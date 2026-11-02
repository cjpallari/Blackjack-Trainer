/**
 * Conditional Monte Carlo validation of the Hi-Lo index sets.
 *
 *   npm run validate:indices            # all jobs, in parallel; writes deviations/data/hilo-validation.json
 *   tsx scripts/validate-indices.ts --job '<json>' --out <file>   # one job (used by the orchestrator)
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { CELL_BY_ID, DEVIATION_CELLS, type DeviationCell } from "../src/lib/blackjack/deviations/definitions";
import {
  bucketStats,
  deriveIndex,
  jobSeed,
  MC_CONVENTIONS,
  runMcJob,
  type McAction,
  type McConvention,
  type McRecord,
} from "../src/lib/blackjack/analysis/mc-validate";
import { slimValidation, type McCellResult, type McValidationFile, type McVariant } from "../src/lib/blackjack/deviations/validation";

const WINDOW: [number, number] = [-6, 8];
const PASS1_QUOTA = 160;
const PASS2_QUOTA = 640;
const PENETRATION = 0.7;
const MAX_DRAWS = 4_000_000;

interface JobSpec {
  decks: number;
  h17: boolean;
  cellId: string;
  threeCard?: boolean;
}

function variantActions(cell: DeviationCell, das: boolean, ls: boolean, threeCard: boolean): McAction[] {
  return cell.actions
    .filter((a) => a !== "surrender" || ls)
    .filter((a) => !(threeCard && a === "double"))
    .map((a) => (a === "split" ? (das ? "splitDAS" : "splitNoDAS") : a) as McAction);
}

function variants(cell: DeviationCell): { das: boolean; ls: boolean }[] {
  const dasOpts = cell.hand?.kind === "pair" ? [false, true] : [true];
  const lsOpts = cell.actions.includes("surrender") ? [false, true] : [false];
  return dasOpts.flatMap((das) => lsOpts.map((ls) => ({ das, ls })));
}

function analyse(records: McRecord[], cell: DeviationCell, das: boolean, ls: boolean, threeCard: boolean) {
  const actions = variantActions(cell, das, ls, threeCard);
  const conventions: Record<string, McVariant["conventions"][McConvention]> = {};
  for (const c of MC_CONVENTIONS) {
    const stats = bucketStats(records, c, actions);
    const idx = deriveIndex(stats);
    conventions[c] = {
      verdict: idx.verdict,
      note: idx.note,
      transitions: idx.transitions,
      buckets: stats.map((b) => ({
        tc: b.tc,
        n: b.states,
        best: b.best,
        runnerUp: b.runnerUp,
        margin: Math.round(b.margin * 1e5) / 1e5,
        se: Number.isFinite(b.se) ? Math.round(b.se * 1e5) / 1e5 : null,
        resolved: b.resolved,
      })),
    };
  }
  // Diagnostics on the floor convention: split-half agreement and depth bands (point estimates).
  const pointIdx = (rs: McRecord[]) => deriveIndex(bucketStats(rs, "floor", actions).map((b) => ({ ...b, resolved: b.states >= 20 }))).transitions;
  const pointTransitions = (rs: McRecord[]) => pointIdx(rs).map((t) => `${t.to}@${t.at}`);
  const ea = pointIdx(records.filter((r) => r.s % 2 === 0));
  const ob = pointIdx(records.filter((r) => r.s % 2 === 1));
  const sameShape = ea.length === ob.length && ea.every((t, i) => t.to === ob[i].to);
  const maxDiff = sameShape ? Math.max(0, ...ea.map((t, i) => Math.abs(t.at - ob[i].at))) : null;
  const bands: [string, number, number][] = [
    ["0–30%", 0, 0.3],
    ["30–50%", 0.3, 0.5],
    ["50–70%", 0.5, 1],
  ];
  return {
    das,
    surrender: ls,
    conventions: conventions as McVariant["conventions"],
    splitHalf: { a: ea.map((t) => `${t.to}@${t.at}`), b: ob.map((t) => `${t.to}@${t.at}`), maxDiff, agree: maxDiff !== null && maxDiff <= 1 },
    depthBands: bands.map(([label, lo, hi]) => ({ label, transitions: pointTransitions(records.filter((r) => r.depth >= lo && r.depth < hi)) })),
  } satisfies McVariant;
}

function runJob(spec: JobSpec): McCellResult {
  const cell = CELL_BY_ID.get(spec.cellId)!;
  const t0 = Date.now();
  const base = { decks: spec.decks, h17: spec.h17, penetration: PENETRATION, cell, maxDraws: MAX_DRAWS, threeCard: spec.threeCard };
  const pass1 = runMcJob({ ...base, window: WINDOW, quotaPerBucket: PASS1_QUOTA, seed: jobSeed(spec.decks, spec.h17, spec.cellId, !!spec.threeCard, 1) });
  let records = pass1.records;
  let draws = pass1.draws;
  let states = pass1.states;

  // Second pass on the buckets around any unresolved or uncertain crossing.
  const refine = new Set<number>();
  for (const v of variants(cell)) {
    const stats = bucketStats(records, "floor", variantActions(cell, v.das, v.ls, !!spec.threeCard));
    const idx = deriveIndex(stats);
    const resolved = stats.filter((s) => s.resolved);
    for (let i = 1; i < resolved.length; i++) {
      if (resolved[i].best === resolved[i - 1].best) continue;
      for (let tc = resolved[i - 1].tc; tc <= resolved[i].tc; tc++) refine.add(tc);
    }
    if (idx.verdict === "unresolved" && !resolved.length) for (let tc = WINDOW[0]; tc <= WINDOW[1]; tc++) refine.add(tc);
  }
  if (refine.size) {
    const lo = Math.min(...refine);
    const hi = Math.max(...refine);
    const pass2 = runMcJob({ ...base, window: [lo, hi], quotaPerBucket: PASS2_QUOTA, seed: jobSeed(spec.decks, spec.h17, spec.cellId, !!spec.threeCard, 2) });
    const offset = states;
    records = records.concat(pass2.records.map((r) => ({ ...r, s: r.s + offset })));
    draws += pass2.draws;
    states += pass2.states;
  }
  return {
    decks: spec.decks,
    h17: spec.h17,
    cellId: spec.cellId,
    threeCard: !!spec.threeCard,
    states,
    draws,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    variants: variants(cell).map((v) => analyse(records, cell, v.das, v.ls, !!spec.threeCard)),
  };
}

async function orchestrate() {
  const configs: [number, boolean][] = [
    [2, true],
    [2, false],
    [6, false],
    [6, true],
  ];
  const jobs: JobSpec[] = [];
  for (const [decks, h17] of configs) for (const cell of DEVIATION_CELLS) jobs.push({ decks, h17, cellId: cell.id });
  for (const [decks, h17] of configs) for (const id of ["h16v10", "h15v10"]) jobs.push({ decks, h17, cellId: id, threeCard: true });
  // Expensive (double / split) jobs first for better packing.
  const cost = (j: JobSpec) => (CELL_BY_ID.get(j.cellId)!.actions.includes("double") ? 3 : CELL_BY_ID.get(j.cellId)!.hand?.kind === "pair" ? 2 : 1) * (j.decks === 6 ? 2 : 1);
  jobs.sort((a, b) => cost(b) - cost(a));

  const dir = mkdtempSync(join(tmpdir(), "bj-mc-"));
  const results: McCellResult[] = [];
  const concurrency = Math.max(1, cpus().length - 1);
  let next = 0;
  const started = Date.now();
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      const out = join(dir, `${i}.json`);
      await new Promise<void>((resolve, reject) =>
        execFile(
          process.execPath,
          [...process.execArgv, __filename, "--job", JSON.stringify(jobs[i]), "--out", out],
          { maxBuffer: 1 << 26 },
          (err) => (err ? reject(err) : resolve()),
        ),
      );
      const r = JSON.parse(readFileSync(out, "utf8")) as McCellResult;
      results.push(r);
      console.log(
        `[${results.length}/${jobs.length}] ${r.decks}D ${r.h17 ? "H17" : "S17"} ${r.cellId}${r.threeCard ? " (3-card)" : ""}: ${r.states} states, ${r.seconds}s (elapsed ${Math.round((Date.now() - started) / 1000)}s)`,
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const file: McValidationFile = {
    version: 1,
    method:
      "Conditional Monte Carlo: shuffled shoes, first k cards dealt (k uniform up to a 70% cut card), every two-card hand and the upcard enumerated with their dealing probabilities, exact action EVs from the true remaining composition, grouped by the observable Hi-Lo true count (visible running count ÷ quarter-deck estimate of cards in the shoe). Buckets −6..+8 with 160 states each, refined to 640 states around crossings; a bucket is resolved when the best play's margin exceeds two clustered standard errors.",
    penetration: PENETRATION,
    results: results.sort((a, b) => a.decks - b.decks || Number(a.h17) - Number(b.h17) || a.cellId.localeCompare(b.cellId) || Number(a.threeCard) - Number(b.threeCard)),
  };
  const dataDir = join(__dirname, "..", "src", "lib", "blackjack", "deviations", "data");
  // Full results (margins, SEs, diagnostics) for reports; a slim copy is what the app bundles.
  writeFileSync(join(dataDir, "hilo-validation.full.json"), JSON.stringify(file) + "\n");
  writeFileSync(join(dataDir, "hilo-validation.json"), JSON.stringify(slimValidation(file)) + "\n");
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
}

const jobArg = process.argv.indexOf("--job");
if (jobArg >= 0) {
  const spec = JSON.parse(process.argv[jobArg + 1]) as JobSpec;
  const out = process.argv[process.argv.indexOf("--out") + 1];
  writeFileSync(out, JSON.stringify(runJob(spec)));
} else {
  void orchestrate();
}

export type { McConvention };
