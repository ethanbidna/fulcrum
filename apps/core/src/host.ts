import type { AppliedChange } from '@fulcrum/domain';
export interface CoreHost {
  observeSystem?(sample: unknown): void;
  configureBackground?(settings: unknown): unknown;
  query(name: string, args: unknown): Promise<unknown>;
  execute(command: unknown): Promise<unknown>;
  planCommand?(request: unknown): Promise<unknown>;
  commandPlanStatus?(id: string): unknown;
  cancelCommandPlan?(id: string): void;
  applyCommandPlan?(id: string): Promise<unknown>;
  mcpQuery?(name: string, args: unknown): Promise<unknown>;
  mcpExecute?(command: unknown): Promise<unknown>;
  subscribe(listener: (change: AppliedChange) => void): () => void;
  close(): Promise<void>;
  ingestionActive(): boolean;
}
