import { Ajv } from 'ajv';
import type { JsonModelRuntime } from './interfaces.js';
import type { Candidate, ExtractionInput, ExtractionResult, ModelRuntime } from './extraction-types.js';
import { CANDIDATE_SCHEMA } from './candidate-schema.js';
import { EXTRACTION_SYSTEM } from './extraction-prompt.js';
const MAX_INPUT_CHARACTERS = 6_000;
const MAX_CANDIDATES = 32;
const MAX_ATTEMPTS = 2;
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
const validate = new Ajv().compile<{ candidates: Candidate[] }>(CANDIDATE_SCHEMA);
export { CANDIDATE_SCHEMA, EXTRACTION_SYSTEM };
export type { Candidate, ExtractionInput, ExtractionResult, ModelRuntime, Span } from './extraction-types.js';
export function validateCandidates(output: unknown, sourceText: string): output is { candidates: Candidate[] } {
  if (!validate(output) || output.candidates.length > MAX_CANDIDATES) return false;
  return output.candidates.every(({ span }) => span.start < span.end && span.end <= sourceText.length
    && sourceText.slice(span.start, span.end).trim().length > 0
    && !splitsSurrogate(sourceText, span.start) && !splitsSurrogate(sourceText, span.end));
}
function splitsSurrogate(text: string, offset: number): boolean {
  const current = text.charCodeAt(offset); const previous = text.charCodeAt(offset - 1);
  return current >= LOW_SURROGATE_MIN && current <= LOW_SURROGATE_MAX && previous >= HIGH_SURROGATE_MIN && previous <= HIGH_SURROGATE_MAX;
}
export class StructuredModelRuntime implements ModelRuntime {
  private busy = false;
  constructor(private readonly generator: JsonModelRuntime) {}
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    if (input.signal?.aborted) return { ok: false, code: 'aborted', attempts: 0 };
    if (!input.userIdentity.trim() || !input.speaker.trim() || !input.text.trim() || input.text.length > MAX_INPUT_CHARACTERS) return { ok: false, code: 'input_limit', attempts: 0 };
    if (this.busy) return { ok: false, code: 'unavailable', attempts: 0 };
    this.busy = true;
    try { return await this.generate(input); } finally { this.busy = false; }
  }
  private async generate(input: ExtractionInput): Promise<ExtractionResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (input.signal?.aborted) return { ok: false, code: 'aborted', attempts: attempt - 1 };
      let output: unknown;
      try {
        output = await this.generator.generate({ system: EXTRACTION_SYSTEM, schema: structuredClone(CANDIDATE_SCHEMA),
          input: JSON.stringify({ userIdentity: input.userIdentity, speaker: input.speaker, sourceText: input.text,
            ...(attempt > 1 ? { repair: 'Previous response failed JSON/schema/evidence validation. Re-extract using the schema and valid offsets.' } : {}) }),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch (error) {
        if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return { ok: false, code: 'aborted', attempts: attempt };
        if (error instanceof Error && error.name === 'TimeoutError') return { ok: false, code: 'deadline', attempts: attempt };
        // Malformed JSON gets one repair; transport/runtime failures do not.
        if (!(error instanceof SyntaxError)) return { ok: false, code: 'unavailable', attempts: attempt };
      }
      if (input.signal?.aborted) return { ok: false, code: 'aborted', attempts: attempt };
      if (validateCandidates(output, input.text)) return { ok: true, candidates: structuredClone(output.candidates), attempts: attempt };
    }
    return { ok: false, code: 'invalid_output', attempts: MAX_ATTEMPTS };
  }
}
