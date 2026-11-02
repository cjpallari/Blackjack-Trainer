/**
 * Minimal external store backed by localStorage. SSR-safe: on the server and
 * before hydration it returns the default value. Usable with
 * React's useSyncExternalStore.
 */
export interface PersistentStore<T> {
  get(): T;
  getServer(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
}

export function createPersistentStore<T>(key: string, defaults: T, parse: (raw: unknown) => T | null): PersistentStore<T> {
  let value: T = defaults;
  let loaded = false;
  const listeners = new Set<() => void>();

  const load = () => {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) value = parse(JSON.parse(raw)) ?? defaults;
    } catch {
      value = defaults;
    }
  };

  const save = () => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable (private mode): keep in-memory state.
    }
  };

  const store: PersistentStore<T> = {
    get() {
      load();
      return value;
    },
    getServer() {
      return defaults;
    },
    set(next) {
      load();
      value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
      save();
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (e: StorageEvent) => {
        if (e.key !== key) return;
        loaded = false;
        load();
        listener();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    reset() {
      store.set(defaults);
    },
  };
  return store;
}
