#!/usr/bin/env node
/**
 * VerdictBoard — local scaffold server (Telegraph Hackathon Season II).
 *
 * Serves the static front-end and provides the SERVER-SIDE paid-ask endpoint.
 * The testnet wallet key is read in-process from ../secrets/ and NEVER leaves
 * this process: it is never logged, never returned, never sent to the browser.
 * Client code (public/) contains no key material and cannot sign anything.
 *
 * Endpoints:
 *   GET  /              -> public/index.html (static app)
 *   GET  /api/health    -> passthrough of the node daemon health (free)
 *   GET  /api/feed      -> passthrough of GET {NODE}/daemon/api/questions (free)
 *   POST /api/ask       -> paid Telegraph ask via the x402 pattern from
 *                          ../telegraph-request.mjs (step 7). Body:
 *                          { intent, params, attempts? }
 *                          - CRYPTO_PRICE_USD        (control intent; works today)
 *                          - LLM_OUTPUT_EVALUATION_GENERAL (eval intent; retry slot —
 *                            the node currently 504s on it; each attempt is a real
 *                            $0.01 payment, attempts defaults to 1, max 3)
 *
 * Safety: binds 127.0.0.1 only; per-payment cap enforced by x402 spendControls
 * (max 100000 μUSDC = $0.10; floor is $0.01) AND a server-side run cap
 * (default $0.50 total per server process, VERDICTBOARD_RUN_CAP_UUSDC to change).
 * TESTNET ONLY (Ethereum Sepolia). No mainnet funds exist in this wallet.
 *
 * Run:  node server.mjs            (from this folder; deps resolve from ../node_modules)
 *       PORT=4317 node server.mjs
 */
import { createServer } from "node:http";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const NODE_BASE = "https://devnode.telegraphprotocol.com";
const SEPOLIA_CHAIN = "eip155:11155111";
const SEPOLIA_USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const PORT = Number(process.env.PORT ?? 4317);
const RUN_CAP_UUSDC = Number(process.env.VERDICTBOARD_RUN_CAP_UUSDC ?? 500_000); // $0.50
const HTTP_TIMEOUT_MS = 240_000; // node + this VM's egress proxy can be slow (504s seen at ~66 s)

const ALLOWED_INTENTS = new Set(["CRYPTO_PRICE_USD", "LLM_OUTPUT_EVALUATION_GENERAL"]);
let spentUusdc = 0; // payments the server believes settled (200s and post-payment failures)

const logDir = new URL("./data/", import.meta.url);
await mkdir(logDir, { recursive: true });
async function logAsk(entry) {
  try { await appendFile(new URL("ask-log.jsonl", logDir), JSON.stringify(entry) + "\n"); } catch {}
  console.log(new Date().toISOString(), "ask:", entry.intent, "http", entry.http_status, entry.note ?? "");
}

/* ---- wallet (lazy, in-process only) ------------------------------------ */
let _account = null;
function loadAccount() {
  if (_account) return _account;
  const envText = readFileSync(new URL("../secrets/telegraph-testnet-wallet.env", import.meta.url), "utf8");
  const m = envText.match(/^EVM_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
  if (!m) throw new Error("EVM_PRIVATE_KEY not found in ../secrets/telegraph-testnet-wallet.env");
  return m[1]; // caller wraps with privateKeyToAccount; value never leaves this module's callers
}
async function makePaidFetch() {
  const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(loadAccount());
  _account = account;
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: SEPOLIA_CHAIN, client: new ExactEvmScheme(account) }],
    spendControls: { allowedAssets: [{ network: SEPOLIA_CHAIN, asset: SEPOLIA_USDC, maxAmountPerPayment: "100000" }] },
  });
  return { fetchWithPayment, payer: account.address };
}

/* ---- one paid ask attempt ---------------------------------------------- */
async function paidAskOnce(intent, params) {
  const { fetchWithPayment, payer } = await makePaidFetch();
  const res = await fetchWithPayment(`${NODE_BASE}/engine/v1/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, params }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = null; }
  const decode = (v) => { try { return v ? JSON.parse(Buffer.from(v, "base64").toString()) : null; } catch { return null; } };
  const receipt = decode(res.headers.get("x-telegraph-receipt"));
  // Any non-402 response past the payment step means the $0.01 was authorised;
  // on 200 the receipt confirms settlement; on 504 (observed) the payment also
  // settled on-chain in both spike attempts. Count conservatively.
  if (res.status !== 402) spentUusdc += 10_000;
  let verification = null;
  const signalHash = body?.signal_hash ?? null;
  if (res.status === 200 && signalHash) {
    try {
      const v = await fetch(`${NODE_BASE}/engine/v1/signal/${signalHash}`, { signal: AbortSignal.timeout(60_000) });
      const vj = await v.json().catch(() => null);
      verification = { http_status: v.status, verified: vj?.verification?.verified ?? null, record: vj };
    } catch (e) { verification = { error: e.message }; }
  }
  return { http_status: res.status, payer, body: body ?? text.slice(0, 500), receipt, signal_hash: signalHash, verification };
}

/* ---- HTTP server --------------------------------------------------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
function sendJson(res, status, obj) { const t = JSON.stringify(obj, null, 2); res.writeHead(status, { "Content-Type": "application/json" }); res.end(t); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === "/api/health") {
      const r = await fetch(`${NODE_BASE}/daemon/health`, { signal: AbortSignal.timeout(60_000) });
      return sendJson(res, r.status, await r.json().catch(() => ({})));
    }
    if (url.pathname === "/api/feed") {
      const since = url.searchParams.get("since_hours") ?? "12";
      const limit = url.searchParams.get("limit") ?? "25";
      const r = await fetch(`${NODE_BASE}/daemon/api/questions?since_hours=${encodeURIComponent(since)}&limit=${encodeURIComponent(limit)}`, { signal: AbortSignal.timeout(60_000) });
      return sendJson(res, r.status, await r.json().catch(() => ({})));
    }
    if (url.pathname === "/api/ask" && req.method === "POST") {
      const chunks = []; for await (const c of req) chunks.push(c);
      const { intent, params, attempts = 1 } = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (!ALLOWED_INTENTS.has(intent)) return sendJson(res, 400, { error: `intent not allowed in scaffold: ${intent}` });
      if (!params || typeof params !== "object") return sendJson(res, 400, { error: "params object required" });
      const tries = Math.max(1, Math.min(3, Number(attempts) || 1));
      const history = [];
      for (let i = 0; i < tries; i++) {
        if (spentUusdc + 10_000 > RUN_CAP_UUSDC) {
          history.push({ note: `run spend cap reached (${spentUusdc} μUSDC of ${RUN_CAP_UUSDC}) — restart server or raise VERDICTBOARD_RUN_CAP_UUSDC` });
          break;
        }
        try {
          const out = await paidAskOnce(intent, params);
          const note = out.http_status === 200 ? "ok"
            : out.http_status === 504 ? "node gateway timeout AFTER payment settled — no signal returned (documented eval-intent behaviour 11 Nov); safe to retry later"
            : `http ${out.http_status}`;
          history.push({ ...out, note });
          await logAsk({ at: new Date().toISOString(), intent, params, http_status: out.http_status, signal_hash: out.signal_hash, receipt_hash: out.receipt?.receipt_hash ?? null, verified: out.verification?.verified ?? null, note });
          if (out.http_status === 200) return sendJson(res, 200, { ok: true, attempts: history, spent_uusdc: spentUusdc });
        } catch (e) {
          history.push({ error: e.message, note: "attempt failed client-side (timeout/transport) — payment state unknown; check ask-log + wallet before retrying" });
          await logAsk({ at: new Date().toISOString(), intent, params, http_status: null, error: e.message });
        }
      }
      const last = history[history.length - 1];
      return sendJson(res, 200, { ok: false, attempts: history, spent_uusdc: spentUusdc, note: last?.note ?? "no attempt made" });
    }
    // static
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[a-z0-9._-]+$/i.test(name)) return sendJson(res, 404, { error: "not found" });
    const data = await readFile(new URL(`./public/${name}`, import.meta.url));
    const ext = name.slice(name.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    return res.end(data);
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`VerdictBoard scaffold: http://127.0.0.1:${PORT}  (testnet only; run cap ${RUN_CAP_UUSDC} μUSDC)`));
