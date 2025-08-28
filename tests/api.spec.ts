import { test, expect, request, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://bvnksimulator.pythonanywhere.com';
const INIT_ENDPOINT = '/init';
const WALLETS_ENDPOINT = '/api/wallet';

// Where to store test data
const DATA_DIR = path.resolve(process.cwd(), 'testdata');
const DATA_FILE = path.join(DATA_DIR, 'testdata.json');

let apiCtx: APIRequestContext;
let authToken: string;

// --- FS helpers ---
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

test.describe('BVNK API → wallets → save to testdata/testdata.json (no meta)', () => {
  test.beforeAll(async () => {
    apiCtx = await request.newContext({ baseURL: BASE_URL });

    // Get token (try POST, fallback to GET)
    let resp = await apiCtx.post(INIT_ENDPOINT).catch(() => null as any);
    if (!resp || !resp.ok()) resp = await apiCtx.get(INIT_ENDPOINT);

    expect(resp.ok(), `Init failed: ${resp?.status()} ${resp?.statusText()}`).toBeTruthy();
    const data = await resp.json();
    authToken = data.access_token;

    // Ensure testdata folder & file exist
    ensureDir(DATA_DIR);
    if (!fs.existsSync(DATA_FILE)) writeJson(DATA_FILE, { wallets: {} });
  });

  test.afterAll(async () => {
    await apiCtx.dispose();
  });

  test('fetch wallets and persist selected fields to JSON (wallets only)', async () => {
    const resp = await apiCtx.get(WALLETS_ENDPOINT, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(resp.ok(), `Wallets failed: ${resp.status()} ${resp.statusText()}`).toBeTruthy();

    const payload = await resp.json();

    // Normalize to array
    const wallets: any[] = Array.isArray(payload)
      ? payload
      : (payload?.items ?? payload?.data ?? []);

    console.log('Wallets count:', wallets?.length ?? 0);
    expect(Array.isArray(wallets)).toBeTruthy();

    // Build a compact object keyed by currency code (ETH/TRX/USDT...)
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

    // Merge into existing testdata.json but keep ONLY "wallets"
    const existing = readJsonSafe<{ wallets?: Record<string, any> }>(DATA_FILE, { wallets: {} });
    const next = {
      wallets: { ...(existing.wallets ?? {}), ...compact },
    };

    writeJson(DATA_FILE, next);

    // Basic assertion that we saved at least one wallet entry
    expect(Object.keys(next.wallets).length).toBeGreaterThan(0);
  });
});
