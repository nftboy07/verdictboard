# Milestone Update #1 — VerdictBoard (Telegraph Hackathon Season II, Apps & Agents)

**STATUS: READY-TO-POST DRAFT — not yet posted anywhere.**
**Pinned channel: GitHub** (project repo update / GitHub Discussion under `nftboy07`).
Why GitHub: Official Rules §6 permits updates on "X, LinkedIn, GitHub, YouTube, articles,
videos, technical forums, Discord, or other relevant developer channels" — the channel is
the participant's choice, and §8 item 5 collects the update links in the final submission.
X is **not** required (see CHANNEL-PIN note in BUILD-NOTES.md / parent report).
**Owner action to post:** approve the GitHub write (approval card) when the parent pushes
this file to the public VerdictBoard repo (e.g. as `updates/001-milestone.md` or a repo
Discussion), or paste it into the Telegraph Discord build channel under dreamboy2658.
**Post by:** before the 14 Nov 2026 First Integration Milestone (target 13 Nov).

---

## 📣 VerdictBoard — Milestone Update #1: first paid Telegraph purchase, verified on-chain

*Disclosure: this project is an entry in the Telegraph Hackathon Season II (Apps & Agents
track, Mission 10 — Model Economy) and is competing for hackathon prizes. All activity
below is on the Telegraph **testnet** (Ethereum Sepolia); no mainnet funds are involved.*

I'm building **VerdictBoard**: an autonomous evaluator agent that *buys* evaluation
intelligence through Telegraph and publishes a leaderboard of Miners ranked by **cost per
verified correct answer** — every score linked to its `signal_hash`, so anyone can
re-verify it independently. Benchmarks are self-reported; receipts aren't.

### ✅ Done: a real machine-to-machine purchase, settled and verified

On 11 Nov I completed a paid Telegraph request end-to-end through the supported x402 flow:

- **Intent:** `CRYPTO_PRICE_USD` {symbol: BTC} (calibration/control intent)
- **Flow:** unpaid ask → HTTP 402 x402 challenge → signed EIP-712 payment → HTTP 200
- **Result:** BTC price 73,548.285 USD from Miner "Cp Coinbase", **cost $0.01**, 1,781 ms
- **Payment TX (Sepolia):** `0x06fb1983ec2577708c7f95945b565203f64c761daa2207ecb180e149dad20b78`
- **Receipt hash:** `0xb70401a374fca5d651afef1f5195ba7cd49bd7dc100db7cccc3f2fd97f2e96a4`
- **signal_hash:** `0xb9108125def640de8f2e46ca86ed3feccdd51756b53dc5e386d514ff338a0173`
- **Independent verification:** `GET /engine/v1/signal/{hash}` → **`verified: true`** ✅

Funds were testnet-only throughout: Sepolia ETH from a public faucet, and the freely
mintable test USDC on Sepolia. Spending is capped in code ($0.01 max per payment).

### 🔍 Two things I found that other builders should know

1. **Buy the child intent.** The parent intent `LLM_OUTPUT_EVALUATION` currently has
   **0 live Miners**. Its child **`LLM_OUTPUT_EVALUATION_GENERAL` has 14** (same
   `task`/`output` params, $0.01 floor). Always check `miner_count` on
   `GET /engine/v1/intents/{intent}` before wiring an intent into your app.
2. **The eval intent is timing out at the node right now — honestly.** I paid for
   `LLM_OUTPUT_EVALUATION_GENERAL` **twice**; both payments settled on-chain (TXs
   `0xe35154bd…4052ab3` and `0x2fb4e610…96bdcc8`, $0.01 each), but the node returned
   **HTTP 504** (gateway time-out, ~66 s) both times, so no signal came back, and the
   daemon feed showed no eval-intent signals in the surrounding two hours. I'm reporting
   this as-is: the purchase rail works, the eval route is currently slow/down, and
   VerdictBoard's eval step is built as a retry slot that activates when the node
   recovers. If you're building on this intent, you're not imagining it.

### 🛠️ What's next

- VerdictBoard front-end is live-wired to the daemon feed (`GET /daemon/api/questions`)
  and renders real verified signals from the testnet as they land.
- The evaluator loop (fixed public eval set → paid eval per output → verified-only
  leaderboard rows) slots in behind the retrying eval ask.
- Update #2 (mid-Nov): first paid leaderboard, or a follow-up on the eval-intent timeouts.

### 🔗 Try / verify it yourself

- Verify my signal: `GET https://devnode.telegraphprotocol.com/engine/v1/signal/0xb9108125def640de8f2e46ca86ed3feccdd51756b53dc5e386d514ff338a0173`
- Live feed: `GET https://devnode.telegraphprotocol.com/daemon/api/questions?since_hours=12&limit=10`
- Docs: https://anjoman.ai/docs/using/x402-inference · Missions: https://hackathon.telegraphprotocol.com/missions/model-economy

*Solo builder (Jacku P). Questions and reproductions welcome — the fastest way to help is
to run the verification call above and tell me what you get.*
