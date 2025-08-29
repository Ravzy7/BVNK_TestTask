import fs from 'fs';

export function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

export function readJsonSafe<T = any>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, obj: any) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  console.log(`✅ Wrote JSON: ${filePath}`);
}

export function formatLike(original: string, value: number): string {
  const m = String(original).match(/\.(\d+)?$/);
  const decimals = m?.[1]?.length ?? 0;
  return value.toFixed(decimals);
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}