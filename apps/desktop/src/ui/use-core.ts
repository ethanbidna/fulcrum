import { useCallback, useEffect, useState } from 'react';
import type { Platform } from '../platform/platform.js';
export type CoreState =
  | { phase: 'connecting' }
  | { phase: 'unavailable' }
  | { phase: 'connected'; questionCount: number; initiativeCount: number };
const CORE_REFRESH_INTERVAL_MS = 30_000;
export function useCore(platform: Platform) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CoreState>({ phase: 'connecting' });
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let transport: Awaited<ReturnType<Platform['connectCore']>> | undefined;
    let stop: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    setState({ phase: 'connecting' });
    const refresh = async () => {
      const current = ++generation;
      try {
        const [rail, initiatives] = await Promise.all([
          transport!.query('portfolio.rail', {}), transport!.query('portfolio.list', {}),
        ]);
        if (!disposed && current === generation) setState({ phase: 'connected', questionCount: rail.questionCount, initiativeCount: initiatives.length });
      } catch { if (!disposed && current === generation) setState({ phase: 'unavailable' }); }
    };
    void (async () => {
      try {
        transport = await platform.connectCore();
        if (disposed) { transport.close(); return; }
        stop = await transport.subscribe(() => { void refresh(); });
        if (disposed) { stop(); transport.close(); return; }
        await refresh();
        if (!disposed) refreshTimer = setInterval(() => { void refresh(); }, CORE_REFRESH_INTERVAL_MS);
      } catch { if (!disposed) setState({ phase: 'unavailable' }); }
    })();
    return () => { disposed = true; clearInterval(refreshTimer); stop?.(); transport?.close(); };
  }, [platform, attempt]);
  return { state, retry: useCallback(() => setAttempt(value => value + 1), []) };
}
