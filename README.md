# my-news-digest

Claude Code Routine が毎朝生成する Inoreader ニュースダイジェストを、
GitHub への push を起点に Cloudflare Workers Assets で公開する。

仕様: [docs/SPEC.md](docs/SPEC.md)

```
[Routine] digest md を push → [GitHub Actions] astro build + wrangler deploy → [Cloudflare] news.example.com
```

## ローカル開発

```sh
pnpm install
pnpm dev       # http://localhost:4321
pnpm build     # dist/ に出力
pnpm preview
```

Node.js 22 以上、pnpm 10 系（`packageManager` にピン留め済み）。

## 構成

| パス | 役割 |
| --- | --- |
| `CLAUDE.md` | routine のエントリポイント |
| `docs/digest-instructions.md` | ダイジェスト生成ルール詳細 |
| `src/content/docs/index.mdx` | トップ（最新＋一覧） |
| `src/content/docs/digests/YYYY/MM/DD.md` | ダイジェスト本体 |
| `src/starlightRouteData.ts` | サイドバーを日付降順に反転 |
| `astro.config.mjs` | Starlight 設定（noindex, sidebar） |
| `wrangler.jsonc` | Workers Assets 設定 |
| `.github/workflows/deploy.yml` | push → build → deploy |

## セットアップ

### 1. ドメインを置換する

`news.example.com` をすべて実ドメインに置換する。

```sh
rg -l 'news\.example\.com'
# astro.config.mjs / wrangler.jsonc / CLAUDE.md / docs/digest-instructions.md / README.md
```

対象のゾーンが Cloudflare 上にあること（`custom_domain: true` はゾーンが必要）。

### 2. Cloudflare API トークン

Cloudflare ダッシュボード → My Profile → API Tokens で最小権限のトークンを作成する。

- Account → **Workers Scripts: Edit**
- Zone → **Workers Routes: Edit**（カスタムドメイン割当に必要）

GitHub リポジトリの Settings → Secrets and variables → Actions に
`CLOUDFLARE_API_TOKEN` として登録する。

> トークンが複数アカウントにアクセスできる場合は、`wrangler.jsonc` に
> `"account_id": "..."` を追記してデプロイ先を確定させる。

### 3. 初回デプロイ

`main` に push すると Actions が走る。ローカルから手動で行う場合:

```sh
pnpm build
pnpm exec wrangler deploy
```

### 4. Cloudflare Access（手動設定・コード管理外）

有料ソースの要約を含むため、**必ず**閲覧を保護する。

1. Cloudflare ダッシュボード → **Zero Trust** → Access → Applications → **Add an application**
2. type: **Self-hosted**
3. Application domain: `news.example.com`（パスは空 = サイト全体）
4. Policy: Action **Allow** / Include → **Emails** → 自分のメールアドレス
5. Identity provider: One-time PIN（メール認証）で十分
6. 保存後、シークレットウィンドウで `https://news.example.com/` を開き、
   認証画面が出ることを確認する

`wrangler.jsonc` で `workers_dev` / `preview_urls` を `false` にしてある。
Access はカスタムドメインにしか適用されないため、この 2 つは有効化しないこと。

### 5. noindex の確認

```sh
curl -s https://news.example.com/ | grep 'name="robots"'
# <meta name="robots" content="noindex, nofollow"/>
```

### 6. routine の接続

routine にこのリポジトリを接続（fresh clone）し、プロンプトを以下に差し替える:

```
このリポジトリの CLAUDE.md に従い、本日分のニュースダイジェストを生成して push しなさい。
```

routine 側で必要な設定:

- 環境変数: `INOREADER_APP_ID`, `INOREADER_APP_KEY`, `INOREADER_REFRESH_TOKEN`
- allowed domains: `www.inoreader.com`
- リポジトリへの push 権限

## 制約

- シークレットをリポジトリにコミットしない
- 有料ソースの要約を含むため一般公開しない（Access 必須 + noindex）
- ダイジェスト以外のページ・機能は作らない（RSS, OG 画像, タグ等はスコープ外）
