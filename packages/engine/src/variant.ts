import type { EvaluatorId, HandSelection } from './eval/index.js';

/**
 * A variant is DATA, not code.
 *
 * Adding Razz must not mean writing a Razz engine. Every game in Mixed Nuts is
 * expressed as: forced-bet rule + betting structure + an ordered phase list +
 * a showdown spec. If a new variant cannot be expressed here, extend this
 * schema — do not fork the engine.
 */

export type BettingStructure =
  | { kind: 'no-limit' }
  | { kind: 'pot-limit' }
  | { kind: 'fixed-limit'; /** small bet = 1 unit, big bet = 2 units */ betsPerRound: number }
  | { kind: 'cap'; capInBb: number };

export type ForcedBets =
  | { kind: 'blinds'; sbInBb: 0.5; ante?: number }
  | {
      kind: 'antes-bring-in';
      /** Who is forced to bring in: lowest upcard (stud games) or highest (razz). */
      bringInBy: 'lowest-upcard' | 'highest-upcard';
    };

/** Who opens the action on a betting round. */
export type FirstToAct =
  | 'left-of-button'
  | 'under-the-gun'
  | 'bring-in'
  | 'best-board'
  | 'worst-board';

export type Phase =
  | {
      type: 'deal';
      target: 'hole';
      count: number;
      visibility: 'down' | 'up';
    }
  | {
      type: 'deal';
      target: 'board';
      count: number;
      burn: boolean;
      boardIndex?: number;
    }
  | {
      type: 'draw';
      maxDiscards: number | 'all';
    }
  | {
      type: 'bet';
      tier: 'small' | 'big';
      firstToAct: FirstToAct;
      openPairDoubleBet?: boolean;
    };

export interface PotShare {
  readonly id: string;
  readonly evaluator: EvaluatorId;
  readonly selection: HandSelection;
  readonly fallbackTo: string | null;
}

export interface Variant {
  readonly id: VariantId;
  readonly name: string;
  readonly shortName: string;
  readonly betting: BettingStructure;
  readonly forced: ForcedBets;
  readonly holeCards: number;
  readonly maxPlayers: number;
  readonly phases: readonly Phase[];
  readonly showdown: readonly PotShare[];
  readonly deckExhaustion?: 'reshuffle-discards' | 'not-applicable';
  readonly status: 'stable' | 'draft';
  readonly houseRuleNotes?: string;
}

export type VariantId =
  | 'nlh'
  | 'flh'
  | 'plo'
  | 'plo8'
  | 'flo8'
  | 'bigo'
  | 'stud7'
  | 'stud8'
  | 'razz'
  | '27td'
  | 'a5td'
  | 'nl27sd'
  | 'badugi'
  | 'baducey'
  | 'badacey'
  | 'archie'
  | 'dramaha'
  | 'dramadugi';

export const SEL_HOLDEM: HandSelection = { pool: 'hole+board', holeMin: 0, holeMax: 2 };
export const SEL_OMAHA: HandSelection = { pool: 'hole+board', holeMin: 2, holeMax: 2 };
export const SEL_OWN5: HandSelection = { pool: 'hole', holeMin: 5, holeMax: 5 };
export const SEL_OWN4: HandSelection = { pool: 'hole', holeMin: 4, holeMax: 4 };
