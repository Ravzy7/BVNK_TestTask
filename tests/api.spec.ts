import { test, expect, request, APIRequestContext } from '@playwright/test';

const BASE_URL = 'http://bvnksimulator.pythonanywhere.com';
const INIT_ENDPOINT = '/init';
const WALLETS_ENDPOINT = '/api/wallet';

let apiCtx: APIRequestContext;
let authToken: string;

test.describe('BVNK API tests', () => {

  test.beforeAll(async () => {
    // Create one API context for all tests
    apiCtx = await request.newContext({ baseURL: BASE_URL });

    // --- Call /init ---
    let resp = await apiCtx.post(INIT_ENDPOINT).catch(() => null as any);
    if (!resp || !resp.ok()) {
      resp = await apiCtx.get(INIT_ENDPOINT);
    }
    expect(resp.ok(), `Init failed: ${resp?.status()} ${resp?.statusText()}`).toBeTruthy();

    const data = await resp.json();
    console.log('Init response:', data);

    // Basic assertions
    expect(typeof data.access_token).toBe('string');
    expect(data.access_token.length).toBeGreaterThan(0);
    expect(data.token_type.toLowerCase()).toBe('bearer');
    expect(typeof data.expiry).toBe('number');
    expect(data.expiry).toBeGreaterThan(0);

    // Save the token for later tests
    authToken = data.access_token;
  });

  test.afterAll(async () => {
    await apiCtx.dispose();
  });

  // --- Test 1: Init endpoint explicitly ---
  test('Init endpoint returns valid token payload', async () => {
    expect(typeof authToken).toBe('string');
    expect(authToken.length).toBeGreaterThan(0);
  });

  // --- Test 2: Wallets endpoint using the token ---
  test('Wallets endpoint returns user wallets', async () => {
    const resp = await apiCtx.get(WALLETS_ENDPOINT, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(resp.ok(), `Wallets failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const json = await resp.json();
    console.log('Wallets response:', JSON.stringify(json, null, 2));

    // Defensive checks
    expect(Array.isArray(json) || typeof json === 'object').toBeTruthy();
  });
});
