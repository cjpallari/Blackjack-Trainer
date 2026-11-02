"use client";

import { useEffect, useRef } from "react";

/**
 * Global keyboard shortcuts. Keys are matched case-insensitively against
 * KeyboardEvent.key ("h", "enter", " " etc). Ignored while typing in inputs
 * unless the handler map opts in with `allowInInputs`.
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, opts: { enabled?: boolean; allowInInputs?: string[] } = {}) {
  const ref = useRef(map);
  ref.current = map;
  const { enabled = true, allowInInputs = [] } = opts;
  const allowed = allowInInputs.join(",");
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing && !allowed.split(",").includes(key)) return;
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, allowed]);
}
