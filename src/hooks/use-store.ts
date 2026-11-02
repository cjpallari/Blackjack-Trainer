"use client";

import { useSyncExternalStore } from "react";
import type { PersistentStore } from "@/lib/storage/persistent-store";
import { settingsStore, statsStore } from "@/lib/storage/stores";

export function useStore<T>(store: PersistentStore<T>): [T, PersistentStore<T>["set"]] {
  const value = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  return [value, store.set];
}

export const useSettings = () => useStore(settingsStore);
export const useStats = () => useStore(statsStore);
