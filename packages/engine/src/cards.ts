/**
 * Card encoding: a Card is an integer 0..51.
 *   rank = 2 + (card >> 2)   // 2..14, where 14 = Ace
 *   suit = card & 3          // 0=c 1=d 2=h 3=s
 * Compact, allocation-free, and cheap to compare/hash — the engine evaluates
 * tens of thousands of hands per second across many concurrent tables.
 */
export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export const rankOf = (c: Card): number => 2 + (c >> 2);
export const suitOf = (c: Card): number => c & 3;

export const makeCard = (rank: number, suit: number): Card => ((rank - 2) << 2) | suit;

export const FULL_DECK: readonly Card[] = Array.from({ length: 52 }, (_, i) => i);

export function formatCard(c: Card): string {
  return `${RANKS[rankOf(c) - 2]}${SUITS[suitOf(c)]}`;
}

export function formatCards(cs: readonly Card[]): string {
  return cs.map(formatCard).join(' ');
}

/** Parse "As Kd 7c" or "AsKd7c". Intended for tests and hand-history replay only. */
export function parseCards(s: string): Card[] {
  const t = s.replace(/[\s,]/g, '');
  if (t.length % 2 !== 0) throw new Error(`bad card string: ${s}`);
  const out: Card[] = [];
  for (let i = 0; i < t.length; i += 2) {
    const r = RANKS.indexOf(t[i]!.toUpperCase());
    const u = SUITS.indexOf(t[i + 1]!.toLowerCase());
    if (r < 0 || u < 0) throw new Error(`bad card: ${t.slice(i, i + 2)}`);
    out.push(makeCard(r + 2, u));
  }
  return out;
}

/**
 * Fisher-Yates using an injected RNG.
 *
 * SECURITY: production callers MUST pass a CSPRNG-backed source
 * (see `createSecureRng`). Math.random is permitted in tests only. The deck
 * is never exposed to clients; only the cards a seat is entitled to see are
 * ever serialised out.
 */
export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = a;
  }
  return arr;
}

/** Generate all k-subsets of `xs` as index-free arrays. */
export function combinations<T>(xs: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const n = xs.length;
  if (k > n || k < 0) return out;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    out.push(idx.map((i) => xs[i]!));
    let i = k - 1;
    while (i >= 0 && idx[i]! === n - k + i) i--;
    if (i < 0) return out;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}
