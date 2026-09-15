import { RoomManager } from './rooms.js';
import { createVerifier } from './auth.js';
import { secureShuffle } from './rng.js';
import { startWebSocketServer } from './ws.js';

const PORT = Number(process.env['PORT'] ?? 8787);
const STATIC_DIR = process.env['STATIC_DIR'] ?? 'apps/web/dist';
const server = startWebSocketServer({
  port: PORT,
  staticDir: STATIC_DIR,
  createManager: (send) => new RoomManager({
    send,
    verifier: createVerifier(process.env['AUTH_MODE']),
    now: () => Date.now(),
    shuffle: secureShuffle,
    actionTimeoutMs: 15_000,
    maxSeats: 6,
    buyInBb: 100,
    emptyRoomTtlMs: 10 * 60_000,
    nextHandDelayMs: 4_000,
    allowedVariants: ['nlh', 'plo', 'plo8', 'bigo', 'flh', 'flo8'],
  }),
});
console.log(`Mixed Nuts listening on :${PORT} (auth: ${process.env['AUTH_MODE']})`);
process.on('SIGINT', () => { server.close(); process.exit(0); });
