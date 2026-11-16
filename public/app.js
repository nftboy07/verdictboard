// VerdictBoard front-end (scaffold). No keys, no signing — paid asks go to the
// local server (server.mjs), which holds the testnet wallet server-side only.
const NODE = "https://devnode.telegraphprotocol.com";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

/* ---- node health -------------------------------------------------------- */
fetch(`${NODE}/daemon/health`)
  .then((r) => r.json())
  .then((j) => { $("node-status").textContent = j.status === "ok" ? "ok ✅" : JSON.stringify(j); })
  .catch(() => { $("node-status").textContent = "unreachable from browser (feed falls back to server proxy)"; });

/* ---- live daemon feed ----------------------------------------------------- */
async function loadFeed() {
  const qs = "since_hours=12&limit=25";
  let data = null;
  try { const r = await fetch(`${NODE}/daemon/api/questions?${qs}`); data = await r.json(); }
  catch { try { const r = await fetch(`/api/feed?${qs}`); data = await r.json(); } catch {} }
  if (!data) { $("feed").textContent = "Feed unavailable right now."; return; }
  $("feed-total").textContent = data.total ?? "?";
  $("feed").innerHTML = (data.results ?? []).map((s) => `
    <article class="sig">
      <div class="sig-head">
        <span class="intent">${esc(s.routing?.intent ?? "?")}</span>
        <span class="miner">${esc(s.routing?.subnet_name ?? "")}</span>
        <span class="status ${esc(s.status)}">${esc(s.status)}</span>
      </div>
      <div class="sig-q">${esc(s.question?.text ?? "")}</div>
      <div class="sig-meta">
        cost $${esc(s.execution?.cost_usd ?? "?")} · ${esc(s.execution?.duration_ms ?? "?")} ms ·
        ${esc(s.created_at ?? "")} ·
        signal <a href="${NODE}/engine/v1/signal/${esc(s.signal_hash)}" target="_blank" rel="noopener">${short(s.signal_hash)}</a>
      </div>
    </article>`).join("") || "No signals in window.";
}
loadFeed();
setInterval(loadFeed, 30_000);

/* ---- paid asks (via local server) ---------------------------------------- */
async function fireAsk(intent, params, outEl) {
  outEl.innerHTML = "Asking… (unpaid 402 → signed payment → result; the node can take a while)";
  try {
    const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, params, attempts: 1 }) });
    const j = await r.json();
    const a = (j.attempts ?? [])[j.attempts.length - 1] ?? {};
    if (j.ok) {
      const b = a.body ?? {};
      const result = b.result ? `<pre>${esc(JSON.stringify(b.result, null, 1))}</pre>` : "";
      outEl.innerHTML = `✅ <strong>HTTP 200</strong> · miner ${esc(b.miner_name ?? b.miner_id ?? "")} · cost $${esc(b.cost_usd ?? "?")} · ${esc(b.duration_ms ?? "?")} ms<br>
        signal <a href="${NODE}/engine/v1/signal/${esc(a.signal_hash)}" target="_blank" rel="noopener">${short(a.signal_hash)}</a> ·
        verified: <strong>${a.verification?.verified === true ? "true ✅" : esc(a.verification?.verified ?? "n/a")}</strong><br>
        receipt_hash ${short(a.receipt?.receipt_hash)}${result}`;
      return { ok: true, body: b, attempt: a };
    }
    outEl.innerHTML = `⚠️ <strong>HTTP ${esc(a.http_status ?? "?")}</strong> — ${esc(j.note ?? a.note ?? a.error ?? "failed")}`;
    return { ok: false, attempt: a };
  } catch (e) {
    outEl.innerHTML = `❌ Local server error: ${esc(e.message)} (is server.mjs running?)`;
    return { ok: false };
  }
}

$("cp-fire").addEventListener("click", () =>
  fireAsk("CRYPTO_PRICE_USD", { symbol: ($("cp-symbol").value || "BTC").toUpperCase() }, $("cp-out")));

/* ---- leaderboard (verified eval rows, this browser) ----------------------- */
const CORRECT_THRESHOLD = 0.8; // scaffold convention: eval score >= 0.8 counts as "correct"
function boardRows() { try { return JSON.parse(localStorage.getItem("vb-rows") || "[]"); } catch { return []; } }
function renderBoard() {
  const rows = boardRows();
  const tbl = $("board-table");
  if (!rows.length) { tbl.hidden = true; $("board-summary").textContent = "No verified eval rows yet — the eval intent must answer first."; return; }
  const spent = rows.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const correct = rows.filter((r) => (r.score ?? 0) >= CORRECT_THRESHOLD).length;
  $("board-summary").innerHTML = `Rows: ${rows.length} · verified-correct: ${correct} · total spent $${spent.toFixed(2)} · <strong>cost per verified correct answer: ${correct ? "$" + (spent / correct).toFixed(4) : "— (no correct answers yet)"}</strong>`;
  tbl.hidden = false;
  tbl.querySelector("tbody").innerHTML = rows.map((r) => `<tr>
    <td>${esc(r.at)}</td><td>${esc(r.task)}</td><td>${esc(r.score)}</td><td>$${esc(r.cost_usd)}</td>
    <td><a href="${NODE}/engine/v1/signal/${esc(r.signal_hash)}" target="_blank" rel="noopener">${short(r.signal_hash)}</a></td>
    <td>${r.verified ? "true ✅" : "no"}</td></tr>`).join("");
}
renderBoard();

$("ev-fire").addEventListener("click", async () => {
  const task = $("ev-task").value, output = $("ev-output").value;
  const res = await fireAsk("LLM_OUTPUT_EVALUATION_GENERAL", { task, output }, $("ev-out"));
  if (res.ok && res.attempt?.verification?.verified === true) {
    const result = res.body?.result ?? {};
    const rows = boardRows();
    rows.unshift({ at: new Date().toISOString(), task, score: result.score ?? null, cost_usd: res.body?.cost_usd ?? 0.01, signal_hash: res.attempt.signal_hash, verified: true });
    localStorage.setItem("vb-rows", JSON.stringify(rows));
    renderBoard();
  }
});

/* ---- local ask log (server-side record; renders even when the node is down) */
async function loadLog() {
  const el = $("log-list");
  try {
    const r = await fetch("/api/log");
    const j = await r.json();
    const entries = j.entries ?? [];
    if (!entries.length) { el.textContent = "No asks logged yet."; return; }
    el.innerHTML = entries.slice().reverse().map((e) => `
      <div>${esc(e.at)} · <strong>${esc(e.intent)}</strong> · HTTP ${esc(e.http_status ?? "—")} ·
      ${e.signal_hash ? `signal <a href="${NODE}/engine/v1/signal/${esc(e.signal_hash)}" target="_blank" rel="noopener">${short(e.signal_hash)}</a> · ` : ""}
      verified: ${e.verified === true ? "true ✅" : esc(e.verified ?? "—")}${e.note ? ` · ${esc(e.note)}` : ""}</div>`).join("");
  } catch { el.textContent = "Local ask log unavailable (is server.mjs running?)"; }
}
loadLog();
