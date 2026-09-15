import type { Card } from './cards.js';
import type { VariantId } from './variant.js';

export interface SeatState {
  readonly seat: number;
  readonly playerId: string;
  stack: number;
  committedRound: number;
  committedHand: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  closedForRaise: boolean;
  hole: Card[];
  upcards: number[];
}

export interface TableConfig {
  readonly variantId: VariantId;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly ante: number;
  readonly buttonSeat: number;
}

export type Action =
  | { readonly type: 'fold' }
  | { readonly type: 'check' }
  | { readonly type: 'call' }
  | { readonly type: 'bet'; readonly to: number }
  | { readonly type: 'raise'; readonly to: number };

export interface RaiseRange {
  readonly kind: 'bet' | 'raise';
  readonly minTo: number;
  readonly maxTo: number;
  readonly isAllInOnly: boolean;
}

export interface LegalActions {
  readonly seat: number;
  readonly fold: boolean;
  readonly check: boolean;
  readonly call: { readonly amount: number; readonly to: number } | null;
  readonly raise: RaiseRange | null;
}

export type HandEvent =
  | { t: 'hand-start'; variant: VariantId; button: number; sb: number; bb: number }
  | { t: 'post'; seat: number; amount: number; kind: 'sb' | 'bb' | 'ante' }
  | { t: 'deal-hole'; seat: number; cards: Card[]; visibility: 'down' | 'up' }
  | { t: 'deal-board'; cards: Card[]; burn: Card | null }
  | { t: 'round-start'; phaseIndex: number; firstToAct: number }
  | { t: 'action'; seat: number; action: Action; committedTo: number }
  | { t: 'round-end'; phaseIndex: number; pot: number }
  | { t: 'refund'; seat: number; amount: number }
  | { t: 'showdown'; seat: number; shareId: string; cards: Card[]; description: string }
  | { t: 'award'; seat: number; amount: number; potIndex: number; shareId: string }
  | { t: 'hand-end'; uncontested: boolean };

export interface HandState {
  readonly config: TableConfig;
  seats: SeatState[];
  board: Card[];
  deck: Card[];
  deckIndex: number;
  burned: Card[];
  discards: Card[];
  phaseIndex: number;
  roundOpen: boolean;
  roundIndex: number;
  currentBet: number;
  lastRaiseSize: number;
  betsThisRound: number;
  actionOn: number | null;
  status: 'running' | 'complete';
  events: HandEvent[];
  result: HandResult | null;
}

export interface PotAward { readonly potIndex: number; readonly seat: number; readonly amount: number; readonly shareId: string; }
export interface HandResult {
  readonly uncontested: boolean;
  readonly awards: readonly PotAward[];
  readonly refunds: readonly { seat: number; amount: number }[];
  readonly potTotal: number;
}

export const potTotal = (s: HandState): number => s.seats.reduce((a, x) => a + x.committedHand, 0);
export const activeSeats = (s: HandState): SeatState[] => s.seats.filter((x) => !x.folded);
export const actionableSeats = (s: HandState): SeatState[] => s.seats.filter((x) => !x.folded && !x.allIn);

export function seatOrderFromButton(s: HandState): number[] {
  const n = s.seats.length;
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push((s.config.buttonSeat + i) % n);
  return out;
}

export function nextSeat(s: HandState, from: number, pred: (x: SeatState) => boolean): number | null {
  const n = s.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (pred(s.seats[idx]!)) return idx;
  }
  return null;
}
