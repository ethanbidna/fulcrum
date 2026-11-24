export interface RuntimeProgress { message: string; completedBytes: number | null; totalBytes: number | null }
export interface RuntimeKeys { encryption: string; jwt: string }
export interface RuntimeKeyStore { read(): Promise<RuntimeKeys | null>; write(keys: RuntimeKeys): Promise<void> }
export interface ConnectorRuntime {
  installed(): Promise<boolean>;
  start(signal: AbortSignal, progress: (progress: RuntimeProgress) => void): Promise<string>;
  install(signal: AbortSignal, progress: (progress: RuntimeProgress) => void): Promise<string>;
  stop(): Promise<void>;
  healthy(origin: string): Promise<boolean>;
}
