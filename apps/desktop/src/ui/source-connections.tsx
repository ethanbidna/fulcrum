import { useCallback, useState } from 'react';
import type { ComponentProps } from 'react';
import type { ConnectionRuntimeStatus } from '@fulcrum/domain';
import { ManagedSources } from './managed-sources.js';
import { ConnectionRuntimeControls } from './connection-runtime.js';

export function SourceConnections(props: ComponentProps<typeof ManagedSources>) {
  const [phase, setPhase] = useState<ConnectionRuntimeStatus['phase']>();
  const changed = useCallback((next: ConnectionRuntimeStatus['phase']) => setPhase(next), []);
  return <><ConnectionRuntimeControls {...props} onPhaseChange={changed} />
    <ManagedSources key={phase} {...props} /></>;
}
