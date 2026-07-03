import { EditorView } from "@codemirror/view"

export function createEditorTheme(dark: boolean) {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
        fontFamily: "var(--font-mono)",
        fontSize: "0.75rem", // match the surrounding UI (text-xs) instead of the 16px browser default
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        backgroundColor: "var(--background)",
      },
      ".cm-content": {
        caretColor: "var(--foreground)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--foreground)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--accent)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--background)",
        color: "var(--muted-foreground)",
        borderRight: "1px solid var(--border)",
      },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in oklch, var(--accent) 45%, transparent)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        paddingLeft: "0.75rem",
        paddingRight: "0.75rem",
      },
      ".cm-panels": {
        backgroundColor: "var(--card)",
        color: "var(--card-foreground)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        borderColor: "var(--border)",
      },
      ".cm-changedLine": {
        backgroundColor: "color-mix(in oklch, var(--chart-4) 12%, transparent)",
      },
      ".cm-changedText": {
        backgroundColor: "color-mix(in oklch, var(--chart-4) 24%, transparent)",
      },
      ".cm-deletedChunk, .cm-deletedLine": {
        backgroundColor: "color-mix(in oklch, var(--destructive) 12%, transparent)",
      },
      ".cm-deletedText": {
        backgroundColor: "color-mix(in oklch, var(--destructive) 24%, transparent)",
      },
      ".cm-insertedLine": {
        backgroundColor: "color-mix(in oklch, var(--chart-2) 14%, transparent)",
      },
      ".cm-changedLineGutter": {
        backgroundColor: "var(--chart-4)",
      },
      ".cm-deletedLineGutter": {
        backgroundColor: "var(--destructive)",
      },
      ".cm-deletedLine del, .cm-deletedLine": {
        textDecoration: "none",
      },
      ".cm-chunkButtons": {
        display: "none",
      },
    },
    { dark },
  )
}
