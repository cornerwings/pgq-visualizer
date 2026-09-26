# Property Graph Visualizer

A React component for editing `CREATE PROPERTY GRAPH` SQL. It shows vertex and edge tables on a canvas and lets you edit the SQL interactively.

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

## License and development notice

MIT licensed. See [LICENSE](./LICENSE).

This project was developed with LLM assistance.
