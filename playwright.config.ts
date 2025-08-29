import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';


dotenv.config();


export default defineConfig({
testDir: 'tests',
timeout: 60_000,
expect: { timeout: 15_000 },
reporter: [['list'], ['html', { open: 'never' }]],
use: {
// NOTE: we DO NOT rely on built-in baseURL inside fixtures to avoid the
// "worker fixture cannot depend on test fixture 'baseURL'" problem.
// We read BASE_URL via process.env in our custom fixture instead.
},
workers: 1, // the suite is serial by design (quote -> accept -> balances)
});