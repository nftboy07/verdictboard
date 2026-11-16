# VerdictBoard — Milestone Update #2 (16 Nov 2026)

**The evaluator agent is built.** Update #1 shipped the live-proven scaffold (a real paid ask, a verified signal). This update ships the full batch agent described in the plan:

- **`evalset.json`** — the fixed public evaluation set: 6 tasks × 2 graded outputs across 4 subjects, with correct / partially-correct / deliberately-wrong outputs and desk ground truth, plus the unpaid break-it case (missing `output` param).
- **`agent.mjs`** — the batch evaluator: buys `LLM_OUTPUT_EVALUATION_GENERAL` per output through the same x402 flow as the live-proven server, with per-payment spend controls, a per-run spend limit, and a hard abort after 2 consecutive node 504s so a stalled node can't drain the run. Every call writes full evidence (request, receipt, signal hash, cost, duration, serving miner).
- **`publish.mjs`** — the leaderboard publisher: cost per verified correct answer per subject and overall, every row linked to its signal proof, plus the evidence bundle.
- **Bug found and fixed:** the server cached its derived account object, so a *second* paid ask in the same process would have thrown. The 11 Nov smoke test made exactly one ask, so it never fired — every retry would have. Fixed, with a regression test proving the payer still matches the recorded 11 Nov payer.
- **Offline mode** (`VERDICTBOARD_OFFLINE=1`): the full UI runs from the bundled ask log — the verified 11 Nov signal — with paid asks cleanly refused (503, nothing paid), so reviewers can explore the board even while the testnet node is unreachable.

**Honestly still owed, all network-dependent:** one live eval probe (the eval intent returned node 504s on 11 Nov), the first real agent run (`--spend-limit-usdc 0.50`; worst case $0.12 at floor prices), and the demo video. The testnet wallet holds ≈9.96 test USDC and ≈0.21 Sepolia ETH — no new funding needed. If the intent still 504s, the run self-aborts after two attempts and the settled-but-signalless payments become the documented blocker evidence, per this project's milestone rules.

Final submission via the H2 form by 1 Dec 2026, 23:59 UTC.
