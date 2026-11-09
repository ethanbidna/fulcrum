export interface JsonGeneration { system: string; input: string; schema: Record<string, unknown>; signal?: AbortSignal }
export interface JsonModelRuntime { generate(request: JsonGeneration): Promise<unknown> }
export type { Candidate, Span, ExtractionInput, ExtractionResult, ModelRuntime } from './extraction-types.js';
