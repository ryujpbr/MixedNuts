import { type Card, rankOf, suitOf } from '../cards.js';

export interface RankFlags {
  readonly aceLow: boolean;
  readonly wheelStraight: boolean;
  readonly useStraightsFlushes: boolean;
}

export const CAT = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export const CAT_NAMES: Record<number, string> = {
  0: 'High Card',
  1: 'One Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
};

export interface RankValue {
  readonly category: number;
  readonly score: readonly number[];
}

export function compareScore(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function rank5(cards: readonly Card[], flags: RankFlags): RankValue {
  if (cards.length !== 5) throw new Error(`rank5 expects 5 cards, got ${cards.length}`);

  const ranks = cards.map((c) => {
    const r = rankOf(c);
    return flags.aceLow && r === 14 ? 1 : r;
  });

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]);

  const isFlush = flags.useStraightsFlushes && new Set(cards.map(suitOf)).size === 1;

  let straightHigh = 0;
  if (flags.useStraightsFlushes && counts.size === 5) {
    const uniq = [...counts.keys()].sort((a, b) => b - a);
    if (uniq[0]! - uniq[4]! === 4) {
      straightHigh = uniq[0]!;
    } else if (
      flags.wheelStraight &&
      !flags.aceLow &&
      uniq[0] === 14 &&
      uniq[1] === 5 &&
      uniq[4] === 2
    ) {
      straightHigh = 5;
    }
  }

  if (straightHigh && isFlush) return { category: CAT.STRAIGHT_FLUSH, score: [CAT.STRAIGHT_FLUSH, straightHigh] };
  if (groups[0]![1] === 4) return { category: CAT.QUADS, score: [CAT.QUADS, groups[0]![0], groups[1]![0]] };
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return { category: CAT.FULL_HOUSE, score: [CAT.FULL_HOUSE, groups[0]![0], groups[1]![0]] };
  if (isFlush) return { category: CAT.FLUSH, score: [CAT.FLUSH, ...ranks.slice().sort((a, b) => b - a)] };
  if (straightHigh) return { category: CAT.STRAIGHT, score: [CAT.STRAIGHT, straightHigh] };
  if (groups[0]![1] === 3) return { category: CAT.TRIPS, score: [CAT.TRIPS, groups[0]![0], groups[1]![0], groups[2]![0]] };
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return { category: CAT.TWO_PAIR, score: [CAT.TWO_PAIR, groups[0]![0], groups[1]![0], groups[2]![0]] };
  if (groups[0]![1] === 2) return { category: CAT.PAIR, score: [CAT.PAIR, groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]] };
  return { category: CAT.HIGH_CARD, score: [CAT.HIGH_CARD, ...ranks.slice().sort((a, b) => b - a)] };
}

export const FLAGS_HIGH: RankFlags = { aceLow: false, wheelStraight: true, useStraightsFlushes: true };
export const FLAGS_LOW27: RankFlags = { aceLow: false, wheelStraight: false, useStraightsFlushes: true };
export const FLAGS_LOWA5: RankFlags = { aceLow: true, wheelStraight: false, useStraightsFlushes: false };
