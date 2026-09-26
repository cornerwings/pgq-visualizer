# Property Graph Visualizer

A React component for editing `CREATE PROPERTY GRAPH` SQL. It shows vertex and edge tables on a canvas and lets you edit the SQL or use detail forms. The repository also includes a local demo.

## Use it

The npm package has not been published yet. Once it is available, install it with `npm install pgq-visualizer`. React 18.2+ or 19 and React DOM are peer dependencies.

```tsx
import { useState } from "react";
import { PropertyGraphVisualizer } from "pgq-visualizer";
import "pgq-visualizer/style.css";

export function GraphEditor() {
  const [sql, setSql] = useState(
    "CREATE PROPERTY GRAPH g VERTEX TABLES (people KEY (id));"
  );

  return (
    <div style={{ height: 650 }}>
      <PropertyGraphVisualizer value={sql} onChange={setSql} theme="auto" />
    </div>
  );
}
```

`value` and `onChange` make the component controlled. Give its parent a height. `theme` accepts `"auto"`, `"light"`, or `"dark"`.

The package also exports `parsePropertyGraph`, `parsePropertyGraphWithRanges`, and `serializePropertyGraph` for code that needs the graph model or SQL source ranges.

## Behavior and limits

Select a table in the editor or canvas to inspect it. The detail panel can change names, labels, keys, properties, and edge endpoints. You can add vertices, connect tables, and run Auto layout. When SQL is incomplete, the editor shows the error and the canvas keeps the last valid graph.

Visual edits preserve comments and formatting outside the changed clause. Comments inside a changed clause move before its new text. Removing a table also removes its comments. The parser supports common `CREATE PROPERTY GRAPH` clauses, quoted identifiers, aliases, and composite keys. It rejects unsupported clauses and does not check the database schema.

## Development

Use Node.js 22.13+ and npm.

```sh
npm install
npm run dev
```

The demo runs at the URL printed by Vite. Run `npm test`, `npm run typecheck`, and `npm run test:consumer` before a release. `npm run build` builds the library; `npm run build:demo` builds the static demo. `npm pack --dry-run` lists the files that would be published. Confirm that the npm package name is available before publishing.

## License and development notice

MIT licensed. See [LICENSE](./LICENSE).

This project was developed with LLM assistance.
