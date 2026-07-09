# Kaspa Receipts

Generate printable receipts, transaction history, and tax summaries for Kaspa wallet addresses.

A pure client-side single-page app. No backend, no database, no build step — just a static HTML file you can open in a browser or deploy anywhere.

## Live Website

**[kaspa-receipts.onrender.com](https://kaspa-receipts.onrender.com/)** — hosted on Render's global CDN. No installation required.

## Features

- **Transaction Receipt** — Paste a Kaspa TX hash to see a paper-style receipt with from/to addresses, amounts, confirmation status, and USD value.
- **Wallet History** — Enter a `kaspa:` address with a date range to get a paginated transaction history with net summary.
- **FIFO Cost-Basis Tracking** — Automatically computes realized gain/loss on every sent transaction using First-In-First-Out lot accounting across the full wallet history. Cost basis, sale value, and profit are shown per-transaction and aggregated in the summary.
- **USD Pricing** — Fetches daily KAS/USDT rates from Bybit (up to 1000 days). USD equivalents shown on receipts, statement rows, net summary, and CSV export.
- **Transaction Classification** — Automatically detects `Received`, `Sent`, or `Self` (self-transfer) transactions.
- **CSV Export** — Download transaction history as a CSV file including cost basis and realized gain columns.
- **Dark Mode** — Full dark theme with Kaspa brand colors.

## Usage

### Single Transaction

1. Paste a 64-character transaction hash (hex) into the input.
2. Click **Look Up**.
3. View the receipt showing from/to addresses, amounts, and USD value.

### Wallet History

1. Paste a `kaspa:` wallet address (61–63 characters).
2. Select a date range (defaults to the last 12 months).
3. Click **Look Up**.
4. Browse the paginated transaction list. Click any row to drill into its receipt.
5. Each sent transaction displays its realized gain/loss based on FIFO lot matching.

## Run Locally

No build step required. Serve the project directory with any static file server:

```bash
npx serve .
# or
python -m http.server
# or
npx http-server
```

Then open the address shown in your terminal.

## Run Tests

```bash
npm install
npm test
```

Uses [Vitest](https://vitest.dev/) with [jsdom](https://github.com/jsdom/jsdom). 130+ tests covering API, DOM rendering, utility functions, and FIFO cost-basis logic.

## API

All data is fetched live from:

- **Kaspa public API** — `api.kaspa.org` for transactions, balances, and address history.
- **Bybit v5 API** — `api.bybit.com` for daily KAS/USDT klines (up to 1000 days).

No data is stored locally. No server-side components.

## Tech Stack

- Vanilla JavaScript (ES modules)
- CSS custom properties
- Vitest + jsdom for testing

No frameworks, no bundlers, no build step.

## License

MIT
