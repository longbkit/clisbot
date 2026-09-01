import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

export type CodeLanguage = "yaml" | "markdown";

/**
 * CodeMirror behind a controlled-input interface: `value` in, `onChange` out.
 *
 * The view is created once on mount (there is no server DOM) and reconfigured in
 * place afterwards — remounting it would drop the cursor on every keystroke.
 * `value` is pushed into the document only when it differs from what the editor
 * already holds, so typing does not fight the parent's state.
 */
export function CodeEditor({
  value,
  language,
  readOnly,
  label,
  onChange,
}: {
  value: string;
  language: CodeLanguage;
  readOnly: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const notify = useRef(onChange);
  notify.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return undefined;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          syntaxHighlighting(paseoHighlight, { fallback: true }),
          basicSetup,
          editorTheme,
          languageCompartment.of(languageExtension(language)),
          modeCompartment.of(modeExtensions(readOnly, label)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) notify.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
    // The view owns its content after mount; the effects below keep it in sync.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (editor === null || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: languageCompartment.reconfigure(languageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({
      effects: modeCompartment.reconfigure(modeExtensions(readOnly, label)),
    });
  }, [readOnly, label]);

  return <div ref={host} className="h-full overflow-hidden text-sm" data-testid="code-editor" />;
}

const languageCompartment = new Compartment();
const modeCompartment = new Compartment();

function languageExtension(language: CodeLanguage) {
  return language === "yaml" ? yaml() : markdown();
}

function modeExtensions(readOnly: boolean, label: string) {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      "aria-label": label,
      "aria-readonly": String(readOnly),
    }),
  ];
}

/** Tokens follow the dashboard palette in src/styles.css rather than a vendor theme. */
const paseoHighlight = HighlightStyle.define([
  {
    tag: [tags.definition(tags.propertyName), tags.propertyName, tags.attributeName],
    color: "var(--link)",
  },
  { tag: [tags.string, tags.special(tags.string), tags.monospace], color: "var(--chart-3)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--chart-4)" },
  { tag: [tags.comment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.keyword, tags.operator, tags.punctuation], color: "var(--muted-foreground)" },
  { tag: [tags.heading], color: "var(--foreground)" },
  { tag: [tags.strong], color: "var(--foreground)" },
  { tag: [tags.emphasis], fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--chart-2)" },
]);

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--link)", padding: "0.5rem 0" },
  ".cm-line": { padding: "0 0.875rem" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--foreground) 4%, transparent)" },
  "&:not(.cm-focused) .cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--link) 25%, transparent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--link)" },
});
