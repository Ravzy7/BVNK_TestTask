// Refactored entry point test: tests/api/bvnk.spec.ts
import { test, expect } from '@playwright/test';
import { getAuthContext } from '../fixtures/bvnk';
import * as wallets from '../utils/wallets';
import * as quotes from '../utils/quotes';
import * as balances from '../utils/balances';
import * as dotenv from 'dotenv';
dotenv.config();

// Grouped tests for BVNK simulator API
// Each test uses the shared auth fixture from bvnk.ts

test.describe.configure({ mode: 'serial' });

test.describe('BVNK Flow: ETH → TRX → USDT → ETH', () => {
  let authCtx: Awaited<ReturnType<typeof getAuthContext>>;

  test.beforeAll(async () => {
    authCtx = await getAuthContext();
  });

  test('WALLETS: fetch and store wallet info', async () => {
    await wallets.fetchWallets(authCtx);
  });

  test('QUOTE: ETH → TRX', async () => {
    await quotes.createQuote(authCtx, 'ETH', 'TRX', 1);
  });

  test('ACCEPT: ETH → TRX', async () => {
    await quotes.acceptLastQuote(authCtx);
  });

  test('BALANCE: ETH decreased by 1', async () => {
    await balances.expectBalanceDecrease(authCtx, 'ETH', 1);
  });

  test('TRX: refresh wallet balance', async () => {
    await balances.refreshWallet(authCtx, 'TRX');
  });

  test('QUOTE: TRX → USDT', async () => {
    await quotes.createQuote(authCtx, 'TRX', 'USDT', 420);
  });

  test('ACCEPT: TRX → USDT', async () => {
    await quotes.acceptLastQuote(authCtx);
  });

  test('BALANCE: TRX decreased by 420', async () => {
    await balances.expectBalanceDecrease(authCtx, 'TRX', 420);
  });

  test('USDT: refresh wallet balance', async () => {
    await balances.refreshWallet(authCtx, 'USDT');
  });

  test('QUOTE: TRX → ETH', async () => {
    await quotes.createQuote(authCtx, 'TRX', 'ETH', 987);
  });

  test('ACCEPT: TRX → ETH', async () => {
    await quotes.acceptLastQuote(authCtx);
  });

  test('BALANCE: TRX decreased by 987', async () => {
    await balances.expectBalanceDecrease(authCtx, 'TRX', 987);
  });

  test('ETH: refresh wallet balance', async () => {
    await balances.refreshWallet(authCtx, 'ETH');
  });

  test('QUOTE: ETH → USDT (0.5)', async () => {
    await quotes.createQuote(authCtx, 'ETH', 'USDT', 0.5);
  });

  test('ACCEPT: ETH → USDT', async () => {
    await quotes.acceptLastQuote(authCtx);
  });

  test('BALANCE: ETH decreased by 0.5', async () => {
    await balances.expectBalanceDecrease(authCtx, 'ETH', 0.5);
  });

  test('USDT: refresh wallet balances', async () => {
    await balances.refreshWallet(authCtx, 'USDT');
  });

  test('QUOTE: USDT → TRX (1000)', async () => {
    await quotes.createQuote(authCtx, 'USDT', 'TRX', 1000);
  });

  test('ACCEPT: USDT → TRX', async () => {
    await quotes.acceptLastQuote(authCtx);
  });

  test('BALANCE: USDT decreased by 1000', async () => {
    await balances.expectBalanceDecrease(authCtx, 'USDT', 1000);
  });

  test('TRX: refresh wallet balance (after USDT trade)', async () => {
    await balances.refreshWallet(authCtx, 'TRX');
  });
});