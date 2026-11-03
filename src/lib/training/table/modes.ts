/**
 * What each training mode may show. The table UI reads assistance from here
 * and nowhere else, so the Casino Mode restrictions are testable.
 */
export type TrainingMode = "beginner" | "intermediate" | "casino";

export const MODE_LABELS: Record<TrainingMode, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  casino: "Casino",
};

export interface IntermediateOptions {
  /** Show the basic-strategy recommendation on your turn. */
  hints: boolean;
  /** Show decision feedback right after each action (otherwise in the shoe report). */
  immediateFeedback: boolean;
}

export const DEFAULT_INTERMEDIATE: IntermediateOptions = { hints: false, immediateFeedback: true };

export interface Assistance {
  /** Live running count, decks remaining, true count and penetration. */
  readonly liveCount: boolean;
  readonly strategyHint: boolean;
  readonly decisionFeedback: "immediate" | "deferred";
  readonly checkpointFeedback: "immediate" | "deferred";
  /** The player may request a count check. */
  readonly manualChecks: boolean;
  /** Show the ramp's suggested wager before betting (betting training). */
  readonly betHint: boolean;
  /** Feedback on the wager right after it is placed, or only in the shoe report. */
  readonly betFeedback: "immediate" | "deferred";
}

export function assistanceFor(mode: TrainingMode, intermediate: IntermediateOptions): Assistance {
  switch (mode) {
    case "beginner":
      return { liveCount: true, strategyHint: true, decisionFeedback: "immediate", checkpointFeedback: "immediate", manualChecks: true, betHint: true, betFeedback: "immediate" };
    case "intermediate":
      return {
        liveCount: false,
        strategyHint: intermediate.hints,
        decisionFeedback: intermediate.immediateFeedback ? "immediate" : "deferred",
        checkpointFeedback: "immediate",
        manualChecks: true,
        betHint: false,
        betFeedback: "immediate",
      };
    case "casino":
      return { liveCount: false, strategyHint: false, decisionFeedback: "deferred", checkpointFeedback: "deferred", manualChecks: false, betHint: false, betFeedback: "deferred" };
  }
}
