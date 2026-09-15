import { SEL_OMAHA, SEL_OWN4, SEL_OWN5, SEL_HOLDEM, type ForcedBets, type Phase, type PotShare, type Variant, type VariantId } from '../variant.js';

const BLINDS: ForcedBets = { kind: 'blinds', sbInBb: 0.5 };
const flopPhases = (holeCards: number): Phase[] => [
  { type: 'deal', target: 'hole', count: holeCards, visibility: 'down' },
  { type: 'bet', tier: 'small', firstToAct: 'under-the-gun' },
  { type: 'deal', target: 'board', count: 3, burn: true },
  { type: 'bet', tier: 'small', firstToAct: 'left-of-button' },
  { type: 'deal', target: 'board', count: 1, burn: true },
  { type: 'bet', tier: 'big', firstToAct: 'left-of-button' },
  { type: 'deal', target: 'board', count: 1, burn: true },
  { type: 'bet', tier: 'big', firstToAct: 'left-of-button' },
];
const studPhases = (lowball: boolean): Phase[] => [
  { type: 'deal', target: 'hole', count: 2, visibility: 'down' },
  { type: 'deal', target: 'hole', count: 1, visibility: 'up' },
  { type: 'bet', tier: 'small', firstToAct: 'bring-in' },
  { type: 'deal', target: 'hole', count: 1, visibility: 'up' },
  { type: 'bet', tier: 'small', firstToAct: lowball ? 'worst-board' : 'best-board', openPairDoubleBet: !lowball },
  { type: 'deal', target: 'hole', count: 1, visibility: 'up' },
  { type: 'bet', tier: 'big', firstToAct: lowball ? 'worst-board' : 'best-board' },
  { type: 'deal', target: 'hole', count: 1, visibility: 'up' },
  { type: 'bet', tier: 'big', firstToAct: lowball ? 'worst-board' : 'best-board' },
  { type: 'deal', target: 'hole', count: 1, visibility: 'down' },
  { type: 'bet', tier: 'big', firstToAct: lowball ? 'worst-board' : 'best-board' },
];
const tripleDrawPhases = (holeCards: number): Phase[] => [
  { type: 'deal', target: 'hole', count: holeCards, visibility: 'down' },
  { type: 'bet', tier: 'small', firstToAct: 'under-the-gun' },
  { type: 'draw', maxDiscards: 'all' },
  { type: 'bet', tier: 'small', firstToAct: 'left-of-button' },
  { type: 'draw', maxDiscards: 'all' },
  { type: 'bet', tier: 'big', firstToAct: 'left-of-button' },
  { type: 'draw', maxDiscards: 'all' },
  { type: 'bet', tier: 'big', firstToAct: 'left-of-button' },
];
const SHARE_HIGH_OMAHA: PotShare = { id: 'high', evaluator: 'high', selection: SEL_OMAHA, fallbackTo: null };
const SHARE_LOW8_OMAHA: PotShare = { id: 'low', evaluator: 'low8', selection: SEL_OMAHA, fallbackTo: 'high' };
const V: Partial<Record<VariantId, Variant>> = {
  nlh: { id:'nlh', name:"No-Limit Hold'em", shortName:'NLH', betting:{kind:'no-limit'}, forced:BLINDS, holeCards:2, maxPlayers:6, phases:flopPhases(2), showdown:[{id:'high',evaluator:'high',selection:SEL_HOLDEM,fallbackTo:null}], status:'stable' },
  flh: { id:'flh', name:"Fixed-Limit Hold'em", shortName:'FLH', betting:{kind:'fixed-limit',betsPerRound:4}, forced:BLINDS, holeCards:2, maxPlayers:6, phases:flopPhases(2), showdown:[{id:'high',evaluator:'high',selection:SEL_HOLDEM,fallbackTo:null}], status:'stable' },
  plo: { id:'plo', name:'Pot-Limit Omaha', shortName:'PLO', betting:{kind:'pot-limit'}, forced:BLINDS, holeCards:4, maxPlayers:6, phases:flopPhases(4), showdown:[SHARE_HIGH_OMAHA], status:'stable' },
  plo8: { id:'plo8', name:'Pot-Limit Omaha Hi-Lo (8 or Better)', shortName:'PLO8', betting:{kind:'pot-limit'}, forced:BLINDS, holeCards:4, maxPlayers:6, phases:flopPhases(4), showdown:[SHARE_HIGH_OMAHA,SHARE_LOW8_OMAHA], status:'stable' },
  flo8: { id:'flo8', name:'Fixed-Limit Omaha Hi-Lo (8 or Better)', shortName:'FLO8', betting:{kind:'fixed-limit',betsPerRound:4}, forced:BLINDS, holeCards:4, maxPlayers:6, phases:flopPhases(4), showdown:[SHARE_HIGH_OMAHA,SHARE_LOW8_OMAHA], status:'stable' },
  bigo: { id:'bigo', name:'Big O (Five-Card Omaha Hi-Lo)', shortName:'BigO', betting:{kind:'pot-limit'}, forced:BLINDS, holeCards:5, maxPlayers:6, phases:flopPhases(5), showdown:[SHARE_HIGH_OMAHA,SHARE_LOW8_OMAHA], status:'stable' },
  stud7: { id:'stud7', name:'Seven-Card Stud', shortName:'7Stud', betting:{kind:'fixed-limit',betsPerRound:4}, forced:{kind:'antes-bring-in',bringInBy:'lowest-upcard'}, holeCards:7, maxPlayers:6, phases:studPhases(false), showdown:[{id:'high',evaluator:'high',selection:SEL_OWN5,fallbackTo:null}], status:'stable' },
  stud8: { id:'stud8', name:'Seven-Card Stud Hi-Lo (8 or Better)', shortName:'Stud8', betting:{kind:'fixed-limit',betsPerRound:4}, forced:{kind:'antes-bring-in',bringInBy:'lowest-upcard'}, holeCards:7, maxPlayers:6, phases:studPhases(false), showdown:[{id:'high',evaluator:'high',selection:SEL_OWN5,fallbackTo:null},{id:'low',evaluator:'low8',selection:SEL_OWN5,fallbackTo:'high'}], status:'stable' },
  razz: { id:'razz', name:'Razz', shortName:'Razz', betting:{kind:'fixed-limit',betsPerRound:4}, forced:{kind:'antes-bring-in',bringInBy:'highest-upcard'}, holeCards:7, maxPlayers:6, phases:studPhases(true), showdown:[{id:'low',evaluator:'lowA5',selection:SEL_OWN5,fallbackTo:null}], status:'stable' },
  '27td': { id:'27td', name:'Deuce-to-Seven Triple Draw', shortName:'2-7TD', betting:{kind:'fixed-limit',betsPerRound:4}, forced:BLINDS, holeCards:5, maxPlayers:6, phases:tripleDrawPhases(5), showdown:[{id:'low',evaluator:'low27',selection:SEL_OWN5,fallbackTo:null}], deckExhaustion:'reshuffle-discards', status:'stable' },
  a5td: { id:'a5td', name:'Ace-to-Five Triple Draw', shortName:'A-5TD', betting:{kind:'fixed-limit',betsPerRound:4}, forced:BLINDS, holeCards:5, maxPlayers:6, phases:tripleDrawPhases(5), showdown:[{id:'low',evaluator:'lowA5',selection:SEL_OWN5,fallbackTo:null}], deckExhaustion:'reshuffle-discards', status:'stable', houseRuleNotes:'Played without a joker. 52-card deck only.' },
  nl27sd: { id:'nl27sd', name:'No-Limit Deuce-to-Seven Single Draw', shortName:'NL2-7SD', betting:{kind:'no-limit'}, forced:BLINDS, holeCards:5, maxPlayers:6, phases:[{type:'deal',target:'hole',count:5,visibility:'down'},{type:'bet',tier:'small',firstToAct:'under-the-gun'},{type:'draw',maxDiscards:'all'},{type:'bet',tier:'small',firstToAct:'left-of-button'}], showdown:[{id:'low',evaluator:'low27',selection:SEL_OWN5,fallbackTo:null}], deckExhaustion:'reshuffle-discards', status:'stable' },
  badugi: { id:'badugi', name:'Badugi', shortName:'Badugi', betting:{kind:'fixed-limit',betsPerRound:4}, forced:BLINDS, holeCards:4, maxPlayers:6, phases:tripleDrawPhases(4), showdown:[{id:'badugi',evaluator:'badugi',selection:SEL_OWN4,fallbackTo:null}], deckExhaustion:'reshuffle-discards', status:'stable' },
  badacey: { id:'badacey', name:'Badacey', shortName:'Badacey', betting:{kind:'fixed-limit',betsPerRound:4}, forced:BLINDS, holeCards:5, maxPlayers:6, phases:tripleDrawPhases(5), showdown:[{id:'low',evaluator:'lowA5',selection:SEL_OWN5,fallbackTo:null},{id:'badugi',evaluator:'badugi',selection:{pool:'hole',holeMin:4,holeMax:4},fallbackTo:null}], deckExhaustion:'reshuffle-discards', status:'draft', houseRuleNotes:'Split: A-5 low using all 5 cards vs best badugi using any 4 of the 5. Must pin: whether a non-badugi (3-card) hand can win the badugi half.' },
  baducey: { id:'baducey', name:'Baducey (Badeucy)', shortName:'Baducey', betting:{kind:'fixed-limit',betsPerRound:4}, forced:BLINDS, holeCards:5, maxPlayers:6, phases:tripleDrawPhases(5), showdown:[{id:'low',evaluator:'low27',selection:SEL_OWN5,fallbackTo:null},{id:'badugi',evaluator:'badugi',selection:{pool:'hole',holeMin:4,holeMax:4},fallbackTo:null}], deckExhaustion:'reshuffle-discards', status:'draft', houseRuleNotes:'Split: 2-7 low (all 5) vs best badugi (any 4 of 5). Same open question as Badacey.' },
  dramaha: { id:'dramaha', name:'Dramaha (Drawmaha 5)', shortName:'Dramaha', betting:{kind:'pot-limit'}, forced:BLINDS, holeCards:5, maxPlayers:6, phases:[{type:'deal',target:'hole',count:5,visibility:'down'},{type:'bet',tier:'small',firstToAct:'under-the-gun'},{type:'deal',target:'board',count:3,burn:true},{type:'bet',tier:'small',firstToAct:'left-of-button'},{type:'draw',maxDiscards:'all'},{type:'bet',tier:'small',firstToAct:'left-of-button'},{type:'deal',target:'board',count:1,burn:true},{type:'bet',tier:'big',firstToAct:'left-of-button'},{type:'deal',target:'board',count:1,burn:true},{type:'bet',tier:'big',firstToAct:'left-of-button'}], showdown:[{id:'omaha-high',evaluator:'high',selection:SEL_OMAHA,fallbackTo:null},{id:'draw-high',evaluator:'high',selection:SEL_OWN5,fallbackTo:null}], deckExhaustion:'reshuffle-discards', status:'draft', houseRuleNotes:'Pot splits between the Omaha-high hand and the best 5-card draw hand. Must pin draw timing, number of draws, and draw-half minimum.' },
  dramadugi: { id:'dramadugi', name:'Dramadugi', shortName:'Dramadugi', betting:{kind:'pot-limit'}, forced:BLINDS, holeCards:5, maxPlayers:6, phases:[{type:'deal',target:'hole',count:5,visibility:'down'},{type:'bet',tier:'small',firstToAct:'under-the-gun'},{type:'deal',target:'board',count:3,burn:true},{type:'bet',tier:'small',firstToAct:'left-of-button'},{type:'draw',maxDiscards:'all'},{type:'bet',tier:'small',firstToAct:'left-of-button'},{type:'deal',target:'board',count:1,burn:true},{type:'bet',tier:'big',firstToAct:'left-of-button'},{type:'deal',target:'board',count:1,burn:true},{type:'bet',tier:'big',firstToAct:'left-of-button'}], showdown:[{id:'omaha-high',evaluator:'high',selection:SEL_OMAHA,fallbackTo:null},{id:'badugi',evaluator:'badugi',selection:{pool:'hole',holeMin:4,holeMax:4},fallbackTo:null}], deckExhaustion:'reshuffle-discards', status:'draft', houseRuleNotes:'As Dramaha but the draw half is scored as badugi. Same open questions.' },
};
export const VARIANTS = V;
export const PENDING_RULES: { id: VariantId; blocker: string }[] = [{ id:'archie', blocker:'Multiple incompatible rulesets in circulation. Pick one, document it, then configure.' }];
export const STABLE_VARIANTS = Object.values(V).filter((v) => v.status === 'stable');
export const DRAFT_VARIANTS = Object.values(V).filter((v) => v.status === 'draft');
export function getVariant(id: VariantId): Variant { const v = V[id]; if (!v) throw new Error(`variant not configured: ${id}`); return v; }
