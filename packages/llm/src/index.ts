import type { JsonGeneration, JsonModelRuntime } from './interfaces.js';
export type { JsonGeneration, JsonModelRuntime } from './interfaces.js';
const DEFAULT_ORIGIN = 'http://127.0.0.1:11434';
const REQUEST_DEADLINE_MS = 120_000;
const MAX_OUTPUT_BYTES = 128 * 1024;
const OUTPUT_TOKENS = 1024;
const CONTEXT_TOKENS = 4096;
const BACKGROUND_THREADS = 4;
const APPROVED_MODELS = ['qwen3:4b-instruct-2507-q4_K_M', 'llama3.2:3b', 'llama3.1:8b', 'qwen3.5:4b', 'gemma4:e4b'];
export class OllamaJsonRuntime implements JsonModelRuntime {
  private readonly endpoint: URL;
  constructor(private readonly model = APPROVED_MODELS[0]!, origin = DEFAULT_ORIGIN, private readonly request = fetch) {
    const address = new URL(origin);
    if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.username || address.password || address.search || address.hash || address.pathname !== '/' || !APPROVED_MODELS.includes(model)) throw new Error('LOCAL_APPROVED_MODEL_REQUIRED');
    this.endpoint = new URL('/api/chat', address);
  }
  async generate(input: JsonGeneration): Promise<unknown> {
    const timeout = AbortSignal.timeout(REQUEST_DEADLINE_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await this.request(this.endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ model: this.model, stream: false, think: false, format: input.schema, messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.input }], options: { temperature: 0, num_predict: OUTPUT_TOKENS, num_ctx: CONTEXT_TOKENS, num_thread: BACKGROUND_THREADS } }) });
    if (!response.ok) throw new Error('LOCAL_MODEL_UNAVAILABLE');
    const value = await response.json() as { message?: { content?: string } };
    const content = value.message?.content;
    if (typeof content !== 'string' || new TextEncoder().encode(content).length > MAX_OUTPUT_BYTES) throw new Error('INVALID_MODEL_RESPONSE');
    return JSON.parse(content) as unknown;
  }
}

import { StructuredModelRuntime } from './extraction.js';
export { StructuredModelRuntime, CANDIDATE_SCHEMA, EXTRACTION_SYSTEM, validateCandidates } from './extraction.js';
export type { Candidate, Span, ExtractionInput, ExtractionResult, ModelRuntime } from './extraction.js';
export class OllamaModelRuntime extends StructuredModelRuntime {
  constructor(model: string, origin = DEFAULT_ORIGIN, request = fetch) {
    super(new OllamaJsonRuntime(model, origin, request));
  }
}
