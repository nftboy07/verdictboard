# VerdictBoard

The evaluator agent that prices Miner correctness (Telegraph Hackathon Season II,
Apps & Agents · Mission 10 — Model Economy). It buys evaluation intelligence through
Telegraph and ranks Miners by **cost per verified correct answer**, with every score
linked to its `signal_hash` for independent re-verification.

## Run it (testnet only)

```bash
# Prerequisites: Node.js >= 20. Deps: @x402/fetch, @x402/evm, viem (see
# package.json — in the desk's working tree they resolve from ../node_modules).
# The wallet key comes from the EVM_PRIVATE_KEY env var, or from
# ../secrets/telegraph-testnet-wallet.env in the working tree (see .env.example).
# It never reaches the browser.
cd verdictboard
node server.mjs            # http://127.0.0.1:4317  (PORT=xxxx to change)

# Batch agent over the fixed public eval set (SUBMISSION.md §3–4):
node agent.mjs --dry-run                       # validate eval set + plan, no network
node agent.mjs --spend-limit-usdc 0.50         # live run -> data/agent-results.json
node publish.mjs                               # -> public/leaderboard.html + evidence-bundle.json

# Offline demo (node/network unreachable): bundled ask-log only, asks disabled
VERDICTBOARD_OFFLINE=1 node server.mjs
```

Open the page: the live daemon feed renders immediately (free, no payment).
"Fire paid ask" runs a real $0.01 testnet purchase through the local server.

## What works today

- **Live feed:** page reads `GET /daemon/api/questions` from the live testnet node
  directly (the endpoint serves `Access-Control-Allow-Origin: *`), with an automatic
  fallback to the server's `/api/feed` proxy.
- **Paid ask (control intent `CRYPTO_PRICE_USD`):** full x402 flow server-side
  (402 → signed EIP-712 payment → 200 → receipt → `GET /engine/v1/signal/{hash}`
  verification), same pattern + spend controls as `../telegraph-request.mjs`.
  Smoke-tested live 11 Nov 2026 — see BUILD-NOTES.md.
- **Eval intent retry slot (`LLM_OUTPUT_EVALUATION_GENERAL`):** same paid path;
  the node 504'd on both paid attempts on 11 Nov (payments settled, no signal).
  One attempt per click by design; successful verified evals land in the
  leaderboard (browser localStorage) automatically.
- **Batch agent + fixed eval set (`agent.mjs` / `evalset.json`, built 16 Nov):**
  6 tasks × 2 graded outputs across 4 subjects (correct/partial/wrong mix with
  desk ground truth) + the unpaid break-it case (missing `output` param, must be
  refused before payment). Spend limit enforced; aborts after 2 consecutive 504s
  so a stalled node can't drain the run. Writes `data/agent-results.json`.
  Dry-run validated offline; the live run waits on the node (see BUILD-NOTES).
- **Publisher (`publish.mjs`, built 16 Nov):** renders the public leaderboard
  (per-subject + overall cost per verified correct answer) to
  `public/leaderboard.html` + `public/evidence-bundle.json`. Aggregation
  self-test passes; with no agent run yet it renders the verified ask log and
  says so plainly.
- **Offline mode (`VERDICTBOARD_OFFLINE=1`):** `/api/health` reports offline,
  `/api/feed` serves the bundled `data/ask-log.jsonl`, `/api/ask` refuses with
  503 — nothing paid, nothing faked. Plus `GET /api/log` (this rig's own asks)
  rendered in the page in both modes.

## Safety

- Server binds 127.0.0.1 only. Per-payment cap $0.10 via x402 spendControls
  (floor is $0.01); server-side run cap $0.50 per process
  (`VERDICTBOARD_RUN_CAP_UUSDC`). Every ask is appended to `data/ask-log.jsonl`.
- The private key is loaded in-process from `../secrets/` and is never logged,
  returned, or present in `public/` (verified by grep in the smoke test).

## Known limitations

- Testnet only (mainnet Jan 2027). Eval-intent scoring waits on the node fixing
  its 504s. The interactive leaderboard's persistence is browser-local; the
  batch agent + publisher (built 16 Nov) produce the durable public board —
  their first live run is still owed (see BUILD-NOTES.md status section and
  FINISH-STATUS.md).
