# Mixed Nuts

ファストフォールド式ポーカー Mix Game プラットフォーム。

賭博ではありません。チップに金銭的価値はなく、購入も換金もできません。

## 構成

```
packages/engine     ルールエンジン。純粋関数。DBもソケットも知らない
packages/protocol   席ごとに削られたビュー。ワイヤーに乗るのはこれだけ
apps/server         WebSocket サーバーとテーブル進行
apps/web            React クライアント
```

設計と実装の契約は `packages/engine/SPEC.md`。実装を始める前に読んでください。

## 動かす

```bash
npm install
npm test          # 87ケース
npm run typecheck

npm run dev:server   # AUTH_MODE=dev で :8787
npm run dev:web      # http://localhost:5173
```

ブラウザを2つ開き、片方で「ルームを作る」、もう片方でそのコードを入力して参加。
両方で「席につく」を押すと対戦が始まります。
別端末から繋ぐ場合は `?server=ws://<ホスト>:8787` を付けてください。

## 認証

開発中は端末ローカルのIDで動きます（検証なし）。本番では Firebase Auth を使います。

```bash
npm install firebase-admin          # サーバー
npm install firebase                # クライアント
export GOOGLE_APPLICATION_CREDENTIALS=...
AUTH_MODE=firebase NODE_ENV=production npm run server
```

クライアント側は `.env` に `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` /
`VITE_FIREBASE_PROJECT_ID` / `VITE_FIREBASE_APP_ID` を置くと Google サインインに切り替わります。

`NODE_ENV=production` で `AUTH_MODE` が firebase 以外なら、サーバーは起動を拒否します。

## 現状

稼働: NLH / PLO / PLO8 / BigO / FLH / FLO8（フロップ系すべて）
参加コードによるプライベートルーム（友人戦）が動きます。
ファストフォールドのプールと Mix ローテーションは M3。

セッション収支（推移グラフ・ゼロサム検算つき）が見られます。
ハンド履歴の永続化と手役表示は未実装です。収支はサーバー再起動で消えます。

## Railway にデプロイする

このリポジトリを**まるごとそのまま**GitHub に置いてください。サブディレクトリに切り分ける必要はありません。

```
mixednuts/
├── railway.json        ビルドと起動の設定
├── .gitignore
├── .env.example
├── package.json        ワークスペースのルート
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── packages/
│   ├── engine/         ルールエンジン（SPEC.md はここ）
│   └── protocol/       席ごとに削られたビュー
└── apps/
    ├── server/
    └── web/
```

`node_modules/` と `dist/` はコミットしません（`.gitignore` 済み）。

### 手順

1. GitHub に push
2. Railway で New Project → Deploy from GitHub repo → このリポジトリ
3. Root Directory は**リポジトリのルートのまま**。ビルドと起動は `railway.json` が持っています
4. Variables に最低限これだけ入れる

   ```
   AUTH_MODE=firebase
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}   # JSONを1行で貼る
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

5. Settings → Networking → Generate Domain
6. Firebase コンソール → Authentication → Settings → 承認済みドメインに、発行された
   `*.up.railway.app` を追加（これを忘れると Google サインインのポップアップが弾かれます）

### 落とし穴

- **`NODE_ENV=production` を Variables に入れないでください。** npm が devDependencies を飛ばし、ビルドに必要な vite と esbuild が消えて失敗します
- **`VITE_*` はビルド時に読まれます。** 後から足したら再デプロイが必要です
- サーバーとクライアントは**同じサービスから配信されます**。ページが https なら WebSocket は自動的に `wss://` になります。ブラウザは https のページから `ws://` を開かせてくれないので、これが一番よくある事故です
- `PORT` は Railway が渡します。自分で設定しないでください
- WebSocket は常時接続なので、Vercel Functions のようなサーバーレスでは動きません

### クライアントを別ホストに置く場合

Cloudflare Pages などに分けることもできます（ビルド `npm run build:web`、出力 `apps/web/dist`）。
その場合は `?server=wss://<railwayのドメイン>` を付けてアクセスしてください。
ただし**同一オリジンで配信する方が事故が少ない**ので、まとめることを勧めます。
