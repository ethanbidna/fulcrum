// Creates GitHub labels, milestones and issues from backlog/BACKLOG.md using the gh CLI.
// Usage: node tools/create-issues.mjs <owner/repo> [--dry-run]
// Skips issues whose title already exists, so it is safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './reference/schemas.mjs';

const [repo, flag] = process.argv.slice(2);
const DRY_RUN = flag === '--dry-run';
if (!repo) {
  console.error('usage: node tools/create-issues.mjs <owner/repo> [--dry-run]');
  process.exit(1);
}

const LABEL_COLORS = {
  spike: 'd4c5f9', core: '1d76db', store: '0e8a16', ui: 'fbca04', ingestion: 'c5def5',
  ai: '5319e7', mcp: 'bfdadc', packaging: 'f9d0c4', security: 'b60205',
};

function gh(args) {
  if (DRY_RUN) { console.log('gh', args.join(' ')); return ''; }
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function parseBacklog(markdown) {
  const items = [];
  let milestone = null;
  for (const block of markdown.split(/^(?=## |### )/m)) {
    const heading = block.split('\n', 1)[0];
    if (heading.startsWith('## ')) { milestone = heading.slice(3).trim(); continue; }
    if (!heading.startsWith('### ')) continue;
    const lines = block.split('\n').slice(1);
    const labelLine = lines.find(l => l.startsWith('Labels:'));
    const labels = labelLine ? labelLine.slice('Labels:'.length).split(',').map(s => s.trim()) : [];
    const body = lines.filter(l => l !== labelLine).join('\n').trim()
      .replaceAll('](../', `](https://github.com/${repo}/blob/main/`);
    items.push({ title: heading.slice(4).trim(), milestone, labels, body });
  }
  return items;
}

function ensureLabels() {
  for (const [name, color] of Object.entries(LABEL_COLORS)) {
    gh(['label', 'create', name, '--repo', repo, '--color', color, '--force']);
  }
}

function ensureMilestones(items) {
  const existing = DRY_RUN ? [] : JSON.parse(gh(['api', `repos/${repo}/milestones?state=all&per_page=100`])).map(m => m.title);
  for (const title of new Set(items.map(i => i.milestone))) {
    if (!existing.includes(title)) gh(['api', `repos/${repo}/milestones`, '-f', `title=${title}`]);
  }
}

function existingIssueTitles() {
  if (DRY_RUN) return new Set();
  const out = gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '500', '--json', 'title']);
  return new Set(JSON.parse(out).map(i => i.title));
}

const items = parseBacklog(fs.readFileSync(path.join(REPO_ROOT, 'backlog/BACKLOG.md'), 'utf8'));
ensureLabels();
ensureMilestones(items);
const existing = existingIssueTitles();
for (const item of items) {
  if (existing.has(item.title)) continue;
  const footer = `\n\n---\nSource of truth: [backlog/BACKLOG.md](https://github.com/${repo}/blob/main/backlog/BACKLOG.md)`;
  const args = ['issue', 'create', '--repo', repo, '--title', item.title, '--body', item.body + footer, '--milestone', item.milestone];
  for (const label of item.labels) args.push('--label', label);
  const url = gh(args).trim();
  console.log(url || item.title);
}
