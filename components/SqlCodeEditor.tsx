import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { basicSetup } from "codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { parsePropertyGraphWithRanges, PgqParseError } from "../lib/pgq";

export interface SqlCodeEditorHandle { reveal: (position: number) => void }

interface SqlCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCursor: (position: number) => void;
}

const colors = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--pgq-blue)", fontWeight: "600" },
  { tag: tags.string, color: "var(--pgq-cyan)" },
  { tag: tags.number, color: "var(--pgq-magenta)" },
  { tag: tags.comment, color: "var(--pgq-muted)", fontStyle: "italic" },
  { tag: tags.operator, color: "var(--pgq-orange)" },
]);

function diagnostics(source: string): Diagnostic[] {
  try { parsePropertyGraphWithRanges(source); return []; }
  catch (reason) {
    const error = reason as Error;
    const start = reason instanceof PgqParseError ? reason.from : Math.max(0, source.length - 1);
    const end = reason instanceof PgqParseError ? reason.to : source.length;
    const from = source.length ? Math.min(start, source.length - 1) : 0;
    const to = Math.max(from, Math.min(source.length, end));
    return [{ from, to, severity: "error", message: error.message, source: "SQL/PGQ" }];
  }
}

export const SqlCodeEditor = forwardRef<SqlCodeEditorHandle, SqlCodeEditorProps>(function SqlCodeEditor({ value, onChange, onCursor }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const applyingProp = useRef(false);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;

  useImperativeHandle(ref, () => ({ reveal(position) {
    const current = view.current;
    if (current) current.dispatch({ effects: EditorView.scrollIntoView(Math.min(position, current.state.doc.length), { y: "center" }) });
  } }), []);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      doc: value,
      parent: host.current,
      extensions: [
        basicSetup,
        sql({ dialect: PostgreSQL }),
        syntaxHighlighting(colors),
        EditorView.lineWrapping,
        linter(current => diagnostics(current.state.doc.toString()), { delay: 180 }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !applyingProp.current) onChangeRef.current(update.state.doc.toString());
          if ((update.selectionSet || update.docChanged) && update.view.hasFocus) onCursorRef.current(update.state.selection.main.head);
        }),
      ],
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    applyingProp.current = true;
    try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); }
    finally { applyingProp.current = false; }
  }, [value]);

  return <div ref={host} className="pgq-code-editor" aria-label="CREATE PROPERTY GRAPH SQL" />;
});
