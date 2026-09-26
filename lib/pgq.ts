export type PropertyMode = "all" | "listed" | "none";

export interface GraphTable {
  table: string;
  alias?: string;
  key: string[];
  label: string;
  properties: string[];
  propertyMode: PropertyMode;
}

export interface VertexTable extends GraphTable {
  kind: "vertex";
}

export interface EdgeTable extends GraphTable {
  kind: "edge";
  source: { columns: string[]; table: string; references: string[] };
  destination: { columns: string[]; table: string; references: string[] };
}

export interface PropertyGraph {
  name: string;
  orReplace: boolean;
  vertices: VertexTable[];
  edges: EdgeTable[];
}

/** SQL identifiers are folded only when they are not quoted. */
export function identifierKey(name: string): string {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  for (let i = 0; i < name.length; i++) {
    const char = name[i];
    if (char === '"') {
      if (quoted && name[i + 1] === '"') { part += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "." && !quoted) {
      parts.push(part); part = "";
    } else {
      part += quoted ? char : char.toLowerCase();
    }
  }
  parts.push(part);
  return JSON.stringify(parts);
}

export function sameIdentifier(a: string, b: string): boolean { return identifierKey(a) === identifierKey(b); }

export function lastIdentifierPart(name: string): string {
  let start = 0;
  let quoted = false;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === '"') {
      if (quoted && name[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (name[i] === "." && !quoted) start = i + 1;
  }
  return name.slice(start);
}

type Token = { value: string; start: number; end: number };

export type SourceSpan = { from: number; to: number };
export type TableFields = {
  table: SourceSpan;
  alias?: SourceSpan;
  key?: SourceSpan;
  label?: SourceSpan;
  properties?: SourceSpan;
  source?: SourceSpan;
  destination?: SourceSpan;
};
export type TableRange = SourceSpan & { kind: "vertex" | "edge"; id: string; fields: TableFields; separatorAfter?: SourceSpan };
export type GraphSource = { ranges: TableRange[]; lists: { vertex: SourceSpan; edge?: SourceSpan } };

export class PgqParseError extends Error {
  constructor(message: string, public readonly from: number, public readonly to: number) {
    super(message);
    this.name = "PgqParseError";
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }
    if (input.slice(i, i + 2) === "--") {
      i = input.indexOf("\n", i + 2);
      if (i < 0) break;
      continue;
    }
    if (input.slice(i, i + 2) === "/*") {
      const end = input.indexOf("*/", i + 2);
      if (end < 0) throw new PgqParseError("Unclosed SQL comment", i, input.length);
      i = end + 2;
      continue;
    }
    const start = i;
    if (input[i] === '"') {
      i++;
      while (i < input.length) {
        if (input[i] === '"' && input[i + 1] === '"') { i += 2; continue; }
        if (input[i++] === '"') break;
      }
      if (input[i - 1] !== '"') throw new PgqParseError("Unclosed quoted identifier", start, input.length);
    } else if (input[i] === "'") {
      i++;
      while (i < input.length) {
        if (input[i] === "'" && input[i + 1] === "'") { i += 2; continue; }
        if (input[i++] === "'") break;
      }
      if (input[i - 1] !== "'") throw new PgqParseError("Unclosed string literal", start, input.length);
    } else if (/[(),.;+*/=<>:!?|-]/.test(input[i])) {
      i++;
    } else if (/[A-Za-z_0-9$#]/.test(input[i])) {
      while (i < input.length && /[A-Za-z_0-9$#]/.test(input[i])) i++;
    } else {
      throw new PgqParseError(`Unexpected character “${input[i]}”`, i, i + 1);
    }
    tokens.push({ value: input.slice(start, i), start, end: i });
  }
  return tokens;
}

class Parser {
  private i = 0;
  readonly ranges: TableRange[] = [];
  readonly lists: GraphSource["lists"] = { vertex: { from: 0, to: 0 } };
  constructor(private readonly sql: string, private readonly tokens: Token[]) {}
  private peek(offset = 0) { return this.tokens[this.i + offset]?.value; }
  private at(value: string) { return this.peek()?.toUpperCase() === value; }
  private take(value: string) { if (this.at(value)) { this.i++; return true; } return false; }
  private need(value: string) {
    if (!this.take(value)) throw this.error(`Expected ${value}`);
  }
  private error(message: string) {
    const token = this.tokens[this.i];
    const from = token?.start ?? this.sql.length;
    const to = token?.end ?? this.sql.length;
    return new PgqParseError(`${message}${token ? ` near “${token.value}”` : " at end of statement"}`, from, to);
  }
  private identifier(): string {
    const value = this.peek();
    if (!value || !/^(?:[A-Za-z_][A-Za-z_0-9$#]*|"(?:[^"]|"")+")$/.test(value)) throw this.error("Expected an identifier");
    this.i++;
    return value;
  }
  private qualifiedIdentifier(): string {
    let name = this.identifier();
    while (this.take(".")) name += `.${this.identifier()}`;
    return name;
  }
  private identifierList(): string[] {
    this.need("(");
    const values = [this.qualifiedIdentifier()];
    while (this.take(",")) values.push(this.qualifiedIdentifier());
    this.need(")");
    return values;
  }
  private propertyList(): string[] {
    this.need("(");
    const values: string[] = [];
    let start = this.i;
    let depth = 0;
    while (this.i < this.tokens.length) {
      if (this.at("(") ) depth++;
      if (this.at(")")) {
        if (depth === 0) {
          if (this.i > start) values.push(this.sql.slice(this.tokens[start].start, this.tokens[this.i - 1].end).trim());
          this.i++;
          return values;
        }
        depth--;
      }
      if (this.at(",") && depth === 0) {
        if (this.i === start) throw this.error("Empty property");
        values.push(this.sql.slice(this.tokens[start].start, this.tokens[this.i - 1].end).trim());
        this.i++;
        start = this.i;
        continue;
      }
      this.i++;
    }
    throw this.error("Unclosed property list");
  }
  private mapping() {
    this.need("KEY");
    const columns = this.identifierList();
    this.need("REFERENCES");
    const table = this.qualifiedIdentifier();
    const references = this.identifierList();
    return { columns, table, references };
  }
  private table(kind: "vertex"): VertexTable;
  private table(kind: "edge"): EdgeTable;
  private table(kind: "vertex" | "edge"): VertexTable | EdgeTable {
    const from = this.tokens[this.i]?.start ?? this.sql.length;
    const table = this.qualifiedIdentifier();
    const fields: TableFields = { table: { from, to: this.tokens[this.i - 1].end } };
    const aliasStart = this.tokens[this.i]?.start;
    const alias = this.take("AS") ? this.qualifiedIdentifier() : undefined;
    if (alias && aliasStart !== undefined) fields.alias = { from: aliasStart, to: this.tokens[this.i - 1].end };
    const common: GraphTable = { table, alias, key: [], label: lastIdentifierPart(alias || table), properties: [], propertyMode: "all" };
    const edge: EdgeTable = { ...common, kind: "edge", source: { columns: [], table: "", references: [] }, destination: { columns: [], table: "", references: [] } };
    let sourceSeen = false;
    let destinationSeen = false;
    let labelSeen = false;
    let propertiesSeen = false;
    let keySeen = false;
    while (this.peek() && !this.at(",") && !this.at(")")) {
      if (this.take("KEY")) { if (keySeen) throw this.error("Multiple KEY clauses per table are not supported"); const start = this.tokens[this.i - 1].start; common.key = this.identifierList(); fields.key = { from: start, to: this.tokens[this.i - 1].end }; keySeen = true; }
      else if (kind === "edge" && this.take("SOURCE")) { if (sourceSeen) throw this.error("Multiple SOURCE clauses per edge are not supported"); const start = this.tokens[this.i - 1].start; edge.source = this.mapping(); fields.source = { from: start, to: this.tokens[this.i - 1].end }; sourceSeen = true; }
      else if (kind === "edge" && this.take("DESTINATION")) { if (destinationSeen) throw this.error("Multiple DESTINATION clauses per edge are not supported"); const start = this.tokens[this.i - 1].start; edge.destination = this.mapping(); fields.destination = { from: start, to: this.tokens[this.i - 1].end }; destinationSeen = true; }
      else if (this.take("LABEL")) {
        if (labelSeen) throw this.error("Multiple labels per table are not supported");
        const start = this.tokens[this.i - 1].start;
        common.label = this.identifier(); fields.label = { from: start, to: this.tokens[this.i - 1].end }; labelSeen = true;
      } else if (this.take("PROPERTIES")) {
        if (propertiesSeen) throw this.error("Multiple property clauses per table are not supported");
        const start = this.tokens[this.i - 1].start;
        this.take("ARE");
        if (this.take("ALL")) { this.need("COLUMNS"); common.propertyMode = "all"; }
        else { common.properties = this.propertyList(); common.propertyMode = "listed"; }
        fields.properties = { from: start, to: this.tokens[this.i - 1].end };
        propertiesSeen = true;
      } else if (this.take("NO")) { if (propertiesSeen) throw this.error("Multiple property clauses per table are not supported"); const start = this.tokens[this.i - 1].start; this.need("PROPERTIES"); common.propertyMode = "none"; fields.properties = { from: start, to: this.tokens[this.i - 1].end }; propertiesSeen = true; }
      else throw this.error("Unsupported table clause");
    }
    if (kind === "edge") {
      if (!sourceSeen || !destinationSeen) throw this.error(`Edge table ${table} needs SOURCE and DESTINATION mappings`);
      const parsed: EdgeTable = { ...edge, ...common };
      this.ranges.push({ kind, id: edgeId(parsed), from, to: this.tokens[this.i - 1]?.end ?? from, fields });
      return parsed;
    }
    const parsed: VertexTable = { ...common, kind: "vertex" };
    this.ranges.push({ kind, id: vertexId(parsed), from, to: this.tokens[this.i - 1]?.end ?? from, fields });
    return parsed;
  }
  private tableList<K extends "vertex" | "edge">(kind: K): K extends "vertex" ? VertexTable[] : EdgeTable[] {
    const listStart = this.tokens[this.i]?.start ?? this.sql.length;
    this.need("(");
    const tables: (VertexTable | EdgeTable)[] = [];
    if (!this.at(")")) {
      tables.push(this.table(kind as "edge"));
      while (this.take(",")) {
        const separator = this.tokens[this.i - 1];
        this.ranges[this.ranges.length - 1].separatorAfter = { from: separator.start, to: separator.end };
        tables.push(this.table(kind as "edge"));
      }
    }
    this.need(")");
    this.lists[kind] = { from: listStart, to: this.tokens[this.i - 1].end };
    return tables as K extends "vertex" ? VertexTable[] : EdgeTable[];
  }
  parse(): PropertyGraph {
    this.need("CREATE");
    const orReplace = this.take("OR") ? (this.need("REPLACE"), true) : false;
    this.need("PROPERTY"); this.need("GRAPH");
    const name = this.qualifiedIdentifier();
    this.need("VERTEX"); this.need("TABLES");
    const vertices = this.tableList("vertex");
    const edges = this.take("EDGE") ? (this.need("TABLES"), this.tableList("edge")) : [];
    this.take(";");
    if (this.peek()) throw this.error("Unexpected content after graph definition");
    if (vertices.length === 0) throw new PgqParseError("Add at least one vertex table", this.sql.length, this.sql.length);
    const ids = vertices.map(vertexId);
    if (new Set(ids.map(identifierKey)).size !== ids.length) throw new Error("Vertex table names must be unique");
    const edgeIds = edges.map(edgeId);
    if (new Set(edgeIds.map(identifierKey)).size !== edgeIds.length) throw new Error("Edge table names must be unique");
    if (edgeIds.some(id => ids.some(vertex => sameIdentifier(vertex, id)))) throw new Error("Vertex and edge table names must be distinct");
    for (const edge of edges) {
      const source = ids.find(id => sameIdentifier(id, edge.source.table));
      const destination = ids.find(id => sameIdentifier(id, edge.destination.table));
      if (!source) throw new Error(`Edge ${edge.table} references unknown vertex table ${edge.source.table}`);
      if (!destination) throw new Error(`Edge ${edge.table} references unknown vertex table ${edge.destination.table}`);
      edge.source.table = source;
      edge.destination.table = destination;
      if (edge.source.columns.length !== edge.source.references.length || edge.destination.columns.length !== edge.destination.references.length) throw new Error(`Edge ${edge.table} has mismatched key columns`);
    }
    return { name, orReplace, vertices, edges };
  }
}

export function vertexId(vertex: VertexTable) { return vertex.alias || vertex.table; }
export function edgeId(edge: EdgeTable) { return edge.alias || edge.table; }
export function parsePropertyGraphWithRanges(sql: string): { graph: PropertyGraph } & GraphSource {
  const parser = new Parser(sql, tokenize(sql));
  return { graph: parser.parse(), ranges: parser.ranges, lists: parser.lists };
}
export function parsePropertyGraph(sql: string): PropertyGraph { return parsePropertyGraphWithRanges(sql).graph; }

export function renderTable(table: GraphTable, kind: "vertex" | "edge") {
  const lines = [`    ${table.table}${table.alias ? ` AS ${table.alias}` : ""}`];
  if (table.key.length) lines.push(`      KEY (${table.key.join(", ")})`);
  if (kind === "edge") {
    const edge = table as EdgeTable;
    lines.push(`      SOURCE KEY (${edge.source.columns.join(", ")}) REFERENCES ${edge.source.table} (${edge.source.references.join(", ")})`);
    lines.push(`      DESTINATION KEY (${edge.destination.columns.join(", ")}) REFERENCES ${edge.destination.table} (${edge.destination.references.join(", ")})`);
  }
  lines.push(`      LABEL ${table.label}`);
  if (table.propertyMode === "all") lines.push("      PROPERTIES ARE ALL COLUMNS");
  if (table.propertyMode === "listed") lines.push(`      PROPERTIES (${table.properties.join(", ")})`);
  if (table.propertyMode === "none") lines.push("      NO PROPERTIES");
  return lines.join("\n");
}

export function serializePropertyGraph(graph: PropertyGraph): string {
  return `CREATE ${graph.orReplace ? "OR REPLACE " : ""}PROPERTY GRAPH ${graph.name}\n  VERTEX TABLES (\n${graph.vertices.map(v => renderTable(v, "vertex")).join(",\n")}\n  )${graph.edges.length ? `\n  EDGE TABLES (\n${graph.edges.map(e => renderTable(e, "edge")).join(",\n")}\n  )` : ""};`;
}
