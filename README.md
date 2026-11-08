# NEAR AutoPay

**Automated, on-chain payroll for the NEAR blockchain.** A scheduled agent runs 24/7 in the cloud and triggers batch payouts from a treasury smart contract, so workers get paid on time without anyone pressing a button.

- **Live status page:** LIVE_URL_HERE
- **Demo video:** VIDEO_URL_HERE
- **Network:** NEAR testnet
- **License:** MIT

## The problem

Paying a team in crypto is manual and easy to get wrong: someone has to remember payday, send each transfer, and make sure nobody is paid twice. NEAR AutoPay removes that work. Funds sit in a treasury contract, and an agent releases them on a schedule.

## What it does

- **Scheduled payroll.** The agent runs on a cron schedule (default: 9am UTC on the 1st of every month) and calls the treasury contract's `batch_payout` method.
- **Batch payouts.** One transaction pays every recipient on the payroll list.
- **Duplicate-payment guard.** Before sending, the agent records the pay period as pending. A period that is already paid (or stuck pending after a crash) is never paid again, even after restarts, because the record is stored on a persistent volume.
- **Public status page.** A live page shows the treasury account and balance, the schedule, the recipients, and the payment history with links to the NEAR block explorer, so anyone can verify each payout.
- **Runs unattended.** Deployed on Railway with secrets kept in environment variables, never in the repository.

## How it works

```
cron schedule  ->  Agent (Node.js / TypeScript)  ->  Treasury contract (NEAR)  ->  Worker accounts
                         |
                         +-> state file on a persistent volume (one payment per period)
                         +-> status page (treasury, balance, history, explorer links)
```

1. At the scheduled time the agent checks its record for the current month.
2. If the month is not already paid, it marks the month as pending, then signs and sends `batch_payout` to the treasury contract.
3. The contract transfers the funds to each recipient.
4. The agent records the transaction hash, and the status page shows it with an explorer link.

## Repository layout

| Folder | What it contains |
|---|---|
| `agent/` | The scheduled payroll agent and the status page (TypeScript, node-cron, near-api-js) |
| `contract/` | The treasury smart contract with the `batch_payout` method (TypeScript) |

## Run the agent locally

Requirements: Node.js 20 or newer, and a NEAR testnet account that has been funded and has permission to call the treasury contract.

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

## Security notes

- Secrets live only in environment variables. `.env` and the state file are git-ignored.
- The pay period is recorded before the transaction is sent, so a crash cannot lead to a second payment.
- This is a testnet project. Before using it with real funds, use a separate agent account that holds only enough NEAR for gas, restrict its access key to the `batch_payout` method on the treasury contract, and enforce the one-payment-per-period rule inside the contract as well.

## Roadmap

- Store the worker list on-chain, so the agent reads the current payroll instead of a fixed list.
- Founder dashboard: connect a wallet, deposit into the treasury, and add or remove workers.
- Enforce one payout per period inside the contract.
- Mainnet deployment with a restricted function-call access key for the agent.

## Hackathon track

TRACK_AND_PRIZE_DETAILS_HERE

## License

MIT. See [LICENSE](LICENSE).