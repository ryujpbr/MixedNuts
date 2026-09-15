import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createHttpServer } from './http.js';
import { type ServerMessage, parseClientMessage } from '@mixednuts/protocol';
import type { RoomManager, Sender } from './rooms.js';

export interface WsOptions {
  readonly port: number;
  /** Directory of the built client, served from the same origin. */
  readonly staticDir?: string | null;
  /**
   * The manager needs a writer and the writer needs the socket map, so the
   * manager is built here once `send` exists.
   */
  readonly createManager: (send: Sender) => RoomManager;
  readonly tickMs?: number;
}

/**
 * Parse, authenticate, route, write. No game state, no rules decisions.
 *
 * Two things here are load-bearing:
 *
 *  1. NOTHING is processed before `auth` succeeds, and the identity used
 *     afterwards is the uid the verifier returned. A client-supplied id is
 *     never read.
 *  2. Messages on one connection are processed IN ORDER. Verification is
 *     async, so without the queue a `join-room` sent immediately after `auth`
 *     could be handled while the token is still being checked.
 */
export function startWebSocketServer(opts: WsOptions): {
  close: () => void;
  manager: RoomManager;
  http: Server;
} {
  const sockets = new Map<string, WebSocket>();
  const http = createHttpServer(opts.staticDir ?? null);
  http.listen(opts.port);
  const wss = new WebSocketServer({ server: http });

  const send: Sender = (playerId, msg) => {
    const ws = sockets.get(playerId);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const manager = opts.createManager(send);

  wss.on('connection', (ws) => {
    let playerId: string | null = null;
    let queue: Promise<void> = Promise.resolve();

    const reply = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    const handle = async (text: string): Promise<void> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return reply({ type: 'error', message: 'malformed message' });
      }
      const msg = parseClientMessage(parsed);
      if (!msg) return reply({ type: 'error', message: 'unrecognised message' });

      if (msg.type === 'auth') {
        const user = await manager.authenticate(msg.token);
        if (!user) return reply({ type: 'error', message: 'サインインし直してください' });

        if (playerId && playerId !== user.uid) {
          manager.leaveRoom(playerId, { quiet: true });
          manager.markDisconnected(playerId);
          sockets.delete(playerId);
        }
        // One live socket per account. A second window would otherwise let one
        // person hold two seats at the same table.
        const previous = sockets.get(user.uid);
        if (previous && previous !== ws) previous.close();

        playerId = user.uid;
        sockets.set(user.uid, ws);
        manager.markConnected(user.uid);
        return reply({ type: 'authenticated', playerId: user.uid, name: user.name });
      }

      if (!playerId) return reply({ type: 'error', message: '認証が必要です' });
      manager.handle(playerId, msg);
    };

    ws.on('message', (raw) => {
      queue = queue.then(() => handle(raw.toString())).catch(() => undefined);
    });

    ws.on('close', () => {
      if (!playerId) return;
      if (sockets.get(playerId) === ws) sockets.delete(playerId);
      manager.markDisconnected(playerId);
      manager.disconnect(playerId);
    });
  });

  const tick = setInterval(() => manager.tick(), opts.tickMs ?? 1_000);

  return {
    manager,
    http,
    close: () => {
      clearInterval(tick);
      for (const ws of sockets.values()) ws.close();
      wss.close();
      http.close();
    },
  };
}
