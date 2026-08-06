# ダイジェスト生成ルール

Inoreader のニュースを取得し、要約/翻訳して Markdown を生成するための詳細指示。

## 前提

環境変数 `INOREADER_APP_ID`, `INOREADER_APP_KEY`, `INOREADER_REFRESH_TOKEN` を使って Inoreader API を叩く。

- トークン取得: `POST https://www.inoreader.com/oauth2/token` (`grant_type=refresh_token`)
- 記事取得: `GET https://www.inoreader.com/reader/api/0/stream/contents/user/-/state/com.google/reading-list`

## 取得範囲

- 「未読」かつ「前回取得以降」の記事を対象とする。
- 前回取得の基準は Inoreader 側の既読状態を正とする（ローカルファイルの状態は毎回のセッションで消える前提で当てにしないこと）。
  具体的には `xt=user/-/state/com.google/read` で既読記事を除外して取得する。
- 未読管理が機能しない/初回の場合は、直近 24 時間（`ot=現在時刻-24h`）を取得範囲とする。
- レスポンスに `continuation` が含まれる場合は全件取得できるまでページングすること
  （1 回で取り切れないことが多い。実績として 500 件超・3 ページ）。

## 作業内容

1. 取得した全記事のタイトル・本文（`summary.content`）を読む。
2. 重複記事の排除:
   - 完全に同一の記事だけでなく、複数ソースが同一事象を報じている場合は 1 つに統合する。
   - 日経速報のように同一相場・同一事案を時系列で連続配信しているものは、個別列挙せず要旨として 1 つにまとめる。
3. 英語記事（Hacker News, The Register, BleepingComputer 等）は日本語に翻訳して要約する。
4. カテゴリ別（国内政治/経済、市場・為替、企業決算、AI・テック、セキュリティ、ゲーム、開発 Tips、
   スポーツ・その他 等、その日の内容に応じて調整）に整理し、
   重要度の高いものは詳しめに、軽微なものは箇条書きで簡潔に要約する。

## 出力ファイル

パス: `src/content/docs/digests/YYYY/MM/DD.md`（**JST 基準**の日付）

```markdown
---
title: "YYYY-MM-DD ニュースダイジェスト"
sidebar:
  order: YYYYMMDD
---

## カテゴリ名

- **見出し** — 要約本文。
  https://example.com/article
```

frontmatter の規則:

- `title` は必須。`"` で囲む（`:` を含むため）。
- `sidebar.order` は日付を `YYYYMMDD` の整数にしたもの（例: `20260806`）。サイドバーの降順表示に使う。
- frontmatter に上記以外のキー（`description` 等）を増やさない。

本文の規則:

- 見出しは `##`（カテゴリ）と、必要なら `###` を使う。`#` は使わない（title が h1 になるため）。
- **各記事に URL を必ず記載する。**
- 同日 2 回目以降の実行は同一ファイルを**上書き**する（append しない）。

## commit & push

```
git add src/content/docs/digests/YYYY/MM/DD.md
git commit -m "digest: YYYY-MM-DD"
git push origin main
```

- push した時点で GitHub Actions がビルド・デプロイする。
- **`pnpm install` や `astro build` は実行しない**（ビルドは Actions の責務）。
- ダイジェスト md 以外のファイルを変更・commit しない。

## 通知

完了後、以下をプッシュ通知で送る:

- 要点（見出しレベルで 3〜5 トピック）
- 公開 URL: `https://news.example.com/digests/YYYY/MM/DD/`

これは監視系ではなく毎回配信するダイジェストなので、**内容の有無にかかわらず必ず通知する**こと。

## 後処理

要約に使用した記事は Inoreader 上で既読にする（`edit-tag` API, `a=user/-/state/com.google/read`）。
次回の「前回取得以降」判定に使うため。
