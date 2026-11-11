import type { WorkspaceState } from '@fulcrum/domain';
import { Domain } from '@fulcrum/domain';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
import type { CoreTransport } from '../core-transport.js';
// eslint-disable-next-line fulcrum/layers -- Synthetic test data has no runtime driver access.
import fixture from '../../../../fixtures/states/portfolio.state.json' with { type: 'json' };
export function workshopFixture() {
  const snapshot = structuredClone(fixture) as unknown as WorkspaceStateDoc & {state: WorkspaceState};
  const domain = new Domain(snapshot, [], {
    newId: () => '09000000-0000-7000-8000-000000009999', now: () => '2026-11-10T12:00:00Z',
    deviceId: snapshot.state.devices![0]!.id, userEntityId: snapshot.state.entities[0]!.id,
    validateState: () => [], validateEvent: () => [], commit: async () => { throw new Error('Read-only workshop'); },
  });
  const transport: CoreTransport = { query: (name, args) => domain.query(name, args), execute: async () => ({ ok: false, error: { code: 'WORKSPACE_READ_ONLY', message: 'Read-only synthetic workshop' } }), subscribe: async () => () => {}, close: () => {} };
  return { snapshot, domain, transport, platform: { connectCore: async () => transport } };
}
