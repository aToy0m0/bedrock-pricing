// AWS Price List Bulk API のオファーファイルを docs/data.json 形式に変換する。
// 使い方: node scripts/transform.mjs offer1.json [offer2.json ...] > docs/data.json
// 変換できない入力ではゼロ以外の終了コードで失敗する（不完全なデータを出力しない）。
//
// Bedrock の料金は AWS Price List 上で 2 つのオファーに分かれている:
//   - AmazonBedrock                : 旧 Claude・Amazon Nova・サードパーティ（Mistral 等）。
//                                    モデル名は attributes.model、単価種別は usagetype/inferenceType。
//   - AmazonBedrockFoundationModels: 新しい Claude（Opus 4.x / Sonnet 4.x・5 / Haiku 4.5 ほか）を含む
//                                    マーケットプレイス型。モデル名は attributes.servicename
//                                    （例 "Claude Opus 4.6 (Amazon Bedrock Edition)"）、単価種別は
//                                    usagetype("...MP:..._InputTokenCount-Units") と priceDimension.description。
// どちらのスキーマかは各ファイルの中身から自動判別する。
import { readFileSync } from "node:fs";

const PROVIDER_BY_MODEL = [
  [/^claude/i, "Anthropic"],
  [/^(nova|titan)/i, "Amazon"],
  [/^(meta[ -])?llama/i, "Meta"],
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
  [/^cohere/i, "Cohere"],
  [/^(command|embed|rerank)/i, "Cohere"],
  [/^stab(le|ility)/i, "Stability AI"],
  [/^twelvelabs/i, "TwelveLabs"],
];

function providerOf(model) {
  for (const [re, name] of PROVIDER_BY_MODEL) if (re.test(model)) return name;
  return "その他";
}

const VARIANT_LABEL = { "": "", cross: " (クロスリージョン)", batch: " (バッチ)" };

// 1 つの単価行を byKey へ登録する。同一 (モデル+バリアント, リージョン, 入出力) は最初の値を優先。
function upsert(byKey, model, region, variant, kind, per1M) {
  const name = model + VARIANT_LABEL[variant];
  const key = `${name}|${region}`;
  if (!byKey.has(key)) byKey.set(key, { p: providerOf(model), m: name, r: [region], i: null, o: null });
  const rec = byKey.get(key);
  if (rec[kind] === null) rec[kind] = per1M;
}

// ---- AmazonBedrock（旧スキーマ）----
// Standard のオンデマンド入出力トークンのみを基本行に採用し、バッチ・クロスリージョンを別バリアントに。
// Priority/Flex/Latency 階層・キャッシュ・画像/音声/動画トークンは対象外（表示は Standard 基準）。
function classifyLegacy(inferenceType, usagetype) {
  const s = `${inferenceType || ""} ${usagetype || ""}`;
  if (/cache/i.test(s)) return null;
  if (/image|audio|video|speech/i.test(s)) return null;
  if (/flex|priority|latency/i.test(s)) return null;
  const isOutput = /output|response/i.test(s);
  const isInput = /input/i.test(s) && !isOutput;
  if (!isInput && !isOutput) return null;
  const cross = /cross[-_ ]?region|global/i.test(usagetype || "");
  const batch = /batch/i.test(s);
  if (cross && batch) return null; // クロスリージョン×バッチは煩雑になるため割愛
  return { kind: isInput ? "i" : "o", variant: cross ? "cross" : batch ? "batch" : "" };
}

function per1MFromUnit(priceUSD, unit) {
  if (/1k/i.test(unit)) return priceUSD * 1000;
  if (/1m|million/i.test(unit)) return priceUSD;
  if (/token/i.test(unit)) return priceUSD * 1_000_000;
  return null; // 未知の単位
}

function parseLegacyOffer(offer, byKey, skipped) {
  for (const [sku, termGroup] of Object.entries(offer.terms.OnDemand)) {
    const attrs = offer.products[sku]?.attributes ?? {};
    const usagetype = attrs.usagetype ?? "";
    const region = attrs.regionCode || attrs.location || "不明";

    const c = classifyLegacy(attrs.inferenceType, usagetype);
    if (!c) { skipped.push(`${sku}: 対象外 (${attrs.inferenceType || usagetype})`); continue; }

    let priceUSD = null, unit = "";
    for (const term of Object.values(termGroup)) {
      for (const dim of Object.values(term.priceDimensions ?? {})) {
        if (dim.pricePerUnit?.USD !== undefined) { priceUSD = parseFloat(dim.pricePerUnit.USD); unit = dim.unit ?? ""; break; }
      }
      if (priceUSD !== null) break;
    }
    if (priceUSD === null || Number.isNaN(priceUSD)) { skipped.push(`${sku}: USD 単価なし (${usagetype})`); continue; }

    const per1M = per1MFromUnit(priceUSD, unit);
    if (per1M === null) { skipped.push(`${sku}: 未知の単位 "${unit}" (${usagetype})`); continue; }

    const model = attrs.model
      || usagetype.replace(/^[A-Z0-9]+-/, "").replace(/[-_]?(input|output)[-_]?tokens.*$/i, "");
    upsert(byKey, model, region, c.variant, c.kind, per1M);
  }
}

// ---- AmazonBedrockFoundationModels（新スキーマ / マーケットプレイス型）----
// usagetype 例: "USE1-MP:USE1_InputTokenCount_Global-Units" / "APN1-MP:APN1_output_tokens_standard-Units"
function classifyFM(usagetype, description) {
  let u = usagetype.replace(/^.*MP:/, "").replace(/-Units$/, "");
  u = u.replace(/^[A-Z0-9]+_/, ""); // 先頭のリージョンコード (USE1_ / APN1_ 等)
  const s = `${u} ${description || ""}`;
  if (/cache/i.test(s)) return null;
  if (/reserved|tpm|provisioned|modelunits|storage|customization/i.test(s)) return null;
  if (/image|audio|video|speech|embed|rerank|created/i.test(s)) return null;
  const isOutput = /output|response/i.test(u);
  const isInput = /input/i.test(u) && !isOutput;
  if (!isInput && !isOutput) return null;
  const global = /global/i.test(u);
  const batch = /batch/i.test(u);
  if (global && batch) return null;
  return { kind: isInput ? "i" : "o", variant: global ? "cross" : batch ? "batch" : "" };
}

function per1MFromDescription(priceUSD, description) {
  // マーケットプレイス型は unit="Units" で、粒度は description が示す（例 "Million Input Tokens"）。
  if (/thousand|per 1[, ]?000|per 1k/i.test(description || "")) return priceUSD * 1000;
  return priceUSD; // "Million ..." / "per 1 million ..."
}

function parseFMOffer(offer, byKey, skipped) {
  for (const [sku, termGroup] of Object.entries(offer.terms.OnDemand)) {
    const attrs = offer.products[sku]?.attributes ?? {};
    const servicename = attrs.servicename ?? "";
    const usagetype = attrs.usagetype ?? "";
    const region = attrs.regionCode || attrs.location || "不明";
    if (!/\(Amazon Bedrock Edition\)/i.test(servicename)) { skipped.push(`${sku}: 非モデル製品`); continue; }
    const model = servicename.replace(/\s*\(Amazon Bedrock Edition\)\s*$/i, "").trim();

    for (const term of Object.values(termGroup)) {
      for (const dim of Object.values(term.priceDimensions ?? {})) {
        const c = classifyFM(usagetype, dim.description);
        if (!c) { skipped.push(`${sku}: 対象外 (${usagetype})`); continue; }
        if (dim.pricePerUnit?.USD === undefined) { skipped.push(`${sku}: USD 単価なし`); continue; }
        const usd = parseFloat(dim.pricePerUnit.USD);
        if (Number.isNaN(usd)) continue;
        upsert(byKey, model, region, c.variant, c.kind, per1MFromDescription(usd, dim.description));
      }
    }
  }
}

// スキーマ自動判別: FoundationModels は servicename が "(Amazon Bedrock Edition)" を含む。
function isFoundationModels(offer) {
  for (const p of Object.values(offer.products)) {
    if (/\(Amazon Bedrock Edition\)/i.test(p.attributes?.servicename || "")) return true;
  }
  return false;
}

function parseOfferFile(offer, byKey, skipped) {
  if (!offer?.products || !offer?.terms?.OnDemand) {
    throw new Error("オファーファイル形式ではない (products / terms.OnDemand がない)");
  }
  if (isFoundationModels(offer)) parseFMOffer(offer, byKey, skipped);
  else parseLegacyOffer(offer, byKey, skipped);
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
  source: "AWS Price List Bulk API (AmazonBedrock + AmazonBedrockFoundationModels)",
  publicationDate,
  rows,
}, null, 1));
