/**
 * useLocalStorage — a drop-in replacement for useState that transparently
 * persists the value to localStorage, so settings (provider, devtunnel URLs,
 * model choices) survive reloads with a one-time setup.
 *
 * Values are JSON-serialized. Stored objects are shallow-merged over the default
 * so newly-added config fields gain their defaults instead of becoming undefined
 * for users with an older persisted blob.
 *
 * @packageDocumentation
 */

import { useCallback, useState } from "react";

/**
 * Persisted state hook.
 *
 * @param key - localStorage key.
 * @param initialValue - default used when nothing is stored yet.
 * @returns a `[value, setValue]` tuple mirroring useState.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initialValue;
      const parsed = JSON.parse(raw) as T;
      // Merge over defaults so new fields are populated for older blobs.
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(initialValue as object), ...(parsed as object) } as T
        : parsed;
    } catch {
      return initialValue;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage full or unavailable — keep in-memory only */
      }
    },
    [key],
  );

  return [value, set];
}
