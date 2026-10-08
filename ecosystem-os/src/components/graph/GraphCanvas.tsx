'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useNodesInitialized, useReactFlow, type Node, type NodeChange, type Edge } from '@xyflow/react';
import { useApp } from '@/store/app';
import { useAcquisitionOverlay, useAnalysis } from '@/store/useAnalysis';
import { buildGraph, INFRA_CLUSTER, SEGMENT_CLUSTER, type GEdgeData, type GNodeData } from '@/lib/graph/build';
import { EntityNode } from './EntityNode';
import { FlowEdge } from './FlowEdge';

const nodeTypes = { entity: EntityNode };
const edgeTypes = { flow: FlowEdge };

export function GraphCanvas() {
  const a = useAnalysis();
  const acquisition = useAcquisitionOverlay();
  const s = useApp();
  const rf = useReactFlow();
  const focusId = s.hoverId ?? s.selectedId;

  const built = useMemo(() => {
    if (!s.data || !a) return null;
    return buildGraph({
      data: s.data, analysis: a, mode: s.mode, metric: s.metric, expanded: s.expanded, hiddenEdges: s.hiddenEdges, hiddenKinds: s.hiddenKinds,
      verticalFilter: s.verticalFilter, search: s.search, focusId, selectedId: s.selectedId, journeyId: s.journeyId,
      acquisition: s.view === 'opportunities' ? acquisition : null, positions: s.positions, scenarioActive: a.scenarioActive,
    });
  }, [s.data, a, s.mode, s.metric, s.expanded, s.hiddenEdges, s.hiddenKinds, s.verticalFilter, s.search, focusId, s.selectedId, s.journeyId, acquisition, s.view, s.positions]);

  // Nodes are derived from the engine output plus two bits of view state React Flow reports back:
  // measured sizes, and positions of nodes mid-drag (committed to the store when the drag ends).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const nodes = useMemo<Node<GNodeData>[]>(
    () => (built?.nodes ?? []).map((n) => ({ ...n, measured: measured[n.id], position: dragging[n.id] ?? n.position, dragging: !!dragging[n.id] })),
    [built, measured, dragging],
  );

  const onNodesChange = useCallback((changes: NodeChange<Node<GNodeData>>[]) => {
    const dims: Record<string, { width: number; height: number }> = {};
    const moves: Record<string, { x: number; y: number } | null> = {};
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) dims[c.id] = c.dimensions;
      if (c.type === 'position' && c.position) {
        if (c.dragging) moves[c.id] = c.position;
        else { moves[c.id] = null; s.setPosition(c.id, c.position); }
      }
    }
    if (Object.keys(dims).length) setMeasured((m) => ({ ...m, ...dims }));
    if (Object.keys(moves).length) setDragging((d) => {
      const next = { ...d };
      for (const [id, p] of Object.entries(moves)) if (p) next[id] = p; else delete next[id];
      return next;
    });
  }, [s]);

  // Fit to the whole graph or to specific nodes whenever something asks for it — but only once
  // React Flow has measured the nodes, otherwise the bounds are wrong.
  const initialized = useNodesInitialized();
  const allMeasured = nodes.length > 0 && nodes.every((n) => measured[n.id]);
  const lastFit = useRef(0);
  useEffect(() => {
    if (!(initialized || allMeasured) || !s.fitRequest.at || s.fitRequest.at === lastFit.current) return;
    const req = s.fitRequest;
    // Not cancelled on re-render: a fit that was claimed must actually run.
    setTimeout(() => {
      if (lastFit.current === req.at) return;
      lastFit.current = req.at;
      rf.fitView({ nodes: req.ids?.map((id) => ({ id })), duration: 500, padding: req.ids ? 0.5 : 0.16, maxZoom: req.ids ? 1.1 : 1 });
    }, 40);
  }, [s.fitRequest, initialized, allMeasured, rf]);

  // Expanding a vertical or a cluster re-frames the view around what just appeared.
  const prevExpanded = useRef(s.expanded);
  useEffect(() => {
    const added = [...s.expanded].filter((x) => !prevExpanded.current.has(x));
    prevExpanded.current = s.expanded;
    if (added.length > 1) {
      setTimeout(() => s.requestFit(null), 80); // several opened at once (Expand all): show everything
    } else if (added.length === 1) {
      const id = added[0];
      const related = id === SEGMENT_CLUSTER ? s.data?.segments.map((x) => x.id) : id === INFRA_CLUSTER ? ['parent', ...(s.data?.infra.map((x) => x.id) ?? [])] : [id, ...(s.data?.products.filter((p) => p.vertical === id).map((p) => p.id) ?? [])];
      if (related?.length) setTimeout(() => s.requestFit(related), 80);
    }
  }, [s.expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!built) return null;
  return (
    <ReactFlow
      nodes={nodes}
      edges={built.edges as unknown as Edge<GEdgeData>[]}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodeOrigin={[0.5, 0.5]}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => {
        if (n.id === SEGMENT_CLUSTER || n.id === INFRA_CLUSTER) return s.toggleExpanded(n.id);
        const d = n.data as GNodeData;
        if (d.kind === 'vertical' && s.selectedId === n.id) return s.toggleExpanded(n.id);
        s.select(n.id);
        if (d.kind === 'vertical' && !s.expanded.has(n.id) && s.mode !== 'investor') s.toggleExpanded(n.id);
      }}
      onNodeDoubleClick={(_, n) => (n.data as GNodeData).kind === 'vertical' && s.toggleExpanded(n.id)}
      onNodeMouseEnter={(_, n) => s.setHover(n.id)}
      onNodeMouseLeave={() => s.setHover(null)}
      onPaneClick={() => s.select(null)}
      minZoom={0.08}
      maxZoom={2.2}
      onlyRenderVisibleElements={built.nodes.length > 250}
      proOptions={{ hideAttribution: true }}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      elevateEdgesOnSelect={false}
      nodesConnectable={false}
      deleteKeyCode={null}
    >
      <Background id="dots" variant={BackgroundVariant.Dots} gap={28} size={1} color="#1a212b" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        maskColor="rgba(7,9,12,0.72)"
        nodeColor={(n) => (n.data as GNodeData).color}
        nodeStrokeWidth={0}
        style={{ width: 168, height: 112 }}
      />
      <Controls position="bottom-right" showInteractive={false} style={{ marginBottom: 128 }} />
    </ReactFlow>
  );
}
