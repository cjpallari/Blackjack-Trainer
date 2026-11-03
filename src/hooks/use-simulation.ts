"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SimJob, SimMessage } from "@/workers/sim.worker";

export interface SimRun<T> {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  progress: number;
  result: T | null;
  runtimeMs: number | null;
  error: string | null;
}

/** Runs one simulation job at a time in a Web Worker; never starts automatically. */
export function useSimulation<T>() {
  const worker = useRef<Worker | null>(null);
  const [run, setRun] = useState<SimRun<T>>({ status: "idle", progress: 0, result: null, runtimeMs: null, error: null });

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    (job: SimJob) => {
      stop();
      const w = new Worker(new URL("../workers/sim.worker.ts", import.meta.url));
      worker.current = w;
      setRun({ status: "running", progress: 0, result: null, runtimeMs: null, error: null });
      w.onmessage = (e: MessageEvent<SimMessage>) => {
        const m = e.data;
        if (m.type === "progress") setRun((r) => ({ ...r, progress: m.total ? m.done / m.total : 0 }));
        else if (m.type === "result") {
          setRun({ status: "done", progress: 1, result: m.result as T, runtimeMs: m.runtimeMs, error: null });
          stop();
        } else {
          setRun({ status: "error", progress: 0, result: null, runtimeMs: null, error: m.message });
          stop();
        }
      };
      w.onerror = (e) => {
        setRun({ status: "error", progress: 0, result: null, runtimeMs: null, error: e.message || "Worker failed." });
        stop();
      };
      w.postMessage(job);
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    setRun((r) => (r.status === "running" ? { ...r, status: "cancelled" } : r));
  }, [stop]);

  return { run, start, cancel };
}
