import { useState } from "react";
import { Network, RotateCcw } from "lucide-react";
import { PropertyGraphVisualizer } from "../index";

const examples = [
  {
    id: "payments", label: "Payments graph", sql: `CREATE PROPERTY GRAPH payments_graph
  VERTEX TABLES (
    persons KEY (person_id) LABEL Person
      PROPERTIES (person_id, name, birthday),
    accounts KEY (account_id) LABEL Account
      PROPERTIES (account_id, balance, opened_at),
    merchants KEY (merchant_id) LABEL Merchant
      PROPERTIES ARE ALL COLUMNS
  )
  EDGE TABLES (
    account_owners KEY (id)
      SOURCE KEY (person_id) REFERENCES persons (person_id)
      DESTINATION KEY (account_id) REFERENCES accounts (account_id)
      LABEL Owns NO PROPERTIES,
    transfers KEY (id)
      SOURCE KEY (from_account_id) REFERENCES accounts (account_id)
      DESTINATION KEY (to_account_id) REFERENCES accounts (account_id)
      LABEL Transfer PROPERTIES (amount, ts, memo),
    payments KEY (id)
      SOURCE KEY (account_id) REFERENCES accounts (account_id)
      DESTINATION KEY (merchant_id) REFERENCES merchants (merchant_id)
      LABEL Pays PROPERTIES (amount, ts)
  );`,
  },
  {
    id: "movies", label: "Movies & ratings", sql: `CREATE PROPERTY GRAPH movie_graph
  VERTEX TABLES (
    people KEY (person_id) LABEL person
      PROPERTIES (name, birth_year),
    movies KEY (movie_id) LABEL movie
      PROPERTIES (title, released),
    genres KEY (genre_id) LABEL genre
      PROPERTIES (name)
  )
  EDGE TABLES (
    ratings KEY (rating_id)
      SOURCE KEY (person_id) REFERENCES people (person_id)
      DESTINATION KEY (movie_id) REFERENCES movies (movie_id)
      LABEL rated PROPERTIES (score, rated_at),
    movie_genres KEY (id)
      SOURCE KEY (movie_id) REFERENCES movies (movie_id)
      DESTINATION KEY (genre_id) REFERENCES genres (genre_id)
      LABEL in_genre NO PROPERTIES,
    follows KEY (id)
      SOURCE KEY (follower_id) REFERENCES people (person_id)
      DESTINATION KEY (followed_id) REFERENCES people (person_id)
      LABEL follows NO PROPERTIES
  );`,
  },
  {
    id: "banking", label: "Bank transfers", sql: `CREATE PROPERTY GRAPH banking_graph
  VERTEX TABLES (
    accounts KEY (account_id) LABEL account
      PROPERTIES (owner_name, balance),
    customers KEY (customer_id) LABEL customer
      PROPERTIES (name, city),
    branches KEY (branch_id) LABEL branch
      PROPERTIES (branch_name)
  )
  EDGE TABLES (
    transfers KEY (transfer_id)
      SOURCE KEY (from_account) REFERENCES accounts (account_id)
      DESTINATION KEY (to_account) REFERENCES accounts (account_id)
      LABEL transferred PROPERTIES (amount, transfer_date),
    owns KEY (ownership_id)
      SOURCE KEY (customer_id) REFERENCES customers (customer_id)
      DESTINATION KEY (account_id) REFERENCES accounts (account_id)
      LABEL owns NO PROPERTIES,
    held_at KEY (account_branch_id)
      SOURCE KEY (account_id) REFERENCES accounts (account_id)
      DESTINATION KEY (branch_id) REFERENCES branches (branch_id)
      LABEL held_at NO PROPERTIES
  );`,
  },
  {
    id: "campus", label: "Campus network", sql: `CREATE OR REPLACE PROPERTY GRAPH campus_graph
  VERTEX TABLES (
    students KEY (student_id) LABEL student
      PROPERTIES (name, major),
    courses KEY (course_id) LABEL course
      PROPERTIES (title, credits),
    faculty KEY (faculty_id) LABEL professor
      PROPERTIES (name, department),
    departments KEY (department_id) LABEL department
      PROPERTIES (name)
  )
  EDGE TABLES (
    enrollments KEY (enrollment_id)
      SOURCE KEY (student_id) REFERENCES students (student_id)
      DESTINATION KEY (course_id) REFERENCES courses (course_id)
      LABEL enrolled_in PROPERTIES (semester, grade),
    teaches KEY (teaching_id)
      SOURCE KEY (faculty_id) REFERENCES faculty (faculty_id)
      DESTINATION KEY (course_id) REFERENCES courses (course_id)
      LABEL teaches NO PROPERTIES,
    belongs_to KEY (membership_id)
      SOURCE KEY (faculty_id) REFERENCES faculty (faculty_id)
      DESTINATION KEY (department_id) REFERENCES departments (department_id)
      LABEL belongs_to NO PROPERTIES
  );`,
  },
] as const;

export default function App() {
  const [sql, setSql] = useState<string>(examples[0].sql);
  const [exampleId, setExampleId] = useState<string>(examples[0].id);
  const [lastExampleId, setLastExampleId] = useState<string>(examples[0].id);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [instance, setInstance] = useState(0);

  const changeSql = (next: string) => {
    setSql(next);
    if (exampleId !== "custom" && next !== examples.find(example => example.id === exampleId)?.sql) setExampleId("custom");
  };

  const loadExample = (id: string) => {
    const example = examples.find(item => item.id === id);
    if (!example) return;
    setSql(example.sql); setExampleId(id); setLastExampleId(id); setInstance(number => number + 1);
  };

  return <main className="demo-shell" data-theme={theme}>
    <header className="demo-header">
      <div className="demo-brand"><span className="demo-brand-mark"><Network size={19} /></span><strong>Property Graph Visualizer</strong></div>
      <div className="demo-header-actions">
        <label className="demo-control"><span>Example</span><select aria-label="Choose example" value={exampleId} onChange={event => loadExample(event.target.value)}>{exampleId === "custom" && <option value="custom">Custom changes</option>}{examples.map(example => <option key={example.id} value={example.id}>{example.label}</option>)}</select></label>
        <label className="demo-control"><span>Theme</span><select aria-label="Color theme" value={theme} onChange={event => setTheme(event.target.value as "auto" | "light" | "dark")}><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <button type="button" className="demo-reset" onClick={() => loadExample(lastExampleId)} title="Reset current example"><RotateCcw size={15} /><span>Reset</span></button>
      </div>
    </header>
    <div className="demo-workspace"><PropertyGraphVisualizer key={instance} value={sql} onChange={changeSql} theme={theme} /></div>
  </main>;
}
