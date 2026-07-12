// AWS Price List Bulk API のオファーファイルを docs/data.json 形式に変換する。
// 使い方: node scripts/transform.mjs offer1.json [offer2.json ...] > docs/data.json
// 変換できない入力ではゼロ以外の終了コードで失敗する（不完全なデータを出力しない）。
import { readFileSync } from "node:fs";

const PROVIDER_BY_MODEL = [
  [/^claude/i, "Anthropic"],
  [/^(nova|titan)/i, "Amazon"],
  [/^llama/i, "Meta"],
  [/^gemma/i, "Google"],
  [/^deepseek/i, "DeepSeek"],
  [/^(mistral|ministral|magistral|devstral|voxtral|mixtral|pixtral)/i, "Mistral AI"],
  [/^kimi/i, "Moonshot AI"],
  [/^minimax/i, "MiniMax AI"],
  [/^nemotron/i, "NVIDIA"],
  [/^gpt[-_]?oss/i, "OpenAI OSS"],
  [/^qwen/i, "Qwen"],
  [/^palmyra/i, "Writer"],
  [/^glm/i, "Z AI"],
  [/^(jamba|jurassic)/i, "AI21 Labs"],
  [/^(command|embed|rerank)/i, "Cohere"],
];

function providerOf(model) {
  for (const [re, name] of PROVIDER_BY_MODEL) if (re.test(model)) return name;
  return "その他";
}

// 1 オファーファイル → 行の Map (key: model|region)
function parseOfferFile(offer, byKey, skipped) {
  if (!offer?.products || !offer?.terms?.OnDemand) {
    throw new Error("オファーファイル形式ではない (products / terms.OnDemand がない)");
  }
  for (const [sku, termGroup] of Object.entries(offer.terms.OnDemand)) {
    const attrs = offer.products[sku]?.attributes ?? {};
    const usagetype = attrs.usagetype ?? "";
    const region = attrs.regionCode || attrs.location || "不明";

    let priceUSD = null, unit = "";
    for (const term of Object.values(termGroup)) {
      for (const dim of Object.values(term.priceDimensions ?? {})) {
        if (dim.pricePerUnit?.USD !== undefined) {
          priceUSD = parseFloat(dim.pricePerUnit.USD);
          unit = dim.unit ?? "";
          break;
        }
      }
      if (priceUSD !== null) break;
    }
    if (priceUSD === null || Number.isNaN(priceUSD)) {
      skipped.push(`${sku}: USD 単価なし (${usagetype})`);
      continue;
    }

    const isInput = /input[-_]?tokens/i.test(usagetype);
    const isOutput = /output[-_]?tokens/i.test(usagetype);
    if (!isInput && !isOutput) {
      skipped.push(`${sku}: トークン系でない (${usagetype}, unit=${unit})`);
      continue;
    }

    let per1M;
    if (/1k/i.test(unit)) per1M = priceUSD * 1000;
    else if (/1m|million/i.test(unit)) per1M = priceUSD;
    else if (/token/i.test(unit)) per1M = priceUSD * 1_000_000;
    else {
      skipped.push(`${sku}: 未知の単位 "${unit}" (${usagetype})`);
      continue;
    }

    const model = attrs.model
      || usagetype.replace(/^[A-Z0-9]+-/, "").replace(/[-_]?(input|output)[-_]?tokens.*$/i, "");
    const variant = /batch/i.test(usagetype) ? " (バッチ)"
      : /cross[-_]?region|global/i.test(usagetype) ? " (クロスリージョン)"
      : "";
    const name = model + variant;
    const key = `${name}|${region}`;

    if (!byKey.has(key)) byKey.set(key, { p: providerOf(model), m: name, r: [region], i: null, o: null });
    const rec = byKey.get(key);
    if (isInput) rec.i = per1M; else rec.o = per1M;
  }
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("使い方: node scripts/transform.mjs <offer.json> [offer2.json ...]");
  process.exit(1);
}

const byKey = new Map();
const skipped = [];
let publicationDate = null;

for (const file of files) {
  const offer = JSON.parse(readFileSync(file, "utf8"));
  parseOfferFile(offer, byKey, skipped);
  if (offer.publicationDate) publicationDate = offer.publicationDate;
}

const rows = [...byKey.values()].sort((a, b) =>
  a.p.localeCompare(b.p) || a.m.localeCompare(b.m) || a.r[0].localeCompare(b.r[0]));

if (rows.length === 0) {
  console.error(`失敗: トークン単価の行を 1 件も抽出できなかった (対象外 SKU ${skipped.length} 件)`);
  process.exit(1);
}

console.error(`変換: ${rows.length} 行 / 対象外 SKU ${skipped.length} 件`);
process.stdout.write(JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "AWS Price List Bulk API (AmazonBedrock)",
  publicationDate,
  rows,
}, null, 1));
