import type { BettingStructure, Phase, Variant } from './variant.js';
import { type Action, type HandState, type LegalActions, type RaiseRange, type SeatState, actionableSeats, nextSeat, potTotal } from './table.js';

export function legalActions(state: HandState, variant: Variant, seat: number): LegalActions {
  const s = state.seats[seat];
  if (!s) throw new Error(`no such seat: ${seat}`);
  if (state.actionOn !== seat) throw new Error(`action is not on seat ${seat}`);
  const toCall = Math.max(0, state.currentBet - s.committedRound);
  const canCheck = toCall === 0;
  const callAmount = Math.min(toCall, s.stack);
  return { seat, fold: true, check: canCheck, call: toCall > 0 ? { amount: callAmount, to: s.committedRound + callAmount } : null, raise: raiseRange(state, variant, s) };
}

function raiseRange(state: HandState, variant: Variant, s: SeatState): RaiseRange | null {
  if (s.closedForRaise) return null;
  const others = actionableSeats(state).filter((x) => x.seat !== s.seat);
  if (others.length === 0) return null;
  const kind: 'bet' | 'raise' = state.currentBet === 0 ? 'bet' : 'raise';
  const maxStackTo = s.committedRound + s.stack;
  if (maxStackTo <= state.currentBet) return null;
  const structure = variant.betting;
  const phase = variant.phases[state.phaseIndex];
  if (!phase || phase.type !== 'bet') throw new Error('not in a betting phase');
  if (structure.kind === 'fixed-limit') {
    if (state.betsThisRound >= structure.betsPerRound) return null;
    const unit = betUnit(state, phase, structure);
    const target = state.currentBet + unit;
    const to = Math.min(target, maxStackTo);
    return { kind, minTo: to, maxTo: to, isAllInOnly: to < target };
  }
  const nominalMin = state.currentBet + Math.max(state.lastRaiseSize, state.config.bigBlind);
  let nominalMax: number;
  if (structure.kind === 'pot-limit') {
    const toCall = Math.max(0, state.currentBet - s.committedRound);
    nominalMax = state.currentBet + potTotal(state) + toCall;
  } else if (structure.kind === 'cap') nominalMax = structure.capInBb * state.config.bigBlind;
  else nominalMax = Number.POSITIVE_INFINITY;
  const maxTo = Math.min(maxStackTo, nominalMax);
  if (maxTo <= state.currentBet) return null;
  if (maxTo < nominalMin) return { kind, minTo: maxTo, maxTo, isAllInOnly: true };
  return { kind, minTo: Math.min(nominalMin, maxTo), maxTo, isAllInOnly: false };
}

function betUnit(state: HandState, phase: Extract<Phase, { type: 'bet' }>, structure: Extract<BettingStructure, { kind: 'fixed-limit' }>): number {
  void structure;
  return phase.tier === 'big' ? state.config.bigBlind * 2 : state.config.bigBlind;
}

function put(s: SeatState, amount: number): void {
  const a = Math.min(amount, s.stack);
  s.stack -= a; s.committedRound += a; s.committedHand += a;
  if (s.stack === 0) s.allIn = true;
}

export function applyBettingAction(state: HandState, variant: Variant, action: Action): void {
  const seat = state.actionOn;
  if (seat === null) throw new Error('no action pending');
  const s = state.seats[seat]!;
  const legal = legalActions(state, variant, seat);
  switch (action.type) {
    case 'fold': s.folded = true; s.hasActed = true; break;
    case 'check': if (!legal.check) throw new Error('cannot check: there is a bet to call'); s.hasActed = true; break;
    case 'call': if (!legal.call) throw new Error('cannot call: nothing to call'); put(s, legal.call.amount); s.hasActed = true; break;
    case 'bet':
    case 'raise': {
      const r = legal.raise;
      if (!r) throw new Error('raising is not available to this seat');
      if (r.kind !== action.type) throw new Error(`use "${r.kind}" here, not "${action.type}"`);
      if (action.to < r.minTo || action.to > r.maxTo) throw new Error(`illegal size: ${action.to} outside [${r.minTo}, ${r.maxTo}]`);
      const increment = action.to - state.currentBet;
      const fullRaise = !r.isAllInOnly;
      put(s, action.to - s.committedRound);
      state.currentBet = action.to; state.betsThisRound += 1; s.hasActed = true;
      if (fullRaise) {
        state.lastRaiseSize = increment;
        for (const x of state.seats) if (x.seat !== seat && !x.folded && !x.allIn) { x.hasActed = false; x.closedForRaise = false; }
      } else {
        for (const x of state.seats) if (x.seat !== seat && !x.folded && !x.allIn && x.hasActed) x.closedForRaise = true;
      }
      break;
    }
  }
  state.events.push({ t: 'action', seat, action, committedTo: s.committedRound });
  state.actionOn = findNextToAct(state, seat);
}

export function findNextToAct(state: HandState, from: number): number | null { return nextSeat(state, from, (x) => owesAction(state, x)); }
export function owesAction(state: HandState, x: SeatState): boolean { return !x.folded && !x.allIn && (!x.hasActed || x.committedRound < state.currentBet); }
export function roundComplete(state: HandState): boolean { return state.seats.every((x) => !owesAction(state, x)); }

export function openBettingRound(state: HandState, variant: Variant): void {
  const phase = variant.phases[state.phaseIndex];
  if (!phase || phase.type !== 'bet') throw new Error('phase is not a betting round');
  const isFirstRound = state.roundIndex === 0;
  const blindsAlreadyPosted = isFirstRound && variant.forced.kind === 'blinds';
  for (const x of state.seats) { x.hasActed = false; x.closedForRaise = false; if (!blindsAlreadyPosted) x.committedRound = 0; }
  if (!blindsAlreadyPosted) { state.currentBet = 0; state.lastRaiseSize = state.config.bigBlind; }
  state.betsThisRound = blindsAlreadyPosted ? 1 : 0; state.roundOpen = true;
  const first = resolveFirstToAct(state, phase);
  state.events.push({ t: 'round-start', phaseIndex: state.phaseIndex, firstToAct: first });
  state.actionOn = owesAction(state, state.seats[first]!) ? first : findNextToAct(state, first);
}

function resolveFirstToAct(state: HandState, phase: Extract<Phase, { type: 'bet' }>): number {
  const n = state.seats.length, btn = state.config.buttonSeat;
  const eligible = (i: number) => { const x = state.seats[i]!; return !x.folded && !x.allIn; };
  const scanFrom = (start: number): number => { for (let i = 0; i < n; i++) { const idx = (start + i) % n; if (eligible(idx)) return idx; } for (let i = 0; i < n; i++) { const idx = (start + i) % n; if (!state.seats[idx]!.folded) return idx; } throw new Error('no seats left in hand'); };
  switch (phase.firstToAct) {
    case 'left-of-button': return scanFrom((btn + 1) % n);
    case 'under-the-gun': { const bb = bigBlindSeat(state); return scanFrom((bb + 1) % n); }
    case 'bring-in':
    case 'best-board':
    case 'worst-board': throw new Error(`firstToAct "${phase.firstToAct}" requires the stud module (milestone M7)`);
  }
}

export function smallBlindSeat(state: HandState): number { const n = state.seats.length; return n === 2 ? state.config.buttonSeat : (state.config.buttonSeat + 1) % n; }
export function bigBlindSeat(state: HandState): number { const n = state.seats.length; return n === 2 ? (state.config.buttonSeat + 1) % n : (state.config.buttonSeat + 2) % n; }

export function postForcedBets(state: HandState, variant: Variant): void {
  if (variant.forced.kind !== 'blinds') throw new Error('antes/bring-in forced bets require the stud module (milestone M7)');
  const { ante, smallBlind, bigBlind } = state.config;
  if (ante > 0) {
    for (const idx of state.seats.map((x) => x.seat)) { const x = state.seats[idx]!; const a = Math.min(ante, x.stack); if (a > 0) { put(x, a); state.events.push({ t: 'post', seat: idx, amount: a, kind: 'ante' }); } }
    for (const x of state.seats) x.committedRound = 0;
  }
  const sb = state.seats[smallBlindSeat(state)]!, bb = state.seats[bigBlindSeat(state)]!;
  const sbAmt = Math.min(smallBlind, sb.stack); put(sb, sbAmt); state.events.push({ t: 'post', seat: sb.seat, amount: sbAmt, kind: 'sb' });
  const bbAmt = Math.min(bigBlind, bb.stack); put(bb, bbAmt); state.events.push({ t: 'post', seat: bb.seat, amount: bbAmt, kind: 'bb' });
  state.currentBet = bigBlind; state.lastRaiseSize = bigBlind;
}
