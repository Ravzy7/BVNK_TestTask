import { request } from '@playwright/test';
import { writeJson, ensureDir, readJsonSafe } from '../utils/fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.BASE_URL || 'https://bvnksimulator.pythonanywhere.com';
const INIT_ENDPOINT = process.env.INIT_ENDPOINT || '/init';
const DATA_FILE = path.resolve(process.cwd(), 'testdata', 'testdata.json');

export async function getAuthContext() {
  const apiCtx = await request.newContext({ baseURL: BASE_URL });

  // Switched from POST to GET for INIT
  const resp = await apiCtx.get(INIT_ENDPOINT);

  if (!resp.ok()) {
    const text = await resp.text();
    console.error(`❌ INIT failed. Status: ${resp.status()} ${resp.statusText()}`);
    console.error('Response body:', text);
    throw new Error('Failed to initialize and get bearer token');
  }

  const data = await resp.json();
  const token = data.access_token;

  ensureDir(path.dirname(DATA_FILE));
  writeJson(DATA_FILE, { ...(readJsonSafe(DATA_FILE, {})), bearer: token });

  return { apiCtx, token, baseURL: BASE_URL, dataFile: DATA_FILE };
}
