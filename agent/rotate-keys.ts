import * as dotenv from "dotenv";
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import BN from 'bn.js';
import * as rawNearAPI from 'near-api-js';

const nearAPI = (rawNearAPI as any).default || rawNearAPI;
const { connect, keyStores, KeyPair } = nearAPI;

const RPC_URL = process.env.NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com';
const networkId = process.env.NEAR_NETWORK || 'testnet';
const KEYS_DIR = path.join(process.cwd(), '.keys');
const FULL_FILE = path.join(KEYS_DIR, 'full-access.txt');
const RESTRICTED_FILE = path.join(KEYS_DIR, 'agent-restricted.txt');

async function getAccount(privateKey: string, accountId: string): Promise<any> {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(networkId, accountId, KeyPair.fromString(privateKey));
  const near = await connect({ networkId, keyStore, nodeUrl: RPC_URL });
  return near.account(accountId);
}

function listOf(res: any): any[] {
  return Array.isArray(res) ? res : (res && res.keys ? res.keys : []);
}

// STEP 1: create two new keys and add them to the account.
// The old key (from .env) signs this. Nothing is removed, so nothing can be lost.
async function addKeys(): Promise<void> {
  const accountId = process.env.AGENT_ACCOUNT_ID;
  const oldKey = process.env.AGENT_PRIVATE_KEY;
  const treasury = process.env.TREASURY_CONTRACT_ID;
  if (!accountId || !oldKey || !treasury) {
    console.error('Missing AGENT_ACCOUNT_ID, AGENT_PRIVATE_KEY or TREASURY_CONTRACT_ID in .env');
    process.exit(1);
  }
  if (fs.existsSync(FULL_FILE) || fs.existsSync(RESTRICTED_FILE)) {
    console.error('Key files already exist in .keys. Not creating new ones. Remove them only if you are sure.');
    process.exit(1);
  }

  const fullKey = KeyPair.fromRandom('ed25519');
  const restrictedKey = KeyPair.fromRandom('ed25519');

  // Save the private keys to disk BEFORE adding them on-chain, so they can never be lost
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(FULL_FILE, fullKey.toString() + '\n', { mode: 0o600 });
  fs.writeFileSync(RESTRICTED_FILE, restrictedKey.toString() + '\n', { mode: 0o600 });

  const account = await getAccount(oldKey, accountId);

  // New full-access key (for you only, never put it on a server)
  await account.addKey(fullKey.getPublicKey().toString());
  console.log('Added full-access key:  ' + fullKey.getPublicKey().toString());

  // Restricted key for the agent: can only call batch_payout on the treasury, gas allowance 1 NEAR
  await account.addKey(
    restrictedKey.getPublicKey().toString(),
    treasury,
    'batch_payout',
    new BN('1000000000000000000000000')
  );
  console.log('Added restricted key:   ' + restrictedKey.getPublicKey().toString());

  console.log('');
  console.log('Done. Private keys were saved in the .keys folder (never share or screenshot them).');
  console.log('The old key is still active. Nothing has been removed.');
}

// STEP 2: remove the old key. Signed with the NEW full-access key, so if the new key
// does not work this simply fails and the old key stays in place.
async function removeOld(oldPublicKey: string | undefined): Promise<void> {
  const accountId = process.env.AGENT_ACCOUNT_ID;
  if (!accountId || !oldPublicKey) {
    console.error('Usage: npx tsx rotate-keys.ts remove-old ed25519:OLD_PUBLIC_KEY');
    process.exit(1);
  }
  if (!fs.existsSync(FULL_FILE) || !fs.existsSync(RESTRICTED_FILE)) {
    console.error('Key files not found in .keys. Run the add step first.');
    process.exit(1);
  }

  const fullStr = fs.readFileSync(FULL_FILE, 'utf8').trim();
  const restrictedStr = fs.readFileSync(RESTRICTED_FILE, 'utf8').trim();
  const fullPublic = KeyPair.fromString(fullStr).getPublicKey().toString();
  const restrictedPublic = KeyPair.fromString(restrictedStr).getPublicKey().toString();

  if (oldPublicKey === fullPublic || oldPublicKey === restrictedPublic) {
    console.error('Refusing: the key you asked to remove is one of the NEW keys.');
    process.exit(1);
  }

  const account = await getAccount(fullStr, accountId);
  const keys = listOf(await account.getAccessKeys());

  const hasFull = keys.some(function (k: any) {
    return k.public_key === fullPublic && k.access_key.permission === 'FullAccess';
  });
  const hasRestricted = keys.some(function (k: any) {
    return k.public_key === restrictedPublic && typeof k.access_key.permission === 'object';
  });
  const hasOld = keys.some(function (k: any) { return k.public_key === oldPublicKey; });

  if (!hasFull || !hasRestricted) {
    console.error('Safety check failed: the new keys are not both registered on the account. Nothing was removed.');
    process.exit(1);
  }
  if (!hasOld) {
    console.log('The old key is not on the account (already removed). Nothing to do.');
    return;
  }

  await account.deleteKey(oldPublicKey);
  console.log('Removed old key: ' + oldPublicKey);
  console.log('Remaining keys: new full-access key and the restricted agent key.');
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'add') {
    await addKeys();
  } else if (mode === 'remove-old') {
    await removeOld(process.argv[3]);
  } else {
    console.log('Usage:');
    console.log('  npx tsx rotate-keys.ts add');
    console.log('  npx tsx rotate-keys.ts remove-old ed25519:OLD_PUBLIC_KEY');
  }
}

main().catch(function (err) {
  console.error('Failed:', err);
  process.exit(1);
});
