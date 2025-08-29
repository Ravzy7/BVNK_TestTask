import { expect } from '@playwright/test';
import { readJsonSafe, writeJson } from './fs';

export async function createQuote(ctx: any, from: string, to: string, amountIn: number) {
  const { apiCtx, token, dataFile } = ctx;
  const data = readJsonSafe(dataFile, {}) as { wallets?: Record<string, { id: string | number }> };
  const fromWallet = data.wallets?.[from];
  const toWallet = data.wallets?.[to];

  expect(fromWallet && fromWallet.id).toBeTruthy();
  expect(toWallet && toWallet.id).toBeTruthy();

  if (!fromWallet || !fromWallet.id) {
    throw new Error(`fromWallet is undefined or missing id for key: ${from}`);
  }
  if (!toWallet || !toWallet.id) {
    throw new Error(`toWallet is undefined or missing id for key: ${to}`);
  }

  const payload = {
    from, to,
    fromWallet: Number(fromWallet.id),
    toWallet: Number(toWallet.id),
    useMaximum: true,
    useMinimum: true,
    reference: `e2e-${Date.now()}`,
    amountIn, amountOut: 0,
    payInMethod: from,
    payOutMethod: to,
  };

  const resp = await apiCtx.post('/api/v1/quote', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: payload,
  });

  expect(resp.ok()).toBeTruthy();
  const quote = await resp.json();
  const uuid = quote?.uuid || quote?.quoteUuid;
  expect(uuid).toBeTruthy();

  writeJson(dataFile, { ...data, lastQuoteUuid: uuid });
}

export async function acceptLastQuote(ctx: any) {
  const { apiCtx, token, dataFile } = ctx;
  const { lastQuoteUuid } = readJsonSafe(dataFile, {}) as { lastQuoteUuid?: string };
  expect(lastQuoteUuid).toBeTruthy();

  const acceptUrl = `/api/v1/quote/accept/${encodeURIComponent(String(lastQuoteUuid))}`;
  const resp = await apiCtx.put(acceptUrl, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  expect(resp.ok()).toBeTruthy();
  const body = await resp.json();

  const status = body?.status || body?.state || body?.quoteStatus || body?.data?.status;
  expect(status).toBeTruthy();
  expect(String(status).toLowerCase()).toBe('accepted');

  const fee = Number(body?.fees?.percentage?.service);
  expect(Number.isFinite(fee)).toBeTruthy();
  expect(Math.abs(fee - 0.01)).toBeLessThanOrEqual(1e-9);
}