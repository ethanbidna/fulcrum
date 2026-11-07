import { describe, expect, test } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();
async function violations(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter(message => message.ruleId === 'fulcrum/layers');
}

describe('architecture import boundaries', () => {
  test.each([
    ['apps/desktop/src/index.ts', "import type { Domain } from '@fulcrum/domain';"],
    ['packages/mcp/src/index.ts', "export { execute } from '@fulcrum/domain';"],
    ['packages/domain/src/index.ts', "import type { Store } from '@fulcrum/store/interfaces';"],
    ['packages/domain/src/index.ts', "import { type Index } from '@fulcrum/index/interfaces';"],
    ['packages/ingest/src/index.ts', "import type { Source } from '@fulcrum/sources/interfaces';"],
    ['packages/store/src/index.ts', "import fs from 'node:fs';"],
    ['packages/domain/src/index.ts', "import { helper } from './helper.js';"],
    ['packages/domain/src/domain.test.ts', "import { test } from 'vitest';"],
    ['packages/schema/src/index.ts', "export type { Initiative } from './generated.js';"],
  ])('allows %s: %s', async (file, source) => {
    expect(await violations(file, source)).toEqual([]);
  });

  test.each([
    ['apps/desktop/src/index.ts', "import { Store } from '@fulcrum/store';"],
    ['packages/mcp/src/index.ts', "export * from '@fulcrum/index';"],
    ['packages/domain/src/index.ts', "import { Store } from '@fulcrum/store/interfaces';"],
    ['packages/domain/src/index.ts', "import type { Store } from '@fulcrum/store';"],
    ['packages/domain/src/index.ts', "import fs from 'fs/promises';"],
    ['packages/domain/src/index.ts', "const fs = import('node:fs');"],
    ['packages/domain/src/index.ts', "import { invoke } from '@tauri-apps/api/core';"],
    ['packages/domain/src/index.ts', "import client from 'axios';"],
    ['packages/ingest/src/index.ts', "import fs from 'node:fs';"],
    ['packages/ingest/src/index.ts', "import type { Source } from '@fulcrum/sources/private';"],
    ['packages/store/src/index.ts', "import type { Domain } from '@fulcrum/domain';"],
    ['packages/mcp/src/index.ts', "import { execute } from '../../domain/src/private.js';"],
    ['packages/domain/src/index.ts', "export type { Store } from '../../store/src/interfaces.js';"],
    ['packages/domain/src/index.ts', "type Store = import('@fulcrum/store').Store;"],
    ['packages/domain/src/index.ts', "const fs = require('node:fs');"],
    ['packages/domain/src/index.ts', "const module = import(variable);"],
  ])('rejects %s: %s', async (file, source) => {
    expect(await violations(file, source)).toHaveLength(1);
  });
});
