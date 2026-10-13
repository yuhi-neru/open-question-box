# Open Question Box

**誰でも送れる。AIにも届く。誰でも運営できる。**

匿名の質問・感想・要望・バグ報告を受け取れる、MITライセンスの質問箱です。AIを使わなくても使えます。API・Webhook・埋め込みフォームで自由に接続でき、自分のCloudflareアカウントでも運営できます。

公開サービス: https://open-question-box.pages.dev/

## MVPの範囲

- 匿名・登録不要のメッセージ送信（最大2,000文字）
- 1インスタンスにつき1人の受信者。管理キーでログインする日本語管理画面
- 受信箱・検索・回答（最大4,000文字）・公開/非公開・アーカイブ・完全削除
- 名前、紹介文、受付の一時停止
- APIキー発行、読み取り/書き込み権限、即時失効
- HTTPSの署名付きWebhook、永続アウトボックス、再試行
- 同じ投稿フォームのiframe埋め込み
- JSONエクスポート・インポート（プロフィール、質問、回答、ID、日時を保持）
- Turnstileのサーバー検証、送信/ログイン制限、CSRF対策、CSP

複数ユーザーの会員登録、JPYC投げ銭、初回10 JPYCのAPI有効化と従量課金、AI自動回答は未実装です。公開サービスは「ゆうひねる」の質問箱です。他の受信者はセルフホストして自分の質問箱を作れます。API・通常機能とも無料で、公式サービスへの利用料は不要です。

## 構成

TypeScriptのCloudflare Worker + D1（SQLite）+ Workers Static Assets。フロントは標準HTML/CSS/JavaScriptです。外部AIや有料ストレージ、メール、ウォレットは必要ありません。アプリの実行時依存はCloudflareだけです。設計と段階的拡張は [docs/design.md](docs/design.md)、決済の確認事項は [docs/payments.md](docs/payments.md) を参照してください。

作者の公開URLは独立した `open-question-box.pages.dev` です。`hosting/` の小さなPages Functionから、Service bindingで質問箱専用Workerへ転送します。DB・秘密情報・定期処理はこのWorkerに保持し、公開URLをそのまま渡すため認証やTurnstileも新ドメインで検証されます。アカウント共通のworkers.devサブドメイン名が他サービス名でも、アプリやDBが競合することはありません。

公開URL用Pagesの更新は `npm run deploy:pages`、アプリ本体は `npm run deploy` です。セルフホストではWorker URLだけでも使えます。専用の `名前.pages.dev` も使う場合は、`hosting/wrangler.jsonc` のプロジェクト名と接続先Workerを自分の環境に変更し、専用Pagesプロジェクトを作成・デプロイします。Turnstileの許可ドメインも更新してください。Pages FunctionsはWorkersと同じ無料リクエスト枠を使います。

## ローカルで動かす

Node.js 22以上を用意します。

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# .dev.varsのADMIN_SECRETとRATE_LIMIT_SECRETを別々のランダムな32文字以上の値にする
# 開発時はALLOW_UNPROTECTED_SUBMISSIONS=true、TURNSTILE_SITE_KEY= を指定する
npm run db:migrate
npm run dev
```

http://127.0.0.1:8787/ が送信画面、`/admin` が管理画面です。管理キーは `.dev.vars` の `ADMIN_SECRET` です。秘密情報をGitに登録しないでください。

```powershell
npm run types
npm run check
npm run build
npm test
```

テストは独立した一時D1を使い、本番データを変更しません。ビルド後のWorkerを実ランタイムで実行し、非公開範囲、公開条件、認証/CSRF、API権限、失効、送信制限、移行、削除を検証します。

## 自分のCloudflareでホスト

1. Cloudflareで **Workers Free** を利用していることをダッシュボードで確認します。有料プランへ変更しないでください。
2. `npx wrangler login` で自分のアカウントにログインし、`npx wrangler whoami` で対象を確認します。
3. `wrangler.jsonc` の `account_id` を自分のIDへ、`name` を自分のサービス名へ変更します。
4. `npx wrangler d1 create open-question-box` で専用DBを作成し、返されたIDを `database_id` に設定します。他人のDB IDを再利用しないでください。
5. `npx wrangler d1 migrations apply DB --remote` で初期スキーマを適用します。
6. Cloudflare TurnstileでManagedウィジェットを作成し、公開ホスト名を登録します。`TURNSTILE_SITE_KEY` に自分のサイトキーを設定します。秘密キーは次のコマンドで登録します。
7. 秘密情報を対話入力で設定します（32文字以上の別々のランダムな値）。

```powershell
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put RATE_LIMIT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

8. `ALLOW_UNPROTECTED_SUBMISSIONS` が **false** になっていることを確認して `npm run deploy`。管理画面で名前・紹介文を変更し、送信と回答を確認します。

デプロイはWorkers、D1、無料Turnstileのみを使います。無料枠はアカウント全体で共有され、アクセス増や他サービスの使用も影響します。Workers Freeは1日10万リクエスト、D1は1日500万行読み取り/10万行書き込み、合計5GB保存です（2026-10-14確認）。無料枠を超えれば利用制限がかかります。アプリから有料プランを購入・自動変更しません。**無制限に無料で稼働する保証はありません**。Cloudflareの利用状況を確認してください。

参考: [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)、[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)、[Turnstile無料プラン](https://developers.cloudflare.com/turnstile/plans/)。既にWorkers Paidを利用中のアカウントでは従量費用が生じ得るため、無料枠での運営にはFreeのアカウントを使います。

## API

管理画面の「API・外部連携」でキーを発行してください。秘密キーは発行時だけ表示され、DBにはSHA-256ハッシュのみを保存します。`read` はメッセージ一覧のみ、`write` は一覧・回答・公開・整理・削除も可能です。プロフィール、キー管理、移行は管理者セッション専用です。

```sh
curl 'https://YOUR_HOST/api/v1/messages?status=unanswered&limit=20' \
  -H 'Authorization: Bearer YOUR_API_KEY'

curl -X PATCH 'https://YOUR_HOST/api/v1/messages/MESSAGE_UUID' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"answer":"回答内容","published":false}'
```

APIによる回答も公開は明示指定してください。AIに自動公開権限を与える場合は人間によるレビューの必要性を判断してください。APIキーをブラウザの公開コード、iframe、公開リポジトリに埋め込まないでください。CORSを許可していないため、外部Bot等のサーバーから呼び出します。

[OpenAPI仕様](public/openapi.json) / 公開サービスの `/openapi.json` を利用できます。APIは `/api/v1` 以下です。匿名投稿APIにも通常フォームと同じTurnstileと送信回数制限が適用されます。

## Webhook

`WEBHOOK_URL` に運営者が管理するHTTPSエンドポイントを設定し、`npx wrangler secret put WEBHOOK_SECRET` で32文字以上のランダムな署名キーを登録して再デプロイします。リダイレクトを追跡しません。利用者の投稿から任意URLを受け付けません。**非公開の質問・回答も送信されるため、送信先の信頼性を確認してください。**

イベントは `message.created` / `message.updated`。本文は `{id,type,created_at,data}`、`data` はメッセージです。

ヘッダー:

- `X-OQB-Event`: イベントUUID
- `X-OQB-Timestamp`: 送信時のUNIX秒
- `X-OQB-Signature`: `sha256=` + HMAC-SHA256の16進数

署名対象は **`timestamp + "." + 生のHTTP本文`**。受信側で定数時間比較し、現在時刻から5分以上ずれた署名を拒否します。同じイベントIDの再送は無視してください。リクエスト直後に送信を試み、失敗時は5分おきのCronで再試行します（最大8回、履歴保持7日）。少なくとも一回の配信を目指す方式で重複や前後逆転があり得ます。削除時は未送信/履歴のコピーも除去しますが、すでに外部へ送信済みのデータは取り消せません。

## 埋め込み

```html
<iframe src="https://YOUR_HOST/embed" title="匿名フィードバック"
  width="100%" height="620" loading="lazy"
  style="border:0;max-width:560px"></iframe>
```

iframeに許可するページは `/embed` のみです。管理画面を他サイトへ埋め込むことはできません。

## 移行・バックアップ・秘密情報の更新

移行前に受付を止め、回答編集を休止してから、管理画面でJSONを書き出してください。書き出しは500件単位のページ取得で、編集を続ける場合の一貫したスナップショットは保証しません。新しい環境の管理画面でJSONを取り込めます（20MB以内、500件単位）。同じIDはスキップし、プロフィールを更新します。バッチごとに原子的ですが、複数バッチの全体は原子的ではありません。エラーを修正して再取り込みすれば既存IDをスキップして再開できます。移行にAPIキー/セッション/レート制限/Webhook履歴は含めません。APIキーは新しい環境で再発行してください。

DB全体のバックアップ: `npx wrangler d1 export DB --remote --output backup.sql`。このファイルは非公開メッセージや認証ハッシュを含むため、Gitに追加しないでください。

管理キーを変更するには `npx wrangler secret put ADMIN_SECRET`。既存セッションも失効させる場合は専用DBに `DELETE FROM sessions` を実行します。APIキーは管理画面から個別に失効できます。インフラ管理権限を失った場合の復旧はCloudflareアカウント側で行います。

## 安全性と運用上の限界

本文はプレーンテキストとして表示し、HTMLを実行しません。セッションはハッシュ保存・12時間・HttpOnly/SameSite=Strict/Secure。Cookie認証による変更は同一Origin必須です。生IPはアプリDBに保存せず、短期間のHMACハッシュで送信5回/10分、ログイン10回/15分を制限します。同じネットワークを使う人には共有制限がかかります。Turnstileの成功・hostname・actionを検証します。

アプリのログにメッセージ本文・管理キーを出力しません。Cloudflare自体は通信情報やトレースを扱うため完全匿名を保証しません。ログやトレースを公開しないでください。MVPのモデレーションは受信者によるアーカイブ/削除/受付停止です。自動内容判定、個別の送信者ブロック、添付ファイル、緊急連絡先としての利用は対象外です。

## AIにセットアップを頼む

[docs/self-host-prompt.md](docs/self-host-prompt.md) をAIコーディングエージェントに渡してください。アカウントとインフラは利用者が管理し、特定のAIの契約は必要ありません。
