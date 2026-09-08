# SPEC: ニュースダイジェスト公開サイト

## 目的

Claude Code Routine が毎朝生成する Inoreader ニュースダイジェスト（Markdown）を、
GitHub リポジトリへの push を起点に Cloudflare 上のサブドメインで公開する。

- 生成（routine）と配信（サイト）を同一リポジトリで完結させる
- UI は Astro Starlight を基本とし、ダイジェストのブラウザ読み上げ操作を追加する
- Inoreader は読み取り専用で扱い、既読化などの書き込み操作は行わない
  （既読は不可逆でテスト・再実行ができなくなるため）。取得範囲は時刻ベース（直近 24 時間）

## 全体フロー

```
[Routine (毎朝, cloud)]
  リポジトリを fresh clone
  → CLAUDE.md / docs/digest-instructions.md に従いダイジェスト md を生成
  → src/content/docs/digests/YYYY/MM/DD.md を git push (main)
        │
        ▼
[GitHub Actions]
  push トリガー → astro build → wrangler deploy (Workers Assets)
        │
        ▼
[Cloudflare]
  news.example.com (サブドメイン) で静的配信
  Cloudflare Access で閲覧を保護
```

## リポジトリ構成

```
/
├── CLAUDE.md                    # routine 向けの実行指示（エントリポイント）
├── docs/
│   └── digest-instructions.md   # ダイジェスト生成ルール詳細（既存プロンプトを移設）
├── src/
│   └── content/
│       └── docs/
│           ├── index.md         # トップ: 最新ダイジェストへ誘導
│           └── digests/
│               └── YYYY/MM/DD.md
├── astro.config.mjs
├── wrangler.jsonc               # assets のみの Worker 設定
├── package.json
└── .github/workflows/deploy.yml
```

## ダイジェスト md 仕様

パス: `src/content/docs/digests/YYYY/MM/DD.md`（JST 基準の日付）

```markdown
---
title: "2026-08-06 ニュースダイジェスト"
description: "主要トピック3〜5個を1行で"
sidebar:
  order: 20260806   # YYYYMMDD 整数。降順表示に使う
---

（本文: カテゴリ別ダイジェスト。既存 routine の出力形式を踏襲。
 各記事に URL を必ず記載する）
```

- frontmatter は Starlight の content schema（title 必須）に準拠
- 同日 2 回目以降の実行は同一ファイルを上書き（append しない）

## サイト（Astro Starlight）

- `npm create astro@latest -- --template starlight` をベースに最小構成
- `astro.config.mjs` の要点:
  - `sidebar: [{ label: 'ダイジェスト', autogenerate: { directory: 'digests' } }]`
  - サイドバーは日付降順になるようソート（`sidebar.order` を利用）
  - 検索は Starlight 標準（Pagefind）のまま。追加設定不要
- `src/content/docs/index.md`: 最新ダイジェストへのリンク（または一覧）。
  凝った実装は不要。リダイレクトが簡単ならそれでも可
- robots: `noindex` を全ページに付与（`<meta name="robots" content="noindex">`）
- ダイジェスト本文の外部 HTTP(S) リンクは、ビルド時に `target="_blank"` と `rel="noopener noreferrer"` を付けて別タブで開く。既存の `rel` は保持し、サイト内リンク・ページ内アンカー・メールリンクの動作は変えない。

## ブラウザ読み上げ

- 対象は `/digests/` 配下。Web Speech API を使い、日本語音声を優先する。
- 見出し・本文・箇条書きを文単位で順番に読み上げる。元のリンクと強調は維持する。
- ページ下部のコンパクトな floating バーに、アイコンの再生・停止と速度（0.5〜3.0倍）を常時表示し、音量（0〜100%）はスピーカーアイコンで開く調整欄に隠す。再生と停止は状態に応じて同じ枠に切り替える。可視の文章ラベル・説明文は置かず、操作名は aria-label と title で伝える。
- 再生は先頭から。停止は音声とハイライトを解除し、次の再生は先頭から開始する。
- 速度は `news-digest:tts-rate` に localStorage 保存。初期値は1.0倍で、無効値や保存不可の場合も動作する。
- 再生中の設定変更は現在の文を中断せず、次の文から反映する。
- 発声中の文をハイライトし、再生中に文をタップするとその文から続ける。リンクは通常通り開ける。
- ハイライトは黄色系とし、リンクの文字色を維持する。
- 再生中の文が固定ヘッダー・操作バーに隠れないよう自動スクロールする。手動スクロール後は追従を止め、現在位置アイコンで読み上げ中の文へ戻って追従を再開する。文が画面より長い場合は先頭を表示する。
- キーボードでは再生中の文にフォーカスし Enter / Space で移動できる。ページを離れたら停止する。
- スマホの safe area、本文末尾の余白、明暗テーマに対応する。印刷には操作バーを含めない。
- 非対応ブラウザや発声エラーは操作バーの警告アイコン・ツールチップとスクリーンリーダーで伝える。音声の種類や音量・速度の反映は端末の音声エンジンに依存する。

## デプロイ（GitHub Actions → Cloudflare）

`.github/workflows/deploy.yml`:

- trigger: `push` to `main`
- steps: checkout → setup-node (22) → `npm ci` → `npm run build` → `npx wrangler deploy`
- secrets: `CLOUDFLARE_API_TOKEN`（Workers 編集権限のみの最小トークン）

`wrangler.jsonc`:

- Workers Assets（静的アセットのみ、Worker スクリプト不要なら `assets` 設定のみ）
- カスタムドメイン: `news.example.com`（実ドメインは実装時に置換）

Cloudflare Access:

- `news.example.com` 全体に適用、自分のメールアドレスのみ許可
- ダッシュボードから手動設定（コード管理外。README に手順をメモする）

## Routine 側の変更

既存 routine の変更点のみ記す（Inoreader 取得・要約ロジックは現行仕様を維持）:

1. routine にこのリポジトリを接続する（fresh clone 前提）
2. routine のプロンプトは「`CLAUDE.md` に従え」程度に簡素化し、
   既存の詳細指示は `docs/digest-instructions.md` へ移設
3. 出力先を Artifact から `src/content/docs/digests/YYYY/MM/DD.md` に変更し、
   commit & push する（コミットメッセージ: `digest: YYYY-MM-DD`）
4. プッシュ通知に公開 URL を含める:
   `https://news.example.com/digests/YYYY/MM/DD/`
5. ビルドは行わない（npm install / astro build は Actions の責務）

## 制約・非機能

- シークレット（INOREADER_*, GITHUB 関連）をリポジトリにコミットしない
- Inoreader に対する書き込み系 API（`edit-tag` 等）は呼ばない
- routine 実行環境の allowed domains に `www.inoreader.com` が必要（既存設定を維持）
- 有料ソース要約を含むため一般公開しない（Access 必須 + noindex）
- ダイジェスト以外のページ・機能は作らない（スコープ外: RSS, OG画像, タグ等）

## マイルストーン

1. Starlight 最小構成 + ダミーダイジェスト 2 件でローカル表示確認
2. wrangler.jsonc + deploy.yml で Cloudflare へデプロイ、サブドメイン割当
3. Cloudflare Access 設定（手動）、noindex 確認
4. CLAUDE.md / digest-instructions.md 作成、routine の接続・プロンプト差し替え
5. 本番 routine 実行で E2E 確認（push → deploy → 通知 URL で閲覧）
