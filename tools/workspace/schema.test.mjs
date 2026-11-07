import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { generateSchemaTypes } from './generate-schema.mjs';

test('committed types match every v1 schema and exported definition', async () => {
  const generated = await generateSchemaTypes();
  const committed = await readFile(new URL('../../packages/schema/src/generated.ts', import.meta.url), 'utf8');
  expect(generated).toBe(committed);
  for (const name of ['Initiative', 'FlowObjectGraphNode', 'FlowEdge', 'ChangeEvent', 'WorkspaceJsonManifest', 'WorkspaceStateCheckpointBody', 'Category', 'Question', 'EvidenceRef', 'Moscow']) {
    expect(generated).toMatch(new RegExp(`export (interface|type) ${name}\\b`));
  }
});
