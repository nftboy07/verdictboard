#!/usr/bin/env node
/**
 * agent.mjs — VerdictBoard batch agent (Telegraph Hackathon Season II).
 *
 * Implements SUBMISSION.md §3–4: walks the fixed public eval set
 * (evalset.json), buys one LLM_OUTPUT_EVALUATION_GENERAL evaluation per
 * graded output through the same x402 pattern + spend controls as
 * server.mjs / ../telegraph-request.mjs, verifies every returned signal via
 * GET /engine/v1/signal/{hash}, and records the full evidence per call.
 * Only scores whose verification returns verified:true are published
 * (publish.mjs aggregates them into the leaderboard).
 *
 * Usage:
 *   node agent.mjs [--eval-set evalset.json] [--spend-limit-usdc 0.50]
 *                  [--out data/agent-results.json] [--dry-run]
 *
 *   --dry-run   validate the eval set + print the run plan. No network,
 *               no payment, key value never printed.
 *
 * Safety: TESTNET ONLY (Ethereum Sepolia). Per-payment cap $0.10 via x402
 * spendControls (floor is $0.01). Run spend limit enforced before every
 * ask (default $0.50 = 50 evaluations). After 2 consecutive node 504s the
 * run aborts the remaining graded items — the 11 Nov evidence is that a
 * 504 still settles the $0.01 payment, so burning the whole set against a
 * stalled intent wastes funds. The break-it case is sent WITHOUT the
 * payment wrapper and must be refused before payment; it is logged as an
 * unscored row, never a crash.
 *
 * Key: EVM_PRIVATE_KEY env var, else ../secrets/telegraph-testnet-wallet.env
 * (same source as server.mjs). The key is loaded in-process only — never
 * logged, never written to any output file.
 */
import { readFile, appendFile, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const NODE_BASE = "https://devnode.telegraphprotocol.com";
const SEPOLIA_CHAIN = "eip155:11155111";
const SEPOLIA_USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const EVAL_INTENT = "LLM_OUTPUT_EVALUATION_GENERAL";
const FLOOR_UUSDC = 10_000; // $0.01 — current floor; the live 402 challenge is authoritative
const HTTP_TIMEOUT_MS = 240_000; // node + egress proxy can be slow (504s seen at ~66 s)
const MAX_CONSECUTIVE_504 = 2;

/* ---- args ---------------------------------------------------------------- */
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DRY_RUN = args.includes("--dry-run");
const EVAL_SET_PATH = flag("--eval-set", new URL("./evalset.json", import.meta.url).pathname);
const SPEND_LIMIT_UUSDC = Math.round(Number(flag("--spend-limit-usdc", "0.50")) * 1_000_000);
const OUT_PATH = flag("--out", new URL("./data/agent-results.json", import.meta.url).pathname);

/* ---- eval set ------------------------------------------------------------ */
function loadEvalSet(path) {
  const set = JSON.parse(readFileSync(path, "utf8"));
  if (set.intent !== EVAL_INTENT) throw new Error(`eval set intent must be ${EVAL_INTENT}, got ${set.intent}`);
  if (!Array.isArray(set.tasks) || !set.tasks.length) throw new Error("eval set has no tasks");
  const seen = new Set();
  let graded = 0;
  for (const t of set.tasks) {
    if (!t.id || !t.task || !Array.isArray(t.outputs) || !t.outputs.length) throw new Error(`task ${t.id ?? "?"}: needs id, task, outputs[]`);
    if (seen.has(t.id)) throw new Error(`duplicate task id ${t.id}`);
    seen.add(t.id);
    for (const o of t.outputs) {
      if (!o.subject || typeof o.output !== "string" || !o.output) throw new Error(`task ${t.id}: every output needs subject + non-empty output`);
      if (!["correct", "partial", "wrong"].includes(o.expected)) throw new Error(`task ${t.id}/${o.subject}: expected must be correct|partial|wrong`);
      graded++;
    }
  }
  for (const b of set.break_it ?? []) {
    if (b.kind !== "invalid_params" || !b.missing) throw new Error(`break-it case ${b.id ?? "?"}: needs kind=invalid_params + missing`);
  }
  return { set, graded };
}

/* ---- wallet (in-process only; key never printed/written) ----------------- */
function loadKey() {
  const envKey = process.env.EVM_PRIVATE_KEY;
  if (envKey && /^0x[0-9a-fA-F]{64}$/.test(envKey.trim())) return { key: envKey.trim(), source: "env EVM_PRIVATE_KEY" };
  const envText = readFileSync(new URL("../secrets/telegraph-testnet-wallet.env", import.meta.url), "utf8");
  const m = envText.match(/^EVM_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
  if (!m) throw new Error("no EVM_PRIVATE_KEY in env or ../secrets/telegraph-testnet-wallet.env");
  return { key: m[1], source: "../secrets/telegraph-testnet-wallet.env" };
}
async function makePaidFetch(key) {
  const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(key);
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: SEPOLIA_CHAIN, client: new ExactEvmScheme(account) }],
    spendControls: { allowedAssets: [{ network: SEPOLIA_CHAIN, asset: SEPOLIA_USDC, maxAmountPerPayment: "100000" }] },
  });
  return { fetchWithPayment, payer: account.address };
}

/* ---- one paid evaluation --------------------------------------------------- */
const decode = (v) => { try { return v ? JSON.parse(Buffer.from(v, "base64").toString()) : null; } catch { return null; } };
async function paidEval(fetchWithPayment, payer, task, output) {
  const t0 = Date.now();
  const res = await fetchWithPayment(`${NODE_BASE}/engine/v1/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: EVAL_INTENT, params: { task, output } }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = null; }
  const receipt = decode(res.headers.get("x-telegraph-receipt"));
  const row = {
    http_status: res.status,
    duration_ms: Date.now() - t0,
    payer,
    miner: body?.miner_name ?? body?.miner_id ?? null,
    // On 200 the receipt/body prices the call. On 504 there is no body, but
    // both 11 Nov spike attempts settled on-chain — record the floor as the
    // assumed cost and say so, rather than pretending it was free.
    cost_usd: body?.cost_usd ?? (receipt?.amount_uusdc ? Number(receipt.amount_uusdc) / 1_000_000 : null),
    cost_source: body?.cost_usd != null ? "response body" : receipt ? "receipt" : null,
    score: body?.result?.score ?? null,
    strengths: body?.result?.strengths ?? null,
    errors: body?.result?.errors ?? null,
    signal_hash: body?.signal_hash ?? null,
    receipt: receipt ? { receipt_hash: receipt.receipt_hash ?? null, amount_uusdc: receipt.amount_uusdc ?? null, epoch_id: receipt.epoch_id ?? null, tx_hash: receipt.tx_hash ?? null } : null,
    verification: null,
    note: null,
  };
  if (res.status === 504) { row.cost_usd = row.cost_usd ?? 0.01; row.cost_source = row.cost_source ?? "assumed floor — payment settled on both 11 Nov spike attempts despite the 504"; row.note = "node gateway timeout AFTER payment settled — no signal returned (documented 11 Nov behaviour)"; }
  if (res.status === 200 && row.signal_hash) {
    try {
      const v = await fetch(`${NODE_BASE}/engine/v1/signal/${row.signal_hash}`, { signal: AbortSignal.timeout(60_000) });
      const vj = await v.json().catch(() => null);
      row.verification = { http_status: v.status, verified: vj?.verification?.verified ?? null };
    } catch (e) { row.verification = { error: e.message }; }
  }
  return row;
}

/* ---- main ------------------------------------------------------------------ */
const { set, graded } = loadEvalSet(EVAL_SET_PATH);
const subjects = [...new Set(set.tasks.flatMap((t) => t.outputs.map((o) => o.subject)))];
console.log(`VerdictBoard agent — eval set "${set.name}" (${EVAL_SET_PATH})`);
console.log(`tasks: ${set.tasks.length} · graded outputs: ${graded} · subjects: ${subjects.join(", ")}`);
console.log(`worst-case cost: ${graded} × $0.01 floor = $${(graded / 100).toFixed(2)} (live 402 quote is authoritative) · spend limit: $${(SPEND_LIMIT_UUSDC / 1_000_000).toFixed(2)}`);

if (DRY_RUN) {
  let keyNote = "not checked";
  try { keyNote = `found (${loadKey().source}) — value not printed`; } catch (e) { keyNote = `MISSING — ${e.message}`; }
  console.log(`dry run: eval set valid · wallet key ${keyNote} · no network calls made · no payment attempted`);
  process.exit(0);
}

const { key, source } = loadKey();
const { fetchWithPayment, payer } = await makePaidFetch(key);
console.log(`wallet loaded from ${source} · payer ${payer} · testnet only`);

const rows = [];
let spentUusdc = 0;
let consecutive504 = 0;
let aborted = false;

for (const t of set.tasks) {
  for (const o of t.outputs) {
    const base = { at: new Date().toISOString(), kind: "eval", task_id: t.id, task: t.task, subject: o.subject, expected: o.expected, intent: EVAL_INTENT };
    if (aborted) { rows.push({ ...base, http_status: null, note: `not attempted — run aborted after ${MAX_CONSECUTIVE_504} consecutive node 504s (each 504 still settles $0.01)` }); continue; }
    if (spentUusdc + FLOOR_UUSDC > SPEND_LIMIT_UUSDC) { rows.push({ ...base, http_status: null, note: `not attempted — spend limit $${(SPEND_LIMIT_UUSDC / 1_000_000).toFixed(2)} reached` }); aborted = true; continue; }
    try {
      const r = await paidEval(fetchWithPayment, payer, t.task, o.output);
      if (r.http_status !== 402) spentUusdc += FLOOR_UUSDC; // conservative, same convention as server.mjs
      consecutive504 = r.http_status === 504 ? consecutive504 + 1 : 0;
      if (consecutive504 >= MAX_CONSECUTIVE_504) aborted = true;
      rows.push({ ...base, ...r });
      await appendFile(new URL("./data/ask-log.jsonl", import.meta.url),
        JSON.stringify({ at: base.at, intent: EVAL_INTENT, params: { task: t.task, output: o.output }, http_status: r.http_status, signal_hash: r.signal_hash, receipt_hash: r.receipt?.receipt_hash ?? null, verified: r.verification?.verified ?? null, note: r.note ?? "agent run", via: "agent" }) + "\n").catch(() => {});
      console.log(`${t.id}/${o.subject}: http ${r.http_status} score=${r.score ?? "—"} verified=${r.verification?.verified ?? "—"} spent=$${(spentUusdc / 1_000_000).toFixed(2)}`);
    } catch (e) {
      rows.push({ ...base, http_status: null, error: e.message, note: "attempt failed client-side (timeout/transport) — payment state unknown; check ask-log + wallet before re-running" });
      console.log(`${t.id}/${o.subject}: ERROR ${e.message}`);
    }
  }
}

/* break-it: invalid params must be refused BEFORE payment — sent unpaid */
for (const b of set.break_it ?? []) {
  const base = { at: new Date().toISOString(), kind: "invalid_params_test", case_id: b.id, intent: EVAL_INTENT, missing: b.missing, expected_refusal: b.expect };
  try {
    const res = await fetch(`${NODE_BASE}/engine/v1/ask`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: EVAL_INTENT, params: b.params }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    rows.push({ ...base, http_status: res.status, response_snippet: text.slice(0, 300),
      note: res.status === 400 ? "refused before payment, as required" : `NOT the expected pre-payment 400 — node answered ${res.status} to an unpaid invalid request; recorded as observed` });
    console.log(`break-it ${b.id}: http ${res.status} (expected 400 before payment)`);
  } catch (e) {
    rows.push({ ...base, http_status: null, error: e.message, note: "break-it request failed client-side — refusal behaviour unverified this run" });
  }
}

const scored = rows.filter((r) => r.kind === "eval" && r.verification?.verified === true && typeof r.score === "number");
const correct = scored.filter((r) => r.score >= (set.correct_threshold ?? 0.8));
const run = {
  agent: "verdictboard/agent.mjs", eval_set: set.name, started_from: EVAL_SET_PATH,
  finished_at: new Date().toISOString(), network: "testnet", payer,
  spend_limit_uusdc: SPEND_LIMIT_UUSDC, spent_uusdc_conservative: spentUusdc,
  summary: { graded_outputs: graded, attempted: rows.filter((r) => r.kind === "eval" && r.http_status !== null).length, verified_scored: scored.length, verified_correct: correct.length },
  rows,
};
await mkdir(new URL("./data/agent-runs/", import.meta.url), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(new URL(`./data/agent-runs/run-${stamp}.json`, import.meta.url), JSON.stringify(run, null, 2));
await writeFile(OUT_PATH, JSON.stringify(run, null, 2));
console.log(`\nrun complete: attempted ${run.summary.attempted}/${graded} · verified-scored ${scored.length} · verified-correct ${correct.length} · conservative spend $${(spentUusdc / 1_000_000).toFixed(2)}`);
console.log(`results -> ${OUT_PATH} (+ data/agent-runs/run-${stamp}.json)`);
