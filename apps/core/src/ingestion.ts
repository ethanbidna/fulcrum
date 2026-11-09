import { IngestionScheduler } from '@fulcrum/ingest';
import type { IngestionOptions } from '@fulcrum/ingest';
import { SqliteIngestionQueue } from '@fulcrum/sources';
import type { SourceAdapter } from '@fulcrum/sources';
import type { WorkspaceStateDoc } from '@fulcrum/schema';
const POLL_MS = 60_000;
export interface WorkspaceIngestion {
  adapters: SourceAdapter[];
  scopes: Record<string, string[]>;
  process?: IngestionOptions['process'];
}
export async function openIngestion(options: {
  configuration: WorkspaceIngestion; localDirectory: string; workspaceDirectory: string; deviceId: string; userEntityId: string;
  snapshot(): WorkspaceStateDoc;
}) {
  const queue = await SqliteIngestionQueue.open({ ...options, workspaceId: options.snapshot().workspaceId });
  const scheduler = new IngestionScheduler({ queue, adapters: options.configuration.adapters, deviceId: options.deviceId,
    now: () => new Date().toISOString(), ingestionDeviceId: () => options.snapshot().state.settings.ingestionDeviceId ?? undefined,
    recordedSources: () => options.snapshot().state.sources,
    relevance: () => ({ userId: options.userEntityId, terms: options.snapshot().state.initiatives.map(initiative => initiative.title), linkedThreadIds: [], excludedAuthorIds: [] }),
    ...(options.configuration.process ? { process: options.configuration.process } : {}),
  });
  try {
    // Revoked scopes cannot remain active from an earlier launch.
    const connectors = new Set([...queue.scopes().map(scope => scope.connector), ...Object.keys(options.configuration.scopes)]);
    for (const connector of connectors) {
      const scopes = options.configuration.scopes[connector] ?? [];
      if (!options.configuration.adapters.some(adapter => adapter.id === connector)) { queue.configure(connector, []); continue; }
      await scheduler.configure(connector, scopes);
    }
  } catch (error) { queue.close(); throw error; }
  const timer = setInterval(() => { void scheduler.tick().catch(() => scheduler.pause()); }, POLL_MS);
  timer.unref();
  void scheduler.tick().catch(() => scheduler.pause());
  return { scheduler, async close() { clearInterval(timer); await scheduler.close(); queue.close(); } };
}
