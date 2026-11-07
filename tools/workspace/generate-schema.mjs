import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compile } from 'json-schema-to-typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const schemaDirectory = path.join(root, 'schemas/v1');
const outputFile = path.join(root, 'packages/schema/src/generated.ts');
const banner = '/** Generated from schemas/v1. Run pnpm schema:generate; do not edit. */';

function preserveUnconstrainedValues(value) {
  if (Array.isArray(value)) return value.map(preserveUnconstrainedValues);
  if (!value || typeof value !== 'object') return value;
  // Annotation-only schemas allow scalars and null; the generator infers objects.
  if (Object.keys(value).length === 1 && typeof value.description === 'string') {
    return { ...value, tsType: 'unknown' };
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, preserveUnconstrainedValues(child)]));
}

export async function generateSchemaTypes() {
  const files = (await readdir(schemaDirectory)).filter(file => file.endsWith('.schema.json')).sort();
  const definitions = {};
  const schemas = new Map();
  for (const file of files) {
    const schema = JSON.parse(await readFile(path.join(schemaDirectory, file), 'utf8'));
    schemas.set(file, preserveUnconstrainedValues(schema));
    if (schema.type || schema.oneOf || schema.anyOf) {
      const name = file.replace('.schema.json', '').replace(/(^|-)(\w)/g, (_, separator, letter) => letter.toUpperCase());
      definitions[name] = { $ref: file };
    }
    for (const name of Object.keys(schema.$defs ?? {})) {
      const exportedName = name[0].toUpperCase() + name.slice(1);
      definitions[exportedName] = { $ref: `${file}#/$defs/${name}` };
    }
  }
  return compile({ $defs: definitions }, 'SchemaDefinitions', {
    cwd: schemaDirectory,
    bannerComment: banner,
    unreachableDefinitions: true,
    unknownAny: true,
    $refOptions: {
      resolve: {
        http: false,
        file: {
          order: 1,
          canRead: file => schemas.has(path.basename(file.url)),
          read: file => schemas.get(path.basename(file.url)),
        },
      },
    },
  });
}

async function main() {
  const generated = await generateSchemaTypes();
  if (process.argv.includes('--check')) {
    const committed = await readFile(outputFile, 'utf8').catch(() => null);
    if (committed !== generated) {
      throw new Error('Generated schema types are stale. Run pnpm schema:generate.');
    }
    return;
  }
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, generated);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
