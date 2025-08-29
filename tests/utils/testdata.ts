// tests/utils/testdata.ts
import * as fs from 'fs';

export type WalletMap = Record<string, {
  id: string;
  balance: string;
  available?: string;
  status?: string;
  protocol?: string;
  pfx?: string;
}>;

export type TD = { wallets?: WalletMap; lastQuoteUuid?: string };

export const readJsonSafe = <T = any>(file: string, fallback: T): T => {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeJson = (file: string, obj: any) => {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`✅ wrote: ${file}`);
};

export const formatLike = (original: string, value: number): string => {
  const m = String(original).match(/\.(\d+)?$/);
  const decimals = m?.[1]?.length ?? 0;
  return value.toFixed(decimals);
};

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
