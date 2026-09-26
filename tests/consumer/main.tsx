import { createRoot } from "react-dom/client";
import { PropertyGraphVisualizer, parsePropertyGraph } from "pgq-visualizer";
import "pgq-visualizer/style.css";

const sql = "CREATE PROPERTY GRAPH g VERTEX TABLES (people KEY (id));";
parsePropertyGraph(sql);
createRoot(document.getElementById("root")!).render(<div style={{ height: 600 }}><PropertyGraphVisualizer value={sql} onChange={() => {}} /></div>);
