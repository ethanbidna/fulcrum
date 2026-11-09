import { useEffect, useState } from 'react';
import type { Initiative } from '@fulcrum/schema';
import type { PortfolioBoard } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
export function useInitiative(id: string | undefined, board: PortfolioBoard | undefined, query: CoreTransport['query']) {
  const known = board?.cards.find(card => card.initiative.id === id)?.initiative;
  const [lookup, setLookup] = useState<{ id: string; phase: 'loading' | 'ready' | 'missing'; record?: Initiative }>();
  useEffect(() => {
    if (!id || !board || known) return;
    let disposed = false;
    setLookup(previous => previous?.id === id && previous.record ? previous : { id, phase: 'loading' });
    void query('initiative.get', { id }).then(record => { if (!disposed) setLookup({ id, phase: 'ready', record }); }).catch(() => { if (!disposed) setLookup({ id, phase: 'missing' }); });
    return () => { disposed = true; };
  }, [id, board, known, query]);
  return { initiative: known ?? (lookup?.id === id ? lookup?.record : undefined), loading: !!id && !!board && !known && (lookup?.id !== id || lookup?.phase === 'loading') };
}
