import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, getBezierPath,
  applyNodeChanges, useReactFlow,
  type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { ArrowRight, Check, Clipboard, Code2, LayoutTemplate, Plus, Trash2, X } from "lucide-react";
import { edgeId, lastIdentifierPart, parsePropertyGraphWithRanges, sameIdentifier, serializePropertyGraph, vertexId, type EdgeTable, type PropertyGraph, type PropertyMode, type TableRange, type VertexTable } from "../lib/pgq";
import { editPropertyGraphSql } from "../lib/editSql";
import { placeEdgeCards, type EdgePlacement, type LayoutEdge } from "../lib/edgePlacement";
import { SqlCodeEditor, type SqlCodeEditorHandle } from "./SqlCodeEditor";
import "@xyflow/react/dist/style.css";
import "./PropertyGraphVisualizer.css";

type Selection = { kind: "vertex" | "edge"; id: string } | null;
type TableData = { table: VertexTable; edgeCount: number; color: string };
type TableNode = Node<TableData, "table">;
type ThemeMode = "auto" | "light" | "dark";

const same = sameIdentifier;
const list = (value: string) => value.split(",").map(part => part.trim()).filter(Boolean);
const simpleName = (value: string) => lastIdentifierPart(value).replaceAll('"', "");
const safeName = (value: string) => {
  const normalized = simpleName(value).replace(/[^A-Za-z0-9_]/g, "_").toLowerCase();
  return /^[a-z_]/.test(normalized) ? normalized : `n_${normalized}`;
};
const vertexColors = ["#d78476", "#ad8bd8", "#d77b9e", "#86b895", "#82a7d0"];
const edgeColors = ["#61c2a2", "#9fca61", "#b18add", "#de9b78", "#71a9d0"];

function PropertyRows({ mode, properties }: { mode: PropertyMode; properties: string[] }) {
  const rows = mode === "all" ? ["All columns"] : mode === "none" ? ["No properties"] : properties;
  return <>
    {rows.slice(0, 3).map((property, i) => <div className="pgq-property-row" key={`${property}-${i}`}><span className="pgq-row-mark">{mode === "all" ? "✳" : "·"}</span><span>{property}</span></div>)}
    {rows.length > 3 && <div className="pgq-table-more">+{rows.length - 3} more</div>}
  </>;
}

function TableCard({ data }: NodeProps<TableNode>) {
  const { table, edgeCount, color } = data;
  return <div className="pgq-table-card" style={{ "--pgq-card-accent": color } as CSSProperties}>
    <Handle id="left-in" type="target" position={Position.Left} className="pgq-handle pgq-handle-left-in" title="Connect an edge here" />
    <Handle id="left-out" type="source" position={Position.Left} className="pgq-handle pgq-handle-left-out" />
    <Handle id="right-in" type="target" position={Position.Right} className="pgq-handle pgq-handle-right-in" />
    <Handle id="right-out" type="source" position={Position.Right} className="pgq-handle pgq-handle-right-out" title="Drag to create an edge" />
    <Handle id="top-in" type="target" position={Position.Top} className="pgq-handle pgq-handle-top-in" />
    <Handle id="top-out" type="source" position={Position.Top} className="pgq-handle pgq-handle-top-out" />
    <Handle id="bottom-in" type="target" position={Position.Bottom} className="pgq-handle pgq-handle-bottom-in" />
    <Handle id="bottom-out" type="source" position={Position.Bottom} className="pgq-handle pgq-handle-bottom-out" />
    <div className="pgq-table-header"><strong>{table.label}</strong><span className="pgq-edge-count">{edgeCount} {edgeCount === 1 ? "edge" : "edges"}</span></div>
    <div className="pgq-table-body">
      <div className="pgq-table-label">Table · {table.table}{table.alias ? ` as ${table.alias}` : ""}</div>
      <div className="pgq-card-divider" />
      <div className="pgq-table-row"><span className="pgq-row-type">KEY</span><span>{table.key.length ? table.key.join(", ") : "Inferred key"}</span></div>
      <PropertyRows mode={table.propertyMode} properties={table.properties} />
    </div>
  </div>;
}

const nodeTypes = { table: TableCard };

function CurvedEdge(props: EdgeProps) {
  const isLoop = props.source === props.target;
  const data = props.data as { table?: string; properties?: string[]; propertyMode?: PropertyMode; color?: string; placement?: EdgePlacement; onSelect?: (id: string) => void; onMove?: (id: string, position: { x: number; y: number }) => void } | undefined;
  const { screenToFlowPosition } = useReactFlow();
  const drag = useRef<{ pointer: { x: number; y: number }; card: { x: number; y: number } } | null>(null);
  const didDrag = useRef(false);
  const offset = data?.placement?.bend || 0;
  const dx = props.targetX - props.sourceX;
  const dy = props.targetY - props.sourceY;
  const length = Math.hypot(dx, dy) || 1;
  const bendX = -dy / length * offset;
  const bendY = dx / length * offset;
  const routePoint = data?.placement?.routePoint;
  const midpoint = { x: (props.sourceX + props.targetX) / 2, y: (props.sourceY + props.targetY) / 2 };
  const control = routePoint ? { x: midpoint.x + (routePoint.x - midpoint.x) * 4 / 3, y: midpoint.y + (routePoint.y - midpoint.y) * 4 / 3 } : null;
  const [path, fallbackX, fallbackY] = control
    ? [`M ${props.sourceX},${props.sourceY} C ${control.x},${control.y} ${control.x},${control.y} ${props.targetX},${props.targetY}`, routePoint!.x, routePoint!.y] as const
    : isLoop
    ? [`M ${props.sourceX},${props.sourceY} C ${props.sourceX + 130},${Math.min(props.sourceY, props.targetY) - 190 - offset} ${props.targetX - 130},${Math.min(props.sourceY, props.targetY) - 190 - offset} ${props.targetX},${props.targetY}`, (props.sourceX + props.targetX) / 2, Math.min(props.sourceY, props.targetY) - 100 - offset * .75] as const
    : offset ? [`M ${props.sourceX},${props.sourceY} C ${props.sourceX + dx * .35 + bendX * 1.33},${props.sourceY + dy * .35 + bendY * 1.33} ${props.sourceX + dx * .65 + bendX * 1.33},${props.sourceY + dy * .65 + bendY * 1.33} ${props.targetX},${props.targetY}`, (props.sourceX + props.targetX) / 2 + bendX, (props.sourceY + props.targetY) / 2 + bendY] as const
    : getBezierPath({ sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition, targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition, curvature: .38 });
  const labelX = data?.placement?.x ?? fallbackX;
  const labelY = data?.placement?.y ?? fallbackY;
  return <>
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={26} />
    <EdgeLabelRenderer>
      <div className={`pgq-edge-card nodrag nopan ${props.selected ? "pgq-edge-card-selected" : ""}`} style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all", "--pgq-edge-accent": data?.color } as CSSProperties} role="button" tabIndex={0} aria-label={`Select or drag edge ${props.label}`} onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointer: screenToFlowPosition({ x: event.clientX, y: event.clientY }), card: { x: labelX, y: labelY } }; didDrag.current = false; data?.onSelect?.(props.id); }} onPointerMove={event => { if (!drag.current) return; const point = screenToFlowPosition({ x: event.clientX, y: event.clientY }); const delta = { x: point.x - drag.current.pointer.x, y: point.y - drag.current.pointer.y }; if (Math.hypot(delta.x, delta.y) > 3) didDrag.current = true; if (didDrag.current) data?.onMove?.(props.id, { x: drag.current.card.x + delta.x, y: drag.current.card.y + delta.y }); }} onPointerUp={event => { if (drag.current) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onClick={event => { if (didDrag.current) { event.preventDefault(); didDrag.current = false; } else data?.onSelect?.(props.id); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); data?.onSelect?.(props.id); } }}>
        <div className="pgq-edge-card-title">{props.label}</div>
        <div className="pgq-edge-card-table">Table · {data?.table}</div>
        <div className="pgq-card-divider" />
        <PropertyRows mode={data?.propertyMode || "all"} properties={data?.properties || []} />
      </div>
    </EdgeLabelRenderer>
  </>;
}

const edgeTypes = { curved: CurvedEdge };

function layoutNodes(graph: PropertyGraph): TableNode[] {
  const engine = new dagre.graphlib.Graph();
  engine.setDefaultEdgeLabel(() => ({}));
  engine.setGraph({ rankdir: "LR", nodesep: 170, ranksep: 300, marginx: 100, marginy: 120 });
  graph.vertices.forEach(vertex => engine.setNode(vertexId(vertex), { width: 242, height: 190 }));
  graph.edges.forEach(edge => engine.setEdge(edge.source.table, edge.destination.table));
  dagre.layout(engine);
  return graph.vertices.map((table, index) => {
    const id = vertexId(table);
    const point = engine.node(id) || { x: 0, y: 0 };
    return { id, type: "table", position: { x: point.x - 121, y: point.y - 95 }, data: { table, edgeCount: graph.edges.filter(edge => same(edge.source.table, id) || same(edge.destination.table, id)).length, color: vertexColors[index % vertexColors.length] } };
  });
}

function flowEdges(graph: PropertyGraph, nodes: TableNode[], selection: Selection, onSelect: (id: string) => void, onMove: (id: string, position: { x: number; y: number }) => void, preferredPositions: Record<string, { x: number; y: number }>): Edge[] {
  const byId = new Map(nodes.map(node => [node.id, node.position]));
  const routed: LayoutEdge[] = graph.edges.map(edge => {
    const source = byId.get(edge.source.table) || { x: 0, y: 0 };
    const target = byId.get(edge.destination.table) || { x: 0, y: 0 };
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    let sourceHandle = "right-out";
    let targetHandle = "left-in";
    if (edge.source.table === edge.destination.table) { sourceHandle = "right-out"; targetHandle = "left-in"; }
    else if (Math.abs(dx) >= Math.abs(dy) * 0.8) {
      if (dx < 0) { sourceHandle = "left-out"; targetHandle = "right-in"; }
    } else if (dy >= 0) { sourceHandle = "bottom-out"; targetHandle = "top-in"; }
    else { sourceHandle = "top-out"; targetHandle = "bottom-in"; }
    return { id: edgeId(edge), source: edge.source.table, target: edge.destination.table, sourceHandle, targetHandle };
  });
  const placements = placeEdgeCards(nodes.map(node => ({ id: node.id, position: node.position, width: node.measured?.width || 242, height: node.measured?.height || 190 })), routed, preferredPositions);
  return graph.edges.map((edge, index) => {
    const route = routed[index];
    const selected = selection?.kind === "edge" && selection.id === edgeId(edge);
    return {
      ...route,
      type: "curved", label: edge.label, selected, data: { table: edge.table, properties: edge.properties, propertyMode: edge.propertyMode, color: edgeColors[index % edgeColors.length], placement: placements[edgeId(edge)], onSelect, onMove },
      style: { stroke: edgeColors[index % edgeColors.length], strokeWidth: selected ? 3.4 : 2.4, strokeLinecap: "round" },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[index % edgeColors.length], width: 17, height: 17 },
    };
  });
}

function Field({ label, value, onCommit, hint }: { label: string; value: string; onCommit: (value: string) => void; hint?: string }) {
  return <label className="pgq-field"><span>{label}</span><input key={`${label}:${value}`} defaultValue={value} onBlur={event => { if (event.target.value !== value) onCommit(event.target.value.trim()); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />{hint && <small>{hint}</small>}</label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="pgq-field"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
}

export interface PropertyGraphVisualizerProps {
  value: string;
  onChange: (sql: string) => void;
  theme?: ThemeMode;
  className?: string;
}

function Visualizer({ value, onChange, theme = "auto", className = "" }: PropertyGraphVisualizerProps) {
  const initial = useMemo(() => { try { return parsePropertyGraphWithRanges(value); } catch { return null; } }, []);
  const [graph, setGraph] = useState<PropertyGraph | null>(initial?.graph || null);
  const [ranges, setRanges] = useState<TableRange[]>(initial?.ranges || []);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [flowNodes, setFlowNodes] = useState<TableNode[]>(() => initial ? layoutNodes(initial.graph) : []);
  const positions = useRef<Record<string, { x: number; y: number }>>({});
  const cursorPosition = useRef<number | null>(null);
  const cursorDriven = useRef(false);
  const pendingSelection = useRef<Exclude<Selection, null> | null>(null);
  const pendingVertexRename = useRef<{ from: string; to: string } | null>(null);
  const pendingEdgeRename = useRef<{ from: string; to: string } | null>(null);
  const sqlEditor = useRef<SqlCodeEditorHandle>(null);
  const [copied, setCopied] = useState(false);
  const [edgePositions, setEdgePositions] = useState<Record<string, { x: number; y: number }>>({});
  const { fitView, screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    try {
      const parsed = parsePropertyGraphWithRanges(value);
      setGraph(parsed.graph); setRanges(parsed.ranges); setError(null); setEditError(null);
      if (pendingVertexRename.current && parsed.ranges.some(range => range.kind === "vertex" && range.id === pendingVertexRename.current!.to)) {
        const { from, to } = pendingVertexRename.current;
        if (positions.current[from]) positions.current[to] = positions.current[from];
        delete positions.current[from];
      }
      pendingVertexRename.current = null;
      if (pendingEdgeRename.current && parsed.ranges.some(range => range.kind === "edge" && range.id === pendingEdgeRename.current!.to)) {
        const { from, to } = pendingEdgeRename.current;
        setEdgePositions(current => {
          const next = { ...current };
          if (next[from]) next[to] = next[from];
          delete next[from];
          return next;
        });
      }
      pendingEdgeRename.current = null;
      if (pendingSelection.current) {
        const pending = pendingSelection.current;
        if (parsed.ranges.some(range => range.kind === pending.kind && range.id === pending.id)) setSelection(pending);
        pendingSelection.current = null;
      } else if (cursorDriven.current && cursorPosition.current !== null) {
        const found = parsed.ranges.find(range => cursorPosition.current! >= range.from && cursorPosition.current! <= range.to);
        setSelection(found ? { kind: found.kind, id: found.id } : null);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not parse SQL"); }
  }, [value]);

  const structuralKey = graph ? `${graph.name}:${graph.vertices.map(vertexId).join("|")}:${graph.edges.map(edge => `${edgeId(edge)}:${edge.source.table}:${edge.destination.table}`).join("|")}` : "";
  useEffect(() => {
    if (!graph) return;
    setFlowNodes(layoutNodes(graph).map(node => ({ ...node, position: positions.current[node.id] || node.position })));
  }, [graph]);
  useEffect(() => {
    if (!structuralKey) return;
    const frame = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300, maxZoom: 1 }));
    return () => cancelAnimationFrame(frame);
  }, [fitView, structuralKey]);

  const emit = useCallback((next: PropertyGraph) => {
    if (error || !graph) return false;
    try {
      const current = parsePropertyGraphWithRanges(value);
      if (serializePropertyGraph(current.graph) !== serializePropertyGraph(graph)) throw new Error("Wait for the current SQL update before editing the graph");
      const sql = editPropertyGraphSql(value, current.graph, next, current);
      const parsed = parsePropertyGraphWithRanges(sql);
      if (serializePropertyGraph(parsed.graph) !== serializePropertyGraph(next)) throw new Error("The SQL edit changed the graph unexpectedly");
      setEditError(null);
      cursorDriven.current = false;
      onChange(sql);
      return true;
    } catch (reason) { setEditError(reason instanceof Error ? reason.message : "Invalid graph edit"); return false; }
  }, [error, graph, onChange, value]);

  const selectOnCanvas = (next: Selection) => {
    cursorDriven.current = false;
    setSelection(next);
    const range = ranges.find(item => item.kind === next?.kind && item.id === next.id);
    if (range) sqlEditor.current?.reveal(range.from);
  };

  const onCursor = (position: number) => {
    cursorDriven.current = true;
    cursorPosition.current = position;
    const range = ranges.find(item => position >= item.from && position <= item.to);
    setSelection(range ? { kind: range.kind, id: range.id } : null);
  };

  const addVertex = () => {
    if (!graph) return;
    let n = graph.vertices.length + 1;
    while (graph.vertices.some(vertex => same(vertexId(vertex), `new_table_${n}`))) n++;
    const name = `new_table_${n}`;
    if (emit({ ...graph, vertices: [...graph.vertices, { kind: "vertex", table: name, key: ["id"], label: name, properties: [], propertyMode: "all" }] })) pendingSelection.current = { kind: "vertex", id: name };
  };

  const connect = (connection: Connection) => {
    if (!graph || error || !connection.source || !connection.target) return;
    const source = graph.vertices.find(vertex => vertexId(vertex) === connection.source);
    const destination = graph.vertices.find(vertex => vertexId(vertex) === connection.target);
    if (!source || !destination) return;
    const base = `${safeName(vertexId(source))}_to_${safeName(vertexId(destination))}`;
    let name = base; let n = 2;
    while (graph.edges.some(edge => same(edgeId(edge), name)) || graph.vertices.some(vertex => same(vertexId(vertex), name))) name = `${base}_${n++}`;
    const sourceKey = source.key.length ? source.key : ["id"];
    const destinationKey = destination.key.length ? destination.key : ["id"];
    const edge: EdgeTable = { kind: "edge", table: name, key: ["id"], label: name, properties: [], propertyMode: "all",
      source: { columns: sourceKey.map(key => `${safeName(vertexId(source))}_${safeName(key)}`), table: vertexId(source), references: sourceKey },
      destination: { columns: destinationKey.map(key => `${safeName(vertexId(destination))}_${safeName(key)}`), table: vertexId(destination), references: destinationKey } };
    if (emit({ ...graph, edges: [...graph.edges, edge] })) pendingSelection.current = { kind: "edge", id: name };
  };

  const connectOnNodeDrop = (event: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromNode: { id: string } | null; fromHandle: { type: string } | null }) => {
    if (state.isValid || !state.fromNode || error) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!point) return;
    const position = screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const target = flowNodes.find(node => {
      const width = node.measured?.width || 242;
      const height = node.measured?.height || 165;
      return position.x >= node.position.x - 16 && position.x <= node.position.x + width + 16 && position.y >= node.position.y - 16 && position.y <= node.position.y + height + 16;
    });
    if (!target) return;
    const from = state.fromNode.id;
    connect({ source: state.fromHandle?.type === "target" ? target.id : from, target: state.fromHandle?.type === "target" ? from : target.id, sourceHandle: null, targetHandle: null });
  };

  const reconnect = (oldFlowEdge: Edge, connection: Connection) => {
    if (!graph || error || !connection.source || !connection.target) return;
    const old = graph.edges.find(edge => edgeId(edge) === oldFlowEdge.id);
    const source = graph.vertices.find(vertex => vertexId(vertex) === connection.source);
    const destination = graph.vertices.find(vertex => vertexId(vertex) === connection.target);
    if (!old || !source || !destination) return;
    const mapping = (vertex: VertexTable) => {
      const references = vertex.key.length ? vertex.key : ["id"];
      return { table: vertexId(vertex), references, columns: references.map(key => `${safeName(vertexId(vertex))}_${safeName(key)}`) };
    };
    const updated = { ...old,
      source: same(old.source.table, vertexId(source)) ? old.source : mapping(source),
      destination: same(old.destination.table, vertexId(destination)) ? old.destination : mapping(destination),
    };
    if (emit({ ...graph, edges: graph.edges.map(edge => edgeId(edge) === oldFlowEdge.id ? updated : edge) })) { setEdgePositions(current => { const next = { ...current }; delete next[oldFlowEdge.id]; return next; }); selectOnCanvas({ kind: "edge", id: oldFlowEdge.id }); }
  };

  const updateVertex = (id: string, patch: Partial<VertexTable>) => {
    if (!graph) return;
    const old = graph.vertices.find(vertex => vertexId(vertex) === id);
    if (!old) return;
    const updated = { ...old, ...patch };
    const nextId = vertexId(updated);
    if (graph.vertices.some(vertex => vertexId(vertex) !== id && same(vertexId(vertex), nextId))) return;
    const accepted = emit({ ...graph, vertices: graph.vertices.map(vertex => vertexId(vertex) === id ? updated : vertex), edges: graph.edges.map(edge => ({ ...edge,
      source: { ...edge.source, table: same(edge.source.table, id) ? nextId : edge.source.table },
      destination: { ...edge.destination, table: same(edge.destination.table, id) ? nextId : edge.destination.table },
    })) });
    if (accepted && nextId !== id) {
      pendingVertexRename.current = { from: id, to: nextId };
      pendingSelection.current = { kind: "vertex", id: nextId };
    }
  };

  const updateEdge = (id: string, patch: Partial<EdgeTable>) => {
    if (!graph) return;
    const old = graph.edges.find(edge => edgeId(edge) === id);
    if (!old) return;
    const updated = { ...old, ...patch };
    const nextId = edgeId(updated);
    if (graph.edges.some(edge => edgeId(edge) !== id && same(edgeId(edge), nextId))) return;
    if (emit({ ...graph, edges: graph.edges.map(edge => edgeId(edge) === id ? updated : edge) }) && nextId !== id) {
      pendingEdgeRename.current = { from: id, to: nextId };
      pendingSelection.current = { kind: "edge", id: nextId };
    }
  };

  const removeSelected = () => {
    if (!graph || !selection) return;
    if (selection.kind === "vertex") {
      if (graph.vertices.length <= 1) return;
      if (!emit({ ...graph, vertices: graph.vertices.filter(vertex => vertexId(vertex) !== selection.id), edges: graph.edges.filter(edge => !same(edge.source.table, selection.id) && !same(edge.destination.table, selection.id)) })) return;
    } else if (!emit({ ...graph, edges: graph.edges.filter(edge => edgeId(edge) !== selection.id) })) return;
    setSelection(null);
  };

  const selectedVertex = selection?.kind === "vertex" ? graph?.vertices.find(vertex => vertexId(vertex) === selection.id) : undefined;
  const selectedEdge = selection?.kind === "edge" ? graph?.edges.find(edge => edgeId(edge) === selection.id) : undefined;
  const edges = graph ? flowEdges(graph, flowNodes, selection, id => selectOnCanvas({ kind: "edge", id }), (id, position) => setEdgePositions(current => ({ ...current, [id]: position })), edgePositions) : [];
  const nodes = useMemo(() => flowNodes.map(node => ({ ...node, selected: selection?.kind === "vertex" && selection.id === node.id })), [flowNodes, selection]);
  const hasDetails = !!selectedVertex || !!selectedEdge;

  const copySql = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  };

  return <div className={`pgq-visualizer ${className}`} data-theme={theme}>
    <div className="pgq-main">
      <section className="pgq-graph-area" aria-label="Property graph visualizer">
        <div className="pgq-toolbar">
          <div className="pgq-graph-ident"><span className="pgq-graph-symbol">✳</span><span><strong>{graph?.name || "Property graph"}</strong><small>{graph ? `${graph.vertices.length} vertex tables · ${graph.edges.length} edge tables` : "Enter a CREATE PROPERTY GRAPH statement"}</small></span></div>
          <div className="pgq-toolbar-actions"><button type="button" onClick={addVertex} disabled={!graph || !!error}><Plus size={16} /> Add vertex</button><button type="button" onClick={() => { if (!graph) return; positions.current = {}; setEdgePositions({}); setFlowNodes(layoutNodes(graph)); requestAnimationFrame(() => fitView({ padding: .2, duration: 300, maxZoom: 1 })); }} disabled={!graph}><LayoutTemplate size={16} /> Auto layout</button></div>
        </div>
        <div className="pgq-canvas">
          <ReactFlow<TableNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={(changes: NodeChange<TableNode>[]) => setFlowNodes(current => applyNodeChanges(changes, current))} onNodeDragStop={(_, node) => { positions.current[node.id] = node.position; }} onConnect={connect} onConnectEnd={connectOnNodeDrop} connectionRadius={48} onReconnect={reconnect} edgesReconnectable={!error} reconnectRadius={40} onNodeClick={(_, node) => selectOnCanvas({ kind: "vertex", id: node.id })} onEdgeClick={(_, edge) => selectOnCanvas({ kind: "edge", id: edge.id })} onPaneClick={() => selectOnCanvas(null)} fitView fitViewOptions={{ padding: .2, maxZoom: 1 }} minZoom={.25} maxZoom={1.8} deleteKeyCode={null} nodesConnectable={!error}>
            <Background color="var(--pgq-grid)" gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {!graph && <div className="pgq-canvas-empty">Enter a valid CREATE PROPERTY GRAPH statement to see its tables.</div>}
        </div>
      </section>
      <aside className={`pgq-sidebar ${hasDetails ? "pgq-sidebar-selected" : ""}`} aria-label="SQL and graph details">
        {hasDetails && <section className="pgq-detail-panel" aria-label="Selected element details">
          <div className="pgq-panel-head"><span>{selection?.kind === "vertex" ? "VERTEX DETAILS" : "EDGE DETAILS"}</span><button type="button" aria-label="Close details" onClick={() => setSelection(null)}><X size={16} /></button></div>
          {selectedVertex && <div className="pgq-inspector-content" key={`vertex:${selection?.id}`}>
            <h2>{vertexId(selectedVertex)}</h2><p>Each row becomes a graph vertex.</p>
            <Field label="Table name" value={selectedVertex.table} onCommit={table => table && updateVertex(vertexId(selectedVertex), { table })} />
            <Field label="Graph alias" value={selectedVertex.alias || ""} onCommit={alias => updateVertex(vertexId(selectedVertex), { alias: alias || undefined })} />
            <Field label="Label" value={selectedVertex.label} onCommit={label => label && updateVertex(vertexId(selectedVertex), { label })} />
            <Field label="Key columns" value={selectedVertex.key.join(", ")} onCommit={key => updateVertex(vertexId(selectedVertex), { key: list(key) })} hint="Comma-separated columns" />
            <SelectField label="Properties" value={selectedVertex.propertyMode} options={["all", "listed", "none"]} onChange={propertyMode => updateVertex(vertexId(selectedVertex), { propertyMode: propertyMode as PropertyMode })} />
            {selectedVertex.propertyMode === "listed" && <Field label="Property columns" value={selectedVertex.properties.join(", ")} onCommit={properties => updateVertex(vertexId(selectedVertex), { properties: list(properties) })} />}
            <button type="button" className="pgq-remove" onClick={removeSelected} disabled={graph?.vertices.length === 1}><Trash2 size={15} /> Remove vertex and its edges</button>
          </div>}
          {selectedEdge && graph && <div className="pgq-inspector-content" key={`edge:${selection?.id}`}>
            <h2>{edgeId(selectedEdge)}</h2><p>Drag either endpoint on the canvas to reconnect this edge.</p>
            <Field label="Table name" value={selectedEdge.table} onCommit={table => table && updateEdge(edgeId(selectedEdge), { table })} />
            <Field label="Graph alias" value={selectedEdge.alias || ""} onCommit={alias => updateEdge(edgeId(selectedEdge), { alias: alias || undefined })} />
            <Field label="Label" value={selectedEdge.label} onCommit={label => label && updateEdge(edgeId(selectedEdge), { label })} />
            <Field label="Key columns" value={selectedEdge.key.join(", ")} onCommit={key => updateEdge(edgeId(selectedEdge), { key: list(key) })} />
            <div className="pgq-inspector-divider" />
            <SelectField label="Source vertex" value={selectedEdge.source.table} options={graph.vertices.map(vertexId)} onChange={table => { const references = graph.vertices.find(vertex => vertexId(vertex) === table)?.key || ["id"]; updateEdge(edgeId(selectedEdge), { source: { ...selectedEdge.source, table, references, columns: references.map((reference, i) => selectedEdge.source.columns[i] || reference) } }); }} />
            <Field label="Source columns" value={selectedEdge.source.columns.join(", ")} onCommit={columns => { const next = list(columns); updateEdge(edgeId(selectedEdge), { source: { ...selectedEdge.source, columns: next, references: next.map((column, i) => selectedEdge.source.references[i] || column) } }); }} />
            <Field label="References" value={selectedEdge.source.references.join(", ")} onCommit={references => { const next = list(references); updateEdge(edgeId(selectedEdge), { source: { ...selectedEdge.source, references: next, columns: next.map((reference, i) => selectedEdge.source.columns[i] || reference) } }); }} />
            <div className="pgq-mapping-arrow"><ArrowRight size={15} /> DIRECTION</div>
            <SelectField label="Destination vertex" value={selectedEdge.destination.table} options={graph.vertices.map(vertexId)} onChange={table => { const references = graph.vertices.find(vertex => vertexId(vertex) === table)?.key || ["id"]; updateEdge(edgeId(selectedEdge), { destination: { ...selectedEdge.destination, table, references, columns: references.map((reference, i) => selectedEdge.destination.columns[i] || reference) } }); }} />
            <Field label="Destination columns" value={selectedEdge.destination.columns.join(", ")} onCommit={columns => { const next = list(columns); updateEdge(edgeId(selectedEdge), { destination: { ...selectedEdge.destination, columns: next, references: next.map((column, i) => selectedEdge.destination.references[i] || column) } }); }} />
            <Field label="References" value={selectedEdge.destination.references.join(", ")} onCommit={references => { const next = list(references); updateEdge(edgeId(selectedEdge), { destination: { ...selectedEdge.destination, references: next, columns: next.map((reference, i) => selectedEdge.destination.columns[i] || reference) } }); }} />
            <div className="pgq-inspector-divider" />
            <SelectField label="Properties" value={selectedEdge.propertyMode} options={["all", "listed", "none"]} onChange={propertyMode => updateEdge(edgeId(selectedEdge), { propertyMode: propertyMode as PropertyMode })} />
            {selectedEdge.propertyMode === "listed" && <Field label="Property columns" value={selectedEdge.properties.join(", ")} onCommit={properties => updateEdge(edgeId(selectedEdge), { properties: list(properties) })} />}
            <button type="button" className="pgq-remove" onClick={removeSelected}><Trash2 size={15} /> Remove edge</button>
          </div>}
        </section>}
        <section className="pgq-sql-panel" aria-label="SQL definition">
          <div className="pgq-panel-head"><div><Code2 size={16} /><span>SQL DEFINITION</span></div><button type="button" onClick={copySql} aria-label="Copy SQL">{copied ? <Check size={15} /> : <Clipboard size={15} />}</button></div>
          <SqlCodeEditor ref={sqlEditor} value={value} onChange={onChange} onCursor={onCursor} />
          <div className={`pgq-sql-status ${error || editError ? "pgq-sql-status-error" : ""}`}>{error ? `SQL error: ${error}` : editError ? `Edit not applied: ${editError}` : "SQL and graph are in sync"}</div>
        </section>
      </aside>
    </div>
  </div>;
}

export function PropertyGraphVisualizer(props: PropertyGraphVisualizerProps) {
  return <ReactFlowProvider><Visualizer {...props} /></ReactFlowProvider>;
}
