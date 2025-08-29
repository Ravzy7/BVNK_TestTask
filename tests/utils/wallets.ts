import { expect } from '@playwright/test';
import { writeJson, readJsonSafe } from './fs';

export async function fetchWallets(ctx: any) {
  const { apiCtx, token, dataFile } = ctx;
  const resp = await apiCtx.get('/api/wallet', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  const wallets = (Array.isArray(data) ? data : data?.items || data?.data || []);
  const compact = wallets.reduce((acc: any, w: any) => {
    const code = String(w?.currency?.code || '').toUpperCase();
    if (!code) return acc;
    acc[code] = {
      id: String(w.id),
      balance: String(w.balance),
      available: String(w.available),
      status: String(w.status),
      protocol: String(w.protocol),
      pfx: code,
    };
    return acc;
  }, {});
  const prev = readJsonSafe(dataFile, {});
  writeJson(dataFile, { ...prev, wallets: compact });
}

