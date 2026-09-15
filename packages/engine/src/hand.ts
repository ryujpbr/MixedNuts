import type { Card } from './cards.js';
import { applyBettingAction, legalActions as computeLegalActions, openBettingRound, postForcedBets } from './betting.js';
import { EVALUATORS } from './eval/index.js';
import { type Pot, buildPots, refundUnmatched } from './pot.js';
import { awardPot } from './showdown.js';
import { type Action, type HandState, type LegalActions, type PotAward, type SeatState, type TableConfig, activeSeats, seatOrderFromButton } from './table.js';
import type { Variant } from './variant.js';

export interface SeatInit { readonly playerId: string; readonly stack: number; }
export interface StartHandOptions { readonly variant: Variant; readonly config: TableConfig; readonly seats: readonly SeatInit[]; readonly deck: readonly Card[]; }

export function startHand(opts: StartHandOptions): HandState {
  const { variant, config, seats, deck } = opts;
  if (seats.length < 2) throw new Error('need at least 2 seats');
  if (seats.length > variant.maxPlayers) throw new Error(`${variant.shortName} allows at most ${variant.maxPlayers} seats`);
  if (config.buttonSeat < 0 || config.buttonSeat >= seats.length) throw new Error('buttonSeat out of range');
  if (seats.some((x) => x.stack <= 0)) throw new Error('every seat needs chips');
  const state: HandState = {
    config,
    seats: seats.map((x, i) => ({ seat:i, playerId:x.playerId, stack:x.stack, committedRound:0, committedHand:0, folded:false, allIn:false, hasActed:false, closedForRaise:false, hole:[], upcards:[] })),
    board: [], deck:[...deck], deckIndex:0, burned:[], discards:[], phaseIndex:0, roundOpen:false, roundIndex:0, currentBet:0, lastRaiseSize:config.bigBlind, betsThisRound:0, actionOn:null, status:'running', events:[], result:null,
  };
  state.events.push({ t:'hand-start', variant:variant.id, button:config.buttonSeat, sb:config.smallBlind, bb:config.bigBlind });
  postForcedBets(state, variant); advance(state, variant); return state;
}
export function legalActions(state: HandState, variant: Variant): LegalActions | null { return state.actionOn === null ? null : computeLegalActions(state, variant, state.actionOn); }
export function applyAction(state: HandState, variant: Variant, action: Action): HandState { if (state.status !== 'running') throw new Error('hand is already complete'); const next=cloneState(state); applyBettingAction(next,variant,action); advance(next,variant); return next; }
export function cloneState(state: HandState): HandState { return { ...state, seats:state.seats.map((x)=>({...x,hole:[...x.hole],upcards:[...x.upcards]})), board:[...state.board], deck:[...state.deck], burned:[...state.burned], discards:[...state.discards], events:[...state.events] }; }

function advance(state: HandState, variant: Variant): void {
  for (;;) {
    if (state.status === 'complete') return;
    if (activeSeats(state).length <= 1) { settle(state,variant,true); return; }
    const phase=variant.phases[state.phaseIndex];
    if (!phase) { settle(state,variant,false); return; }
    if (phase.type === 'deal') { if (phase.target === 'hole') dealHole(state,phase.count,phase.visibility); else dealBoard(state,phase.count,phase.burn); state.phaseIndex+=1; continue; }
    if (phase.type === 'draw') throw new Error('draw phases require the draw module (milestone M6)');
    if (!state.roundOpen) openBettingRound(state,variant);
    if (state.actionOn !== null) return;
    state.events.push({t:'round-end',phaseIndex:state.phaseIndex,pot:potSum(state)}); state.roundOpen=false; state.roundIndex+=1; state.phaseIndex+=1;
  }
}
const potSum=(s:HandState)=>s.seats.reduce((a,x)=>a+x.committedHand,0);
function draw(state:HandState,n:number):Card[]{ if(state.deckIndex+n>state.deck.length) throw new Error('deck exhausted — reshuffle rule not implemented (milestone M6)'); const out=state.deck.slice(state.deckIndex,state.deckIndex+n); state.deckIndex+=n; return out; }
function dealHole(state:HandState,count:number,visibility:'down'|'up'):void { const order=seatOrderFromButton(state).filter((i)=>!state.seats[i]!.folded); const dealt=new Map<number,Card[]>(order.map((i)=>[i,[]])); for(let r=0;r<count;r++) for(const i of order) dealt.get(i)!.push(draw(state,1)[0]!); for(const i of order){const cards=dealt.get(i)!;const s=state.seats[i]!;if(visibility==='up')for(let k=0;k<cards.length;k++)s.upcards.push(s.hole.length+k);s.hole.push(...cards);state.events.push({t:'deal-hole',seat:i,cards,visibility});}}
function dealBoard(state:HandState,count:number,burn:boolean):void { let burned:Card|null=null;if(burn){burned=draw(state,1)[0]!;state.burned.push(burned);}const cards=draw(state,count);state.board.push(...cards);state.events.push({t:'deal-board',cards,burn:burned}); }

function settle(state:HandState,variant:Variant,uncontested:boolean):void {
  const refunds=refundUnmatched(state); const pots:Pot[]=buildPots(state.seats); const order=seatOrderFromButton(state); const awards:PotAward[]=[]; const shown=new Set<string>();
  if(uncontested){const winner=activeSeats(state)[0];if(!winner)throw new Error('no seats left in hand');for(const p of pots)awards.push({potIndex:p.index,seat:winner.seat,amount:p.amount,shareId:'uncontested'});}
  else for(const p of pots){const contenders=p.eligible.map((i)=>({seat:i,hole:state.seats[i]!.hole}));if(contenders.length===1){awards.push({potIndex:p.index,seat:contenders[0]!.seat,amount:p.amount,shareId:'uncontested'});continue;}const {awards:potAwards,shares}=awardPot(variant,contenders,state.board,p.amount,order.filter((i)=>p.eligible.includes(i)));for(const sh of shares){const spec=variant.showdown.find((x)=>x.id===sh.shareId)!;const ev=EVALUATORS[spec.evaluator];for(const [seat,hand] of sh.hands){const key=`${seat}:${sh.shareId}`;if(shown.has(key))continue;shown.add(key);state.events.push({t:'showdown',seat,shareId:sh.shareId,cards:[...hand.cards],description:ev.describe(hand)});}}for(const a of potAwards)if(a.amount>0)awards.push({potIndex:p.index,seat:a.seat,amount:a.amount,shareId:a.shareId});}
  for(const a of awards){state.seats[a.seat]!.stack+=a.amount;state.events.push({t:'award',seat:a.seat,amount:a.amount,potIndex:a.potIndex,shareId:a.shareId});}
  const potTotalAmount=pots.reduce((x,p)=>x+p.amount,0),paid=awards.reduce((x,a)=>x+a.amount,0);if(paid!==potTotalAmount)throw new Error(`pot conservation violated: paid ${paid} of ${potTotalAmount}`);
  state.actionOn=null;state.status='complete';state.result={uncontested,awards,refunds,potTotal:potTotalAmount};state.events.push({t:'hand-end',uncontested});
}
export function seatResults(state:HandState,initial:readonly SeatInit[]):number[]{return state.seats.map((x:SeatState,i)=>x.stack-initial[i]!.stack);}
