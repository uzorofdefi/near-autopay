import * as dotenv from "dotenv";
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import cron from 'node-cron';
import BN from 'bn.js';
import * as rawNearAPI from 'near-api-js';

// Unwrap the CommonJS module whether tsx puts it in .default or not
const nearAPI = (rawNearAPI as any).default || rawNearAPI;
const { connect, keyStores, KeyPair } = nearAPI;

interface WorkerPayout {
  account_id: string;
  amount: string;
}

interface PeriodRecord {
  status: 'pending' | 'paid' | 'failed';
  at: string;
  txHash?: string;
}

const PAYROLL_SCHEDULE: WorkerPayout[] = [
  { account_id: 'bob.testnet', amount: '10000000000000000000000' },
  { account_id: 'alice.testnet', amount: '10000000000000000000000' },
];

// ---------- Settings (all can be changed from environment variables) ----------
// Default: 9am on the 1st of each month. For a demo, set CRON_SCHEDULE="*/5 * * * *"
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 9 1 * *';
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'UTC';
// On a server, point STATE_FILE at a persistent volume, e.g. /data/autopay-state.json
const STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), '.autopay-state.json');

// ---------- Duplicate-payment guard ----------
function currentPeriod(): string {
  // e.g. "2026-11" (UTC)
  return new Date().toISOString().slice(0, 7);
}

function loadState(): Record<string, PeriodRecord> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state: Record<string, PeriodRecord>): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ---------- Payroll ----------
async function executePayroll(): Promise<void> {
  console.log('🤖 [NEAR AutoPay Agent] Triggering scheduled payroll execution...');

  const networkId: string = process.env.NEAR_NETWORK || 'testnet';
  const agentAccountId = process.env.AGENT_ACCOUNT_ID;
  const agentPrivateKey = process.env.AGENT_PRIVATE_KEY;
  const treasuryContractId = process.env.TREASURY_CONTRACT_ID;

  if (!agentAccountId || !agentPrivateKey || !treasuryContractId) {
    console.error('❌ Missing environment configuration (AGENT_ACCOUNT_ID, AGENT_PRIVATE_KEY, TREASURY_CONTRACT_ID).');
    return;
  }

  const force = process.env.FORCE === 'true';
  const period = currentPeriod();
  const state = loadState();
  const existing = state[period];

  if (existing && existing.status === 'paid' && !force) {
    console.log('⏭️  Period ' + period + ' already paid (tx ' + existing.txHash + '). Skipping.');
    return;
  }

  if (existing && existing.status === 'pending' && !force) {
    console.warn(
      '⚠️  Period ' + period + ' is marked PENDING. A previous run may have sent the payment. ' +
      'Check the transaction on the explorer, then edit ' + STATE_FILE + ' before retrying.'
    );
    return;
  }

  // Mark pending BEFORE sending, so a crash cannot lead to a second payment
  state[period] = { status: 'pending', at: new Date().toISOString() };
  saveState(state);

  try {
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(agentPrivateKey);
    await keyStore.setKey(networkId, agentAccountId, keyPair);

    const near = await connect({
      networkId,
      keyStore,
      nodeUrl: process.env.NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com',
    });

    const agentAccount = await near.account(agentAccountId);

    console.log('📡 Sending batch payout transaction to Treasury (' + treasuryContractId + ')...');

    const result: any = await agentAccount.functionCall({
      contractId: treasuryContractId,
      methodName: 'batch_payout',
      args: { payouts: PAYROLL_SCHEDULE },
      gas: new BN('300000000000000'),
      attachedDeposit: new BN('0'),
    });

    const txHash = result?.transaction?.hash;
    state[period] = { status: 'paid', at: new Date().toISOString(), txHash };
    saveState(state);

    console.log('✅ Batch Payout Successful!');
    console.log('🔗 Transaction Hash: ' + txHash);
    console.log('🔎 Explorer: https://testnet.nearblocks.io/txns/' + txHash);
  } catch (error) {
    // Marked failed so it can be retried. If the error was a timeout, check the
    // explorer first: the transaction may have landed anyway.
    state[period] = { status: 'failed', at: new Date().toISOString() };
    saveState(state);
    console.error('❌ Error executing payroll transaction:', error);
  }
}

console.log('⚡️ NEAR AutoPay Agent daemon started. Waiting for schedule trigger...');

// Test mode: RUN_NOW=true npx tsx src/index.ts   (add FORCE=true to ignore the guard)
if (process.env.RUN_NOW === 'true') {
  executePayroll();
} else {
  if (!cron.validate(CRON_SCHEDULE)) {
    console.error('❌ Invalid CRON_SCHEDULE: ' + CRON_SCHEDULE);
    process.exit(1);
  }
  console.log('🕘 Schedule: "' + CRON_SCHEDULE + '" (' + CRON_TIMEZONE + ')');
  cron.schedule(CRON_SCHEDULE, async () => {
    await executePayroll();
  }, { timezone: CRON_TIMEZONE });
}