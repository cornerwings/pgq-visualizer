import assert from "node:assert/strict";
import test from "node:test";
import { editPropertyGraphSql } from "../lib/editSql";
import { parsePropertyGraphWithRanges, serializePropertyGraph, type PropertyGraph } from "../lib/pgq";

function edit(sql: string, change: (graph: PropertyGraph) => PropertyGraph) {
  const parsed = parsePropertyGraphWithRanges(sql);
  const next = change(parsed.graph);
  const result = editPropertyGraphSql(sql, parsed.graph, next, parsed);
  assert.equal(serializePropertyGraph(parsePropertyGraphWithRanges(result).graph), serializePropertyGraph(next));
  return result;
}

test("field edits preserve comments and formatting around untouched definitions", () => {
  const sql = `-- graph note\nCREATE PROPERTY GRAPH g\n VERTEX TABLES (\n  people KEY /* key note */ (id) LABEL person,\n  movies KEY(id) -- movies note\n );`;
  const result = edit(sql, graph => ({ ...graph, vertices: graph.vertices.map((table, i) => i ? table : { ...table, key: ["person_id"] }) }));
  assert.ok(result.startsWith("-- graph note\nCREATE PROPERTY GRAPH g\n"));
  assert.match(result, /\/\* key note \*\//);
  assert.match(result, /movies KEY\(id\) -- movies note/);
  assert.match(result, /KEY \(person_id\)/);
});

test("adding a vertex and first edge retains existing SQL", () => {
  const sql = `CREATE PROPERTY GRAPH g VERTEX TABLES (people KEY(id) /* keep */);`;
  const withVertex = edit(sql, graph => ({ ...graph, vertices: [...graph.vertices, { kind: "vertex", table: "movies", key: ["id"], label: "movies", properties: [], propertyMode: "all" }] }));
  const withEdge = edit(withVertex, graph => ({ ...graph, edges: [{ kind: "edge", table: "likes", key: ["id"], label: "likes", properties: [], propertyMode: "all", source: { columns: ["person_id"], table: "people", references: ["id"] }, destination: { columns: ["movie_id"], table: "movies", references: ["id"] } }] }));
  assert.match(withEdge, /people KEY\(id\)/);
  assert.match(withEdge, /\/\* keep \*\//);
  assert.match(withEdge, /EDGE TABLES/);
});

test("removing a vertex and several incident edges leaves a valid statement", () => {
  const sql = `CREATE PROPERTY GRAPH g VERTEX TABLES (a KEY(id), b KEY(id), c KEY(id)) EDGE TABLES (ab SOURCE KEY(a_id) REFERENCES a(id) DESTINATION KEY(b_id) REFERENCES b(id), bc SOURCE KEY(b_id) REFERENCES b(id) DESTINATION KEY(c_id) REFERENCES c(id), ac SOURCE KEY(a_id) REFERENCES a(id) DESTINATION KEY(c_id) REFERENCES c(id));`;
  const result = edit(sql, graph => ({ ...graph, vertices: graph.vertices.filter(vertex => vertex.table !== "b"), edges: graph.edges.filter(edge => edge.table === "ac") }));
  assert.match(result, /ac SOURCE KEY/);
  assert.doesNotMatch(result, /ab SOURCE KEY|bc SOURCE KEY/);
});

test("renaming a vertex updates edge references without rewriting other tables", () => {
  const sql = `CREATE PROPERTY GRAPH g VERTEX TABLES (people KEY(id), movies KEY(id)) EDGE TABLES (likes SOURCE KEY(person_id) REFERENCES people(id) DESTINATION KEY(movie_id) REFERENCES movies(id));`;
  const result = edit(sql, graph => ({ ...graph, vertices: graph.vertices.map((vertex, i) => i ? vertex : { ...vertex, alias: "person" }), edges: graph.edges.map(edge => ({ ...edge, source: { ...edge.source, table: "person" } })) }));
  assert.match(result, /people AS person KEY\(id\)/);
  assert.match(result, /REFERENCES person \(id\)/);
  assert.match(result, /movies KEY\(id\)/);
});
