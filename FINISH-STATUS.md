# VerdictBoard — FINISH STATUS (16 Nov 2026)

**One line:** the build is finished and offline-verified; everything left is
network-dependent execution and submission mechanics, due by the final
deadline (H2 form by **1 Dec 2026, 23:59 UTC** per ../SUBMISSION.md; brief's
outer date 2 Dec 2026).

## Built and verified offline (16 Nov)
- Scaffold server + UI (live-proven 11 Nov: paid control ask, `verified: true`).
- **Bug fixed:** wallet/account cache collision that would have thrown on every
  second paid ask in a server process. Regression test PASS.
- `evalset.json` — fixed public eval set (6 tasks × 2 outputs, 4 subjects,
  ground-truth labels, unpaid break-it case). Dry-run validated.
- `agent.mjs` — batch agent (spend limit, 504 abort-after-2, per-call evidence,
  signal verification, `data/agent-results.json`). Dry-run PASS.
- `publish.mjs` — leaderboard + evidence bundle. Aggregation self-test 9/9 PASS;
  ask-log fallback page generated (`public/leaderboard.html`).
- Server offline mode (`VERDICTBOARD_OFFLINE=1`) + `/api/log`: smoke test PASS
  (statics 200, feed/health/log from bundled data, paid asks refuse 503).
- `package.json`, `.env.example`; `node --check` clean on all JS; no key
  material in `public/`; ask-log untouched by tests. Details: BUILD-NOTES.md.

## Still needed for the final submission (in order)
1. **One live eval probe (network):** when egress/the node cooperate, fire ONE
   eval retry from the UI slot (existing wiring, $0.01) to learn whether
   `LLM_OUTPUT_EVALUATION_GENERAL` still 504s.
2. **First real agent run (network):** `node agent.mjs --spend-limit-usdc 0.50`
   (12 graded outputs; worst case $0.12 at floor + free break-it case), then
   `node publish.mjs` for the real leaderboard. If the intent still 504s, the
   run aborts itself after 2 and the settled-but-signalless payments become
   the documented blocker evidence instead.
3. **Demo video (2–5 min, ../SUBMISSION.md §7 outline):** record in the final
   week. Strongest with live verified rows from step 2; offline mode can carry
   the narration if the node is still down, but say so on camera.
4. **Public updates:** pinned channel is GitHub (BUILD-NOTES); rules ask for
   ≥3 updates on separate dates — #1 went out with the repo; add #2 (first
   paid leaderboard, after step 2) and #3 (final results + tutorial) before
   submitting, and collect their links for the form.
5. **Verify the bounties-repo star at submission time:** ../SUBMISSION.md §1
   still flags the `telegraphprotocol/bounties` star by `nftboy07` as "still
   to be done" while desk records elsewhere say starred — re-check live and
   fix whichever record is wrong; the star is required for every track.
6. **Fill the ⚠️ fields in ../SUBMISSION.md** (reviewer-access link = public
   repo + hosted leaderboard page; showcase permission = owner's call) and
   submit through the H2 website. Nothing else in the draft is open.
7. **Wallet:** ≈9.96 test USDC / ≈0.21 Sepolia ETH (unchanged since 11 Nov) —
   ample for steps 1–2; no funding action needed.

## Honest limits
- No live eval ask has ever succeeded against this node (two paid attempts
  504'd on 11 Nov, payments settled, no signal). The entry stands on the
  live-proven control intent + the documented eval blocker if step 1–2 fail
  again; rules §3 accepts "an attempt, or what is blocking you" for the
  milestone, and the final narrative in ../SUBMISSION.md already states the
  testnet/504 position plainly.
- `agent.mjs`'s 200-branch and `publish.mjs`'s real-run render are
  UNTESTED-LIVE (syntax-checked, dry-run/self-test verified only).
