# NEAR AutoPay

**Automated, on-chain payroll for the NEAR blockchain.** A scheduled agent runs 24/7 in the cloud and triggers batch payouts from a treasury smart contract, so workers get paid on time without anyone pressing a button. A founder dashboard lets you connect a wallet, fund the treasury, and see the payroll and payment history.

**Built for NEAR HACKATHON 2026**: primary track *Real-World Money*, secondary track *Autonomous Business* (details below).

## Links

| | |
|---|---|
| **Demo video** | VIDEO_URL_HERE |
| **Founder dashboard (live)** | https://near-autopay-dashboard.vercel.app |
| **Agent status page (live)** | https://near-autopay-production.up.railway.app |
| **Source code** | https://github.com/uzorofdefi/near-autopay |
| **Network** | NEAR testnet |
| **Treasury contract account** | `uzor-autopay.testnet` ([explorer](https://testnet.nearblocks.io/address/uzor-autopay.testnet)) |
| **License** | MIT |

## The problem

Paying a team in crypto is manual and easy to get wrong: someone has to remember payday, send each transfer, and make sure nobody is paid twice. NEAR AutoPay removes that work. Funds sit in a treasury contract, and an agent releases them on a schedule.

## What it does

- **Scheduled payroll.** The agent runs on a cron schedule (default: 9am UTC on the 1st of every month) and calls the treasury contract's `batch_payout` method.
- **Batch payouts.** One transaction pays every recipient on the payroll list.
- **Duplicate-payment guard.** Before sending, the agent records the pay period as pending. A period that is already paid (or stuck pending after a crash) is never paid again, even after restarts, because the record is stored on a persistent volume.
- **Founder dashboard.** Connect a NEAR wallet, see the treasury balance and your own balance, deposit NEAR into the treasury (signed in your wallet), and view the payroll recipients and payment history with explorer links.
- **Public status page and JSON API.** The agent serves a status page and a read-only `/api/status` endpoint, so anyone can verify each payout on the NEAR block explorer.
- **Runs unattended.** Deployed on Railway, with secrets kept in environment variables, never in the repository.

## Built with

| Part | Technology |
|---|---|
| Treasury smart contract | TypeScript with **near-sdk-js** (NEAR JavaScript SDK) 2.x |
| Payroll agent | Node.js, TypeScript (run with tsx), **near-api-js** 4.x, node-cron, dotenv, bn.js |
| Founder dashboard | Vite, TypeScript, **NEAR Connect** (`@hot-labs/near-connect`), `@near-js/providers`, `@near-js/utils` |
| Blockchain access | NEAR testnet via the FastNEAR RPC; NEAR block explorer (nearblocks.io) |
| Hosting | Agent on Railway (with a persistent volume), dashboard on Vercel |

## How it works

```
cron schedule -> Agent (Node.js / TypeScript) -> Treasury contract (NEAR) -> Worker accounts
                     |
                     +-> state file on a persistent volume (one payment per period)
                     +-> status page and /api/status (treasury, schedule, recipients, history)

Founder dashboard (Vite + NEAR Connect) -> wallet signs deposits to the treasury
                                        -> reads balances from NEAR RPC and payroll data from /api/status
```

1. At the scheduled time the agent checks its record for the current month.
2. If the month is not already paid, it marks the month as pending, then signs and sends `batch_payout` to the treasury contract.
3. The contract transfers the funds to each recipient.
4. The agent records the transaction hash, and the status page and dashboard show it with an explorer link.

## Try it ("do X, see Y")

No login or account is needed for steps 1 to 3.

1. **Do:** open the [founder dashboard](https://near-autopay-dashboard.vercel.app).
   **See:** the treasury balance, the payroll recipients (`bob.testnet` and `alice.testnet`, 0.0100 NEAR each), and a payment history with `2026-11` marked `paid` and a transaction link.
2. **Do:** click the transaction link in the payment history.
   **See:** the NEAR block explorer page with status **Success**, a `batch_payout` call on `uzor-autopay.testnet`, and transfers to `bob.testnet` and `alice.testnet` (open the **Receipts** tab).
3. **Do:** open the [agent status page](https://near-autopay-production.up.railway.app), then `/api/status` on the same address.
   **See:** the agent's schedule (`0 9 1 * *`, UTC), the recipients, and the same payment history as JSON. This is the live agent running in the cloud.
4. **Do:** (needs a NEAR testnet wallet with some testnet NEAR; tested with Meteor Wallet) click **Connect wallet** on the dashboard, enter `0.1`, click **Deposit**, and approve it in your wallet. Check that the receiver is `uzor-autopay.testnet`.
   **See:** "Deposit sent" with an explorer link, and the treasury balance rises by 0.1 NEAR.
5. **Do:** run the agent locally (see below) with `RUN_NOW=true npm start` twice.
   **See:** the first run sends the payout (or reports an error from the contract); the second run prints `already paid ... Skipping`, because each month can only be paid once.

The agent pays on its schedule using a restricted key that is not public. The payout recorded in the history (with its explorer link) shows the full flow: agent, treasury contract, and workers.

## Repository layout

| Folder | What it contains |
|---|---|
| `agent/` | The scheduled payroll agent, status page and JSON API |
| `contract/` | The treasury smart contract with the `batch_payout` method (near-sdk-js) |
| `dashboard/` | The founder dashboard |

## Run the agent locally

Requirements: Node.js 20 or newer, and a NEAR testnet account with permission to call the treasury contract.

```bash
cd agent
npm install
```

Create `agent/.env` (this file is git-ignored; never commit it):

```
AGENT_ACCOUNT_ID=your-agent.testnet
AGENT_PRIVATE_KEY=ed25519:...
TREASURY_CONTRACT_ID=your-treasury.testnet
```

Run it once, immediately, instead of waiting for the schedule:

```bash
RUN_NOW=true npm start
```

Run it as a daemon with the status page on http://localhost:3000:

```bash
npm start
```

### Optional settings

| Variable | Default | Purpose |
|---|---|---|
| `CRON_SCHEDULE` | `0 9 1 * *` | When payroll runs (cron syntax) |
| `CRON_TIMEZONE` | `UTC` | Timezone for the schedule |
| `STATE_FILE` | `.autopay-state.json` | Where paid periods are recorded (use a persistent volume on a server) |
| `NEAR_RPC_URL` | FastNEAR testnet RPC | NEAR RPC endpoint |
| `FORCE` | unset | Set to `true` to ignore the duplicate-payment guard (testing only) |

## Run the dashboard locally

```bash
cd dashboard
npm install
npm run dev
```

Open http://localhost:5173. The treasury account and agent address are set at the top of `dashboard/src/main.ts`.

## Security notes

- Secrets live only in environment variables. `.env`, the state file and key files are git-ignored.
- The server runs with a restricted function-call access key: it can only call `batch_payout` on the treasury contract, with a limited gas allowance. It cannot transfer funds directly or change the account.
- The full-access key is kept offline and is never deployed.
- The pay period is recorded before the transaction is sent, so a crash cannot lead to a second payment, and the record is stored on a persistent volume.
- The dashboard never handles keys. Deposits are signed inside the user's wallet.
- This is a testnet project. Before handling real funds, also enforce the one-payment-per-period rule inside the contract.

## Roadmap

- Store the worker list on-chain, so the agent reads the current payroll instead of a fixed list, and founders can add and remove workers from the dashboard.
- Enforce one payout per period inside the contract.
- Pay in stablecoins (USDC) and accept funding from any chain through NEAR Intents.
- Mainnet deployment (the restricted agent key is already used on testnet).

## Hackathon track

Built for **NEAR HACKATHON 2026**.

**Primary track: Real-World Money.** This track asks for payroll, invoicing and payment rails that a real business could use. NEAR AutoPay is payroll: a company funds an on-chain treasury, and the agent pays every worker on schedule in one batch transaction, with a dashboard to fund the treasury and see exactly who was paid and when.

**Secondary track: Autonomous Business.** The agent manages treasury payments on its own, inside limits set by humans: a fixed payroll list, a fixed schedule, a restricted access key that can only call `batch_payout` with a limited gas allowance, and a guard that makes a double payment impossible for the same month.

**Honest scope:** payouts are in native NEAR on testnet. The agent is deterministic, rule-based automation and does not use an LLM, which keeps its behavior predictable and auditable. Stablecoin payouts and cross-chain funding through NEAR Intents are on the roadmap.

## License

MIT. See [LICENSE](LICENSE).