/**
 * Monte Carlo validation results (see analysis/mc-validate.ts and
 * scripts/validate-indices.ts) and the activation decision built on them.
 *
 * An index is used for grading only when the conditional Monte Carlo
 * resolves it for the ruleset and true-count convention. Everything else is
 * labelled experimental (no Monte Carlo run, or inconclusive) or disabled
 * (no deviation in range, or a non-monotone result).
 */
import type { TrueCountRounding } from "../counting";
import type { McAction, McConvention, McVerdict } from "../analysis/mc-validate";
import type { DeviationAction } from "./definitions";
import data from "./data/hilo-validation.json";

export interface McBucket {
  readonly tc: number;
  readonly best: McAction;
  readonly runnerUp: McAction | null;
  readonly resolved: boolean;
  /** Statistics: present in the full results file, omitted from the bundled runtime copy. */
  readonly n?: number;
  readonly margin?: number;
  readonly se?: number | null;
}

export interface McConventionResult {
  readonly verdict: McVerdict;
  readonly note: string;
  readonly transitions: readonly { from: McAction; to: McAction; at: number; uncertain: boolean }[];
  readonly buckets: readonly McBucket[];
}

export interface McVariant {
  readonly das: boolean;
  readonly surrender: boolean;
  readonly conventions: Readonly<Record<McConvention, McConventionResult>>;
  /** Index from even- vs odd-numbered samples; agree when transitions match within one true count. */
  readonly splitHalf: { readonly a: readonly string[]; readonly b: readonly string[]; readonly maxDiff: number | null; readonly agree: boolean };
  readonly depthBands: readonly { readonly label: string; readonly transitions: readonly string[] }[];
}

export interface McCellResult {
  readonly decks: number;
  readonly h17: boolean;
  readonly cellId: string;
  readonly threeCard: boolean;
  readonly states: number;
  readonly draws: number;
  readonly seconds: number;
  readonly variants: readonly McVariant[];
}

export interface McValidationFile {
  readonly version: 1;
  readonly method: string;
  readonly penetration: number;
  readonly results: readonly McCellResult[];
}

export const VALIDATION = data as unknown as McValidationFile;

/** Runtime copy: drops depth-band and split-half detail and per-bucket statistics the app doesn't read. */
export function slimValidation(f: McValidationFile): McValidationFile {
  return {
    ...f,
    results: f.results
      .filter((r) => !r.threeCard)
      .map((r) => ({
        ...r,
        variants: r.variants.map((v) => ({
          ...v,
          splitHalf: { a: [], b: [], maxDiff: v.splitHalf.maxDiff, agree: v.splitHalf.agree },
          depthBands: [],
          conventions: Object.fromEntries(
            Object.entries(v.conventions).map(([k, c]) => [
              k,
              { ...c, buckets: c.buckets.map((b) => ({ tc: b.tc, best: b.best, runnerUp: b.runnerUp, resolved: b.resolved })) },
            ]),
          ) as unknown as McVariant["conventions"],
        })),
      })),
  };
}

export type IndexStatus = "validated" | "experimental" | "disabled";

export interface IndexValidation {
  readonly status: IndexStatus;
  readonly reason: string;
  /** The Monte Carlo result used (validated / inconclusive), if any. */
  readonly result: McConventionResult | null;
  readonly variant: McVariant | null;
  readonly cell: McCellResult | null;
}

export function toDeviationAction(a: McAction): DeviationAction {
  return a === "splitDAS" || a === "splitNoDAS" ? "split" : a;
}

/** The Monte Carlo convention that answers questions in a given true-count convention. */
export function mcConvention(c: TrueCountRounding): McConvention {
  // Under "exact", raw TC ≥ i ⇔ floor(raw) ≥ i, so floor buckets give the same thresholds.
  return c === "exact" ? "floor" : c;
}

export function validationFor(
  key: { decks: number; h17: boolean; das: boolean; surrender: boolean },
  cellId: string,
  convention: TrueCountRounding,
  file: McValidationFile = VALIDATION,
): IndexValidation {
  const cell = file.results.find((r) => r.decks === key.decks && r.h17 === key.h17 && r.cellId === cellId && !r.threeCard) ?? null;
  if (!cell) return { status: "experimental", reason: "Not validated by Monte Carlo for this deck count and soft-17 rule (synthetic estimate only).", result: null, variant: null, cell: null };
  const variant =
    cell.variants.find((v) => v.das === key.das && v.surrender === key.surrender) ??
    cell.variants.find((v) => v.surrender === key.surrender) ??
    cell.variants[0];
  const result = variant.conventions[mcConvention(convention)];
  switch (result.verdict) {
    case "validated":
      if (!variant.splitHalf.agree)
        return { status: "experimental", reason: "The two halves of the Monte Carlo sample disagree by more than one true count; more samples needed.", result, variant, cell };
      return { status: "validated", reason: "", result, variant, cell };
    case "unresolved":
      return { status: "experimental", reason: `Monte Carlo inconclusive: ${result.note}`, result, variant, cell };
    case "no-deviation":
      return { status: "disabled", reason: `No deviation: ${result.note}`, result, variant, cell };
    case "non-monotone":
      return { status: "disabled", reason: `Inconsistent result: ${result.note}`, result, variant, cell };
  }
}
