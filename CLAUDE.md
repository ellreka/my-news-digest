# CLAUDE.md

このリポジトリは、毎朝の Inoreader ニュースダイジェストを生成し、
Cloudflare 上のサブドメインで公開するためのもの。

## routine 実行時にやること

1. [docs/digest-instructions.md](docs/digest-instructions.md) に従ってダイジェストを生成する。
2. 出力先は `src/content/docs/digests/YYYY/MM/DD.md`（JST 基準）。同日再実行時は上書き。
3. そのファイルだけを commit（`digest: YYYY-MM-DD`）して `main` に push する。
4. 公開 URL `https://news.example.com/digests/YYYY/MM/DD/` を含めてプッシュ通知を送る。

## やらないこと

- `pnpm install` / `astro build` / `wrangler deploy` は実行しない。ビルドとデプロイは GitHub Actions の責務。
- ダイジェスト md 以外のファイル（サイト設定、ワークフロー、docs）を変更しない。
- シークレット（`INOREADER_*` 等）をリポジトリにコミットしない。
- ダイジェスト以外のページ・機能を追加しない（RSS, OG 画像, タグ等はスコープ外）。

## サイト構成（参考）

- Astro Starlight の静的サイト。`src/content/docs/` 配下が全ページ。
- サイドバーは `digests` ディレクトリを autogenerate し、`sidebar.order` を使って日付降順で表示する。
- 全ページ `noindex`。閲覧は Cloudflare Access で保護している。
