export const EDGE_CARD_WIDTH = 164;
export const EDGE_CARD_HEIGHT = 142;

export type LayoutNode = { id: string; position: { x: number; y: number }; width: number; height: number };
export type LayoutEdge = { id: string; source: string; target: string; sourceHandle: string; targetHandle: string };
export type EdgePlacement = { x: number; y: number; bend: number; routePoint?: { x: number; y: number } };
type Rect = { x: number; y: number; width: number; height: number };

const overlaps = (a: Rect, b: Rect, gap = 14) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

function anchor(node: LayoutNode, handle: string) {
  const { x, y } = node.position;
  if (handle.startsWith("left")) return { x, y: y + node.height * (handle.endsWith("in") ? .38 : .62) };
  if (handle.startsWith("right")) return { x: x + node.width, y: y + node.height * (handle.endsWith("in") ? .38 : .62) };
  if (handle.startsWith("top")) return { x: x + node.width * (handle.endsWith("in") ? .38 : .62), y };
  return { x: x + node.width * (handle.endsWith("in") ? .38 : .62), y: y + node.height };
}

function crossesNode(source: LayoutNode, target: LayoutNode, nodes: LayoutNode[]) {
  const from = { x: source.position.x + source.width / 2, y: source.position.y + source.height / 2 };
  const to = { x: target.position.x + target.width / 2, y: target.position.y + target.height / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return false;
  return nodes.some(node => {
    if (node.id === source.id || node.id === target.id) return false;
    const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
    const progress = ((center.x - from.x) * dx + (center.y - from.y) * dy) / lengthSquared;
    if (progress <= .1 || progress >= .9) return false;
    return Math.hypot(center.x - (from.x + progress * dx), center.y - (from.y + progress * dy)) < Math.max(node.width, node.height) / 2 + 24;
  });
}

/** Place every edge card outside node and previously placed edge-card bounds. */
export function placeEdgeCards(nodes: LayoutNode[], edges: LayoutEdge[], preferredPositions: Record<string, { x: number; y: number }> = {}): Record<string, EdgePlacement> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const occupied: Rect[] = nodes.map(node => ({ ...node.position, width: node.width, height: node.height }));
  const placements: Record<string, EdgePlacement> = {};
  const pairKey = (edge: LayoutEdge) => [edge.source, edge.target].sort().join("\u0000");

  for (const edge of [...edges].sort((a, b) => Number(!!preferredPositions[b.id]) - Number(!!preferredPositions[a.id]))) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const siblings = edges.filter(item => pairKey(item) === pairKey(edge));
    const index = siblings.findIndex(item => item.id === edge.id);
    const parallelBend = (index - (siblings.length - 1) / 2) * 115;
    const dx = target.position.x - source.position.x;
    const dy = target.position.y - source.position.y;
    const routingBend = crossesNode(source, target, nodes)
      ? (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? -185 : 185) : (dy >= 0 ? 185 : -185))
      : 0;
    const bend = parallelBend + routingBend;
    const from = anchor(source, edge.sourceHandle);
    const to = anchor(target, edge.targetHandle);
    const pathDx = to.x - from.x;
    const pathDy = to.y - from.y;
    const length = Math.hypot(pathDx, pathDy) || 1;
    const perpendicular = { x: -pathDy / length, y: pathDx / length };
    const preferredSign = Math.abs(pathDx) >= Math.abs(pathDy) ? (pathDx >= 0 ? -1 : 1) : (pathDy >= 0 ? -1 : 1);
    const normal = { x: perpendicular.x * preferredSign, y: perpendicular.y * preferredSign };
    const isLoop = edge.source === edge.target;
    let placed = false;

    const reserve = (center: { x: number; y: number }, manual = false) => {
      const rect = { x: center.x - EDGE_CARD_WIDTH / 2, y: center.y - EDGE_CARD_HEIGHT / 2, width: EDGE_CARD_WIDTH, height: EDGE_CARD_HEIGHT };
      if (occupied.some(other => overlaps(rect, other))) return false;
      placements[edge.id] = { x: center.x, y: center.y, bend,
        ...(manual ? { routePoint: center } : {}) };
      occupied.push(rect);
      return true;
    };

    const preferred = preferredPositions[edge.id];
    if (preferred) {
      for (let ring = 0; ring < 40 && !placed; ring++) {
        const radius = ring * 24;
        const angles = ring === 0 ? [0] : [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
        for (const angle of angles) {
          if (reserve({ x: preferred.x + Math.cos(angle) * radius, y: preferred.y + Math.sin(angle) * radius }, true)) { placed = true; break; }
        }
      }
    }

    // Search near the visible path first, then expand outward. The expanding
    // rings ensure a free position exists even in dense or manually moved layouts.
    for (let ring = 0; !placed; ring++) {
      const distances = ring === 0 ? [0] : [ring * 90, -ring * 90];
      const fractions = isLoop ? [.5, .25, .75] : [.5, .35, .65, .2, .8];
      for (const distance of distances) {
        for (const fraction of fractions) {
          const pathPoint = isLoop
            ? { x: source.position.x + source.width / 2 + (fraction - .5) * 150, y: source.position.y - 85 - bend * .75 }
            : { x: from.x + pathDx * fraction + perpendicular.x * bend * 4 * fraction * (1 - fraction), y: from.y + pathDy * fraction + perpendicular.y * bend * 4 * fraction * (1 - fraction) };
          const center = { x: pathPoint.x + (isLoop ? 0 : normal.x) * distance, y: pathPoint.y + (isLoop ? -1 : normal.y) * distance };
          if (reserve(center)) { placed = true; break; }
        }
        if (placed) break;
      }
    }
  }
  return placements;
}
