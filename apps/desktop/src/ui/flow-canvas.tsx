import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Controls, applyNodeChanges } from '@xyflow/react';
import type { ReactFlowInstance, Connection, NodeChange } from '@xyflow/react';
import type { CommandResult, GraphView, PortfolioBoard } from '@fulcrum/domain';
import type { Initiative } from '@fulcrum/schema';
import type { CoreTransport } from '../core-transport.js';
import type { ExecuteCommand } from './new-initiative.js';
import { canvasEdges, layoutGraph, refreshObjects, initialViewport } from './flow-model.js';
import type { CanvasNode, ObjectData } from './flow-model.js';
import { FlowObjectView } from './flow-object.js';
import { ConditionalEdge } from './conditional-edge.js';
import { AddObject, ConnectObjects } from './flow-forms.js';
import { moscowLabels } from './portfolio-model.js';
import '@xyflow/react/dist/style.css';
const nodeTypes = { object: FlowObjectView, frame: ({ data }: { data: { label: string } }) => <span className="flow-group-label">{data.label}</span> };
const edgeTypes = { conditional: ConditionalEdge };
interface Props {
  initiative: Initiative; board: PortfolioBoard; query: CoreTransport['query']; execute: ExecuteCommand;
  undo: () => Promise<CommandResult | null>; canUndo: boolean;
}
export function FlowCanvas(props: Props) { return <ReactFlowProvider><FlowEditor {...props} /></ReactFlowProvider>; }
function FlowEditor({ initiative, board, query, execute, undo, canUndo }: Props) {
  const [graph, setGraph] = useState<GraphView>(); const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [adding, setAdding] = useState(false); const [connection, setConnection] = useState<Connection>();
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string }>();
  const graphShape = useRef('');
  const instance = useRef<ReactFlowInstance<CanvasNode> | null>(null); const layoutGeneration = useRef(0);
  const showStart = (value: CanvasNode[]) => { requestAnimationFrame(() => { void instance.current?.setViewport(initialViewport(value)); }); };
  const arrange = useCallback(async (value: GraphView) => {
    const generation = ++layoutGeneration.current;
    try { const result = await layoutGraph(value); if (generation !== layoutGeneration.current) return; setNodes(result); setSelected(undefined); showStart(result); }
    catch { if (generation === layoutGeneration.current) setError('Could not arrange the graph. Try Auto-layout again.'); }
  }, []);
  useEffect(() => {
    let disposed = false; setError('');
    void query('graph.get', { initiativeId: initiative.id }).then(value => {
      if (disposed) return;
      setGraph(value); setLoading(false);
      setSelected(previous => previous && (previous.kind === 'node' ? value.nodes : value.edges).some(item => item.id === previous.id) ? previous : undefined);
      const shape = JSON.stringify([value.nodes.map(node => [node.id, node.groupId]), value.references.map(node => node.id), value.groups]);
      if (graphShape.current !== shape) { graphShape.current = shape; void arrange(value); }
      else setNodes(previous => refreshObjects(previous, value));
    }).catch(() => { if (!disposed) { setLoading(false); setError('Could not load this graph. Return to initiatives and retry the connection.'); } });
    return () => { disposed = true; };
  }, [initiative.id, board, query, arrange]);
  useEffect(() => () => { layoutGeneration.current++; }, []);
  const run = useCallback<ExecuteCommand>(async command => {
    if (busyRef.current) return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Wait for the current edit to finish.' } };
    busyRef.current = true; setBusy(true); setError('');
    try { return await execute(command); }
    catch { const message = 'Could not save the edit. Check the local core connection and try again.'; return { ok: false, error: { code: 'VALIDATION_FAILED', message } }; }
    finally { busyRef.current = false; setBusy(false); }
  }, [execute]);
  const undoLast = useCallback(async () => {
    if (busyRef.current || !canUndo) return; busyRef.current = true; setBusy(true); setError('');
    try { const result = await undo(); if (result && !result.ok) setError(result.error.message); }
    catch { setError('Could not undo. Check the local core connection and try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  }, [undo, canUndo]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement; if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); void undoLast(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [undoLast]);
  const rename = useCallback(async (id: string, title: string) => {
    const result = await run({ name: 'node.update', args: { id, patch: { title } } });
    if (!result.ok) setError(result.error.message);
    return result.ok;
  }, [run]);
  const rendered = useMemo(() => nodes.map(node => node.type === 'object' ? { ...node, data: { ...node.data, busy, rename } as ObjectData } : node), [nodes, busy, rename]);
  const renderedEdges = useMemo(() => graph ? canvasEdges(graph).map(edge => ({ ...edge, selected: selected?.kind === 'edge' && selected.id === edge.id })) : [], [graph, selected?.kind, selected?.id]);
  const selectNode = useCallback((selection: { nodes: CanvasNode[] }) => {
    const node = selection.nodes.find(node => node.type === 'object' && !(node.data as ObjectData).reference);
    if (node) setSelected(previous => previous?.kind === 'node' && previous.id === node.id ? previous : { kind: 'node', id: node.id });
  }, []);
  const remove = async () => {
    if (!selected) return;
    const result = await run({ name: selected.kind === 'node' ? 'node.delete' : 'edge.delete', args: { id: selected.id } });
    if (result.ok) setSelected(undefined); else setError(result.error.message);
  };
  const label = selected?.kind === 'node' ? graph?.nodes.find(node => node.id === selected.id)?.title : graph?.edges.find(edge => edge.id === selected?.id)?.type.replaceAll('_', ' ');
  return <section className="initiative-flow" aria-label="Initiative flow">
    <div className="initiative-attributes"><span>{initiative.moscow === null ? 'MoSCoW not set' : moscowLabels[initiative.moscow]}</span>{board.categories.filter(category => initiative.categoryIds.includes(category.id)).map(category => <span key={category.id}>{category.label}</span>)}{initiative.targetDate && <span>Due {initiative.targetDate}</span>}</div>
    <div className="flow-toolbar"><div className="toolbar-actions"><button className="primary-button" onClick={() => { setAdding(!adding); setConnection(undefined); }} disabled={busy} aria-expanded={adding}>Add node</button><button className="secondary-button" disabled={busy || !graph || graph.nodes.length < 2} onClick={() => { setAdding(false); setConnection({ source: graph!.nodes[0]!.id, target: graph!.nodes[1]!.id, sourceHandle: null, targetHandle: null }); }}>Connect nodes</button><button className="secondary-button" onClick={() => { if (graph) void arrange(graph); }} disabled={busy || !graph}>Auto-layout</button><button className="secondary-button" onClick={() => { void undoLast(); }} disabled={busy || !canUndo} title="Undo last user edit (⌘Z)">Undo</button></div><div className="flow-selection" role="status">{label ? <><span>{label}</span><button className="secondary-button" disabled={busy} onClick={() => { void remove(); }}>Delete selected {selected?.kind}</button></> : <span>Select a node to rename, or a relationship to delete.</span>}</div></div>
    {adding && <AddObject initiativeId={initiative.id} execute={run} close={() => setAdding(false)} />}
    {connection && graph && <ConnectObjects key={`${connection.source}/${connection.target}`} graph={graph} connection={connection} execute={run} close={() => setConnection(undefined)} />}
    {error && <p className="command-error" role="alert">{error}</p>}
    {loading ? <p role="status">Opening the graph…</p> : <><div className="flow-canvas" aria-label="Flow canvas" aria-busy={busy}><ReactFlow<CanvasNode> nodes={rendered} edges={renderedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={value => { instance.current = value; showStart(nodes); }} onNodesChange={(changes: NodeChange<CanvasNode>[]) => setNodes(previous => applyNodeChanges(changes.filter(change => change.type !== 'remove'), previous))} onSelectionChange={selectNode} onNodeClick={(_, node) => { if (node.type === 'object' && !(node.data as ObjectData).reference) setSelected({ kind: 'node', id: node.id }); }} onEdgeClick={(_, edge) => setSelected({ kind: 'edge', id: edge.id })} onPaneClick={() => setSelected(undefined)} onConnect={value => { setAdding(false); setConnection(value); }} nodesDraggable={!busy} nodesConnectable={!busy} edgesReconnectable={false} deleteKeyCode={null} minZoom={0.2} maxZoom={1.5} ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': 'Zoom in', 'controls.zoomOut.ariaLabel': 'Zoom out', 'controls.fitView.ariaLabel': 'Fit graph', 'node.a11yDescription.default': 'Press Enter or Space to select. Use arrow keys to move the node. Drag between handles to propose a relationship.' }}><Controls showInteractive={false} />{graph?.nodes.length === 0 && <div className="flow-empty"><h2>Start with your next step</h2><p>Add your own Task, an external Dependency, a Decision or a Milestone.</p></div>}</ReactFlow></div><p className="flow-help">Drag to pan; scroll to zoom. Node positions are local to this view. Select a node, then Rename. ⌘Z undoes your last saved edit.</p></>}
  </section>;
}
