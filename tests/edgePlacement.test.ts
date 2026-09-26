import test from "node:test";
import assert from "node:assert/strict";
import { EDGE_CARD_HEIGHT, EDGE_CARD_WIDTH, placeEdgeCards, type LayoutEdge, type LayoutNode } from "../lib/edgePlacement";

const nodes: LayoutNode[] = [
  { id: "people", position: { x: 0, y: 0 }, width: 242, height: 170 },
  { id: "movies", position: { x: 542, y: 0 }, width: 242, height: 170 },
  { id: "genres", position: { x: 1084, y: 0 }, width: 242, height: 170 },
];

const edges: LayoutEdge[] = [
  { id: "ratings", source: "people", target: "movies", sourceHandle: "right-out", targetHandle: "left-in" },
  { id: "follows", source: "people", target: "people", sourceHandle: "right-out", targetHandle: "left-in" },
  { id: "ratings_alt", source: "people", target: "movies", sourceHandle: "right-out", targetHandle: "left-in" },
  { id: "skip", source: "people", target: "genres", sourceHandle: "right-out", targetHandle: "left-in" },
];

const collides = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width + 14 && a.x + a.width + 14 > b.x && a.y < b.y + b.height + 14 && a.y + a.height + 14 > b.y;

function assertNoCardOverlap(placements: ReturnType<typeof placeEdgeCards>) {
  const cards = Object.values(placements).map(({ x, y }) => ({ x: x - EDGE_CARD_WIDTH / 2, y: y - EDGE_CARD_HEIGHT / 2, width: EDGE_CARD_WIDTH, height: EDGE_CARD_HEIGHT }));
  assert.equal(cards.length, edges.length);
  cards.forEach((card, index) => {
    nodes.forEach(node => assert.equal(collides(card, { ...node.position, width: node.width, height: node.height }), false, `card ${index} overlaps ${node.id}`));
    cards.slice(index + 1).forEach((other, otherIndex) => assert.equal(collides(card, other), false, `cards ${index} and ${index + otherIndex + 1} overlap`));
  });
}

test("edge cards avoid vertex cards and each other after auto layout", () => {
  const placements = placeEdgeCards(nodes, edges);
  assertNoCardOverlap(placements);
  assert.ok(placements.skip.bend < 0, "long edge routes above the middle table");
});

test("manually moved edge cards snap clear of occupied cards", () => {
  const placements = placeEdgeCards(nodes, edges, { ratings: { x: 120, y: 85 } });
  assertNoCardOverlap(placements);
  assert.ok(placements.ratings.routePoint, "manual edge position also changes its route");
});

test("dense parallel connections each receive a clear card position", () => {
  const parallel = Array.from({ length: 12 }, (_, index) => ({ ...edges[0], id: `edge_${index}` }));
  const placements = placeEdgeCards(nodes, parallel);
  const cards = Object.values(placements).map(({ x, y }) => ({ x: x - EDGE_CARD_WIDTH / 2, y: y - EDGE_CARD_HEIGHT / 2, width: EDGE_CARD_WIDTH, height: EDGE_CARD_HEIGHT }));
  assert.equal(cards.length, parallel.length);
  cards.forEach((card, index) => cards.slice(index + 1).forEach(other => assert.equal(collides(card, other), false)));
});
