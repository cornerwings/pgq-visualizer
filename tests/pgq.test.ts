import assert from "node:assert/strict";
import test from "node:test";
import { parsePropertyGraph, parsePropertyGraphWithRanges, serializePropertyGraph, PgqParseError } from "../lib/pgq";

test("parses and round-trips keys, properties, aliases, and edge mappings", () => {
  const sql = `-- a graph with a composite key
    CREATE OR REPLACE PROPERTY GRAPH catalog
    VERTEX TABLES (
      products AS item KEY (tenant_id, product_id) LABEL product PROPERTIES (name, price AS amount),
      categories KEY (id) PROPERTIES ARE ALL COLUMNS
    )
    EDGE TABLES (
      memberships KEY (id)
        SOURCE KEY (tenant_id, product_id) REFERENCES item (tenant_id, product_id)
        DESTINATION KEY (category_id) REFERENCES categories (id)
        LABEL belongs_to NO PROPERTIES
    );`;
  const graph = parsePropertyGraph(sql);
  assert.equal(graph.orReplace, true);
  assert.deepEqual(graph.vertices[0].key, ["tenant_id", "product_id"]);
  assert.deepEqual(graph.vertices[0].properties, ["name", "price AS amount"]);
  assert.equal(graph.edges[0].source.table, "item");
  assert.deepEqual(parsePropertyGraph(serializePropertyGraph(graph)), graph);
});

test("canonicalizes case-insensitive references for graph connections", () => {
  const graph = parsePropertyGraph(`CREATE PROPERTY GRAPH g VERTEX TABLES (people KEY(id), movies KEY(id)) EDGE TABLES (likes SOURCE KEY(person_id) REFERENCES PEOPLE(id) DESTINATION KEY(movie_id) REFERENCES MOVIES(id));`);
  assert.equal(graph.edges[0].source.table, "people");
  assert.equal(graph.edges[0].destination.table, "movies");
});

test("rejects unsupported clauses and broken connections", () => {
  assert.throws(() => parsePropertyGraph(`CREATE PROPERTY GRAPH g VERTEX TABLES (people KEY(id) OPTIONS(foo));`), /Unsupported table clause/);
  assert.throws(() => parsePropertyGraph(`CREATE PROPERTY GRAPH g VERTEX TABLES (people KEY(id)) EDGE TABLES (likes SOURCE KEY(person_id) REFERENCES missing(id) DESTINATION KEY(person_id) REFERENCES people(id));`), /unknown vertex table missing/);
});

test("locates SQL table definitions and syntax errors for cursor selection", () => {
  const sql = `CREATE PROPERTY GRAPH g VERTEX TABLES (people KEY(id), movies KEY(id)) EDGE TABLES (likes SOURCE KEY(person_id) REFERENCES people(id) DESTINATION KEY(movie_id) REFERENCES movies(id));`;
  const { ranges } = parsePropertyGraphWithRanges(sql);
  assert.equal(ranges.find(range => range.from <= sql.indexOf("people KEY") && range.to >= sql.indexOf("people KEY"))?.id, "people");
  assert.equal(ranges.find(range => range.from <= sql.indexOf("likes SOURCE") && range.to >= sql.indexOf("likes SOURCE"))?.kind, "edge");
  assert.throws(() => parsePropertyGraphWithRanges(sql.replace("DESTINATION", "DESTINATIOX")), error => error instanceof PgqParseError && error.from === sql.indexOf("DESTINATION"));
});

test("quoted identifiers keep their case and dots during round trips", () => {
  const sql = `CREATE PROPERTY GRAPH g VERTEX TABLES ("sales.2026" KEY(id), "Person" KEY(id), "person" KEY(id));`;
  const graph = parsePropertyGraph(sql);
  assert.equal(graph.vertices[0].label, '"sales.2026"');
  assert.deepEqual(parsePropertyGraph(serializePropertyGraph(graph)), graph);
  assert.equal(graph.vertices.length, 3);
  assert.throws(() => parsePropertyGraph(`CREATE PROPERTY GRAPH g VERTEX TABLES ("Person" KEY(id)) EDGE TABLES (e SOURCE KEY(id) REFERENCES "person"(id) DESTINATION KEY(id) REFERENCES "Person"(id));`), /unknown vertex table "person"/);
});

test("rejects duplicate clauses instead of losing the first value", () => {
  const prefix = `CREATE PROPERTY GRAPH g VERTEX TABLES (v KEY(id)`;
  assert.throws(() => parsePropertyGraph(`${prefix} KEY(other));`), /Multiple KEY clauses/);
  assert.throws(() => parsePropertyGraph(`${prefix} PROPERTIES (x) NO PROPERTIES);`), /Multiple property clauses/);
  assert.throws(() => parsePropertyGraph(`${prefix}) EDGE TABLES (e SOURCE KEY(a) REFERENCES v(id) SOURCE KEY(b) REFERENCES v(id) DESTINATION KEY(c) REFERENCES v(id));`), /Multiple SOURCE clauses/);
});
