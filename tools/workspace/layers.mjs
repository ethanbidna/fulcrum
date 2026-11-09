import path from 'node:path';

const workspacePackage = /(?:^|\/)(?:apps|packages)\/([^/]+)\//;
const packageImport = /^@fulcrum\/([^/]+)(?:\/(.*))?$/;
const driverNames = new Set(['store', 'index', 'sources', 'llm', 'context']);
const interfaceDependencies = {
  domain: new Set(['store', 'index']),
  ingest: driverNames,
};

function isTypeOnly(node) {
  if (node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type') return true;
  return node.specifiers?.length > 0 && node.specifiers.every(specifier => specifier.importKind === 'type' || specifier.exportKind === 'type');
}

function allowsPackage(source, target, subpath, node) {
  if (subpath && subpath !== 'interfaces') return false;
  if (source === 'core' && ['domain', 'store', 'index', 'mcp', 'llm', 'sources', 'ingest', 'context'].includes(target)) return !subpath;
  if (target === 'schema') return !subpath && isTypeOnly(node);
  if (['desktop', 'mcp', 'ingest'].includes(source) && target === 'domain') return !subpath;
  return interfaceDependencies[source]?.has(target) && subpath === 'interfaces' && isTypeOnly(node);
}

function importProblem(source, filename, specifier, node) {
  if (typeof specifier !== 'string') return 'Use a static module path so boundaries can be checked.';
  if (specifier.startsWith('.')) {
    const destination = path.resolve(path.dirname(filename), specifier).replaceAll('\\', '/');
    if (destination.match(workspacePackage)?.[1] === source) return;
    return 'Use a public @fulcrum package entry point across workspace boundaries.';
  }
  const target = specifier.match(packageImport);
  if (target) {
    if (allowsPackage(source, target[1], target[2], node)) return;
    return `${source} cannot import ${specifier} here; use the architecture layer table.`;
  }
  if (/\.test\.[cm]?[jt]sx?$/.test(filename) && specifier === 'vitest') return;
  // Pure layers must not acquire I/O through runtime or third-party modules.
  if (['domain', 'schema', 'ingest'].includes(source)) return `${source} may only import its declared workspace APIs and interfaces.`;
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: { boundary: '{{reason}}' },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const source = filename.match(workspacePackage)?.[1];
    if (!source) return {};
    function check(node, specifier) {
      const reason = importProblem(source, filename, specifier, node);
      if (reason) context.report({ node, messageId: 'boundary', data: { reason } });
    }
    return {
      ImportDeclaration: node => check(node, node.source.value),
      ExportNamedDeclaration: node => { if (node.source) check(node, node.source.value); },
      ExportAllDeclaration: node => check(node, node.source.value),
      ImportExpression: node => check(node, node.source.value),
      TSImportType: node => check(node, node.source.value),
      TSImportEqualsDeclaration: node => check(node, node.moduleReference.expression?.value),
      CallExpression: node => {
        if (node.callee.name === 'require') check(node, node.arguments[0]?.value);
      },
    };
  },
};
