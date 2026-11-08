import { readdir, readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { StoreError } from './files.js';

export interface StoreValidators { manifest: ValidateFunction; event: ValidateFunction; checkpoint: ValidateFunction }
let cached: Promise<StoreValidators> | undefined;
export function loadStoreValidators(): Promise<StoreValidators> {
  return cached ??= load();
}
async function load(): Promise<StoreValidators> {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTuples: false, allowUnionTypes: true });
  const addFormats = formats as unknown as (ajv: Ajv2020) => void;
  addFormats(ajv);
  const directory = new URL('../../../schemas/v1/', import.meta.url);
  for (const file of await readdir(directory)) if (file.endsWith('.schema.json')) ajv.addSchema(JSON.parse(await readFile(new URL(file, directory), 'utf8')));
  const get = (file: string) => ajv.getSchema(`https://fulcrum.local/schemas/v1/${file}.schema.json`)!;
  return { manifest: get('workspace'), event: get('change-event'), checkpoint: get('workspace-state') };
}
export function validate(validator: ValidateFunction, value: unknown) {
  if (!validator(value)) throw new StoreError('WORKSPACE_VALIDATION_FAILED', 'Workspace record failed schema validation', validator.errors);
}
