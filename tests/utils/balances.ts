import { expect } from '@playwright/test';
import { wait, readJsonSafe, writeJson, formatLike } from './fs';

export async function expectBalanceDecrease(ctx: any, currency: string, decreaseBy: number) {
  const { apiCtx, token, dataFile } = ctx;
  const prevData = readJsonSafe(dataFile, {}) as { wallets?: Record<string, any> };
  const wallet = prevData.wallets?.[currency];
  expect(wallet && wallet.id && wallet.balance).toBeTruthy();

  const walletUrl = `/api/wallet/${encodeURIComponent(wallet.id)}`;
  const prevBalance = parseFloat(wallet.balance);
  let currentBalance: number | null = null;

  for (let i = 0; i < 5; i++) {
    const resp = await apiCtx.get(walletUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    const bal = Number(body?.balance ?? body?.available);
    if (Number.isFinite(bal) && Math.abs(prevBalance - bal - decreaseBy) <= 1e-6) {
      currentBalance = bal;
      break;
    }
    await wait(1000);
  }

  expect(currentBalance).toBeTruthy();
  const newBalStr = formatLike(wallet.balance, currentBalance!);

  const updated = readJsonSafe(dataFile, {}) as { wallets?: Record<string, any> };
  updated.wallets = updated.wallets || {};
  updated.wallets[currency] = {
    ...updated.wallets[currency],
    balance: newBalStr,
    available: newBalStr,
  };
  writeJson(dataFile, updated);
}

export async function refreshWallet(ctx: any, currency: string) {
  const { apiCtx, token, dataFile } = ctx;
  const data = readJsonSafe(dataFile, {}) as { wallets?: Record<string, any> };
  data.wallets = data.wallets || {};
  const wallet = data.wallets?.[currency];
  expect(wallet?.id).toBeTruthy();

  const walletUrl = `/api/wallet/${encodeURIComponent(wallet.id)}`;
  const resp = await apiCtx.get(walletUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(resp.ok()).toBeTruthy();

  const body = await resp.json();
  const bal = body?.balance ?? body?.available;
  expect(bal).toBeTruthy();

  data.wallets[currency] = {
    ...wallet,
    balance: String(bal),
    available: String(bal),
    status: wallet.status ?? body.status,
    protocol: wallet.protocol ?? body.protocol,
    pfx: wallet.pfx ?? currency,
  };
  writeJson(dataFile, data);
}