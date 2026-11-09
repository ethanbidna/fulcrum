import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
const ROUTE_LABEL_GAP = 24;
export function ConditionalEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props);
  return <><BaseEdge id={props.id} path={path} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} {...(props.style ? { style: props.style } : {})} {...(props.interactionWidth === undefined ? {} : { interactionWidth: props.interactionWidth })} />
    <EdgeLabelRenderer><div className="conditional-route-label" style={{ transform: `translate(-50%, -100%) translate(${props.targetX}px,${props.targetY - ROUTE_LABEL_GAP}px)` }}>{props.label}</div></EdgeLabelRenderer></>;
}
