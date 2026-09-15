import { randomInt } from 'node:crypto';
import { type Card, type VariantId, getVariant } from '@mixednuts/engine';
import type { ClientMessage, ServerMessage } from '@mixednuts/protocol';
import type { AuthedUser, TokenVerifier } from './auth.js';
import { Scoreboard } from './scoreboard.js';
import { Table } from './table.js';

export type Sender = (playerId: string, msg: ServerMessage) => void;

/**
 * Unambiguous alphabet: no 0/O, no 1/I/L. People read these codes aloud and
 * type them on phones, and a code that gets mistyped is a friend who cannot
 * join. 32^6 is about a billion, so guessing a live room is hopeless even
 * before the attempt limiter below.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const MAX_JOIN_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 60_000;

export interface RoomManagerOptions {
  readonly send: Sender;
  readonly verifier: TokenVerifier;
  readonly now: () => number;
  readonly shuffle: (deck: readonly Card[]) => Card[];
  readonly actionTimeoutMs: number;
  readonly maxSeats: number;
  /** Fixed stack in big blinds. Everyone sits with the same amount. */
  readonly buyInBb: number;
  /** How long an empty room survives, so a reconnect finds it still there. */
  readonly emptyRoomTtlMs: number;
  readonly nextHandDelayMs: number;
  readonly allowedVariants: readonly VariantId[];
}

interface Room {
  readonly code: string;
  readonly table: Table;
  readonly scores: Scoreboard;
  readonly variant: VariantId;
  readonly bigBlind: number;
  host: string;
  readonly members: Set<string>;
  emptySince: number | null;
  nextHandAt: number | null;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly playerRoom = new Map<string, string>();
  private readonly users = new Map<string, AuthedUser>();
  private readonly attempts = new Map<string, { count: number; since: number }>();

  constructor(private readonly opts: RoomManagerOptions) {}

  // -- identity -------------------------------------------------------------

  /**
   * Verify a token and return the identity to use for this connection.
   *
   * The caller must use the returned uid and discard anything the client said
   * about who it is. There is deliberately no overload that takes a playerId.
   */
  async authenticate(token: string): Promise<AuthedUser | null> {
    const user = await this.opts.verifier.verify(token);
    if (!user) return null;
    this.users.set(user.uid, user);
    return user;
  }

  nameOf(playerId: string): string {
    return this.users.get(playerId)?.name ?? 'プレイヤー';
  }

  // -- routing --------------------------------------------------------------

  handle(playerId: string, msg: ClientMessage): void {
    switch (msg.type) {
      case 'auth':
        return; // handled by the transport before we ever get here
      case 'create-room':
        return this.createRoom(playerId, msg.variant, msg.bigBlind);
      case 'join-room':
        return this.joinRoom(playerId, msg.code);
      case 'leave-room':
        return this.leaveRoom(playerId);
      default: {
        const room = this.roomOf(playerId);
        if (!room) return this.fail(playerId, 'ルームに入っていません');
        room.table.handle(playerId, msg);
      }
    }
  }

  private createRoom(playerId: string, variant: VariantId, bigBlind: number): void {
    if (!this.opts.allowedVariants.includes(variant)) {
      return this.fail(playerId, 'このゲームはまだ選べません');
    }
    this.leaveRoom(playerId, { quiet: true });

    const code = this.freshCode();
    const scores = new Scoreboard();
    const room: Room = {
      code,
      variant,
      bigBlind,
      host: playerId,
      members: new Set(),
      emptySince: null,
      nextHandAt: null,
      scores,
      table: new Table({
        variant: getVariant(variant),
        smallBlind: Math.floor(bigBlind / 2),
        bigBlind,
        maxSeats: this.opts.maxSeats,
        buyIn: bigBlind * this.opts.buyInBb,
        actionTimeoutMs: this.opts.actionTimeoutMs,
        autoStart: true,
        resetStackEachHand: true,
        shuffle: this.opts.shuffle,
        now: this.opts.now,
        send: this.opts.send,
        onRoster: () => this.pushRoom(code),
        onHandComplete: (handId, results) => {
          scores.record(handId, results);
          this.pushScores(code);
        },
      }),
    };
    this.rooms.set(code, room);
    this.addMember(room, playerId);
  }

  private joinRoom(playerId: string, code: string): void {
    if (this.rateLimited(playerId)) {
      return this.fail(playerId, 'コードの入力が多すぎます。少し待ってください');
    }
    const room = this.rooms.get(code);
    // Same message whether the code is wrong or the room is full, so the
    // response cannot be used to enumerate which codes exist.
    if (!room) return this.fail(playerId, 'そのコードのルームは見つかりません');
    if (this.playerRoom.get(playerId) === code) {
      this.pushRoom(code, playerId);
      return this.pushScores(code, playerId);
    }
    this.leaveRoom(playerId, { quiet: true });
    this.addMember(room, playerId);
  }

  private addMember(room: Room, playerId: string): void {
    room.members.add(playerId);
    room.emptySince = null;
    this.playerRoom.set(playerId, room.code);
    room.table.join(playerId, this.nameOf(playerId));
    room.scores.ensure(playerId, this.nameOf(playerId));
    this.pushRoom(room.code);
    this.pushScores(room.code);
  }

  leaveRoom(playerId: string, opts: { quiet?: boolean } = {}): void {
    const code = this.playerRoom.get(playerId);
    if (!code) return;
    const room = this.rooms.get(code);
    this.playerRoom.delete(playerId);
    if (!room) return;
    room.members.delete(playerId);
    room.table.leave(playerId);
    if (room.host === playerId) {
      // The host leaving does not close the room: friends mid-session should
      // not all get kicked because one person's phone died.
      room.host = [...room.members][0] ?? room.host;
    }
    if (room.members.size === 0) room.emptySince = this.opts.now();
    if (!opts.quiet) this.opts.send(playerId, { type: 'room-closed' });
    this.pushRoom(code);
  }

  /** Socket closed. Keeps the membership so a refresh lands back in the room. */
  disconnect(playerId: string): void {
    const room = this.roomOf(playerId);
    if (!room) return;
    room.table.leave(playerId);
    if ([...room.members].every((id) => !this.isConnected(id))) {
      room.emptySince = this.opts.now();
    }
    this.pushRoom(room.code);
  }

  private connected = new Set<string>();
  markConnected(playerId: string): void {
    this.connected.add(playerId);
  }
  markDisconnected(playerId: string): void {
    this.connected.delete(playerId);
  }
  private isConnected(playerId: string): boolean {
    return this.connected.has(playerId);
  }

  // -- clock ----------------------------------------------------------------

  tick(): void {
    const now = this.opts.now();
    for (const room of [...this.rooms.values()]) {
      room.table.tick();
      const state = room.table.state;
      if (!state || state.status === 'complete') {
        if (room.nextHandAt === null) {
          room.nextHandAt = now + this.opts.nextHandDelayMs;
        } else if (now >= room.nextHandAt) {
          room.nextHandAt = null;
          room.table.maybeStartHand();
        }
      } else {
        room.nextHandAt = null;
      }
      if (room.emptySince !== null && now - room.emptySince > this.opts.emptyRoomTtlMs) {
        for (const id of room.members) this.playerRoom.delete(id);
        this.rooms.delete(room.code);
      }
    }
  }

  // -- outbound -------------------------------------------------------------

  private pushRoom(code: string, only?: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const msg: ServerMessage = {
      type: 'room',
      code: room.code,
      variant: room.variant,
      bigBlind: room.bigBlind,
      host: room.host,
      members: room.table.roster(),
      handsPlayed: room.table.handCount,
    };
    if (only) {
      this.opts.send(only, msg);
      return;
    }
    for (const id of room.members) this.opts.send(id, msg);
  }

  private pushScores(code: string, only?: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const msg: ServerMessage = { type: 'scoreboard', snapshot: room.scores.snapshot() };
    if (only) {
      this.opts.send(only, msg);
      return;
    }
    for (const id of room.members) this.opts.send(id, msg);
  }

  private fail(playerId: string, message: string): void {
    this.opts.send(playerId, { type: 'error', message });
  }

  private roomOf(playerId: string): Room | null {
    const code = this.playerRoom.get(playerId);
    return code ? (this.rooms.get(code) ?? null) : null;
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(0, ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('could not allocate a room code');
  }

  private rateLimited(playerId: string): boolean {
    const now = this.opts.now();
    const entry = this.attempts.get(playerId);
    if (!entry || now - entry.since > ATTEMPT_WINDOW_MS) {
      this.attempts.set(playerId, { count: 1, since: now });
      return false;
    }
    entry.count += 1;
    return entry.count > MAX_JOIN_ATTEMPTS;
  }

  // -- inspection for tests and ops ----------------------------------------

  get roomCount(): number {
    return this.rooms.size;
  }
  codeOf(playerId: string): string | null {
    return this.playerRoom.get(playerId) ?? null;
  }
  tableOf(playerId: string): Table | null {
    return this.roomOf(playerId)?.table ?? null;
  }
  scoresOf(playerId: string): Scoreboard | null {
    return this.roomOf(playerId)?.scores ?? null;
  }
  hasRoom(code: string): boolean {
    return this.rooms.has(code);
  }
}
