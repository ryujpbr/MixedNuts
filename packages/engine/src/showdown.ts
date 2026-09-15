import type { Card } from './cards.js';
import { EVALUATORS, type EvaluatedHand, bestHand } from './eval/index.js';
import type { Variant } from './variant.js';

export interface Contender { readonly seat: number; readonly hole: readonly Card[]; }
export interface ShareResult { readonly shareId: string; readonly winners: readonly number[]; readonly hands: ReadonlyMap<number, EvaluatedHand>; }
export interface Award { readonly seat: number; readonly amount: number; readonly shareId: string; }

export function awardPot(
  variant: Variant,
  contenders: readonly Contender[],
  board: readonly Card[],
  amount: number,
  oddChipOrder: readonly number[],
): { awards: Award[]; shares: ShareResult[] } {
  const shares: ShareResult[] = [];
  for (const spec of variant.showdown) {
    const ev = EVALUATORS[spec.evaluator];
    const hands = new Map<number, EvaluatedHand>();
    for (const c of contenders) {
      const h = bestHand(ev, c.hole, board, spec.selection);
      if (h) hands.set(c.seat, h);
    }
    let winners: number[] = [];
    let best: EvaluatedHand | null = null;
    for (const [seat, h] of hands) {
      const cmp = best === null ? 1 : ev.compare(h, best);
      if (cmp > 0) { best = h; winners = [seat]; }
      else if (cmp === 0) winners.push(seat);
    }
    shares.push({ shareId: spec.id, winners, hands });
  }

  const byId = new Map(shares.map((s) => [s.shareId, s]));
  const weights = new Map<string, number>();
  for (const spec of variant.showdown) {
    const s = byId.get(spec.id)!;
    let target = spec.id;
    if (s.winners.length === 0) {
      if (!spec.fallbackTo) continue;
      target = spec.fallbackTo;
      if (byId.get(target)!.winners.length === 0) continue;
    }
    weights.set(target, (weights.get(target) ?? 0) + 1);
  }

  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  if (totalWeight === 0) throw new Error('no qualifying hand for any pot share — engine invariant violated');
  const perWeight = Math.floor(amount / totalWeight);
  const awards: Award[] = [];
  let distributed = 0;
  const pending: { shareId: string; seats: number[]; chips: number }[] = [];
  for (const [shareId, w] of weights) {
    const chips = perWeight * w;
    pending.push({ shareId, seats: byId.get(shareId)!.winners.slice(), chips });
    distributed += chips;
  }
  let remainder = amount - distributed;
  for (let i = 0; remainder > 0; i = (i + 1) % pending.length) { pending[i]!.chips += 1; remainder -= 1; }

  for (const p of pending) {
    const seatsInOrder = oddChipOrder.filter((s) => p.seats.includes(s));
    if (seatsInOrder.length === 0) throw new Error(`share ${p.shareId} has winners outside the odd-chip order`);
    const each = Math.floor(p.chips / seatsInOrder.length);
    let rem = p.chips - each * seatsInOrder.length;
    for (const seat of seatsInOrder) {
      const amt = each + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      awards.push({ seat, amount: amt, shareId: p.shareId });
    }
  }
  const check = awards.reduce((a, b) => a + b.amount, 0);
  if (check !== amount) throw new Error(`pot conservation violated: paid ${check} of ${amount}`);
  return { awards, shares };
}
