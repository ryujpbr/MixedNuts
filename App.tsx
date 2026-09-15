import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CardSlot,
  HandView,
  RoomMember,
  ScoreSnapshot,
  ServerMessage,
  SeatView,
} from '@mixednuts/protocol';
import { type Session, firebaseConfigured, localSession, signInWithGoogle } from './auth.js';

const RANKS = '23456789TJQKA';
const SUIT_GLYPH = ['♣', '♦', '♥', '♠'];

const VARIANTS = [
  { id: 'nlh', label: "ホールデム (No Limit)" },
  { id: 'plo', label: 'オマハ (Pot Limit)' },
  { id: 'plo8', label: 'オマハ ハイロー' },
  { id: 'bigo', label: 'ビッグオー' },
  { id: 'flh', label: "ホールデム (Fixed Limit)" },
  { id: 'flo8', label: 'オマハ ハイロー (Fixed Limit)' },
] as const;

/**
 * Same origin in production, so an https page gets wss:// without anyone
 * having to remember. In dev the client runs on Vite's port and the server on
 * its own, so point at that instead.
 */
function defaultServer(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env.DEV) return `ws://${location.hostname}:8787`;
  return `${scheme}//${location.host}`;
}

const SERVER = new URLSearchParams(location.search).get('server') ?? defaultServer();

function Card({ card, size }: { card: CardSlot; size: 'board' | 'mine' | 'seat' }) {
  const cls = size === 'seat' ? 'card' : `card ${size}`;
  if (card === null) return <div className={`${cls} back`} aria-label="伏せ札" />;
  const rank = RANKS[card >> 2]!;
  const suit = card & 3;
  const red = suit === 1 || suit === 2;
  return (
    <div className={`${cls}${red ? ' red' : ''}`} aria-label={`${rank}${SUIT_GLYPH[suit]}`}>
      <span className="rank">{rank}</span>
      <span className="suit">{SUIT_GLYPH[suit]}</span>
    </div>
  );
}

interface RoomState {
  code: string;
  variant: string;
  bigBlind: number;
  host: string;
  members: RoomMember[];
  handsPlayed: number;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [view, setView] = useState<HandView | null>(null);
  const [scores, setScores] = useState<ScoreSnapshot | null>(null);
  const [showScores, setShowScores] = useState(false);
  const [notice, setNotice] = useState('');
  const ws = useRef<WebSocket | null>(null);

  const send = useCallback((msg: unknown) => {
    const socket = ws.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }, []);

  // Connect once signed in, and keep the token fresh for long sessions.
  useEffect(() => {
    if (!session) return;
    let closed = false;
    const socket = new WebSocket(SERVER);
    ws.current = socket;

    const authenticate = async () => send({ type: 'auth', token: await session.token() });

    socket.onopen = () => void authenticate();
    socket.onclose = () => {
      if (!closed) setNotice('接続が切れました。ページを再読み込みしてください。');
    };
    socket.onmessage = (ev) => {
      const msg: ServerMessage = JSON.parse(ev.data as string);
      switch (msg.type) {
        case 'authenticated':
          setPlayerId(msg.playerId);
          setNotice('');
          break;
        case 'room':
          setRoom(msg);
          break;
        case 'room-closed':
          setRoom(null);
          setView(null);
          setScores(null);
          break;
        case 'scoreboard':
          setScores(msg.snapshot);
          break;
        case 'state':
          setView(msg.view);
          setNotice('');
          break;
        case 'error':
          setNotice(msg.message);
          break;
      }
    };

    const refresh = setInterval(() => void authenticate(), 30 * 60_000);
    return () => {
      closed = true;
      clearInterval(refresh);
      socket.close();
    };
  }, [session, send]);

  if (!session) return <SignIn onSession={setSession} />;
  if (!room) return <RoomPicker send={send} notice={notice} ready={playerId !== null} />;

  return (
    <div className="app">
      <div className="bar">
        <div className="brand">
          Mixed <span>Nuts</span>
        </div>
        <div className="bar-meta">
          <span className="code-pill">{room.code}</span>
          <button className="score-tab" onClick={() => setShowScores((v) => !v)}>
            {showScores ? '閉じる' : formatPoints(myPoints(scores, playerId))}
          </button>
        </div>
      </div>
      {showScores ? (
        <Scores snapshot={scores} playerId={playerId} />
      ) : view ? (
        <Felt view={view} />
      ) : (
        <Waiting room={room} send={send} />
      )}
      {view && !showScores && <Hero view={view} send={send} notice={notice} />}
      {!view && !showScores && (
        <RoomFooter room={room} playerId={playerId} send={send} notice={notice} />
      )}
    </div>
  );
}

function myPoints(snapshot: ScoreSnapshot | null, playerId: string | null): number {
  if (!snapshot || !playerId) return 0;
  return snapshot.entries.find((e) => e.playerId === playerId)?.points ?? 0;
}

function formatPoints(points: number): string {
  return `${points > 0 ? '+' : ''}${points.toLocaleString()}`;
}

const LINE_COLOURS = ['#c49a3f', '#5aa9c9', '#a8756a', '#7fae82', '#b88bc0', '#cbd5da'];

function Scores({
  snapshot,
  playerId,
}: {
  snapshot: ScoreSnapshot | null;
  playerId: string | null;
}) {
  if (!snapshot || snapshot.hands === 0) {
    return <div className="waiting">まだハンドが終わっていません</div>;
  }
  const sum = snapshot.entries.reduce((a, e) => a + e.points, 0);

  return (
    <div className="scores">
      <ScoreChart snapshot={snapshot} />
      <div className="score-table">
        {snapshot.entries.map((e, i) => (
          <div key={e.playerId} className={e.playerId === playerId ? 'is-me' : undefined}>
            <span className="swatch" style={{ background: LINE_COLOURS[i % LINE_COLOURS.length] }} />
            <span className="who">{e.name}</span>
            <span className="hands">{e.hands}ハンド</span>
            <span className={`pts ${e.points >= 0 ? 'up' : 'down'}`}>{formatPoints(e.points)}</span>
          </div>
        ))}
      </div>
      {snapshot.balanced ? (
        <div className="balance ok">合計 {sum} · 全員の収支は釣り合っています</div>
      ) : (
        <div className="balance bad">
          合計 {sum} · 収支が合っていません。記録の不具合です
        </div>
      )}
      <div className="footnote">{snapshot.hands}ハンド分。直近200ハンドをグラフに表示します。</div>
    </div>
  );
}

function ScoreChart({ snapshot }: { snapshot: ScoreSnapshot }) {
  const width = 320;
  const height = 130;
  const pad = 4;
  const all = snapshot.series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const max = Math.max(...all, 1);
  const min = Math.min(...all, -1);
  const span = max - min || 1;
  const n = snapshot.series[0]?.points.length ?? 0;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="収支の推移">
      <line x1={0} y1={y(0)} x2={width} y2={y(0)} className="zero" />
      {snapshot.series.map((s, i) => (
        <polyline
          key={s.playerId}
          points={s.points.map((v, idx) => `${x(idx)},${y(v)}`).join(' ')}
          fill="none"
          stroke={LINE_COLOURS[i % LINE_COLOURS.length]}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function SignIn({ onSession }: { onSession: (s: Session) => void }) {
  const [name, setName] = useState(() => localStorage.getItem('mixednuts.name') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const google = async () => {
    setBusy(true);
    try {
      onSession(await signInWithGoogle());
    } catch {
      setError('サインインできませんでした。もう一度お試しください。');
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="lobby">
        <h1>
          Mixed <span>Nuts</span>
        </h1>
        <p>賭けごとではありません。チップに金銭的価値はなく、購入も換金もできません。</p>

        {firebaseConfigured ? (
          <button className="btn go" onClick={google} disabled={busy}>
            {busy ? 'サインイン中' : 'Googleでサインイン'}
          </button>
        ) : (
          <>
            <label htmlFor="name">プレイヤー名</label>
            <input
              id="name"
              value={name}
              maxLength={16}
              placeholder="ゲスト"
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn go" onClick={() => onSession(localSession(name))}>
              はじめる
            </button>
            <p className="footnote">
              この端末だけのIDで遊びます。友人戦の記録を残すにはサインインが必要です。
            </p>
          </>
        )}
        <div className="notice">{error}</div>
      </div>
    </div>
  );
}

function RoomPicker({
  send,
  notice,
  ready,
}: {
  send: (msg: unknown) => void;
  notice: string;
  ready: boolean;
}) {
  const [code, setCode] = useState('');
  const [variant, setVariant] = useState<string>('nlh');
  const [bigBlind, setBigBlind] = useState(100);

  return (
    <div className="app">
      <div className="lobby">
        <h1>
          Mixed <span>Nuts</span>
        </h1>
        <p>友人だけのルームを作るか、受け取ったコードで参加します。</p>

        <label htmlFor="code">参加コード</label>
        <div className="row">
          <input
            id="code"
            className="code-input"
            value={code}
            maxLength={6}
            placeholder="ABC123"
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, ''))}
          />
          <button
            className="btn go"
            disabled={code.length !== 6 || !ready}
            onClick={() => send({ type: 'join-room', code })}
          >
            参加する
          </button>
        </div>

        <div className="divider">または</div>

        <label htmlFor="variant">ゲーム</label>
        <select
          id="variant"
          className="select"
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
        >
          {VARIANTS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>

        <label htmlFor="bb">ブラインド</label>
        <select
          id="bb"
          className="select"
          value={bigBlind}
          onChange={(e) => setBigBlind(Number(e.target.value))}
        >
          {[100, 200, 500, 1000].map((bb) => (
            <option key={bb} value={bb}>
              {bb / 2} / {bb}
            </option>
          ))}
        </select>

        <button
          className="btn raise"
          disabled={!ready}
          onClick={() => send({ type: 'create-room', variant, bigBlind })}
        >
          ルームを作る
        </button>
        <div className="notice">{notice}</div>
      </div>
    </div>
  );
}

function Waiting({ room, send }: { room: RoomState; send: (msg: unknown) => void }) {
  void send;
  const label = VARIANTS.find((v) => v.id === room.variant)?.label ?? room.variant;
  return (
    <div className="felt-wrap">
      <div className="felt" />
      <div className="centre">
        <div className="pot">{label}</div>
        <div className="code-large">{room.code}</div>
        <div className="pot">このコードを友人に伝えてください</div>
      </div>
    </div>
  );
}

function RoomFooter({
  room,
  playerId,
  send,
  notice,
}: {
  room: RoomState;
  playerId: string | null;
  send: (msg: unknown) => void;
  notice: string;
}) {
  const me = room.members.find((m) => m.playerId === playerId);
  const seated = room.members.filter((m) => m.seated).length;

  const copy = () => {
    void navigator.clipboard?.writeText(room.code);
  };

  return (
    <div className="actions">
      <div className="seated-list">
        {room.members.map((m) => (
          <div key={m.playerId}>
            <span>
              {m.name}
              {m.playerId === room.host && <span className="badge host">主催</span>}
            </span>
            <span>{m.seated ? m.stack.toLocaleString() : '...'}</span>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={copy}>コードをコピー</button>
        {me?.seated ? (
          <button className="btn" onClick={() => send({ type: 'leave-seat' })}>退席</button>
        ) : (
          <button className="btn go" disabled={seated >= 8} onClick={() => send({ type: 'take-seat' })}>着席する</button>
        )}
        {me?.playerId === room.host && (
          <button className="btn raise" disabled={seated < 2} onClick={() => send({ type: 'start' })}>ゲーム開始</button>
        )}
      </div>
      <div className="notice">{notice}</div>
    </div>
  );
}

function Felt({ view }: { view: HandView }) {
  return (
    <div className="felt-wrap">
      <div className="felt" />
      <div className="centre"><div className="pot">Pot {view.pot.toLocaleString()}</div><div className="street">{view.street}</div></div>
      {view.seats.map((s) => <Seat key={s.playerId} seat={s} />)}
      {view.board.map((c, i) => <Card key={i} card={c} size="board" />)}
    </div>
  );
}
function Seat({ seat }: { seat: SeatView }) {
  return <div className={`seat seat-${seat.seat}`}><div className="name">{seat.name}</div><div className="stack">{seat.stack.toLocaleString()}</div>{seat.hole.map((c, i) => <Card key={i} card={c} size="seat" />)}{seat.folded && <div className="folded">FOLD</div>}</div>;
}
function Hero({ view, send, notice }: { view: HandView; send: (msg: unknown) => void; notice: string }) {
  const me = view.seats.find((s) => s.isMe);
  return <div className="hero"><div className="hero-cards">{me?.hole.map((c, i) => <Card key={i} card={c} size="mine" />)}</div><div className="notice">{notice}</div><div className="actions"><button className="btn" onClick={() => send({ type: 'action', action: 'fold' })}>Fold</button><button className="btn" onClick={() => send({ type: 'action', action: 'check' })}>Check</button><button className="btn go" onClick={() => send({ type: 'action', action: 'call' })}>Call</button><button className="btn raise" onClick={() => send({ type: 'action', action: 'raise', amount: 100 })}>Raise</button></div></div>;
}
