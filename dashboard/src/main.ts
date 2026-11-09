import { NearConnector } from "@hot-labs/near-connect";

const NETWORK = "testnet";
const TREASURY = "uzor-autopay.testnet";
const RPC_URL = "https://rpc.testnet.fastnear.com";
const AGENT_URL = "https://near-autopay-production.up.railway.app";
const EXPLORER = "https://testnet.nearblocks.io";
const YOCTO = BigInt("1000000000000000000000000");

function el(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function setStatus(message: string, isError: boolean): void {
  const s = el("status");
  s.textContent = message;
  s.className = isError ? "err" : "ok";
}

function formatNear(yocto: string): string {
  const big = BigInt(yocto);
  const whole = big / YOCTO;
  const frac = (big % YOCTO) / BigInt("100000000000000000000");
  return whole.toString() + "." + frac.toString().padStart(4, "0") + " NEAR";
}

function parseNear(text: string): string | null {
  if (!/^\d+(\.\d{1,24})?$/.test(text)) return null;
  const parts = text.split(".");
  const whole = BigInt(parts[0]) * YOCTO;
  const fracText = ((parts[1] || "") + "000000000000000000000000").slice(0, 24);
  return (whole + BigInt(fracText)).toString();
}

async function getBalance(accountId: string): Promise<string> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query",
        params: { request_type: "view_account", finality: "final", account_id: accountId },
      }),
    });
    const data: any = await res.json();
    if (data.result && data.result.amount) return formatNear(data.result.amount);
    return "unavailable";
  } catch (error) {
    return "unavailable";
  }
}

const connector = new NearConnector({ network: NETWORK });
let currentAccount: string | null = null;

async function showAccount(address: string | null): Promise<void> {
  currentAccount = address;
  el("connect").style.display = address ? "none" : "inline-block";
  el("disconnect").style.display = address ? "inline-block" : "none";
  if (!address) {
    el("account").textContent = "Not connected";
    return;
  }
  el("account").textContent = "Connected: " + address + " (loading balance...)";
  const balance = await getBalance(address);
  el("account").textContent = "Connected: " + address + " | Balance: " + balance;
}

async function addressOf(wallet: any, accounts?: any[]): Promise<string | null> {
  if (accounts && accounts.length > 0) {
    const a: any = accounts[0];
    return typeof a === "string" ? a : a.accountId;
  }
  if (wallet && typeof wallet.getAccounts === "function") {
    const list: any = await wallet.getAccounts();
    if (list && list.length > 0) return list[0].accountId || list[0];
  }
  if (wallet && typeof wallet.getAddress === "function") {
    return await wallet.getAddress();
  }
  return null;
}

connector.on("wallet:signIn", async (event: any) => {
  console.log("signIn event", event);
  const address = await addressOf(event.wallet, event.accounts);
  await showAccount(address);
});

connector.on("wallet:signOut", async () => {
  await showAccount(null);
});

async function restoreSession(): Promise<void> {
  try {
    const wallet = await connector.wallet();
    const address = await addressOf(wallet);
    await showAccount(address);
  } catch (error) {
    // not signed in yet
  }
}

async function refreshBalances(): Promise<void> {
  el("treasury-balance").textContent = await getBalance(TREASURY);
  if (currentAccount) await showAccount(currentAccount);
}

async function deposit(): Promise<void> {
  if (!currentAccount) {
    setStatus("Connect a wallet first.", true);
    return;
  }
  const yocto = parseNear((el("amount") as HTMLInputElement).value.trim());
  if (!yocto || yocto === "0") {
    setStatus("Enter an amount greater than 0.", true);
    return;
  }
  try {
    setStatus("Approve the transaction in your wallet...", false);
    const wallet = await connector.wallet();
    const result: any = await wallet.signAndSendTransaction({
      receiverId: TREASURY,
      actions: [{ type: "Transfer", params: { deposit: yocto } }],
    });
    const hash = result && result.transaction ? result.transaction.hash : "";
    setStatus("Deposit sent.", false);
    if (hash) {
      const a = document.createElement("a");
      a.href = EXPLORER + "/txns/" + hash;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = " View on explorer";
      el("status").appendChild(a);
    }
    await refreshBalances();
  } catch (error) {
    setStatus("Deposit cancelled or failed: " + String(error), true);
  }
}

function table(headers: string[], rows: (string | HTMLElement)[][]): HTMLElement {
  const t = document.createElement("table");
  const head = document.createElement("tr");
  headers.forEach(function (h) {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  t.appendChild(head);
  rows.forEach(function (r) {
    const tr = document.createElement("tr");
    r.forEach(function (c) {
      const td = document.createElement("td");
      if (typeof c === "string") td.textContent = c;
      else td.appendChild(c);
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  return t;
}

async function loadAgent(): Promise<void> {
  try {
    const res = await fetch(AGENT_URL + "/api/status");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data: any = await res.json();

    const rec = el("recipients");
    rec.textContent = "";
    rec.appendChild(
      table(
        ["Account", "Amount per period"],
        data.recipients.map(function (r: any) {
          return [r.account_id, formatNear(r.amount)];
        })
      )
    );

    const his = el("history");
    his.textContent = "";
    if (data.history.length === 0) {
      his.textContent = "No payments recorded yet.";
    } else {
      his.appendChild(
        table(
          ["Period", "Status", "Time (UTC)", "Transaction"],
          data.history.map(function (h: any) {
            let tx: string | HTMLElement = "-";
            if (h.txHash) {
              const a = document.createElement("a");
              a.href = EXPLORER + "/txns/" + h.txHash;
              a.target = "_blank";
              a.rel = "noopener";
              a.textContent = String(h.txHash).slice(0, 10) + "...";
              tx = a;
            }
            return [h.period, h.status, h.at, tx];
          })
        )
      );
    }
  } catch (error) {
    el("recipients").textContent = "Agent data not available yet.";
    el("history").textContent = "Agent data not available yet.";
  }
}

const treasuryLink = el("treasury-link") as HTMLAnchorElement;
treasuryLink.href = EXPLORER + "/address/" + TREASURY;
treasuryLink.textContent = TREASURY;

el("connect").addEventListener("click", function () {
  connector.connect();
});
el("disconnect").addEventListener("click", function () {
  connector.disconnect();
});
el("deposit").addEventListener("click", function () {
  deposit();
});

refreshBalances();
loadAgent();
restoreSession();
