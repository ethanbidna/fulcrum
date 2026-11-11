import type { WorkspaceStateDoc } from '@fulcrum/schema';
import type { CommandName } from '@fulcrum/domain';
import { SocketClient } from '../src/socket-client.js';
export async function seedPortfolio(socketPath: string, secret: string, snapshot: WorkspaceStateDoc) {
  const client = await SocketClient.connect(socketPath, secret);
  const state = snapshot.state;
  const collections = [
    ['devices', 'device.register'], ['entities', 'entity.create'], ['categories', 'category.create'],
    ['objectives', 'objective.create'], ['sources', 'source.record'], ['initiatives', 'initiative.create'],
    ['groups', 'group.create'], ['nodes', 'node.create'], ['edges', 'edge.create'],
    ['assertions', 'assertion.record'], ['questions', 'question.raise'],
  ] as const;
  try {
    for (const [collection, command] of collections) for (const record of state[collection] ?? []) {
      const name: CommandName = collection === 'initiatives' && 'lifecycle' in record && record.lifecycle === 'proposed' ? 'initiative.propose' : command;
      const result = await client.request('execute', { name, args: { record } }) as { ok: boolean; error?: { code: string } };
      if (!result.ok) throw new Error(`SYNTHETIC_SEED_FAILED:${collection}:${result.error?.code}`);
    }
  } finally { client.close(); }
}
