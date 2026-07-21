# 🪨 Bedrock 料金エクスプローラー

> Amazon Bedrock のオンデマンド料金（トークン単価）をプロバイダー横断で **フィルタ・ソート・円換算表示** する静的ページ。
> データは AWS Price List Bulk API から GitHub Actions で **毎日自動更新** される。

<p align="center">
  <a href="https://atoy0m0.github.io/bedrock-pricing/">
    <img src="https://img.shields.io/badge/%F0%9F%9A%80_Live_Site-atoy0m0.github.io%2Fbedrock--pricing-0B5B54?style=for-the-badge" alt="Live Site">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/data-AWS_Price_List_Bulk_API-B4540A?style=flat-square" alt="data source">
  <img src="https://img.shields.io/badge/update-daily_(JST_06:00)-0B5B54?style=flat-square" alt="update schedule">
  <img src="https://img.shields.io/badge/hosting-GitHub_Pages-24292F?style=flat-square&logo=github" alt="hosting">
</p>

## 🔗 公開サイト

**▶ [https://atoy0m0.github.io/bedrock-pricing/](https://atoy0m0.github.io/bedrock-pricing/)**

## 📁 構成

| ファイル / パス | 役割 |
| --- | --- |
| `docs/index.html` | 表示（GitHub Pages が公開） |
| `docs/data.json` | データ本体（Actions が生成） |
| `scripts/transform.mjs` | Price List → `data.json` の変換 |
| `.github/workflows/update-pricing.yml` | 自動更新（毎日 JST 06:00 / 手動実行可） |

## 🚀 セットアップ

```bash
gh auth login                       # 未認証なら
cd bedrock-pricing
git init -b main && git add -A && git commit -m "init"
gh repo create bedrock-pricing --public --source=. --push
# gh api -X POST "repos/{owner}/bedrock-pricing/pages" -f "source[branch]=main" -f "source[path]=/docs"
gh api -X POST "repos/atoy0m0/bedrock-pricing/pages" -f "source[branch]=main" -f "source[path]=/docs"
```

公開 URL: <https://atoy0m0.github.io/bedrock-pricing/>

> [!NOTE]
> 初回はスナップショットデータ（Anthropic 現行 Claude / Nova / Llama 3・4 を含まない）で表示される。
> Actions タブから `update-pricing` を手動実行すると Price List の全量データに置き換わる。

## 🌏 対象リージョンの変更

`.github/workflows/update-pricing.yml` の `REGIONS` を編集する（スペース区切り）。

## 🧪 ローカルでの変換確認

```bash
base="https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws"
# 旧 Claude・Nova・サードパーティ
curl -fsSL "$base/AmazonBedrock/current/ap-northeast-1/index.json" -o offer-ap-northeast-1.json
# 新しい Claude（Opus 4.x / Sonnet 5 等）を含む
curl -fsSL "$base/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json" -o offer-fm-ap-northeast-1.json
node scripts/transform.mjs offer-*.json > docs/data.json
python3 -m http.server -d docs 8000   # http://localhost:8000
```

## ⚠️ 免責

> [!WARNING]
> 非公式の参考情報。料金は予告なく変更される。実際の請求は AWS 公式が優先。
> Amazon Bedrock および AWS は Amazon.com, Inc. またはその関連会社の商標であり、本プロジェクトは AWS による公認・提携ではない。
