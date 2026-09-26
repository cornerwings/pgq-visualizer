import { edgeId, renderTable, vertexId, type EdgeTable, type GraphSource, type GraphTable, type PropertyGraph, type SourceSpan, type TableRange, type VertexTable } from "./pgq";

type Patch = SourceSpan & { text: string };

function commentsIn(sql: string): string[] {
  const comments: string[] = [];
  let quoted: "'" | '"' | null = null;
  for (let i = 0; i < sql.length;) {
    if (quoted) {
      if (sql[i] === quoted && sql[i + 1] === quoted) i += 2;
      else if (sql[i++] === quoted) quoted = null;
    } else if (sql[i] === "'" || sql[i] === '"') {
      quoted = sql[i++] as "'" | '"';
    } else if (sql.slice(i, i + 2) === "--") {
      const end = sql.indexOf("\n", i + 2);
      comments.push(sql.slice(i, end < 0 ? sql.length : end));
      i = end < 0 ? sql.length : end;
    } else if (sql.slice(i, i + 2) === "/*") {
      const end = sql.indexOf("*/", i + 2);
      comments.push(sql.slice(i, end + 2));
      i = end + 2;
    } else i++;
  }
  return comments;
}

function replace(patches: Patch[], sql: string, span: SourceSpan, text: string) {
  const comments = commentsIn(sql.slice(span.from, span.to));
  patches.push({ ...span, text: comments.length ? `${comments.join("\n      ")}\n      ${text}` : text });
}

function mapping(direction: "SOURCE" | "DESTINATION", value: EdgeTable["source"]): string {
  return `${direction} KEY (${value.columns.join(", ")}) REFERENCES ${value.table} (${value.references.join(", ")})`;
}

function properties(value: GraphTable): string {
  if (value.propertyMode === "none") return "NO PROPERTIES";
  if (value.propertyMode === "listed") return `PROPERTIES (${value.properties.join(", ")})`;
  return "PROPERTIES ARE ALL COLUMNS";
}

function patchTable(sql: string, previous: VertexTable | EdgeTable, next: VertexTable | EdgeTable, range: TableRange, patches: Patch[]) {
  const appended: string[] = [];
  if (previous.table !== next.table) replace(patches, sql, range.fields.table, next.table);
  if (previous.alias !== next.alias) {
    if (range.fields.alias) replace(patches, sql, range.fields.alias, next.alias ? `AS ${next.alias}` : "");
    else if (next.alias) patches.push({ from: range.fields.table.to, to: range.fields.table.to, text: ` AS ${next.alias}` });
  }
  if (JSON.stringify(previous.key) !== JSON.stringify(next.key)) {
    const text = next.key.length ? `KEY (${next.key.join(", ")})` : "";
    if (range.fields.key) replace(patches, sql, range.fields.key, text);
    else if (text) appended.push(text);
  }
  if (previous.label !== next.label || (!range.fields.label && (previous.table !== next.table || previous.alias !== next.alias))) {
    const text = `LABEL ${next.label}`;
    if (range.fields.label) replace(patches, sql, range.fields.label, text);
    else appended.push(text);
  }
  if (previous.propertyMode !== next.propertyMode || JSON.stringify(previous.properties) !== JSON.stringify(next.properties)) {
    const text = properties(next);
    if (range.fields.properties) replace(patches, sql, range.fields.properties, text);
    else if (next.propertyMode !== "all") appended.push(text);
  }
  if (previous.kind === "edge" && next.kind === "edge") {
    for (const direction of ["source", "destination"] as const) {
      if (JSON.stringify(previous[direction]) === JSON.stringify(next[direction])) continue;
      const text = mapping(direction.toUpperCase() as "SOURCE" | "DESTINATION", next[direction]);
      const span = range.fields[direction];
      if (span) replace(patches, sql, span, text);
      else appended.push(text);
    }
  }
  if (appended.length) patches.push({ from: range.to, to: range.to, text: ` ${appended.join(" ")}` });
}

function patchList<T extends VertexTable | EdgeTable>(sql: string, kind: "vertex" | "edge", previous: T[], next: T[], source: GraphSource, patches: Patch[]) {
  const id = kind === "vertex" ? (table: T) => vertexId(table as VertexTable) : (table: T) => edgeId(table as EdgeTable);
  const ranges = source.ranges.filter(range => range.kind === kind);
  const paired = previous.length === next.length ? previous.map((table, index) => [table, next[index], ranges[index]] as const)
    : previous.filter(table => next.some(candidate => id(candidate) === id(table))).map(table => [table, next.find(candidate => id(candidate) === id(table))!, ranges[previous.indexOf(table)]] as const);
  for (const [oldTable, newTable, range] of paired) patchTable(sql, oldTable, newTable, range, patches);

  const removedIndices = previous.flatMap((table, index) => paired.some(([oldTable]) => oldTable === table) ? [] : [index]);
  for (let i = 0; i < removedIndices.length;) {
    const start = removedIndices[i];
    let end = start;
    while (removedIndices[i + 1] === end + 1) end = removedIndices[++i];
    const before = ranges[start - 1];
    const after = ranges[end].separatorAfter;
    patches.push(after
      ? { from: ranges[start].from, to: after.to, text: "" }
      : before?.separatorAfter
        ? { from: before.separatorAfter.from, to: ranges[end].to, text: "" }
        : { from: ranges[start].from, to: ranges[end].to, text: "" });
    i++;
  }

  const added = next.filter(table => !paired.some(([, newTable]) => newTable === table));
  if (!added.length) return;
  const rendered = added.map(table => renderTable(table, kind)).join(",\n");
  const existing = source.lists[kind];
  if (!existing) {
    patches.push({ from: source.lists.vertex.to, to: source.lists.vertex.to, text: `\n  EDGE TABLES (\n${rendered}\n  )` });
  } else if (ranges.length) {
    const from = ranges[ranges.length - 1].to;
    const to = existing.to - 1;
    const gap = sql.slice(from, to);
    const retained = commentsIn(gap).length ? gap.trimEnd() : "";
    patches.push({ from, to, text: `,${retained}\n${rendered}\n  ` });
  } else {
    patches.push({ from: existing.from + 1, to: existing.from + 1, text: `\n${rendered}\n  ` });
  }
}

/** Apply a visual graph edit to the original SQL without reformatting other definitions or comments. */
export function editPropertyGraphSql(sql: string, previous: PropertyGraph, next: PropertyGraph, source: GraphSource): string {
  const patches: Patch[] = [];
  patchList(sql, "vertex", previous.vertices, next.vertices, source, patches);
  patchList(sql, "edge", previous.edges, next.edges, source, patches);
  patches.sort((a, b) => b.from - a.from || b.to - a.to);
  for (const patch of patches) sql = sql.slice(0, patch.from) + patch.text + sql.slice(patch.to);
  return sql;
}
