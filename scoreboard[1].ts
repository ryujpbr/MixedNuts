import type { ScoreEntry, ScoreSnapshot } from '@mixednuts/protocol';

export interface HandResultLine {
  readonly playerId: string;
  readonly name: string;
  readonly delta: number;
}

/**
 * Per-room session scoring.
 *
 * The scoreboard deliberately re-derives the zero-sum property instead of
 * trusting it. The engine already asserts chip conservation inside a hand;
 * this is a second, independent check one layer away, on the numbers that
 * players actually see. Two checks that agree are worth far more than one,
 * because the failure mode people care about is "my friend's total went up
 * and nobody's went down", and that is a reporting bug, not a rules bug.
 *
 * Once `balanced` goes false it stays false and the UI says so. Quietly
 * correcting the numbers would hide exactly the thing worth knowing.
 */
export class Scoreboard {
  private readonly points = new Map<string, number>();
  private readonly names = new Map<string, string>();
  private readonly handsPlayed = new Map<string, number>();
  private readonly history: { playerId: string; points: number }[][] = [];
  private hands = 0;
  private balanced = true;

  constructor(private readonly maxHistory = 200) {}

  record(handId: string, results: readonly HandResultLine[]): void {
    if (results.length === 0) return;

    const sum = results.reduce((a, r) => a + r.delta, 0);
    if (sum !== 0) {
      this.balanced = false;
      console.error(
        `[scoreboard] hand ${handId} does not balance: ${sum} chips unaccounted for`,
        results,
      );
    }

    for (const r of results) {
      this.names.set(r.playerId, r.name);
      this.points.set(r.playerId, (this.points.get(r.playerId) ?? 0) + r.delta);
      this.handsPlayed.set(r.playerId, (this.handsPlayed.get(r.playerId) ?? 0) + 1);
    }
    this.hands += 1;

    // Snapshot every known player, including ones who sat out this hand, so
    // the chart has a flat segment rather than a gap.
    this.history.push(
      [...this.points.entries()].map(([playerId, points]) => ({ playerId, points })),
    );
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  /** A player who joins mid-session starts at zero, which keeps the sum zero. */
  ensure(playerId: string, name: string): void {
    this.names.set(playerId, name);
    if (!this.points.has(playerId)) this.points.set(playerId, 0);
    if (!this.handsPlayed.has(playerId)) this.handsPlayed.set(playerId, 0);
  }

  snapshot(): ScoreSnapshot {
    const entries: ScoreEntry[] = [...this.points.entries()]
      .map(([playerId, points]) => ({
        playerId,
        name: this.names.get(playerId) ?? playerId,
        points,
        hands: this.handsPlayed.get(playerId) ?? 0,
      }))
      .sort((a, b) => b.points - a.points);

    const series = entries.map((e) => ({
      playerId: e.playerId,
      points: this.history.map(
        (snap) => snap.find((x) => x.playerId === e.playerId)?.points ?? 0,
      ),
    }));

    return {
      hands: this.hands,
      entries,
      series,
      balanced: this.balanced && entries.reduce((a, e) => a + e.points, 0) === 0,
    };
  }

  get isBalanced(): boolean {
    return this.snapshot().balanced;
  }
  get total(): number {
    return [...this.points.values()].reduce((a, b) => a + b, 0);
  }
}
