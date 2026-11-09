import type { AppliedChange } from '@fulcrum/domain';
export interface CoreHost {
  query(name: string, args: unknown): Promise<unknown>;
  execute(command: unknown): Promise<unknown>;
  mcpQuery?(name: string, args: unknown): Promise<unknown>;
  mcpExecute?(command: unknown): Promise<unknown>;
  subscribe(listener: (change: AppliedChange) => void): () => void;
  close(): Promise<void>;
  ingestionActive(): boolean;
}
