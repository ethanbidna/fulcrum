export interface JsonGeneration { system: string; input: string; schema: Record<string, unknown>; signal?: AbortSignal }
export interface JsonModelRuntime { generate(request: JsonGeneration): Promise<unknown> }
