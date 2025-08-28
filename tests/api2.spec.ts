// tests/api/wallets-and-trade.spec.ts
import { test, expect, request, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://bvnksimulator.pythonanywhere.com';
const INIT_ENDPOINT = '/init';
const WALLETS_ENDPOINT = '/api/wallet';
const QUOTE_URL = 'https://bvnksimulator.pythonanywhere.com/api/v1/quote';

const DATA_DIR = path.resolve(process.cwd(), 'testdata');
const DATA_FILE = path.join(DATA_DIR, 'testdata.json');

let apiCtx: APIRequestContext;
let authToken: string | null = null;

// ---------- FS helpers ----------
function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}
function readJsonSafe<T = any>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeJson(filePath: string, obj: any) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  console.log(`✅ Wrote JSON: ${filePath}`);
}

test.describe.configure({ mode: 'serial' });

test.describe('BVNK API → each call as its own test', () => {
  test.beforeAll(async () => {
    apiCtx = await request.newContext({ baseURL: BASE_URL });
    ensureDir(DATA_DIR);
    if (!fs.existsSync(DATA_FILE)) writeJson(DATA_FILE, { wallets: {} });
  });

  test.afterAll(async () => {
    await apiCtx.dispose();
  });

  // 1) INIT — get bearer token
  test('INIT: retrieve bearer token', async () => {
    let resp = await apiCtx.post(INIT_ENDPOINT).catch(() => null as any);
    if (!resp || !resp.ok()) resp = await apiCtx.get(INIT_ENDPOINT);

    expect(resp.ok(), `Init failed: ${resp?.status()} ${resp?.statusText()}`).toBeTruthy();
    const data = await resp.json();
    authToken = data.access_token;
    console.log('Init response:', JSON.stringify(data, null, 2));

    expect(typeof authToken).toBe('string');
    expect((authToken as string).length).toBeGreaterThan(10);
  });

  // 2) WALLETS — fetch & save to testdata/testdata.json (wallets only)
  test('WALLETS: fetch and persist selected fields to JSON (wallets only)', async () => {
    expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

    const resp = await apiCtx.get(WALLETS_ENDPOINT, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(resp.ok(), `Wallets failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const payload = await resp.json();
    const wallets: any[] = Array.isArray(payload)
      ? payload
      : (payload?.items ?? payload?.data ?? []);

    console.log('Wallets response:', JSON.stringify(payload, null, 2));
    expect(Array.isArray(wallets)).toBeTruthy();

    const compact = wallets.reduce<Record<string, any>>((acc, w) => {
      const code = String(w?.currency?.code ?? '').toUpperCase();
      if (!code) return acc;
      acc[code] = {
        id: String(w.id ?? ''),
        balance: String(w.balance ?? ''),
        available: String(w.available ?? ''),
        status: String(w.status ?? ''),
        protocol: String(w.protocol ?? ''),
        pfx: String(w?.currency?.code ?? ''),
      };
      return acc;
    }, {});

    const existing = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
      DATA_FILE,
      { wallets: {} }
    );

    const next = {
      ...('lastQuoteUuid' in existing ? { lastQuoteUuid: existing.lastQuoteUuid } : {}),
      wallets: { ...(existing.wallets ?? {}), ...compact },
    };

    writeJson(DATA_FILE, next);
    expect(Object.keys(next.wallets).length).toBeGreaterThan(0);
  });

  // 3) QUOTE — trade 1 ETH -> TRX & save uuid to JSON
  test('QUOTE: trade 1 ETH -> TRX and store uuid in JSON', async () => {
    expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

    const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
      DATA_FILE,
      { wallets: {} }
    );
    const ETH = data.wallets?.ETH;
    const TRX = data.wallets?.TRX;

    expect.soft(ETH, 'ETH wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
    expect.soft(TRX, 'TRX wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
    expect(ETH?.id, 'ETH.id missing').toBeTruthy();
    expect(ETH?.pfx, 'ETH.pfx missing').toBeTruthy();
    expect(TRX?.id, 'TRX.id missing').toBeTruthy();
    expect(TRX?.pfx, 'TRX.pfx missing').toBeTruthy();

    const payload = {
      from: String(ETH.pfx),
      to: String(TRX.pfx),
      fromWallet: Number(ETH.id),
      useMaximum: true,
      useMinimum: true,
      reference: `e2e-${Date.now()}`,
      toWallet: Number(TRX.id),
      amountIn: 1,
      amountOut: 0,
      payInMethod: String(ETH.pfx),
      payOutMethod: String(TRX.pfx),
    };

    const resp = await apiCtx.post(QUOTE_URL, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: payload,
    });

    expect(resp.ok(), `Quote failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const quote = await resp.json();
    console.log('Quote request payload:', JSON.stringify(payload, null, 2));
    console.log('Quote response:', JSON.stringify(quote, null, 2));

    const uuid: string | undefined =
      (quote && (quote.uuid as string)) ??
      (quote && (quote.quoteUuid as string)) ??
      undefined;

    expect(uuid, 'No uuid field found in quote response').toBeTruthy();

    const current = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
    const updated = { ...current, lastQuoteUuid: String(uuid) };
    writeJson(DATA_FILE, updated);

    const verify = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
    expect(verify.lastQuoteUuid, 'lastQuoteUuid not saved').toBe(String(uuid));
  });

// 4) ACCEPT — confirm lastQuoteUuid, assert status === 'accepted' and fees.percentage.service === 0.01
test('ACCEPT: confirm ETH -> TRX quote (status accepted, service fee 0.01)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load the UUID we stored after creating the quote
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );

  const uuid = data.lastQuoteUuid;
  expect(uuid, 'lastQuoteUuid missing from testdata.json. Run QUOTE test first.').toBeTruthy();

  const acceptUrl = `https://bvnksimulator.pythonanywhere.com/api/v1/quote/accept/${encodeURIComponent(
    String(uuid)
  )}`;

  const resp = await apiCtx.put(acceptUrl, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  expect(resp.ok(), `Accept failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  // Parse JSON (fail if none, we need to assert fields)
  let body: any;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text();
    throw new Error(
      `Accept response did not contain JSON to assert fields.\nHTTP ${resp.status()} ${resp.statusText()}\nBody: ${text}`
    );
  }

  console.log('Accept URL:', acceptUrl);
  console.log('Accept response:', JSON.stringify(body, null, 2));

  // Assert status == 'accepted'
  const status =
    body?.status ??
    body?.state ??
    body?.quoteStatus ??
    body?.data?.status ??
    undefined;

  expect(status, 'No status field found in accept response').toBeTruthy();
  expect(String(status).toLowerCase()).toBe('accepted');

  // Assert fees.percentage.service == 0.01 (numeric, tolerant of string formatting)
  const serviceRaw = body?.fees?.percentage?.service;
  expect(serviceRaw, 'fees.percentage.service missing in accept response').toBeTruthy();

  const serviceNum = Number(serviceRaw);
  expect(Number.isFinite(serviceNum)).toBeTruthy();
  expect(Math.abs(serviceNum - 0.01)).toBeLessThanOrEqual(1e-9);

  // (Optional) Soft-check processing fee if you want:
  // expect.soft(String(body?.fees?.percentage?.processing ?? '')).toBe('0');
});


// helper: small wait (top-level in the file is fine if you don't have it already)
// helper: keep original decimal precision when writing back
const formatLike = (original: string, value: number): string => {
  const m = String(original).match(/\.(\d+)?$/);
  const decimals = m?.[1]?.length ?? 0;
  return value.toFixed(decimals);
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 5) BALANCE CHECK — ETH balance should have decreased by 1
 *    after accepting the ETH -> TRX quote, then persist new balance.
 */
test('BALANCE: ETH wallet balance decreased by 1 (persist new balance)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load ETH from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const ETH = data.wallets?.ETH;

  expect(ETH, 'ETH wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(ETH?.id, 'ETH.id missing in testdata.json').toBeTruthy();
  expect(ETH?.balance, 'ETH.balance (pre-trade) missing in testdata.json').toBeTruthy();

  const ethId = String(ETH.id);
  const prevBalance = parseFloat(String(ETH.balance));
  expect(Number.isFinite(prevBalance), `Invalid previous balance: ${ETH.balance}`).toBeTruthy();

  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(ethId)}`;

  // Poll a few times in case the system is eventually consistent
  let currentBalance: number | null = null;
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const resp = await apiCtx.get(walletUrl, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(resp.ok(), `ETH wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const wallet = await resp.json();
    const balStr = wallet?.balance ?? wallet?.available ?? null;
    if (balStr != null) {
      currentBalance = parseFloat(String(balStr));
      if (Number.isFinite(currentBalance)) {
        // Expect prevBalance - currentBalance ≈ 1
        const delta = prevBalance - currentBalance;
        if (Math.abs(delta - 1) <= 1e-6) break;
      }
    }

    await wait(1000);
  }

  expect(currentBalance, 'Could not read current ETH balance').toBeTruthy();

  // Assert decreased by ~1 with a tiny tolerance for decimals
  const expected = prevBalance - 1;
  const diff = Math.abs((currentBalance as number) - expected);

  console.log('ETH previous balance:', prevBalance);
  console.log('ETH current  balance:', currentBalance);
  console.log('Expected (prev - 1):', expected);
  console.log('Difference:', diff);

  expect(diff, `ETH balance did not decrease by 1 (prev=${prevBalance}, current=${currentBalance})`)
    .toBeLessThanOrEqual(1e-6);

  // ✅ Persist the new balance back to testdata.json (update balance & available)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const newBalStr = formatLike(String(ETH.balance), currentBalance as number);

  latest.wallets = latest.wallets || {};
  latest.wallets.ETH = {
    ...(latest.wallets.ETH ?? {}),
    id: ethId,
    balance: newBalStr,
    available: newBalStr,
    status: ETH.status,
    protocol: ETH.protocol,
    pfx: ETH.pfx,
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated ETH balance in ${DATA_FILE} to ${newBalStr}`);
});

/**
 * 6) TRX BALANCE REFRESH — fetch TRX wallet by ID and persist its latest balance to testdata.json
 */
test('TRX: refresh wallet balance from API (persist to testdata.json)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load TRX from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const TRX = data.wallets?.TRX;

  expect(TRX, 'TRX wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(TRX?.id, 'TRX.id missing in testdata.json').toBeTruthy();

  const trxId = String(TRX.id);
  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(trxId)}`;

  const resp = await apiCtx.get(walletUrl, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(resp.ok(), `TRX wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const wallet = await resp.json();
  console.log('TRX wallet response:', JSON.stringify(wallet, null, 2));

  // Prefer 'balance', fall back to 'available'
  const balStr: string | null = wallet?.balance ?? wallet?.available ?? null;
  expect(balStr, 'No balance/available field in TRX wallet response').toBeTruthy();

  // Optional numeric sanity
  const balNum = Number(balStr);
  expect(Number.isFinite(balNum), `TRX balance is not numeric: ${balStr}`).toBeTruthy();

  // ✅ Persist the latest TRX balance back to testdata.json (update balance & available; keep other fields)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  latest.wallets = latest.wallets || {};
  latest.wallets.TRX = {
    ...(latest.wallets.TRX ?? {}),
    id: trxId,
    balance: String(balStr),
    available: String(balStr),
    status: TRX.status ?? wallet?.status ?? latest.wallets.TRX?.status,
    protocol: TRX.protocol ?? wallet?.protocol ?? latest.wallets.TRX?.protocol,
    pfx: TRX.pfx ?? latest.wallets.TRX?.pfx ?? 'TRX',
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated TRX balance in ${DATA_FILE} to ${balStr}`);
});

//7 
test('QUOTE: trade 420 TRX -> USDT and store uuid in JSON', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load wallets from JSON
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );
  const TRX = data.wallets?.TRX;
  const USDT = data.wallets?.USDT; // expects a USDT wallet captured by the WALLETS test

  expect.soft(TRX, 'TRX wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect.soft(USDT, 'USDT wallet missing from testdata.json. Ensure the USDT wallet exists and rerun WALLETS.').toBeTruthy();

  expect(TRX?.id, 'TRX.id missing').toBeTruthy();
  expect(TRX?.pfx, 'TRX.pfx missing').toBeTruthy();
  expect(USDT?.id, 'USDT.id missing').toBeTruthy();
  expect(USDT?.pfx, 'USDT.pfx missing').toBeTruthy();

  const payload = {
    from: String(TRX.pfx),        // "TRX"
    to: String(USDT.pfx),          // "USDT"
    fromWallet: Number(TRX.id),   // TRX wallet id
    useMaximum: true,
    useMinimum: true,
    reference: `e2e-${Date.now()}`,
    toWallet: Number(USDT.id),     // USDT wallet id
    amountIn: 420,                // trade 420 TRX
    amountOut: 0,
    payInMethod: String(TRX.pfx), // "TRX"
    payOutMethod: String(USDT.pfx) // "USDT"
  };

  const resp = await apiCtx.post(QUOTE_URL, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    data: payload,
  });

  expect(resp.ok(), `Quote failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const quote = await resp.json();
  console.log('Quote request payload:', JSON.stringify(payload, null, 2));
  console.log('Quote response:', JSON.stringify(quote, null, 2));

  // Basic sanity checks
  if ('from' in quote) expect(String(quote.from).toUpperCase()).toBe(String(TRX.pfx).toUpperCase());
  if ('to' in quote)   expect(String(quote.to).toUpperCase()).toBe(String(USDT.pfx).toUpperCase());
  if ('amountIn' in quote) expect(Number(quote.amountIn)).toBeGreaterThan(0);

  // Extract and persist UUID
  const uuid: string | undefined =
    (quote && (quote.uuid as string)) ??
    (quote && (quote.quoteUuid as string)) ??
    undefined;

  expect(uuid, 'No uuid field found in quote response').toBeTruthy();

  const current = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
  const updated = { ...current, lastQuoteUuid: String(uuid) };
  writeJson(DATA_FILE, updated);

  const verify = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
  expect(verify.lastQuoteUuid, 'lastQuoteUuid not saved').toBe(String(uuid));
});

//8
test('ACCEPT: confirm TRX -> USDT quote (status accepted, service fee 0.01)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load the UUID we stored after creating the quote
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );

  const uuid = data.lastQuoteUuid;
  expect(uuid, 'lastQuoteUuid missing from testdata.json. Run QUOTE test first.').toBeTruthy();

  const acceptUrl = `https://bvnksimulator.pythonanywhere.com/api/v1/quote/accept/${encodeURIComponent(
    String(uuid)
  )}`;

  const resp = await apiCtx.put(acceptUrl, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  expect(resp.ok(), `Accept failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  // Parse JSON (fail if none, we need to assert fields)
  let body: any;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text();
    throw new Error(
      `Accept response did not contain JSON to assert fields.\nHTTP ${resp.status()} ${resp.statusText()}\nBody: ${text}`
    );
  }

  console.log('Accept URL:', acceptUrl);
  console.log('Accept response:', JSON.stringify(body, null, 2));

  // Assert status == 'accepted'
  const status =
    body?.status ??
    body?.state ??
    body?.quoteStatus ??
    body?.data?.status ??
    undefined;

  expect(status, 'No status field found in accept response').toBeTruthy();
  expect(String(status).toLowerCase()).toBe('accepted');

  // Assert fees.percentage.service == 0.01 (numeric, tolerant of string formatting)
  const serviceRaw = body?.fees?.percentage?.service;
  expect(serviceRaw, 'fees.percentage.service missing in accept response').toBeTruthy();

  const serviceNum = Number(serviceRaw);
  expect(Number.isFinite(serviceNum)).toBeTruthy();
  expect(Math.abs(serviceNum - 0.01)).toBeLessThanOrEqual(1e-9);

  // (Optional) Soft-check processing fee if you want:
  // expect.soft(String(body?.fees?.percentage?.processing ?? '')).toBe('0');
});

//9
/**
 * TRX BALANCE CHECK — TRX balance should have decreased by 420
 * after trading 420 TRX -> USDT, then persist new balance.
 */
test('BALANCE: TRX wallet balance decreased by 420 (persist new balance)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load TRX from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const TRX = data.wallets?.TRX;

  expect(TRX, 'TRX wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(TRX?.id, 'TRX.id missing in testdata.json').toBeTruthy();
  expect(TRX?.balance, 'TRX.balance (pre-trade) missing in testdata.json').toBeTruthy();

  const trxId = String(TRX.id);
  const prevBalance = parseFloat(String(TRX.balance));
  expect(Number.isFinite(prevBalance), `Invalid previous TRX balance: ${TRX.balance}`).toBeTruthy();

  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(trxId)}`;

  // Poll a few times in case the system is eventually consistent
  let currentBalance: number | null = null;
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const resp = await apiCtx.get(walletUrl, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(resp.ok(), `TRX wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const wallet = await resp.json();
    const balStr = wallet?.balance ?? wallet?.available ?? null;
    if (balStr != null) {
      currentBalance = parseFloat(String(balStr));
      if (Number.isFinite(currentBalance)) {
        // Expect prevBalance - currentBalance ≈ 420
        const delta = prevBalance - currentBalance;
        if (Math.abs(delta - 420) <= 1e-6) break;
      }
    }

    await wait(1000);
  }

  expect(currentBalance, 'Could not read current TRX balance').toBeTruthy();

  // Assert decreased by ~420 with a small tolerance for decimals
  const expected = prevBalance - 420;
  const diff = Math.abs((currentBalance as number) - expected);

  console.log('TRX previous balance:', prevBalance);
  console.log('TRX current  balance:', currentBalance);
  console.log('Expected (prev - 420):', expected);
  console.log('Difference:', diff);

  expect(diff, `TRX balance did not decrease by 420 (prev=${prevBalance}, current=${currentBalance})`)
    .toBeLessThanOrEqual(1e-6);

  // ✅ Persist the new TRX balance back to testdata.json (update balance & available)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const newBalStr = formatLike(String(TRX.balance), currentBalance as number);

  latest.wallets = latest.wallets || {};
  latest.wallets.TRX = {
    ...(latest.wallets.TRX ?? {}),
    id: trxId,
    balance: newBalStr,
    available: newBalStr,
    status: TRX.status,
    protocol: TRX.protocol,
    pfx: TRX.pfx,
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated TRX balance in ${DATA_FILE} to ${newBalStr}`);
});

//10
test('USDT: refresh wallet balance from API (persist to testdata.json)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load USDT from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const USDT = data.wallets?.USDT;

  expect(USDT, 'USDT wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(USDT?.id, 'USDT.id missing in testdata.json').toBeTruthy();

  const USDTId = String(USDT.id);
  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(USDTId)}`;

  const resp = await apiCtx.get(walletUrl, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(resp.ok(), `USDT wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const wallet = await resp.json();
  console.log('USDT wallet response:', JSON.stringify(wallet, null, 2));

  // Prefer 'balance', fall back to 'available'
  const balStr: string | null = wallet?.balance ?? wallet?.available ?? null;
  expect(balStr, 'No balance/available field in USDT wallet response').toBeTruthy();

  // Numeric sanity check
  const balNum = Number(balStr);
  expect(Number.isFinite(balNum), `USDT balance is not numeric: ${balStr}`).toBeTruthy();

  // ✅ Persist the latest USDT balance back to testdata.json (update balance & available; keep other fields)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  latest.wallets = latest.wallets || {};
  latest.wallets.USDT = {
    ...(latest.wallets.USDT ?? {}),
    id: USDTId,
    balance: String(balStr),
    available: String(balStr),
    status: USDT.status ?? wallet?.status ?? latest.wallets.USDT?.status,
    protocol: USDT.protocol ?? wallet?.protocol ?? latest.wallets.USDT?.protocol,
    pfx: USDT.pfx ?? latest.wallets.USDT?.pfx ?? 'USDT',
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated USDT balance in ${DATA_FILE} to ${balStr}`);
});

//11
test('QUOTE: trade 987 TRX -> ETH and store uuid in JSON', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load wallets from JSON
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );
  const TRX = data.wallets?.TRX;
  const ETH = data.wallets?.ETH; // expects an ETH wallet captured by the WALLETS test

  expect.soft(TRX, 'TRX wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect.soft(ETH, 'ETH wallet missing from testdata.json. Ensure the ETH wallet exists and rerun WALLETS.').toBeTruthy();

  expect(TRX?.id, 'TRX.id missing').toBeTruthy();
  expect(TRX?.pfx, 'TRX.pfx missing').toBeTruthy();
  expect(ETH?.id, 'ETH.id missing').toBeTruthy();
  expect(ETH?.pfx, 'ETH.pfx missing').toBeTruthy();

  const payload = {
    from: String(TRX.pfx),         // "TRX"
    to: String(ETH.pfx),           // "ETH"
    fromWallet: Number(TRX.id),    // TRX wallet id
    useMaximum: true,
    useMinimum: true,
    reference: `e2e-${Date.now()}`,
    toWallet: Number(ETH.id),      // ETH wallet id
    amountIn: 987,                 // trade 987 TRX
    amountOut: 0,
    payInMethod: String(TRX.pfx),  // "TRX"
    payOutMethod: String(ETH.pfx), // "ETH"
  };

  const resp = await apiCtx.post(QUOTE_URL, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    data: payload,
  });

  expect(resp.ok(), `Quote failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const quote = await resp.json();
  console.log('Quote request payload:', JSON.stringify(payload, null, 2));
  console.log('Quote response:', JSON.stringify(quote, null, 2));

  // Basic sanity checks
  if ('from' in quote) expect(String(quote.from).toUpperCase()).toBe(String(TRX.pfx).toUpperCase());
  if ('to' in quote)   expect(String(quote.to).toUpperCase()).toBe(String(ETH.pfx).toUpperCase());
  if ('amountIn' in quote) expect(Number(quote.amountIn)).toBeGreaterThan(0);

  // Extract and persist UUID
  const uuid: string | undefined =
    (quote && (quote.uuid as string)) ??
    (quote && (quote.quoteUuid as string)) ??
    undefined;

  expect(uuid, 'No uuid field found in quote response').toBeTruthy();

  const current = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
  const updated = { ...current, lastQuoteUuid: String(uuid) };
  writeJson(DATA_FILE, updated);

  const verify = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
  expect(verify.lastQuoteUuid, 'lastQuoteUuid not saved').toBe(String(uuid));
});


//12
test('ACCEPT: confirm TRX -> ETH quote (status accepted, service fee 0.01)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load the UUID we stored after creating the quote
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );

  const uuid = data.lastQuoteUuid;
  expect(uuid, 'lastQuoteUuid missing from testdata.json. Run QUOTE test first.').toBeTruthy();

  const acceptUrl = `https://bvnksimulator.pythonanywhere.com/api/v1/quote/accept/${encodeURIComponent(
    String(uuid)
  )}`;

  const resp = await apiCtx.put(acceptUrl, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  expect(resp.ok(), `Accept failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  // Parse JSON (fail if none, we need to assert fields)
  let body: any;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text();
    throw new Error(
      `Accept response did not contain JSON to assert fields.\nHTTP ${resp.status()} ${resp.statusText()}\nBody: ${text}`
    );
  }

  console.log('Accept URL:', acceptUrl);
  console.log('Accept response:', JSON.stringify(body, null, 2));

  // Assert status == 'accepted'
  const status =
    body?.status ??
    body?.state ??
    body?.quoteStatus ??
    body?.data?.status ??
    undefined;

  expect(status, 'No status field found in accept response').toBeTruthy();
  expect(String(status).toLowerCase()).toBe('accepted');

  // Assert fees.percentage.service == 0.01 (numeric, tolerant of string formatting)
  const serviceRaw = body?.fees?.percentage?.service;
  expect(serviceRaw, 'fees.percentage.service missing in accept response').toBeTruthy();

  const serviceNum = Number(serviceRaw);
  expect(Number.isFinite(serviceNum)).toBeTruthy();
  expect(Math.abs(serviceNum - 0.01)).toBeLessThanOrEqual(1e-9);

  // (Optional) Soft-check processing fee if you want:
  // expect.soft(String(body?.fees?.percentage?.processing ?? '')).toBe('0');
});

//13
test('BALANCE: TRX wallet balance decreased by 987 (persist new balance)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load TRX from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const TRX = data.wallets?.TRX;

  expect(TRX, 'TRX wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(TRX?.id, 'TRX.id missing in testdata.json').toBeTruthy();
  expect(TRX?.balance, 'TRX.balance (pre-trade) missing in testdata.json').toBeTruthy();

  const trxId = String(TRX.id);
  const prevBalance = parseFloat(String(TRX.balance));
  expect(Number.isFinite(prevBalance), `Invalid previous TRX balance: ${TRX.balance}`).toBeTruthy();

  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(trxId)}`;

  // Poll a few times in case the system is eventually consistent
  let currentBalance: number | null = null;
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const resp = await apiCtx.get(walletUrl, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(resp.ok(), `TRX wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const wallet = await resp.json();
    const balStr = wallet?.balance ?? wallet?.available ?? null;
    if (balStr != null) {
      currentBalance = parseFloat(String(balStr));
      if (Number.isFinite(currentBalance)) {
        // Expect prevBalance - currentBalance ≈ 987
        const delta = prevBalance - currentBalance;
        if (Math.abs(delta - 987) <= 1e-6) break;
      }
    }

    await wait(1000);
  }

  expect(currentBalance, 'Could not read current TRX balance').toBeTruthy();

  // Assert decreased by ~987 with a small tolerance for decimals
  const expected = prevBalance - 987;
  const diff = Math.abs((currentBalance as number) - expected);

  console.log('TRX previous balance:', prevBalance);
  console.log('TRX current  balance:', currentBalance);
  console.log('Expected (prev - 987):', expected);
  console.log('Difference:', diff);

  expect(diff, `TRX balance did not decrease by 987 (prev=${prevBalance}, current=${currentBalance})`)
    .toBeLessThanOrEqual(1e-6);

  // ✅ Persist the new TRX balance back to testdata.json (update balance & available)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const newBalStr = formatLike(String(TRX.balance), currentBalance as number);

  latest.wallets = latest.wallets || {};
  latest.wallets.TRX = {
    ...(latest.wallets.TRX ?? {}),
    id: trxId,
    balance: newBalStr,
    available: newBalStr,
    status: TRX.status,
    protocol: TRX.protocol,
    pfx: TRX.pfx,
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated TRX balance in ${DATA_FILE} to ${newBalStr}`);
});

//14
test('ETH: refresh wallet balance from API (persist to testdata.json)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load ETH from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const ETH = data.wallets?.ETH;

  expect(ETH, 'ETH wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(ETH?.id, 'ETH.id missing in testdata.json').toBeTruthy();

  const ethId = String(ETH.id);
  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(ethId)}`;

  const resp = await apiCtx.get(walletUrl, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(resp.ok(), `ETH wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const wallet = await resp.json();
  console.log('ETH wallet response:', JSON.stringify(wallet, null, 2));

  // Prefer 'balance', fall back to 'available'
  const balStr: string | null = wallet?.balance ?? wallet?.available ?? null;
  expect(balStr, 'No balance/available field in ETH wallet response').toBeTruthy();

  // Numeric sanity check
  const balNum = Number(balStr);
  expect(Number.isFinite(balNum), `ETH balance is not numeric: ${balStr}`).toBeTruthy();

  // ✅ Persist the latest ETH balance back to testdata.json (update balance & available; keep other fields)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  latest.wallets = latest.wallets || {};
  latest.wallets.ETH = {
    ...(latest.wallets.ETH ?? {}),
    id: ethId,
    balance: String(balStr),
    available: String(balStr),
    status: ETH.status ?? wallet?.status ?? latest.wallets.ETH?.status,
    protocol: ETH.protocol ?? wallet?.protocol ?? latest.wallets.ETH?.protocol,
    pfx: ETH.pfx ?? latest.wallets.ETH?.pfx ?? 'ETH',
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated ETH balance in ${DATA_FILE} to ${balStr}`);
});

//15
test('QUOTE: trade 0.5 ETH -> USDT and store uuid in JSON', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load wallets from JSON
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );
  const ETH = data.wallets?.ETH;
  const USDT = data.wallets?.USDT; // expects a USDT wallet captured by the WALLETS test

  expect.soft(ETH, 'ETH wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect.soft(USDT, 'USDT wallet missing from testdata.json. Ensure the USDT wallet exists and rerun WALLETS.').toBeTruthy();

  expect(ETH?.id, 'ETH.id missing').toBeTruthy();
  expect(ETH?.pfx, 'ETH.pfx missing').toBeTruthy();
  expect(USDT?.id, 'USDT.id missing').toBeTruthy();
  expect(USDT?.pfx, 'USDT.pfx missing').toBeTruthy();

  const payload = {
    from: String(ETH.pfx),          // "ETH"
    to: String(USDT.pfx),           // "USDT"
    fromWallet: Number(ETH.id),     // ETH wallet id
    useMaximum: true,
    useMinimum: true,
    reference: `e2e-${Date.now()}`,
    toWallet: Number(USDT.id),      // USDT wallet id
    amountIn: 0.5,                  // trade 0.5 ETH
    amountOut: 0,
    payInMethod: String(ETH.pfx),   // "ETH"
    payOutMethod: String(USDT.pfx), // "USDT"
  };

  const resp = await apiCtx.post(QUOTE_URL, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    data: payload,
  });

  expect(resp.ok(), `Quote failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const quote = await resp.json();
  console.log('Quote request payload:', JSON.stringify(payload, null, 2));
  console.log('Quote response:', JSON.stringify(quote, null, 2));

  // Basic sanity checks
  if ('from' in quote) expect(String(quote.from).toUpperCase()).toBe(String(ETH.pfx).toUpperCase());
  if ('to' in quote)   expect(String(quote.to).toUpperCase()).toBe(String(USDT.pfx).toUpperCase());
  if ('amountIn' in quote) expect(Number(quote.amountIn)).toBeGreaterThan(0);

  // Extract and persist UUID
  const uuid: string | undefined =
    (quote && (quote.uuid as string)) ??
    (quote && (quote.quoteUuid as string)) ??
    undefined;

  expect(uuid, 'No uuid field found in quote response').toBeTruthy();

  const current = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
  const updated = { ...current, lastQuoteUuid: String(uuid) };
  writeJson(DATA_FILE, updated);

  const verify = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
  expect(verify.lastQuoteUuid, 'lastQuoteUuid not saved').toBe(String(uuid));
});

//16
test('ACCEPT: confirm ETH -> USDT quote (status accepted, service fee 0.01)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load the UUID we stored after creating the quote
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );

  const uuid = data.lastQuoteUuid;
  expect(uuid, 'lastQuoteUuid missing from testdata.json. Run QUOTE test first.').toBeTruthy();

  const acceptUrl = `https://bvnksimulator.pythonanywhere.com/api/v1/quote/accept/${encodeURIComponent(
    String(uuid)
  )}`;

  const resp = await apiCtx.put(acceptUrl, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  expect(resp.ok(), `Accept failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  // Parse JSON (fail if none, we need to assert fields)
  let body: any;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text();
    throw new Error(
      `Accept response did not contain JSON to assert fields.\nHTTP ${resp.status()} ${resp.statusText()}\nBody: ${text}`
    );
  }

  console.log('Accept URL:', acceptUrl);
  console.log('Accept response:', JSON.stringify(body, null, 2));

  // Assert status == 'accepted'
  const status =
    body?.status ??
    body?.state ??
    body?.quoteStatus ??
    body?.data?.status ??
    undefined;

  expect(status, 'No status field found in accept response').toBeTruthy();
  expect(String(status).toLowerCase()).toBe('accepted');

  // Assert fees.percentage.service == 0.01 (numeric, tolerant of string formatting)
  const serviceRaw = body?.fees?.percentage?.service;
  expect(serviceRaw, 'fees.percentage.service missing in accept response').toBeTruthy();

  const serviceNum = Number(serviceRaw);
  expect(Number.isFinite(serviceNum)).toBeTruthy();
  expect(Math.abs(serviceNum - 0.01)).toBeLessThanOrEqual(1e-9);

  // (Optional) Soft-check processing fee if you want:
  // expect.soft(String(body?.fees?.percentage?.processing ?? '')).toBe('0');
});

//17
// Assumes wait, formatLike, readJsonSafe, writeJson, DATA_FILE, apiCtx, authToken exist in the suite

/**
 * BALANCE CHECK — ETH balance should have decreased by 0.5
 * after trading 0.5 ETH -> USDT (or USD), then persist new balance.
 */
test('BALANCE: ETH wallet balance decreased by 0.5 (persist new balance)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load ETH from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const ETH = data.wallets?.ETH;

  expect(ETH, 'ETH wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(ETH?.id, 'ETH.id missing in testdata.json').toBeTruthy();
  expect(ETH?.balance, 'ETH.balance (pre-trade) missing in testdata.json').toBeTruthy();

  const ethId = String(ETH.id);
  const prevBalance = parseFloat(String(ETH.balance));
  expect(Number.isFinite(prevBalance), `Invalid previous ETH balance: ${ETH.balance}`).toBeTruthy();

  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(ethId)}`;

  // Poll a few times in case the system is eventually consistent
  let currentBalance: number | null = null;
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const resp = await apiCtx.get(walletUrl, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(resp.ok(), `ETH wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const wallet = await resp.json();
    const balStr = wallet?.balance ?? wallet?.available ?? null;
    if (balStr != null) {
      currentBalance = parseFloat(String(balStr));
      if (Number.isFinite(currentBalance)) {
        // Expect prevBalance - currentBalance ≈ 0.5
        const delta = prevBalance - currentBalance;
        if (Math.abs(delta - 0.5) <= 1e-6) break;
      }
    }

    await wait(1000);
  }

  expect(currentBalance, 'Could not read current ETH balance').toBeTruthy();

  // Assert decreased by ~0.5 with a small tolerance for decimals
  const expected = prevBalance - 0.5;
  const diff = Math.abs((currentBalance as number) - expected);

  console.log('ETH previous balance:', prevBalance);
  console.log('ETH current  balance:', currentBalance);
  console.log('Expected (prev - 0.5):', expected);
  console.log('Difference:', diff);

  expect(diff, `ETH balance did not decrease by 0.5 (prev=${prevBalance}, current=${currentBalance})`)
    .toBeLessThanOrEqual(1e-6);

  // ✅ Persist the new ETH balance back to testdata.json (update balance & available)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const newBalStr = formatLike(String(ETH.balance), currentBalance as number);

  latest.wallets = latest.wallets || {};
  latest.wallets.ETH = {
    ...(latest.wallets.ETH ?? {}),
    id: ethId,
    balance: newBalStr,
    available: newBalStr,
    status: ETH.status,
    protocol: ETH.protocol,
    pfx: ETH.pfx,
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated ETH balance in ${DATA_FILE} to ${newBalStr}`);
});

//18
test('USDT: refresh wallet balance from API after ETH Trade (persist to testdata.json)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load USDT from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const USDT = data.wallets?.USDT;

  expect(USDT, 'USDT wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(USDT?.id, 'USDT.id missing in testdata.json').toBeTruthy();

  const usdtId = String(USDT.id);
  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(usdtId)}`;

  const resp = await apiCtx.get(walletUrl, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(resp.ok(), `USDT wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const wallet = await resp.json();
  console.log('USDT wallet response:', JSON.stringify(wallet, null, 2));

  // Prefer 'balance', fall back to 'available'
  const balStr: string | null = wallet?.balance ?? wallet?.available ?? null;
  expect(balStr, 'No balance/available field in USDT wallet response').toBeTruthy();

  // Numeric sanity check
  const balNum = Number(balStr);
  expect(Number.isFinite(balNum), `USDT balance is not numeric: ${balStr}`).toBeTruthy();

  // ✅ Persist the latest USDT balance back to testdata.json (update balance & available; keep other fields)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  latest.wallets = latest.wallets || {};
  latest.wallets.USDT = {
    ...(latest.wallets.USDT ?? {}),
    id: usdtId,
    balance: String(balStr),
    available: String(balStr),
    status: USDT.status ?? wallet?.status ?? latest.wallets.USDT?.status,
    protocol: USDT.protocol ?? wallet?.protocol ?? latest.wallets.USDT?.protocol,
    pfx: USDT.pfx ?? latest.wallets.USDT?.pfx ?? 'USDT',
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated USDT balance in ${DATA_FILE} to ${balStr}`);
});

//19
test('QUOTE: trade 1000 USDT -> TRX and store uuid in JSON', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load wallets from JSON
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );
  const USDT = data.wallets?.USDT;
  const TRX  = data.wallets?.TRX; // expects TRX wallet captured by the WALLETS test

  expect.soft(USDT, 'USDT wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect.soft(TRX,  'TRX wallet missing from testdata.json. Ensure the TRX wallet exists and rerun WALLETS.').toBeTruthy();

  expect(USDT?.id, 'USDT.id missing').toBeTruthy();
  expect(USDT?.pfx, 'USDT.pfx missing').toBeTruthy();
  expect(TRX?.id, 'TRX.id missing').toBeTruthy();
  expect(TRX?.pfx, 'TRX.pfx missing').toBeTruthy();

  const payload = {
    from: String(USDT.pfx),        // "USDT"
    to:   String(TRX.pfx),         // "TRX"
    fromWallet: Number(USDT.id),   // USDT wallet id
    useMaximum: true,
    useMinimum: true,
    reference: `e2e-${Date.now()}`,
    toWallet: Number(TRX.id),      // TRX wallet id
    amountIn: 1000,                // trade 1000 USDT
    amountOut: 0,
    payInMethod:  String(USDT.pfx),// "USDT"
    payOutMethod: String(TRX.pfx), // "TRX"
  };

  const resp = await apiCtx.post(QUOTE_URL, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    data: payload,
  });

  expect(resp.ok(), `Quote failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const quote = await resp.json();
  console.log('Quote request payload:', JSON.stringify(payload, null, 2));
  console.log('Quote response:', JSON.stringify(quote, null, 2));

  // Basic sanity checks
  if ('from' in quote) expect(String(quote.from).toUpperCase()).toBe(String(USDT.pfx).toUpperCase());
  if ('to'   in quote) expect(String(quote.to).toUpperCase()).toBe(String(TRX.pfx).toUpperCase());
  if ('amountIn' in quote) expect(Number(quote.amountIn)).toBeGreaterThan(0);

  // Extract and persist UUID
  const uuid: string | undefined =
    (quote && (quote.uuid as string)) ??
    (quote && (quote.quoteUuid as string)) ??
    undefined;

  expect(uuid, 'No uuid field found in quote response').toBeTruthy();

  const current = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
  const updated = { ...current, lastQuoteUuid: String(uuid) };
  writeJson(DATA_FILE, updated);

  const verify = readJsonSafe<{ wallets?: any; lastQuoteUuid?: string }>(DATA_FILE, { wallets: {} });
  expect(verify.lastQuoteUuid, 'lastQuoteUuid not saved').toBe(String(uuid));
});

//20
test('ACCEPT: confirm USDT -> TRX quote (status accepted, service fee 0.01)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load the UUID we stored after creating the quote
  const data = readJsonSafe<{ wallets?: Record<string, any>; lastQuoteUuid?: string }>(
    DATA_FILE,
    { wallets: {} }
  );

  const uuid = data.lastQuoteUuid;
  expect(uuid, 'lastQuoteUuid missing from testdata.json. Run QUOTE test first.').toBeTruthy();

  const acceptUrl = `https://bvnksimulator.pythonanywhere.com/api/v1/quote/accept/${encodeURIComponent(
    String(uuid)
  )}`;

  const resp = await apiCtx.put(acceptUrl, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  expect(resp.ok(), `Accept failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  // Parse JSON (fail if none, we need to assert fields)
  let body: any;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text();
    throw new Error(
      `Accept response did not contain JSON to assert fields.\nHTTP ${resp.status()} ${resp.statusText()}\nBody: ${text}`
    );
  }

  console.log('Accept URL:', acceptUrl);
  console.log('Accept response:', JSON.stringify(body, null, 2));

  // Assert status == 'accepted'
  const status =
    body?.status ??
    body?.state ??
    body?.quoteStatus ??
    body?.data?.status ??
    undefined;

  expect(status, 'No status field found in accept response').toBeTruthy();
  expect(String(status).toLowerCase()).toBe('accepted');

  // Assert fees.percentage.service == 0.01 (numeric, tolerant of string formatting)
  const serviceRaw = body?.fees?.percentage?.service;
  expect(serviceRaw, 'fees.percentage.service missing in accept response').toBeTruthy();

  const serviceNum = Number(serviceRaw);
  expect(Number.isFinite(serviceNum)).toBeTruthy();
  expect(Math.abs(serviceNum - 0.01)).toBeLessThanOrEqual(1e-9);

  // (Optional) Soft-check processing fee if you want:
  // expect.soft(String(body?.fees?.percentage?.processing ?? '')).toBe('0');
});
//21

// Assumes wait, formatLike, readJsonSafe, writeJson, DATA_FILE, apiCtx, authToken exist in the suite

/**
 * BALANCE CHECK — USDT balance should have decreased by 1000
 * after trading 1000 USDT -> TRX (or other), then persist new balance.
 */
test('BALANCE: USDT wallet balance decreased by 1000 (persist new balance)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load USDT from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const USDT = data.wallets?.USDT;

  expect(USDT, 'USDT wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(USDT?.id, 'USDT.id missing in testdata.json').toBeTruthy();
  expect(USDT?.balance, 'USDT.balance (pre-trade) missing in testdata.json').toBeTruthy();

  const usdtId = String(USDT.id);
  const prevBalance = parseFloat(String(USDT.balance));
  expect(Number.isFinite(prevBalance), `Invalid previous USDT balance: ${USDT.balance}`).toBeTruthy();

  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(usdtId)}`;

  // Poll a few times in case the system is eventually consistent
  let currentBalance: number | null = null;
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const resp = await apiCtx.get(walletUrl, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(resp.ok(), `USDT wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const wallet = await resp.json();
    const balStr = wallet?.balance ?? wallet?.available ?? null;
    if (balStr != null) {
      currentBalance = parseFloat(String(balStr));
      if (Number.isFinite(currentBalance)) {
        // Expect prevBalance - currentBalance ≈ 1000
        const delta = prevBalance - currentBalance;
        if (Math.abs(delta - 1000) <= 1e-6) break;
      }
    }

    await wait(1000);
  }

  expect(currentBalance, 'Could not read current USDT balance').toBeTruthy();

  // Assert decreased by ~1000 with a small tolerance for decimals
  const expected = prevBalance - 1000;
  const diff = Math.abs((currentBalance as number) - expected);

  console.log('USDT previous balance:', prevBalance);
  console.log('USDT current  balance:', currentBalance);
  console.log('Expected (prev - 1000):', expected);
  console.log('Difference:', diff);

  expect(diff, `USDT balance did not decrease by 1000 (prev=${prevBalance}, current=${currentBalance})`)
    .toBeLessThanOrEqual(1e-6);

  // ✅ Persist the new USDT balance back to testdata.json (update balance & available)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const newBalStr = formatLike(String(USDT.balance), currentBalance as number);

  latest.wallets = latest.wallets || {};
  latest.wallets.USDT = {
    ...(latest.wallets.USDT ?? {}),
    id: usdtId,
    balance: newBalStr,
    available: newBalStr,
    status: USDT.status,
    protocol: USDT.protocol,
    pfx: USDT.pfx ?? 'USDT',
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated USDT balance in ${DATA_FILE} to ${newBalStr}`);
});

//22
test('TRX: refresh wallet balance from API AFTER USDT Trade (persist to testdata.json)', async () => {
  expect(authToken, 'Bearer token not set; ensure INIT test ran and passed.').toBeTruthy();

  // Load TRX from saved testdata
  const data = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  const TRX = data.wallets?.TRX;

  expect(TRX, 'TRX wallet missing from testdata.json. Run WALLETS test first.').toBeTruthy();
  expect(TRX?.id, 'TRX.id missing in testdata.json').toBeTruthy();

  const trxId = String(TRX.id);
  const walletUrl = `https://bvnksimulator.pythonanywhere.com/api/wallet/${encodeURIComponent(trxId)}`;

  const resp = await apiCtx.get(walletUrl, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  expect(resp.ok(), `TRX wallet GET failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

  const wallet = await resp.json();
  console.log('TRX wallet response:', JSON.stringify(wallet, null, 2));

  // Prefer 'balance', fall back to 'available'
  const balStr: string | null = wallet?.balance ?? wallet?.available ?? null;
  expect(balStr, 'No balance/available field in TRX wallet response').toBeTruthy();

  // Numeric sanity check
  const balNum = Number(balStr);
  expect(Number.isFinite(balNum), `TRX balance is not numeric: ${balStr}`).toBeTruthy();

  // ✅ Persist the latest TRX balance back to testdata.json (update balance & available; keep other fields)
  const latest = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
  latest.wallets = latest.wallets || {};
  latest.wallets.TRX = {
    ...(latest.wallets.TRX ?? {}),
    id: trxId,
    balance: String(balStr),
    available: String(balStr),
    status: TRX.status ?? wallet?.status ?? latest.wallets.TRX?.status,
    protocol: TRX.protocol ?? wallet?.protocol ?? latest.wallets.TRX?.protocol,
    pfx: TRX.pfx ?? latest.wallets.TRX?.pfx ?? 'TRX',
  };

  writeJson(DATA_FILE, latest);
  console.log(`✅ Updated TRX balance in ${DATA_FILE} to ${balStr}`);
});


});




