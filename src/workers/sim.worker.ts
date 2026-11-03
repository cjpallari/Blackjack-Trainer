/**
 * Runs betting / bankroll simulations off the main thread. One request per
 * worker; cancellation terminates the worker (runs are deterministic, so a
 * cancelled run can simply be restarted with the same seed).
 */
import { runCompare, runEv, runPenetration, runRor, type CompareRequest, type EvRequest, type PenetrationRequest, type RorRequest } from "@/lib/sim/analyses";

export type SimJob =
  | { kind: "ev"; req: EvRequest }
  | { kind: "compare"; req: CompareRequest; ror?: Omit<RorRequest, "sim"> }
  | { kind: "ror"; req: RorRequest; ev: { rounds: number; roundsPerHour: number } }
  | { kind: "penetration"; req: PenetrationRequest };

export type SimMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; result: unknown; runtimeMs: number }
  | { type: "error"; message: string };

const ctx = self as unknown as { postMessage(m: SimMessage): void; onmessage: ((e: MessageEvent<SimJob>) => void) | null };

function throttled(offset = 0, scale = 1, total = 1) {
  let last = 0;
  return (done: number, t: number) => {
    const now = performance.now();
    if (now - last < 100 && done < t) return;
    last = now;
    ctx.postMessage({ type: "progress", done: offset + (done / t) * scale, total });
  };
}

const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "shoeNets" || k === "shoeRounds" ? undefined : v)));

ctx.onmessage = (e) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    let result: unknown;
    switch (job.kind) {
      case "ev":
        result = runEv(job.req, throttled());
        break;
      case "penetration":
        result = runPenetration(job.req, throttled());
        break;
      case "compare": {
        const steps = job.ror ? 2 : 1;
        const compare = runCompare(job.req, throttled(0, 1 / steps, 1));
        const ror = job.ror
          ? job.req.ramps.map((ramp, i) =>
              runRor({ ...job.ror!, sim: { ...job.req.sim, ramp } }, throttled(0.5 + i / (2 * job.req.ramps.length), 1 / (2 * job.req.ramps.length), 1)),
            )
          : null;
        result = { compare, ror };
        break;
      }
      case "ror": {
        // A short expected-value run supplies μ and σ for the infinite-horizon approximation.
        const ev = runEv({ sim: job.req.sim, rounds: job.ev.rounds, seed: job.req.seed + 1, roundsPerHour: job.ev.roundsPerHour }, throttled(0, 0.25, 1));
        const ror = runRor(job.req, throttled(0.25, 0.75, 1));
        result = { ror, ev };
        break;
      }
    }
    ctx.postMessage({ type: "result", result: strip(result), runtimeMs: performance.now() - t0 });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
