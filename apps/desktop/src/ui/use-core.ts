import { useCallback, useEffect, useState, useRef } from 'react';
import type { CommandEnvelope, PortfolioBoard, CommandRequest } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import type { Platform } from '../platform/platform.js';
export type CoreState =
  | { phase: 'connecting' }
  | { phase: 'unavailable' }
  | { phase: 'connected'; questionCount: number; initiativeCount: number; board: PortfolioBoard };
const CORE_REFRESH_INTERVAL_MS = 30_000;
export function useCore(platform: Platform) {
  const undoEvents = useRef<string[]>([]);
  const [undoVersion, setUndoVersion] = useState(0);
  const currentTransport = useRef<CoreTransport | undefined>(undefined);
  const refreshCurrent = useRef<() => Promise<void>>(async () => {});
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
        const board = await transport!.query('portfolio.board', {});
        if (!disposed && current === generation) setState({ phase: 'connected', board, questionCount: board.rail.questionCount, initiativeCount: board.cards.length });
      } catch { if (!disposed && current === generation) setState({ phase: 'unavailable' }); }
    };
    refreshCurrent.current = refresh;
    void (async () => {
      try {
        transport = await platform.connectCore();
        if (disposed) { transport.close(); return; }
        currentTransport.current = transport;
        stop = await transport.subscribe(() => { void refresh(); });
        if (disposed) { stop(); transport.close(); return; }
        await refresh();
        if (!disposed) refreshTimer = setInterval(() => { void refresh(); }, CORE_REFRESH_INTERVAL_MS);
      } catch { if (!disposed) setState({ phase: 'unavailable' }); }
    })();
    return () => { disposed = true; currentTransport.current = undefined; clearInterval(refreshTimer); stop?.(); transport?.close(); };
  }, [platform, attempt]);
  const execute = useCallback(async (command: Omit<CommandEnvelope, 'actor'>) => {
    const transport = currentTransport.current;
    if (!transport) throw new Error('CORE_UNAVAILABLE');
    const result = await transport.execute(command);
    if (result.ok) {
      if (command.name === 'change.undo') undoEvents.current = undoEvents.current.filter(id => id !== command.args.eventId);
      else undoEvents.current.push(result.eventId);
      setUndoVersion(value => value + 1);
    }
    if (currentTransport.current === transport) await refreshCurrent.current();
    return result;
  }, []);
  const query: CoreTransport['query'] = useCallback((name, args) => {
    if (!currentTransport.current) return Promise.reject(new Error('Local core unavailable. Retry the connection.'));
    return currentTransport.current.query(name, args);
  }, []);
  const undo = useCallback(async () => {
    const eventId = undoEvents.current.at(-1); if (!eventId) return null;
    const result = await execute({ name: 'change.undo', args: { eventId } });
    return result;
  }, [execute]);
  const planCommand = useCallback((request: CommandRequest) => {
    const transport = currentTransport.current;
    if (!transport?.planCommand) return Promise.reject(new Error('Local command planning is unavailable in this build.'));
    return transport.planCommand(request);
  }, []);
  const cancelCommandPlan = useCallback(async () => { await currentTransport.current?.cancelCommandPlan?.(); }, []);
  const applyCommandPlan = useCallback(async (id: string) => {
    const transport = currentTransport.current;
    if (!transport?.applyCommandPlan) throw new Error('Local command planning is unavailable in this build.');
    const result = await transport.applyCommandPlan(id);
    if (result.ok) { undoEvents.current.push(result.eventId); setUndoVersion(value => value + 1); }
    if (currentTransport.current === transport) await refreshCurrent.current();
    return result;
  }, []);
  return { state, execute, query, planCommand, cancelCommandPlan, applyCommandPlan, undo, canUndo: undoVersion > 0 && undoEvents.current.length > 0, retry: useCallback(() => setAttempt(value => value + 1), []) };
}
