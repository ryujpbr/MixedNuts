import type { HandState, SeatState } from './table.js';

export interface Pot {
  readonly index: number;
  readonly amount: number;
  readonly eligible: readonly number[];
}

export function refundUnmatched(state: HandState): { seat: number; amount: number }[] {
  const owed = new Map<number, number>();
  const take = (seat: number, amount: number) => {
    if (amount <= 0) return;
    const s = state.seats[seat]!;
    s.committedHand -= amount;
    s.stack += amount;
    if (s.stack > 0) s.allIn = false;
    owed.set(seat, (owed.get(seat) ?? 0) + amount);
  };

  for (const x of state.seats) {
    if (x.committedHand <= 0) continue;
    const maxOther = Math.max(0, ...state.seats.filter((y) => y.seat !== x.seat).map((y) => y.committedHand));
    take(x.seat, x.committedHand - maxOther);
  }

  const live = state.seats.filter((x) => !x.folded);
  const maxLive = Math.max(0, ...live.map((x) => x.committedHand));
  for (const x of state.seats) take(x.seat, x.committedHand - maxLive);

  const refunds = [...owed.entries()].map(([seat, amount]) => ({ seat, amount }));
  for (const r of refunds) state.events.push({ t: 'refund', seat: r.seat, amount: r.amount });
  return refunds;
}

export function buildPots(seats: readonly SeatState[]): Pot[] {
  const live = seats.filter((x) => !x.folded && x.committedHand > 0);
  const levels = [...new Set(live.map((x) => x.committedHand))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const x of seats) amount += Math.min(Math.max(x.committedHand - prev, 0), level - prev);
    const eligible = live.filter((x) => x.committedHand >= level).map((x) => x.seat);
    if (amount > 0 && eligible.length > 0) {
      const last = pots[pots.length - 1];
      if (last && sameSeats(last.eligible, eligible)) pots[pots.length - 1] = { ...last, amount: last.amount + amount };
      else pots.push({ index: pots.length, amount, eligible });
    }
    prev = level;
  }

  const dead = seats.reduce((a, x) => a + Math.max(x.committedHand - prev, 0), 0);
  if (dead !== 0) throw new Error(`${dead} chips above the top live level — refundUnmatched was not run`);
  return pots.map((p, i) => ({ ...p, index: i }));
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
