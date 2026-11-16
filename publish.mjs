#!/usr/bin/env node
/**
 * publish.mjs — VerdictBoard leaderboard publisher (SUBMISSION.md §4).
 *
 * Reads the latest batch-agent results (data/agent-results.json, written by
 * agent.mjs) and renders the public leaderboard: per-subject and overall
 * COST PER VERIFIED CORRECT ANSWER, with every scored row linked to its
 * signal_hash for independent re-verification. Only rows whose signal
 * verification returned verified:true AND carry a numeric score count as
 * scored; "correct" = score >= threshold (0.8, the scaffold convention in
 * app.js + evalset.json). Money spent on a subject counts ALL its paid
 * attempts (including 504s that settled) — that is the honest denominator
 * story: cost per verified correct answer = total spent ÷ verified correct.
 *
 * Outputs (next to the results file's board):
 *   public/leaderboard.html      — standalone page (inline CSS, no server needed)
 *   public/evidence-bundle.json  — the aggregate + source rows, machine-readable
 *
 * Fallback: with no agent results yet, it renders the verified asks recorded
 * in data/ask-log.jsonl and states plainly that no verified eval rows exist.
 * It never invents rows.
 *
 * Usage:
 *   node publish.mjs [--results data/agent-results.json] [--out public/leaderboard.html]
 *   node publish.mjs --self-test     # aggregation math check on synthetic rows; writes nothing
 */
import { readFileSync, existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";

const NODE = "https://devnode.telegraphprotocol.com";
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const RESULTS_PATH = flag("--results", new URL("./data/agent-results.json", import.meta.url).pathname);
const LOG_PATH = flag("--log", new URL("./data/ask-log.jsonl", import.meta.url).pathname);
const OUT_PATH = flag("--out", new URL("./public/leaderboard.html", import.meta.url).pathname);
const BUNDLE_PATH = flag("--bundle", new URL("./public/evidence-bundle.json", import.meta.url).pathname);
const THRESHOLD = 0.8;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");
const money = (n) => (n == null || Number.isNaN(n) ? "—" : "$" + Number(n).toFixed(4));

/* ---- aggregation (pure; unit-checked by --self-test) ----------------------- */
export function aggregate(rows, threshold = THRESHOLD) {
  const evalRows = rows.filter((r) => r.kind === "eval");
  const bySubject = new Map();
  for (const r of evalRows) {
    const s = bySubject.get(r.subject) ?? { subject: r.subject, attempts: 0, paid_attempts: 0, spent_usd: 0, scored: 0, correct: 0 };
    s.attempts++;
    if (r.http_status !== null && r.http_status !== 402) { s.paid_attempts++; s.spent_usd += r.cost_usd ?? 0.01; }
    if (r.verification?.verified === true && typeof r.score === "number") { s.scored++; if (r.score >= threshold) s.correct++; }
    bySubject.set(r.subject, s);
  }
  const subjects = [...bySubject.values()].map((s) => ({ ...s, cost_per_verified_correct: s.correct ? s.spent_usd / s.correct : null }));
  subjects.sort((a, b) => (a.cost_per_verified_correct ?? Infinity) - (b.cost_per_verified_correct ?? Infinity));
  const totals = subjects.reduce((t, s) => ({ attempts: t.attempts + s.attempts, spent_usd: t.spent_usd + s.spent_usd, scored: t.scored + s.scored, correct: t.correct + s.correct }), { attempts: 0, spent_usd: 0, scored: 0, correct: 0 });
  return { subjects, totals: { ...totals, cost_per_verified_correct: totals.correct ? totals.spent_usd / totals.correct : null }, threshold };
}

/* ---- self-test -------------------------------------------------------------- */
if (args.includes("--self-test")) {
  const rows = [
    { kind: "eval", subject: "X", http_status: 200, cost_usd: 0.01, score: 0.9, verification: { verified: true } },
    { kind: "eval", subject: "X", http_status: 200, cost_usd: 0.01, score: 0.4, verification: { verified: true } },
    { kind: "eval", subject: "X", http_status: 200, cost_usd: 0.01, score: 1.0, verification: { verified: true } },
    { kind: "eval", subject: "X", http_status: 200, cost_usd: 0.01, score: 0.95, verification: { verified: false } }, // unverified: spend counts, score must not
    { kind: "eval", subject: "Y", http_status: 504, cost_usd: 0.01, score: null, verification: null },               // settled 504: spend counts, no score
    { kind: "eval", subject: "Y", http_status: null, cost_usd: null, score: null, verification: null },              // not attempted: no spend
    { kind: "invalid_params_test", http_status: 400 },                                                                // ignored by aggregation
  ];
  const a = aggregate(rows);
  const x = a.subjects.find((s) => s.subject === "X"), y = a.subjects.find((s) => s.subject === "Y");
  const checks = [
    ["X scored = 3", x.scored === 3], ["X correct = 2", x.correct === 2],
    ["X spent = 0.04", Math.abs(x.spent_usd - 0.04) < 1e-9], ["X cost/correct = 0.02", Math.abs(x.cost_per_verified_correct - 0.02) < 1e-9],
    ["Y spent = 0.01", Math.abs(y.spent_usd - 0.01) < 1e-9], ["Y correct = 0, cost/correct null", y.correct === 0 && y.cost_per_verified_correct === null],
    ["totals spent = 0.05", Math.abs(a.totals.spent_usd - 0.05) < 1e-9], ["totals correct = 2", a.totals.correct === 2],
    ["X ranks before Y", a.subjects[0].subject === "X"],
  ];
  let fail = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fail++; }
  console.log(fail ? `self-test: ${fail} FAILURE(S)` : "self-test: all checks passed");
  process.exit(fail ? 1 : 0);
}

/* ---- load sources ----------------------------------------------------------- */
let run = null;
if (existsSync(RESULTS_PATH)) { try { run = JSON.parse(readFileSync(RESULTS_PATH, "utf8")); } catch {} }
let logEntries = [];
if (existsSync(LOG_PATH)) {
  logEntries = readFileSync(LOG_PATH, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const rows = run?.rows ?? [];
const agg = aggregate(rows);
const generated = new Date().toISOString();

/* ---- render ------------------------------------------------------------------ */
const subjectRows = agg.subjects.map((s) => `<tr>
  <td>${esc(s.subject)}</td><td>${s.attempts}</td><td>${s.scored}</td><td>${s.correct}</td>
  <td>${money(s.spent_usd)}</td><td><strong>${s.cost_per_verified_correct ? money(s.cost_per_verified_correct) : "— (no verified correct yet)"}</strong></td></tr>`).join("");
const scoredRows = rows.filter((r) => r.kind === "eval").map((r) => `<tr>
  <td>${esc(r.at)}</td><td>${esc(r.subject)}</td><td>${esc(r.task_id)}</td>
  <td>${r.score ?? "—"}</td><td>${esc(r.expected ?? "")}</td><td>${money(r.cost_usd)}</td>
  <td>${r.signal_hash ? `<a href="${NODE}/engine/v1/signal/${esc(r.signal_hash)}" target="_blank" rel="noopener">${short(r.signal_hash)}</a>` : "—"}</td>
  <td>${r.verification?.verified === true ? "true ✅" : r.http_status === 504 ? "504 — settled, no signal" : esc(r.note ?? r.verification?.verified ?? "—")}</td></tr>`).join("");
const breakRows = rows.filter((r) => r.kind === "invalid_params_test").map((r) => `<tr>
  <td>${esc(r.at)}</td><td>missing <code>${esc(r.missing)}</code></td><td>HTTP ${esc(r.http_status ?? "—")}</td><td>${esc(r.note ?? "")}</td></tr>`).join("");
const logRows = logEntries.map((e) => `<tr>
  <td>${esc(e.at)}</td><td>${esc(e.intent)}</td><td>HTTP ${esc(e.http_status ?? "—")}</td>
  <td>${e.signal_hash ? `<a href="${NODE}/engine/v1/signal/${esc(e.signal_hash)}" target="_blank" rel="noopener">${short(e.signal_hash)}</a>` : "—"}</td>
  <td>${e.verified === true ? "true ✅" : esc(e.verified ?? "—")}</td><td>${esc(e.note ?? "")}</td></tr>`).join("");

const mainSection = run ? `
  <h2>Cost per verified correct answer — by subject</h2>
  <p>Eval set: ${esc(run.eval_set)} · run finished ${esc(run.finished_at)} · payer ${esc(run.payer)} ·
     verified-scored ${agg.totals.scored} · verified-correct ${agg.totals.correct} · total spent ${money(agg.totals.spent_usd)} ·
     <strong>overall cost per verified correct answer: ${agg.totals.cost_per_verified_correct ? money(agg.totals.cost_per_verified_correct) : "—"}</strong></p>
  <table><thead><tr><th>Subject</th><th>Attempts</th><th>Verified scored</th><th>Verified correct</th><th>Spent</th><th>Cost / verified correct</th></tr></thead>
  <tbody>${subjectRows || `<tr><td colspan="6">No eval rows in this run.</td></tr>`}</tbody></table>
  <h2>Every graded output</h2>
  <table><thead><tr><th>When</th><th>Subject</th><th>Task</th><th>Score</th><th>Expected</th><th>Cost</th><th>Signal proof</th><th>Verification</th></tr></thead>
  <tbody>${scoredRows}</tbody></table>
  ${breakRows ? `<h2>Break-it case (invalid params, sent unpaid)</h2>
  <table><thead><tr><th>When</th><th>Defect</th><th>Result</th><th>Note</th></tr></thead><tbody>${breakRows}</tbody></table>` : ""}`
: `
  <h2>No batch-agent run yet</h2>
  <p>No <code>data/agent-results.json</code> exists — the batch agent (agent.mjs) has not completed a run.
     The interactive board in <a href="index.html">the scaffold app</a> still collects verified eval rows
     from the retry slot. What HAS been verified from this rig so far is in the local ask log below;
     every row links to its signal proof.</p>
  <h2>Verified asks recorded in the local ask log</h2>
  <table><thead><tr><th>When</th><th>Intent</th><th>Result</th><th>Signal proof</th><th>Verified</th><th>Note</th></tr></thead>
  <tbody>${logRows || `<tr><td colspan="6">Ask log is empty.</td></tr>`}</tbody></table>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VerdictBoard leaderboard — cost per verified correct answer</title>
<style>
body{font-family:system-ui,sans-serif;margin:0 auto;max-width:980px;padding:20px;background:#0d1117;color:#e6edf3}
table{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0 20px}
th,td{border:1px solid #30363d;padding:6px 8px;text-align:left}
a{color:#58a6ff}.sub{color:#9da7b3}footer{color:#9da7b3;font-size:13px;border-top:1px solid #30363d;padding-top:10px}
</style></head><body>
<h1>⚖️ VerdictBoard — leaderboard</h1>
<p class="sub">Cost per <strong>verified</strong> correct answer (Telegraph Hackathon Season II, Mission 10 — Model Economy).
Scores count only when <code>GET /engine/v1/signal/{hash}</code> returns <code>verified: true</code>; "correct" = eval score ≥ ${THRESHOLD}.
Network: Telegraph <strong>testnet</strong> (Ethereum Sepolia) — no mainnet funds. Generated ${generated} by publish.mjs.</p>
${mainSection}
<footer>Every score links to its signal_hash for independent re-verification. Testnet only.</footer>
</body></html>`;

await mkdir(new URL("./public/", import.meta.url), { recursive: true });
await writeFile(OUT_PATH, html);
await writeFile(BUNDLE_PATH, JSON.stringify({ generated_at: generated, source_results: run ? RESULTS_PATH : null, source_log: LOG_PATH, aggregate: agg, rows, ask_log: logEntries }, null, 2));
console.log(`leaderboard -> ${OUT_PATH}`);
console.log(`evidence bundle -> ${BUNDLE_PATH}`);
console.log(run ? `subjects: ${agg.subjects.length} · verified-scored ${agg.totals.scored} · verified-correct ${agg.totals.correct} · overall cost/correct ${money(agg.totals.cost_per_verified_correct)}`
              : `no agent results yet — rendered ask-log fallback (${logEntries.length} entr${logEntries.length === 1 ? "y" : "ies"})`);
