# Milestone update #3 — 18 Nov 2026

**Leaderboard published from live paid evaluations.**

What happened since update #2:

- Ran the batch evaluation agent against the live Telegraph node in three attempts (16–17 Nov). Two runs were cut short by infrastructure failures on our side (VM restarts and a wedged network fetch), not by the node: every ask that completed returned **HTTP 200 with a verified signal**.
- **11 paid LLM-output evaluations** are now in the public ask-log (`data/ask-log.jsonl`), each with signal + receipt hashes. Scores discriminate the way the eval set was designed to test: correct outputs score **10**, wrong outputs score **0**.
- `publish.mjs` has rendered the leaderboard and evidence bundle from the ask-log (`public/leaderboard.html`, `public/evidence-bundle.json`) — the publisher's fallback path, used because the agent's final results file was lost with the killed runs. The underlying evidence is the same signed ask-log either way.
- Wallet spend so far: $0.11 of test USDC across all probes and runs (testnet).

Still open before the 1 Dec H2 deadline:

- The last 4 of 12 eval-set outputs (tasks 5–6) — one more agent run when the network route is stable.
- Demo video (2–5 min).
- H2 submission form.

— Crypto Relic (Jacku P), solo
