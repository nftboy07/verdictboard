# VerdictBoard — BUILD NOTES (scaffold, 11 Nov 2026)

## Channel pin (milestone/progress updates) — verdict

Re-read of the official rules (https://hackathon.telegraphprotocol.com/rules, 11 Nov 2026)
and timeline page:

- **No single mandated channel exists.** Rules §3 defines the 14 Nov milestone only as
  content: *"Show your first working Telegraph intelligence request or purchase, an
  attempt, or what is blocking you. This is a progress check, not a submission deadline
  or a disqualification rule."* It names no channel, form, or account.
- Rules §8 ("Share your progress"): *"Aim for at least three useful public updates on
  separate dates during the competition… Share with relevant developers on X, LinkedIn,
  YouTube, GitHub, blogs, and technical communities."*
- Rules §6 (growth rubric, 20 pts): *"A participant may use X, LinkedIn, GitHub,
  YouTube, articles, videos, technical forums, Discord, or other relevant developer
  channels. Tag @Telegraphprotoc on X where applicable…"*
- Rules §8 item 5: the final submission collects *"links to your original H2 updates"*.
- Rules §1: *"Final entries go through the H2 website."*

⇒ **X is optional** (one item in a disjunctive channel list; the @Telegraphprotoc tag
applies only "on X where applicable"). The standing no-X-posting order does **not**
conflict with the rules. **Pinned channel: GitHub** (updates live in the public project
repo; links are collected at final submission). Discord (entrant: dreamboy2658) is an
equally valid alternative/supplement.

Draft milestone update: `../MILESTONE-UPDATE-1.md` — DRAFT ONLY, nothing posted.
Owner action to publish: one GitHub approval-card tap when the parent pushes the repo,
or paste into the Telegraph Discord under the owner's account.

## Scaffold — what was built

- `server.mjs` — zero-framework Node server (deps resolve from `../node_modules`):
  static hosting + `/api/health`, `/api/feed` passthroughs + server-side paid
  `POST /api/ask` using the exact x402 pattern/spend controls of
  `../telegraph-request.mjs`. Key loaded in-process from `../secrets/`, never
  logged/returned. Run cap $0.50/process; every ask appended to `data/ask-log.jsonl`.
- `public/index.html` / `app.js` / `style.css` — feed renderer (direct node call,
  CORS `*` verified; proxy fallback), paid-ask panels for the control intent and
  the eval retry slot, verified-only leaderboard (localStorage, cost-per-verified-
  correct-answer aggregate, "correct" = eval score ≥ 0.8 scaffold convention).

## Smoke test — LIVE, 11 Nov 2026 (~09:24 UTC)

| Check | Result |
|---|---|
| `node --check` server + app.js | ✅ pass |
| `GET /` , `/app.js`, `/style.css` | ✅ 200 |
| `GET /api/health` | ✅ `{"status":"ok"}` from live node |
| `GET /api/feed?since_hours=1&limit=2` | ✅ total=30; first item = our own paid signal `0xb91081…a0173` |
| Feed endpoint CORS (direct browser path) | ✅ `Access-Control-Allow-Origin: *` |
| `POST /api/ask` CRYPTO_PRICE_USD {BTC} | ✅ **HTTP 200 in 17.4 s** — miner Cp Coinbase, BTC $73,620.665, cost $0.01; signal `0x6b6a32da1b7fd3fb4c9237366b48e2bd74df5e718bdd66f1d8b44a2c9046ce8e`; receipt `0x677377d6…e42581d`, settlement TX `0xc4bf5c09…0923ee`; **verification `verified: true`**; full result in `smoke-ask-result.json`, log line in `data/ask-log.jsonl` |
| Key hygiene | ✅ grep of `public/` for key material: clean |

## Stubbed / next

- Eval intent: wired end-to-end but the node 504s it (11 Nov, both spike attempts);
  retry is 1 attempt/click deliberately (each attempt is a real $0.01 payment even
  when the node times out). No eval smoke payment was burned in this scaffold run.
- Leaderboard persistence is browser localStorage; the fixed public eval set,
  batch agent (`agent.mjs` per ../SUBMISSION.md §4), public repo + hosted page,
  and the 2–5 min demo video remain for the build phase before 1 Dec 23:59 UTC.
- Wallet after smoke test: ≈9.96 test USDC / ≈0.21 Sepolia ETH (one $0.01 ask spent).

## Build finish — status (16 Nov 2026, offline session; VM egress down)

Audit + build pass over the scaffold. Eval retry wiring left exactly as
designed (front-end always sends `attempts: 1`). No live requests fired.

**Bug found & fixed:** `server.mjs` cached the derived account object in the
same variable `loadAccount()` returned, so the *second* paid ask in a process
passed an account object to `privateKeyToAccount()` and threw. The 11 Nov
smoke test made exactly one ask, so it never fired — but every retry attempt
and every second UI ask would have. Fixed with separate `_key` / `_paid`
caches (+ `EVM_PRIVATE_KEY` env support, secrets-file fallback). Regression
test (verbatim fixed functions, two `makePaidFetch()` calls): PASS, payer
matches the recorded 11 Nov payer; no key material printed.

### Done (offline-verified 16 Nov)
- `evalset.json` — fixed public eval set per ../SUBMISSION.md §3: 6 tasks × 2
  graded outputs, 4 subjects, correct/partial/wrong mix with desk ground
  truth, + unpaid break-it case (missing `output`). Schema-validated.
- `agent.mjs` — batch agent per ../SUBMISSION.md §4 (x402 pattern + $0.10
  per-payment spendControls identical to server; run spend limit; aborts
  after 2 consecutive 504s; full per-call evidence; writes
  `data/agent-results.json` + `data/agent-runs/<stamp>.json`; appends to
  `data/ask-log.jsonl`). `--dry-run` PASS (set valid, key located, no calls).
- `publish.mjs` — leaderboard publisher. `--self-test` 9/9 PASS (verified-only
  scoring, settled-504 spend counting, unattempted = no spend, ranking).
  Fallback render from bundled `data/ask-log.jsonl` generated
  `public/leaderboard.html` + `public/evidence-bundle.json`, honestly
  labelled "No batch-agent run yet".
- `server.mjs` offline mode (`VERDICTBOARD_OFFLINE=1`) + `GET /api/log` +
  malformed-JSON → 400 (was 500). Offline smoke test PASS: `/`, `/app.js`,
  `/style.css`, `/leaderboard.html` 200; `/api/health` offline; `/api/feed`
  serves the bundled log (total=1, our verified smoke signal); `/api/log`
  returns the entry; `POST /api/ask` → 503, nothing paid. Live-mode bad JSON
  → 400, disallowed intent → 400 (both answered before any network call).
- `package.json` + `.env.example` (deps/versions match the working tree;
  SUBMISSION.md §4's reviewer flow now has the files it references).
- Front-end: "Recent asks from this rig" section fed by `/api/log`; board
  section links `leaderboard.html`.
- `node --check` PASS on server.mjs, agent.mjs, publish.mjs, public/app.js.
  Key-hygiene grep of `public/`: clean. Tests did not mutate
  `data/ask-log.jsonl` (still the single 11 Nov line) and fabricated no
  agent results.

### Done but UNTESTED-LIVE (written carefully, syntax-checked, never fired)
- `agent.mjs` live path: paid eval loop, signal verification, 504
  abort-after-2, spend-limit cut-off, results writing. Uses the identical
  x402 config as the live-proven server path, but no live eval ask has ever
  returned from this node, so the 200-branch is unproven end-to-end.
- Break-it invalid-params test (expects pre-payment HTTP 400 per
  ../SUBMISSION.md §4; records the actual status if the node differs).
- `publish.mjs` rendering of a real agent run (math self-tested on synthetic
  rows; HTML path exercised only via the ask-log fallback).
- Front-end `/api/log` rendering in a real browser (endpoint JSON verified
  via curl; app.js syntax-checked).

### Still blocked on network
- Whether the eval intent still 504s — the open question since 11 Nov.
- First real `agent.mjs` run → first real leaderboard (12 graded outputs,
  worst case $0.12 at floor).
- Demo video with live rows; the H2 submission itself.
- Wallet unchanged since 11 Nov: ≈9.96 test USDC / ≈0.21 Sepolia ETH.
