import type { ModelRuntime, ExtractionResult } from '@fulcrum/llm/interfaces';
import type { SourceItem } from '@fulcrum/sources/interfaces';
export function extractSource(runtime: ModelRuntime, source: SourceItem, context: { userIdentity: string; signal?: AbortSignal }): Promise<ExtractionResult> {
  return runtime.extract({ userIdentity: context.userIdentity, speaker: source.authorId, text: source.text,
    ...(context.signal ? { signal: context.signal } : {}) });
}
