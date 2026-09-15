import { type Card, combinations, formatCards, rankOf, suitOf } from '../cards.js';
import {
  CAT_NAMES,
  FLAGS_HIGH,
  FLAGS_LOW27,
  FLAGS_LOWA5,
  type RankValue,
  compareScore,
  rank5,
} from './core.js';

export type EvaluatorId = 'high' | 'low8' | 'lowA5' | 'low27' | 'badugi';

export interface EvaluatedHand {
  readonly evaluator: EvaluatorId;
  readonly cards: readonly Card[];
  readonly value: RankValue;
}

export interface Evaluator {
  readonly id: EvaluatorId;
  readonly handSize: number;
  evaluate(cards: readonly Card[]): EvaluatedHand | null;
  compare(a: EvaluatedHand, b: EvaluatedHand): number;
  describe(h: EvaluatedHand): string;
}

const highish = (id: EvaluatorId, flags: typeof FLAGS_HIGH, invert: boolean): Evaluator => ({
  id,
  handSize: 5,
  evaluate(cards) {
    return { evaluator: id, cards, value: rank5(cards, flags) };
  },
  compare(a, b) {
    const c = compareScore(a.value.score, b.value.score);
    if (c === 0) return 0;
    return invert ? -c : c;
  },
  describe(h) {
    return `${CAT_NAMES[h.value.category]} (${formatCards(h.cards)})`;
  },
});

export const highEvaluator: Evaluator = highish('high', FLAGS_HIGH, false);
export const low27Evaluator: Evaluator = highish('low27', FLAGS_LOW27, true);
export const lowA5Evaluator: Evaluator = highish('lowA5', FLAGS_LOWA5, true);

export const low8Evaluator: Evaluator = {
  id: 'low8',
  handSize: 5,
  evaluate(cards) {
    const rs = cards.map((c) => {
      const r = rankOf(c);
      return r === 14 ? 1 : r;
    });
    if (new Set(rs).size !== 5) return null;
    if (Math.max(...rs) > 8) return null;
    return { evaluator: 'low8', cards, value: rank5(cards, FLAGS_LOWA5) };
  },
  compare(a, b) {
    const c = compareScore(a.value.score, b.value.score);
    return c === 0 ? 0 : -c;
  },
  describe(h) {
    const rs = h.cards
      .map((c) => (rankOf(c) === 14 ? 1 : rankOf(c)))
      .sort((x, y) => y - x)
      .map((r) => (r === 1 ? 'A' : r === 10 ? 'T' : String(r)));
    return `${rs.join('')} low`;
  },
};

export const badugiEvaluator: Evaluator = {
  id: 'badugi',
  handSize: 4,
  evaluate(cards) {
    let best: { degree: number; ranks: number[]; cards: Card[] } | null = null;
    for (let mask = 1; mask < 1 << cards.length; mask++) {
      const sub: Card[] = [];
      for (let i = 0; i < cards.length; i++) if (mask & (1 << i)) sub.push(cards[i]!);
      const rs = sub.map((c) => (rankOf(c) === 14 ? 1 : rankOf(c)));
      if (new Set(rs).size !== sub.length) continue;
      if (new Set(sub.map(suitOf)).size !== sub.length) continue;
      const ranks = rs.slice().sort((a, b) => b - a);
      if (best === null || sub.length > best.degree || (sub.length === best.degree && compareScore(ranks, best.ranks) < 0)) {
        best = { degree: sub.length, ranks, cards: sub };
      }
    }
    if (!best) return null;
    return { evaluator: 'badugi', cards: best.cards, value: { category: best.degree, score: [best.degree, ...best.ranks] } };
  },
  compare(a, b) {
    if (a.value.category !== b.value.category) return a.value.category - b.value.category;
    const c = compareScore(a.value.score.slice(1), b.value.score.slice(1));
    return c === 0 ? 0 : -c;
  },
  describe(h) {
    const names = h.cards
      .map((c) => (rankOf(c) === 14 ? 1 : rankOf(c)))
      .sort((x, y) => y - x)
      .map((r) => (r === 1 ? 'A' : r === 10 ? 'T' : String(r)));
    const kind = h.value.category === 4 ? 'badugi' : `${h.value.category}-card`;
    return `${names.join('')} ${kind}`;
  },
};

export const EVALUATORS: Record<EvaluatorId, Evaluator> = {
  high: highEvaluator,
  low8: low8Evaluator,
  lowA5: lowA5Evaluator,
  low27: low27Evaluator,
  badugi: badugiEvaluator,
};

export interface HandSelection {
  readonly pool: 'hole' | 'hole+board';
  readonly holeMin: number;
  readonly holeMax: number;
}

export function bestHand(
  ev: Evaluator,
  hole: readonly Card[],
  board: readonly Card[],
  sel: HandSelection,
): EvaluatedHand | null {
  let best: EvaluatedHand | null = null;
  const consider = (cards: Card[]) => {
    const h = ev.evaluate(cards);
    if (h && (best === null || ev.compare(h, best) > 0)) best = h;
  };

  if (sel.pool === 'hole') {
    for (const combo of combinations(hole, ev.handSize)) consider(combo);
  } else {
    const lo = Math.max(sel.holeMin, ev.handSize - board.length);
    const hi = Math.min(sel.holeMax, ev.handSize, hole.length);
    for (let k = lo; k <= hi; k++) {
      const need = ev.handSize - k;
      if (need > board.length) continue;
      for (const hc of combinations(hole, k)) {
        for (const bc of combinations(board, need)) consider([...hc, ...bc]);
      }
    }
  }
  return best;
}

export { rank5, compareScore, CAT_NAMES } from './core.js';
