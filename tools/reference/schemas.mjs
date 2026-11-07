// Loads schemas/v1 into one Ajv instance so cross-file $refs resolve.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_DIR = path.join(REPO_ROOT, 'schemas/v1');
const SCHEMA_BASE = 'https://fulcrum.local/schemas/v1/';

export function loadValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTuples: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const file of fs.readdirSync(SCHEMA_DIR).filter(f => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8')));
  }
  const get = name => ajv.getSchema(SCHEMA_BASE + name);
  return {
    workspace: get('workspace.schema.json'),
    workspaceState: get('workspace-state.schema.json'),
    changeEvent: get('change-event.schema.json'),
    flowObject: get('flow-object.schema.json'),
    question: ajv.getSchema(SCHEMA_BASE + 'records.schema.json#/$defs/question'),
    initiative: get('initiative.schema.json'),
  };
}

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}
