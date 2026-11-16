# VerdictBoard — scaffold

The evaluator agent that prices Miner correctness (Telegraph Hackathon Season II,
Apps & Agents · Mission 10 — Model Economy). It buys evaluation intelligence through
Telegraph and ranks Miners by **cost per verified correct answer**, with every score
linked to its `signal_hash` for independent re-verification.

## Run it (testnet only)

```bash
# Prerequisites: Node.js >= 20. From the telegraph-hackathon/ folder, deps are
# already installed (@x402/fetch, @x402/evm, viem). The server reads the
# TESTNET-ONLY wallet key from ../secrets/telegraph-testnet-wallet.env —
# it never reaches the browser.
cd verdictboard
node server.mjs            # http://127.0.0.1:4317  (PORT=xxxx to change)
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

## Safety

- Server binds 127.0.0.1 only. Per-payment cap $0.10 via x402 spendControls
  (floor is $0.01); server-side run cap $0.50 per process
  (`VERDICTBOARD_RUN_CAP_UUSDC`). Every ask is appended to `data/ask-log.jsonl`.
- The private key is loaded in-process from `../secrets/` and is never logged,
  returned, or present in `public/` (verified by grep in the smoke test).

## Known limitations

- Testnet only (mainnet Jan 2027). Eval-intent scoring waits on the node fixing
  its 504s. Leaderboard persistence is browser-local in the scaffold; the fixed
  public eval set + batch agent run come next (see ../SUBMISSION.md §3–4).
