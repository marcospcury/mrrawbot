import { useCallback, useEffect, useState } from "react"

/** useState backed by localStorage (JSON-serialized). Supports updater functions. */
export function usePersisted<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw !== null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore quota errors */
    }
  }, [key, value])

  const set = useCallback((v: T | ((prev: T) => T)) => setValue(v), [])
  return [value, set]
}
