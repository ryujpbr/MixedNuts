import { randomUUID } from 'node:crypto';
import { type Card, type VariantId, getVariant } from '@mixednuts/engine';
import type { ClientMessage, ServerMessage } from '@mixednuts/protocol';
import { Scoreboard } from './scoreboard.js';
import { Table } from './table.js';
import type { Sender } from './rooms.js';

export interface PoolOptions {
  readonly send: Sender;
  readonly now: () => number;
  readonly shuffle: (deck: readonly Card[]) => Card[];
  readonly variant: VariantId;
  readonly bigBlind: number;
  readonly buyInBb: number;
  readonly tableSize: number;
  readonly minTableSize: number;
  readonly shortHandedAfterMs: number;
  readonly actionTimeoutMs: number;
  readonly recentMemory: number;
}

interface Waiter { readonly playerId: string; readonly name: string; since: number; }
interface LiveTable { readonly id: string; readonly table: Table; readonly seated: string[]; released: Set<string>; }

export class Pool {
  private readonly waiting = new Map<string, Waiter>();
  private readonly tables = new Map<string, LiveTable>();
  private readonly tableOfPlayer = new Map<string, string>();
  private readonly recent = new Map<string, string[]>();
  private readonly scores = new Scoreboard();
  private handsDealt = 0;
  private readonly leaving = new Set<string>();

  constructor(private readonly opts: PoolOptions) {}

  join(playerId: string, name: string): void {
    if (this.tableOfPlayer.has(playerId) || this.waiting.has(playerId)) return;
    this.waiting.set(playerId, { playerId, name, since: this.opts.now() });
    this.scores.ensure(playerId, name);
    this.pushStatus(playerId);
  }

  leave(playerId: string): void {
    this.waiting.delete(playerId);
    if (!this.tableOfPlayer.has(playerId)) this.pushStatus(playerId);
  }

  has(playerId: string): boolean { return this.waiting.has(playerId) || this.tableOfPlayer.has(playerId); }

  handle(playerId: string, msg: ClientMessage): void {
    const live = this.tableOfPlayer.get(playerId);
    if (!live) return;
    this.tables.get(live)?.table.handle(playerId, msg);
  }

  tick(): void {
    for (const live of [...this.tables.values()]) {
      live.table.tick();
      const state = live.table.state;
      if (state && state.status !== 'complete') continue;
      this.retire(live);
    }
    while (this.formTable()) { /* seat while enough waiters */ }
  }

  private retire(live: LiveTable): void {
    this.tables.delete(live.id);
    for (const playerId of live.seated) {
      this.tableOfPlayer.delete(playerId);
      if (live.released.has(playerId)) continue;
      this.returnToPool(playerId, live.table.roster().find((r) => r.playerId === playerId)?.name);
    }
  }

  private returnToPool(playerId: string, name: string | undefined): void {
    this.tableOfPlayer.delete(playerId);
    if (!this.leaving.has(playerId)) {
      this.waiting.set(playerId, { playerId, name: name ?? this.waiting.get(playerId)?.name ?? 'プレイヤー', since: this.opts.now() });
    }
    this.leaving.delete(playerId);
    this.pushStatus(playerId);
  }

  leaveAfterHand(playerId: string): void {
    if (this.tableOfPlayer.has(playerId)) this.leaving.add(playerId);
    this.waiting.delete(playerId);
    this.pushStatus(playerId);
  }

  private formTable(): boolean {
    const now = this.opts.now();
    const queue = [...this.waiting.values()].sort((a, b) => a.since - b.since);
    if (queue.length < this.opts.minTableSize) return false;
    const anchor = queue[0]!;
    const wantFull = queue.length >= this.opts.tableSize;
    const waitedLongEnough = now - anchor.since >= this.opts.shortHandedAfterMs;
    if (!wantFull && !waitedLongEnough) return false;

    const picked: Waiter[] = [anchor];
    const rest = queue.slice(1);
    while (picked.length < this.opts.tableSize && rest.length > 0) {
      let bestIndex = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      rest.forEach((candidate, i) => {
        const cost = picked.reduce((a, p) => a + this.encounters(candidate.playerId, p.playerId), 0);
        if (cost < bestCost) { bestCost = cost; bestIndex = i; }
      });
      picked.push(rest.splice(bestIndex, 1)[0]!);
    }
    if (picked.length < this.opts.minTableSize) return false;
    for (const p of picked) this.waiting.delete(p.playerId);
    this.seat(picked);
    return true;
  }

  private encounters(a: string, b: string): number {
    return (this.recent.get(a) ?? []).filter((x) => x === b).length;
  }

  private rememberEncounters(players: readonly string[]): void {
    for (const a of players) {
      const list = this.recent.get(a) ?? [];
      for (const b of players) if (b !== a) list.push(b);
      while (list.length > this.opts.recentMemory) list.shift();
      this.recent.set(a, list);
    }
  }

  private seat(players: readonly Waiter[]): void {
    const id = randomUUID().slice(0, 8);
    const seated = players.map((p) => p.playerId);
    const live: LiveTable = {
      id, seated, released: new Set(),
      table: new Table({
        variant: getVariant(this.opts.variant),
        smallBlind: Math.floor(this.opts.bigBlind / 2),
        bigBlind: this.opts.bigBlind,
        maxSeats: this.opts.tableSize,
        buyIn: this.opts.bigBlind * this.opts.buyInBb,
        actionTimeoutMs: this.opts.actionTimeoutMs,
        autoStart: false,
        resetStackEachHand: true,
        releaseOnFold: true,
        shuffle: this.opts.shuffle,
        now: this.opts.now,
        send: this.opts.send,
        onPlayerReleased: (playerId) => {
          const entry = this.tables.get(id);
          if (!entry) return;
          entry.released.add(playerId);
          const name = players.find((p) => p.playerId === playerId)?.name;
          this.returnToPool(playerId, name);
        },
        onHandComplete: (handId, results) => {
          this.scores.record(handId, results);
          this.handsDealt += 1;
        },
      }),
    };
    this.tables.set(id, live);
    for (const p of players) {
      this.tableOfPlayer.set(p.playerId, id);
      live.table.join(p.playerId, p.name);
      live.table.sit(p.playerId);
    }
    this.rememberEncounters(seated);
    live.table.maybeStartHand();
    for (const p of players) this.pushStatus(p.playerId);
  }

  private pushStatus(playerId: string): void {
    const state = this.tableOfPlayer.has(playerId) ? 'playing' : this.waiting.has(playerId) ? 'waiting' : 'out';
    this.opts.send(playerId, {
      type: 'pool', state, waiting: this.waiting.size, playing: this.tableOfPlayer.size,
      variant: this.opts.variant, bigBlind: this.opts.bigBlind,
      yourPoints: this.scores.pointsOf(playerId), handsDealt: this.handsDealt,
    } satisfies Extract<ServerMessage, { type: 'pool' }>);
  }

  broadcastStatus(): void {
    for (const id of this.waiting.keys()) this.pushStatus(id);
    for (const id of this.tableOfPlayer.keys()) this.pushStatus(id);
  }

  get waitingCount(): number { return this.waiting.size; }
  get playingCount(): number { return this.tableOfPlayer.size; }
  get tableCount(): number { return this.tables.size; }
  get handsPlayed(): number { return this.handsDealt; }
  get scoreboard(): Scoreboard { return this.scores; }
  tableFor(playerId: string): Table | null {
    const id = this.tableOfPlayer.get(playerId);
    return id ? (this.tables.get(id)?.table ?? null) : null;
  }
  recentOpponents(playerId: string): readonly string[] { return this.recent.get(playerId) ?? []; }
}
