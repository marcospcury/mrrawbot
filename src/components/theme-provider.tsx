import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderState = {
  theme: Theme
  resolvedTheme: "dark" | "light"
  setTheme: (theme: Theme) => void
}

const ThemeProviderContext = createContext<ThemeProviderState>({
  theme: "system",
  resolvedTheme: "dark",
  setTheme: () => null,
})

function systemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "mrrawbot-theme",
}: {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme,
  )
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(() =>
    theme === "system" ? systemTheme() : theme,
  )

  useEffect(() => {
    const root = window.document.documentElement
    const apply = () => {
      const next = theme === "system" ? systemTheme() : theme
      root.classList.remove("light", "dark")
      root.classList.add(next)
      setResolvedTheme(next)
    }
    apply()
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      mq.addEventListener("change", apply)
      return () => mq.removeEventListener("change", apply)
    }
  }, [theme])

  return (
    <ThemeProviderContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme: (t) => {
          localStorage.setItem(storageKey, t)
          setThemeState(t)
        },
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeProviderContext)
  if (ctx === undefined) throw new Error("useTheme must be used within a ThemeProvider")
  return ctx
}
