BVNK Simulator API E2E Tests (Playwright + TypeScript)

End-to-end API tests for the BVNK simulator.
Covers token init, wallet fetching, quotes (trades), accepting quotes (with fee assertion), and balance checks, while persisting state to a JSON file across tests.

Features

Playwright + TypeScript API-only tests (no browser UI required)

Worker-scoped fixtures fetch a Bearer token before any test runs

Authenticated API context automatically attaches Authorization: Bearer <token>

Helper utilities for quotes, accept, wallet reads, polling, and formatting

Persistent test data in testdata/testdata.json (wallet IDs/balances, last quote UUID)

Deterministic flow via serial test execution

Prerequisites

Node.js v18+

npm / pnpm / yarn

Internet access to bvnksimulator.pythonanywhere.com

Install
# install deps
npm i

# (optional) install Playwright browsers – not required for API-only, but harmless
npx playwright install

Directory Structure
.
├─ tests/
│  ├─ api/
│  │  └─ bvnk.spec.ts               # serial test suite (quotes, accepts, balances)
│  ├─ fixtures/
│  │  └─ bvnk.ts                    # worker fixtures: token + authed API + testData store
│  └─ utils/
│     ├─ api.ts                     # API helpers (wallets, quote, accept, asserts, etc.)
│     └─ testdata.ts                # JSON store (read/write/merge)
├─ testdata/
│  └─ testdata.json                 # persisted state (auto-created)
├─ package.json
└─ README.md

Environment Variables (optional)

Defaults are baked in; override if needed (e.g., in .env or CI):

BASE_URL=http://bvnksimulator.pythonanywhere.com
INIT_ENDPOINT=/init
WALLETS_ENDPOINT=/api/wallet
QUOTE_URL=https://bvnksimulator.pythonanywhere.com/api/v1/quote

How It Works
Fixtures (tests/fixtures/bvnk.ts)

unauthApi (worker): plain API client used only to call /init

token (worker): fetched once via /init before any tests

api (worker): authenticated APIRequestContext with Authorization: Bearer <token> injected via extraHTTPHeaders

testData (test): JSON-backed store that persists wallets and lastQuoteUuid

Helpers (tests/utils/api.ts)

getToken(api) — POST/GET /init to obtain access token

fetchWallets(api) — GET /api/wallet

fetchWalletById(api, id) — GET /api/wallet/:id

postQuote(api, payload) — POST quote/trade

acceptQuote(api, uuid) — PUT accept quote

assertAcceptedWithServiceFee(body) — asserts status accepted and fees.percentage.service === 0.01

wait(ms) + formatLike(original, value) utilities

Test Data Store (tests/utils/testdata.ts)

read() / write() for the JSON file

getWallet(code) / upsertWallet(code, wallet) for wallet entries

setLastQuoteUuid(uuid) / getLastQuoteUuid()

Running Tests

Run all (serial):

npx playwright test
# or
npm test


Run a specific spec:

npx playwright test tests/api/bvnk.spec.ts --reporter=list


Run a test by title:

npx playwright test -g "QUOTE: 0.5 ETH -> USDT"


Debug:

npx playwright test --debug

What Gets Tested

Wallet discovery → JSON

Fetches wallets and writes compact records to testdata/testdata.json.

Quotes & UUID persistence

Creates quotes like:

1 ETH -> TRX

987 TRX -> ETH

0.5 ETH -> USDT

1000 USDT -> TRX

Saves lastQuoteUuid.

Accept quote & fees

Accepts the last quote.

Asserts status is accepted and service fee = 0.01.

Balance checks with polling

Verifies expected deltas and persists new balances:

ETH -1 (after ETH -> TRX)

TRX -987 (after TRX -> ETH)

ETH -0.5 (after ETH -> USDT)

USDT -1000 (after USDT -> TRX)

Refresh wallets

Reads latest balances by wallet ID and updates JSON store.

Tests run in serial to keep state deterministic.

Example testdata/testdata.json
{
  "wallets": {
    "ETH": {
      "id": "826",
      "balance": "2.20000",
      "available": "2.20000",
      "status": "ACTIVE",
      "protocol": "ETH",
      "pfx": "ETH"
    },
    "TRX": {
      "id": "827",
      "balance": "45213.00",
      "available": "45213.00",
      "status": "ACTIVE",
      "protocol": "TRX",
      "pfx": "TRX"
    },
    "USDT": {
      "id": "828",
      "balance": "9400.00",
      "available": "9400.00",
      "status": "ACTIVE",
      "protocol": "ERC20",
      "pfx": "USDT"
    }
  },
  "lastQuoteUuid": "8f5b3c4e-1a2b-4a6f-9c0d-123456789abc"
}


Reset state anytime:

rm -f testdata/testdata.json