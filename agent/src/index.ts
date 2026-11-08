import * as dotenv from "dotenv";
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
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
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 9 1 * *';
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'UTC';
const STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), '.autopay-state.json');
const RPC_URL = process.env.NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const EXPLORER = process.env.NEAR_NETWORK === 'mainnet'
  ? 'https://nearblocks.io'
  : 'https://testnet.nearblocks.io';

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
      nodeUrl: RPC_URL,
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
    console.log('🔎 Explorer: ' + EXPLORER + '/txns/' + txHash);
  } catch (error) {
    // Marked failed so it can be retried. If the error was a timeout, check the
    // explorer first: the transaction may have landed anyway.
    state[period] = { status: 'failed', at: new Date().toISOString() };
    saveState(state);
    console.error('❌ Error executing payroll transaction:', error);
  }
}

// ---------- Public status page (for judges and demos) ----------
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNear(yocto: string): string {
  const big = BigInt(yocto);
  const base = BigInt('1000000000000000000000000');
  const whole = big / base;
  const frac = (big % base) / BigInt('100000000000000000000');
  return whole.toString() + '.' + frac.toString().padStart(4, '0');
}

async function getBalance(accountId: string): Promise<string> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query',
        params: { request_type: 'view_account', finality: 'final', account_id: accountId },
      }),
    });
    const data: any = await res.json();
    const yocto = data && data.result ? data.result.amount : undefined;
    if (!yocto) return 'unavailable';
    return formatNear(yocto) + ' NEAR';
  } catch {
    return 'unavailable';
  }
}

async function renderStatusPage(): Promise<string> {
  const treasury = process.env.TREASURY_CONTRACT_ID || '(not set)';
  const balance = process.env.TREASURY_CONTRACT_ID ? await getBalance(treasury) : 'unavailable';
  const state = loadState();
  const periods = Object.keys(state).sort().reverse();

  const workerRows = PAYROLL_SCHEDULE.map(function (w) {
    return '<tr><td>' + escapeHtml(w.account_id) + '</td><td>' + formatNear(w.amount) + ' NEAR</td></tr>';
  }).join('');

  const historyRows = periods.length === 0
    ? '<tr><td colspan="4">No payments recorded yet.</td></tr>'
    : periods.map(function (p) {
        const r = state[p];
        const tx = r.txHash
          ? '<a href="' + EXPLORER + '/txns/' + escapeHtml(r.txHash) + '" target="_blank" rel="noopener">' +
            escapeHtml(r.txHash.slice(0, 10)) + '...</a>'
          : '-';
        return '<tr><td>' + escapeHtml(p) + '</td><td>' + escapeHtml(r.status) + '</td><td>' +
          escapeHtml(r.at) + '</td><td>' + tx + '</td></tr>';
      }).join('');

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>NEAR AutoPay</title>',
    '<style>',
    'body{font-family:system-ui,sans-serif;background:#0b0f1a;color:#e8ecf5;margin:0;padding:24px;}',
    '.wrap{max-width:760px;margin:0 auto;}',
    'h1{margin:0 0 4px;font-size:28px;} .sub{color:#9aa6c2;margin-bottom:24px;}',
    '.card{background:#141a2b;border:1px solid #232c47;border-radius:12px;padding:16px 20px;margin-bottom:16px;}',
    '.card h2{margin:0 0 10px;font-size:16px;color:#9aa6c2;font-weight:600;}',
    'table{width:100%;border-collapse:collapse;} td,th{text-align:left;padding:8px 6px;border-bottom:1px solid #232c47;font-size:14px;}',
    'a{color:#6cc4ff;} .ok{color:#4ade80;font-weight:600;}',
    '</style></head><body><div class="wrap">',
    '<h1>NEAR AutoPay</h1>',
    '<div class="sub">Autonomous payroll agent: a scheduled agent triggers batch payouts from an on-chain treasury.</div>',
    '<div class="card"><h2>Agent status</h2><span class="ok">Running</span> &middot; schedule "' +
      escapeHtml(CRON_SCHEDULE) + '" (' + escapeHtml(CRON_TIMEZONE) + ')</div>',
    '<div class="card"><h2>Treasury</h2>Account: <a href="' + EXPLORER + '/address/' + escapeHtml(treasury) +
      '" target="_blank" rel="noopener">' + escapeHtml(treasury) + '</a><br>Balance: ' + escapeHtml(balance) + '</div>',
    '<div class="card"><h2>Payroll recipients</h2><table><tr><th>Account</th><th>Amount per period</th></tr>' +
      workerRows + '</table></div>',
    '<div class="card"><h2>Payment history</h2><table><tr><th>Period</th><th>Status</th><th>Time (UTC)</th><th>Transaction</th></tr>' +
      historyRows + '</table></div>',
    '<div class="sub">Network: ' + escapeHtml(process.env.NEAR_NETWORK || 'testnet') +
      '. Each period can be paid only once: the agent records it before sending.</div>',
    '</div></body></html>',
  ].join('');
}

function startStatusServer(): void {
  const server = http.createServer(async function (req, res) {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    try {
      const html = await renderStatusPage();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('status page error');
    }
  });
  server.listen(PORT, '0.0.0.0', function () {
    console.log('🌐 Status page listening on port ' + PORT);
  });
}

// ---------- Start ----------
console.log('⚡️ NEAR AutoPay Agent daemon started. Waiting for schedule trigger...');
console.log('🔑 Agent key: ' + (process.env.AGENT_PRIVATE_KEY ? KeyPair.fromString(process.env.AGENT_PRIVATE_KEY).getPublicKey().toString() : 'not set'));

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
  startStatusServer();
}