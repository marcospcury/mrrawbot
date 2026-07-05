import { createContext, useContext } from "react"
import { usePersisted } from "@/hooks/use-persisted"

// Defined here (not in lib/editor-themes) so this always-mounted provider does
// not pull CodeMirror and every color theme into the main bundle.
export const DEFAULT_EDITOR_THEME: Record<"light" | "dark", string> = {
  light: "github-light",
  dark: "github-dark",
}

export type FileIconTheme = "monochrome" | "colored"

interface AppearanceState {
  /** Editor (file view + changes view) theme ids, one per app appearance. */
  editorThemeLight: string
  editorThemeDark: string
  fileIconTheme: FileIconTheme
  setEditorThemeLight: (id: string) => void
  setEditorThemeDark: (id: string) => void
  setFileIconTheme: (theme: FileIconTheme) => void
}

const AppearanceContext = createContext<AppearanceState>({
  editorThemeLight: DEFAULT_EDITOR_THEME.light,
  editorThemeDark: DEFAULT_EDITOR_THEME.dark,
  fileIconTheme: "colored",
  setEditorThemeLight: () => null,
  setEditorThemeDark: () => null,
  setFileIconTheme: () => null,
})

/** Shared appearance settings (editor + file icon themes), persisted locally. */
export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [editorThemeLight, setEditorThemeLight] = usePersisted("mrr.editorTheme.light", DEFAULT_EDITOR_THEME.light)
  const [editorThemeDark, setEditorThemeDark] = usePersisted("mrr.editorTheme.dark", DEFAULT_EDITOR_THEME.dark)
  const [fileIconTheme, setFileIconTheme] = usePersisted<FileIconTheme>("mrr.fileIcons", "colored")

  return (
    <AppearanceContext.Provider
      value={{
        editorThemeLight,
        editorThemeDark,
        fileIconTheme,
        setEditorThemeLight,
        setEditorThemeDark,
        setFileIconTheme,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  )
}

export function useAppearance() {
  return useContext(AppearanceContext)
}
