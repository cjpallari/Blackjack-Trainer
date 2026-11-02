/**
 * A table session for one human seat plus AI seats, on top of the engine.
 * Pure: every function returns a new session. The UI holds the session and
 * renders `buildTableView(session.state, revealed)`.
 */
import { act, buyIn, createGame, IllegalActionError, runAiTurns, startRound, type GameState, type HandOutcome } from "./engine";
import type { Rng } from "./rng";
import type { TableRules } from "./rules";
import type { PlayerAction } from "./strategy";

/** AI seats are bankrolled so they never run out of chips. */
export const AI_BANKROLL = 1_000_000_000;
export const MAX_SEATS = 7;

export interface TableConfig {
  readonly rules: TableRules;
  /** 0-based seat index for the human, counted from first base (dealer's left). */
  readonly humanSeat: number;
  readonly bankroll: number;
}

export interface SessionStats {
  rounds: number;
  hands: number;
  wins: number;
  losses: number;
  pushes: number;
  blackjacks: number;
  surrenders: number;
  /** Net chips won or lost across settled rounds. */
  net: number;
  /** Total chips wagered, including doubles and splits. */
  wagered: number;
  buyIns: number;
}

export interface RoundSummary {
  readonly roundNumber: number;
  readonly net: number;
  readonly wagered: number;
  readonly outcomes: readonly HandOutcome[];
}

export interface TableSession {
  readonly config: TableConfig;
  readonly state: GameState;
  readonly humanSeatId: number;
  readonly stats: SessionStats;
  /** Summary of the human's most recent settled round. */
  readonly lastRound: RoundSummary | null;
}

export const emptySessionStats = (): SessionStats => ({
  rounds: 0,
  hands: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  blackjacks: 0,
  surrenders: 0,
  net: 0,
  wagered: 0,
  buyIns: 0,
});

export function seatCount(rules: TableRules): number {
  return Math.min(MAX_SEATS, rules.aiPlayers + 1);
}

export function createTableSession(config: TableConfig, rng: Rng): TableSession {
  const n = seatCount(config.rules);
  const humanSeat = Math.max(0, Math.min(n - 1, config.humanSeat));
  let ai = 0;
  const seats = Array.from({ length: n }, (_, i) =>
    i === humanSeat
      ? { kind: "human" as const, name: "You", bankroll: config.bankroll }
      : { kind: "ai" as const, name: `Player ${++ai}`, bankroll: AI_BANKROLL },
  );
  return {
    config: { ...config, humanSeat },
    state: createGame(config.rules, seats, rng),
    humanSeatId: humanSeat,
    stats: emptySessionStats(),
    lastRound: null,
  };
}

export function humanBankroll(session: TableSession): number {
  return session.state.seats[session.humanSeatId].bankroll;
}

/** Why a bet can't be dealt, or null if it can. */
export function betError(session: TableSession, bet: number): string | null {
  const { minBet, maxBet } = session.config.rules;
  if (session.state.phase === "playerTurn") return "Round in progress.";
  if (!Number.isFinite(bet) || bet <= 0) return "Place a bet.";
  if (bet < minBet) return `Table minimum is ${minBet}.`;
  if (bet > maxBet) return `Table maximum is ${maxBet}.`;
  if (bet > humanBankroll(session)) return "Not enough chips.";
  return null;
}

/** Start a round: the human bets `bet`, each AI bets the table minimum, then AI seats before the human act. */
export function dealRound(session: TableSession, bet: number, rng: Rng): TableSession {
  const err = betError(session, bet);
  if (err) throw new IllegalActionError(err);
  const bets: Record<number, number> = {};
  for (const s of session.state.seats) bets[s.id] = s.kind === "human" ? bet : session.config.rules.minBet;
  return advance(session, runAiTurns(startRound(session.state, bets, rng), rng));
}

export function playerAction(session: TableSession, action: PlayerAction, rng: Rng): TableSession {
  const { state } = session;
  if (!state.turn || state.seats[state.turn.seat].kind !== "human") throw new IllegalActionError("It is not your turn.");
  return advance(session, runAiTurns(act(state, action, rng), rng));
}

export function rebuy(session: TableSession, amount: number): TableSession {
  return {
    ...session,
    state: buyIn(session.state, session.humanSeatId, amount),
    stats: { ...session.stats, buyIns: session.stats.buyIns + amount },
  };
}

function advance(session: TableSession, state: GameState): TableSession {
  if (state.phase !== "roundOver" || state.roundNumber === session.lastRound?.roundNumber) return { ...session, state };
  const hands = state.seats[session.humanSeatId].hands;
  if (hands.length === 0) return { ...session, state };
  const s = { ...session.stats };
  let net = 0;
  let wagered = 0;
  for (const h of hands) {
    s.hands++;
    net += h.net ?? 0;
    wagered += h.bet;
    switch (h.outcome) {
      case "blackjack":
        s.blackjacks++;
        s.wins++;
        break;
      case "win":
        s.wins++;
        break;
      case "push":
        s.pushes++;
        break;
      case "surrender":
        s.surrenders++;
        s.losses++;
        break;
      default:
        s.losses++;
    }
  }
  s.rounds++;
  s.net += net;
  s.wagered += wagered;
  return {
    ...session,
    state,
    stats: s,
    lastRound: { roundNumber: state.roundNumber, net, wagered, outcomes: hands.map((h) => h.outcome!) },
  };
}
