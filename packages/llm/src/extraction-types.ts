export interface Span { start: number; end: number }
export type Candidate = (
  | { kind: 'user_commitment'; text: string; dueHint?: string }
  | { kind: 'external_commitment'; who: string; text: string }
  | { kind: 'state_change'; targetHint: string; newState: string }
  | { kind: 'decision_made'; targetHint: string; optionHint: string }
  | { kind: 'priority_opinion'; targetHint: string; value: string; who: string }
  | { kind: 'new_initiative'; title: string; rationale: string }
  | { kind: 'date'; targetHint: string; date: string }
  | { kind: 'relationship'; fromHint: string; toHint: string; type: 'depends_on' | 'leads_to' }
) & { span: Span };
export interface ExtractionInput {
  userIdentity: string; speaker: string; text: string; signal?: AbortSignal;
}
export type ExtractionResult =
  | { ok: true; candidates: Candidate[]; attempts: number }
  | { ok: false; code: 'invalid_output' | 'unavailable' | 'aborted' | 'deadline' | 'input_limit'; attempts: number };
export interface ModelRuntime { extract(input: ExtractionInput): Promise<ExtractionResult> }
