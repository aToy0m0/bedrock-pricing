# Bedrock 料金エクスプローラー

Amazon Bedrock のオンデマンド料金（トークン単価）をプロバイダー横断でフィルタ・ソート・円換算表示する静的ページ。
データは AWS Price List Bulk API から GitHub Actions で毎日自動更新される。

- 表示: `docs/index.html` (GitHub Pages)
- データ: `docs/data.json` (Actions が生成)
- 変換: `scripts/transform.mjs`
- 更新: `.github/workflows/update-pricing.yml` (毎日 JST 06:00 / 手動実行可)

## セットアップ

```bash
gh auth login                       # 未認証なら
cd bedrock-pricing
git init -b main && git add -A && git commit -m "init"
gh repo create bedrock-pricing --public --source=. --push
gh api -X POST "repos/{owner}/bedrock-pricing/pages" \
  -f "source[branch]=main" -f "source[path]=/docs"
```

公開 URL: `https://<owner>.github.io/bedrock-pricing/`

初回はスナップショットデータ（Anthropic 現行 Claude / Nova / Llama 3・4 を含まない）で表示される。
Actions タブから `update-pricing` を手動実行すると Price List の全量データに置き換わる。

## 対象リージョンの変更

`.github/workflows/update-pricing.yml` の `REGIONS` を編集する（スペース区切り）。

## ローカルでの変換確認

```bash
curl -fsSL "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json" -o offer.json
node scripts/transform.mjs offer.json > docs/data.json
python3 -m http.server -d docs 8000   # http://localhost:8000
```

## 免責

非公式の参考情報。料金は予告なく変更される。実際の請求は AWS 公式が優先。
Amazon Bedrock および AWS は Amazon.com, Inc. またはその関連会社の商標であり、本プロジェクトは AWS による公認・提携ではない。
