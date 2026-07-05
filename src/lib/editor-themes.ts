import { useMemo } from "react"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { dracula } from "@uiw/codemirror-theme-dracula"
import { githubDark, githubLight } from "@uiw/codemirror-theme-github"
import { solarizedDark, solarizedLight } from "@uiw/codemirror-theme-solarized"
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night"
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode"
import { DEFAULT_EDITOR_THEME, useAppearance } from "@/components/appearance-provider"
import { useTheme } from "@/components/theme-provider"
import { createEditorTheme } from "./codemirror-theme"

export interface EditorThemeOption {
  id: string
  label: string
  appearance: "light" | "dark"
  extension: Extension
}

export const EDITOR_THEMES: EditorThemeOption[] = [
  // Light
  { id: "github-light", label: "GitHub Light", appearance: "light", extension: githubLight },
  { id: "vscode-light", label: "VS Code Light", appearance: "light", extension: vscodeLight },
  { id: "solarized-light", label: "Solarized Light", appearance: "light", extension: solarizedLight },
  { id: "mrrawbot-light", label: "Mr Rawbot", appearance: "light", extension: createEditorTheme(false) },
  // Dark
  { id: "github-dark", label: "GitHub Dark", appearance: "dark", extension: githubDark },
  { id: "vscode-dark", label: "VS Code Dark", appearance: "dark", extension: vscodeDark },
  { id: "dracula", label: "Dracula", appearance: "dark", extension: dracula },
  { id: "tokyo-night", label: "Tokyo Night", appearance: "dark", extension: tokyoNight },
  { id: "solarized-dark", label: "Solarized Dark", appearance: "dark", extension: solarizedDark },
  { id: "mrrawbot-dark", label: "Mr Rawbot", appearance: "dark", extension: createEditorTheme(true) },
]

export function getEditorTheme(id: string, appearance: "light" | "dark"): Extension {
  const options = EDITOR_THEMES.filter((t) => t.appearance === appearance)
  return (options.find((t) => t.id === id) ?? options.find((t) => t.id === DEFAULT_EDITOR_THEME[appearance]))!
    .extension
}

/** The user-selected editor color theme for the current app appearance. */
export function useEditorTheme(): Extension {
  const { resolvedTheme } = useTheme()
  const { editorThemeLight, editorThemeDark } = useAppearance()
  return useMemo(
    () => getEditorTheme(resolvedTheme === "dark" ? editorThemeDark : editorThemeLight, resolvedTheme),
    [resolvedTheme, editorThemeLight, editorThemeDark],
  )
}

/**
 * Sizing and diff polish layered on top of any color theme (always pass LAST in
 * the extensions array so its rules win). Replaces the merge view's default
 * changed-text marker — a green wavy underline background image — and the
 * deleted-text strikethrough with flat tints that read on any background.
 */
export const editorChrome: Extension = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "0.75rem", // match the surrounding UI (text-xs) instead of the 16px browser default
    fontFamily: "var(--font-mono)",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)" },
  ".cm-lineNumbers .cm-gutterElement": {
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
  },
  ".cm-changedLine": { background: "color-mix(in srgb, #2ea043 10%, transparent)" },
  ".cm-insertedLine": { background: "color-mix(in srgb, #2ea043 10%, transparent)" },
  ".cm-changedText": {
    background: "color-mix(in srgb, #2ea043 26%, transparent)",
    borderRadius: "2px",
  },
  ".cm-insertedLine ins": { textDecoration: "none" },
  ".cm-deletedChunk": { background: "color-mix(in srgb, #f85149 9%, transparent)" },
  ".cm-deletedText": {
    background: "color-mix(in srgb, #f85149 26%, transparent)",
    borderRadius: "2px",
  },
  ".cm-deletedChunk del, .cm-deletedLine del, .cm-deletedLine": { textDecoration: "none" },
  ".cm-changedLineGutter": { background: "color-mix(in srgb, #2ea043 45%, transparent)" },
  ".cm-deletedLineGutter": { background: "color-mix(in srgb, #f85149 45%, transparent)" },
  ".cm-chunkButtons": { display: "none" },
})
