import { randomUUID } from 'node:crypto';
import {
  FULL_DECK,
  type Card,
  type HandState,
  type TableConfig,
  type Variant,
  applyAction,
  startHand,
} from '@mixednuts/engine';
import {
  type ClientMessage,
  type ServerMessage,
  assertNoLeak,
  redactHand,
} from '@mixednuts/protocol';

export interface Player {
  readonly playerId: string;
  name: string;
  stack: number;
  connected: boolean;
  /** Seat in the CURRENT hand, or null when not dealt in. */
  handSeat: number | null;
}

export interface TableOptions {
  readonly variant: Variant;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly ante?: number;
  readonly maxSeats: number;
  /** Chips a player sits down with. Fixed, because M3 resets every hand. */
  readonly buyIn: number;
  readonly actionTimeoutMs: number;
  /**
   * Deal as soon as two players are seated. Turn off when something else
   * decides when a hand begins — the fast-fold pool in M3 does, and so do
   * tests that need every seat filled before the first deal.
   */
  readonly autoStart?: boolean;
  /**
   * Reset every seated player to `buyIn` before each hand. This is the
   * fast-fold rule from the spec: a fixed effective stack keeps one pool
   * liquid instead of splitting it into deep and short, and it removes
   * stack-carryover entirely when tables are rebuilt every hand.
   */
  readonly resetStackEachHand?: boolean;
  readonly shuffle: (deck: readonly Card[]) => Card[];
  readonly now: () => number;
  readonly send: (playerId: string, msg: ServerMessage) => void;
  /** Called when who-is-seated changes, so the room can refresh its roster. */
  readonly onRoster?: () => void;
  /**
   * Called once per finished hand with each player's net chips for THAT hand.
   * The deltas always sum to zero; the scoreboard re-checks it anyway, one
   * layer away from the engine that produced them.
   */
  readonly onHandComplete?: (
    handId: string,
    results: { playerId: string; name: string; delta: number }[],
  ) => void;
}

/**
 * One table. Transport-agnostic on purpose: the WebSocket adapter only moves
 * bytes, so the rules, the redaction and the timeout behaviour are all
 * testable without opening a socket.
 */
export class Table {
  private readonly players = new Map<string, Player>();
  private order: string[] = [];
  private hand: HandState | null = null;
  private handId = '';
  private actionSeq = 0;
  private buttonIndex = 0;
  private participants: string[] = [];
  private actionDeadline = 0;
  private handsPlayed = 0;
  /** Stacks as they were when the current hand was dealt. */
  private handStart = new Map<string, number>();

  constructor(private readonly opts: TableOptions) {}

  // -- connection lifecycle -------------------------------------------------

  handle(playerId: string, msg: ClientMessage): void {
    switch (msg.type) {
      case 'sit':
        return this.sit(playerId);
      case 'stand':
        return this.stand(playerId);
      case 'ready':
        return this.pushState(playerId);
      case 'action':
        return this.act(playerId, msg);
      default:
        return;
    }
  }

  join(playerId: string, name: string): void {
    const existing = this.players.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.name = name;
    } else {
      this.players.set(playerId, { playerId, name, stack: 0, connected: true, handSeat: null });
    }
    this.pushState(playerId);
  }

  sit(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return this.fail(playerId, 'join first');
    if (this.order.includes(playerId)) return this.fail(playerId, 'already seated');
    if (this.order.length >= this.opts.maxSeats) return this.fail(playerId, 'table is full');
    p.stack = this.opts.buyIn;
    this.order.push(playerId);
    this.opts.onRoster?.();
    if (this.opts.autoStart !== false) this.maybeStartHand();
  }

  /** Give up the seat but stay in the room watching. */
  stand(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || p.handSeat !== null) return; // mid-hand: wait for it to finish
    this.order = this.order.filter((id) => id !== playerId);
    p.stack = 0;
    this.opts.onRoster?.();
  }

  leave(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    // A player in the middle of a hand keeps their seat until it ends; the
    // timeout path folds for them. Removing them mid-hand would orphan chips.
    if (p.handSeat === null) {
      this.order = this.order.filter((id) => id !== playerId);
      this.players.delete(playerId);
      this.opts.onRoster?.();
    }
  }

  /** Everyone in the room, for the room roster message. */
  roster(): { playerId: string; name: string; seated: boolean; stack: number }[] {
    return [...this.players.values()].map((p) => ({
      playerId: p.playerId,
      name: p.name,
      seated: this.order.includes(p.playerId),
      stack: p.stack,
    }));
  }

  get seatedCount(): number {
    return this.order.length;
  }
  get handCount(): number {
    return this.handsPlayed;
  }

  // -- hand lifecycle -------------------------------------------------------

  maybeStartHand(): boolean {
    if (this.hand && this.hand.status === 'running') return false;
    if (this.opts.resetStackEachHand) {
      for (const id of this.order) {
        const p = this.players.get(id);
        if (p) p.stack = this.opts.buyIn;
      }
    }
    const eligible = this.order.filter((id) => (this.players.get(id)?.stack ?? 0) > 0);
    if (eligible.length < 2) return false;

    this.participants = eligible;
    for (const p of this.players.values()) p.handSeat = null;
    this.participants.forEach((id, i) => {
      this.players.get(id)!.handSeat = i;
    });

    const config: TableConfig = {
      variantId: this.opts.variant.id,
      smallBlind: this.opts.smallBlind,
      bigBlind: this.opts.bigBlind,
      ante: this.opts.ante ?? 0,
      buttonSeat: this.buttonIndex % this.participants.length,
    };

    // Random suffix, not a timestamp: two rooms starting their first hand in
    // the same millisecond produced identical ids, which would have collided
    // in hand history the moment two friend games ran at once.
    this.handId = `h${++this.handsPlayed}-${randomUUID().slice(0, 8)}`;
    this.handStart = new Map(
      this.participants.map((id) => [id, this.players.get(id)!.stack]),
    );
    this.actionSeq = 0;
    this.hand = startHand({
      variant: this.opts.variant,
      config,
      seats: this.participants.map((id) => ({
        playerId: id,
        stack: this.players.get(id)!.stack,
      })),
      deck: this.opts.shuffle(FULL_DECK),
    });
    this.resetDeadline();
    this.broadcast();
    this.settleIfComplete();
    return true;
  }

  private act(playerId: string, msg: Extract<ClientMessage, { type: 'action' }>): void {
    const p = this.players.get(playerId);
    const state = this.hand;
    if (!p || !state || state.status !== 'running') return this.fail(playerId, 'no hand in progress');
    if (msg.handId !== this.handId) return this.fail(playerId, 'stale hand');
    if (msg.actionSeq !== this.actionSeq) return this.fail(playerId, 'stale action');
    if (p.handSeat === null || p.handSeat !== state.actionOn) {
      return this.fail(playerId, 'not your turn');
    }

    let next: HandState;
    try {
      next = applyAction(state, this.opts.variant, msg.action);
    } catch (e) {
      // Illegal action: tell only the player who sent it and leave the table
      // untouched. Never crash the table on bad client input.
      return this.fail(playerId, e instanceof Error ? e.message : 'illegal action');
    }
    this.hand = next;
    this.actionSeq += 1;
    this.resetDeadline();
    this.broadcast();
    this.settleIfComplete();
  }

  /**
   * Called by the transport on a timer. Checks when checking is free,
   * otherwise folds — the standard disconnect behaviour.
   */
  tick(): void {
    const state = this.hand;
    if (!state || state.status !== 'running' || state.actionOn === null) return;
    if (this.opts.now() < this.actionDeadline) return;
    const playerId = this.participants[state.actionOn];
    if (!playerId) return;
    const canCheck = state.currentBet - state.seats[state.actionOn]!.committedRound <= 0;
    this.act(playerId, {
      type: 'action',
      handId: this.handId,
      actionSeq: this.actionSeq,
      action: canCheck ? { type: 'check' } : { type: 'fold' },
    });
  }

  private settleIfComplete(): void {
    const state = this.hand;
    if (!state || state.status !== 'complete') return;
    const results: { playerId: string; name: string; delta: number }[] = [];
    state.seats.forEach((s, i) => {
      const id = this.participants[i]!;
      const p = this.players.get(id);
      if (!p) return;
      p.stack = s.stack;
      results.push({
        playerId: id,
        name: p.name,
        delta: s.stack - (this.handStart.get(id) ?? s.stack),
      });
    });
    this.opts.onHandComplete?.(this.handId, results);
    this.buttonIndex += 1;
    this.opts.onRoster?.();
  }

  // -- outbound -------------------------------------------------------------

  /**
   * Build and send a SEPARATE view per connected player.
   *
   * There is no shared payload here by design. If you ever find yourself
   * hoisting `redactHand(...)` out of this loop to "avoid recomputing", stop:
   * that is the change that ships everyone's hole cards to everyone.
   */
  private broadcast(): void {
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      this.pushState(p.playerId);
    }
  }

  private pushState(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (!this.hand) return; // between hands the room roster is the only news
    const view = redactHand(
      this.hand,
      this.opts.variant,
      this.handId,
      p.handSeat,
      new Map([...this.players.values()].map((x) => [x.playerId, x.name])),
      this.actionSeq,
    );
    // Belt and braces: the view type cannot express another seat's hole card,
    // and this re-checks the instance anyway before it goes out.
    assertNoLeak(view, this.hand);
    this.opts.send(playerId, { type: 'state', view });
  }

  private fail(playerId: string, message: string): void {
    this.opts.send(playerId, { type: 'error', message });
  }

  private resetDeadline(): void {
    this.actionDeadline = this.opts.now() + this.opts.actionTimeoutMs;
  }

  // -- test and ops helpers -------------------------------------------------

  get state(): HandState | null {
    return this.hand;
  }
  get currentHandId(): string {
    return this.handId;
  }
  get seq(): number {
    return this.actionSeq;
  }
  /** Who is in a given seat of the CURRENT hand. Seats are per-hand. */
  playerAtSeat(seat: number): string | null {
    return this.participants[seat] ?? null;
  }
  seatOf(playerId: string): number | null {
    return this.players.get(playerId)?.handSeat ?? null;
  }
  stackOf(playerId: string): number {
    return this.players.get(playerId)?.stack ?? 0;
  }
}
