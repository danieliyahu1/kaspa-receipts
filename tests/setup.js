import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set up required DOM elements before app.js runs
document.body.innerHTML = `
  <input type="text" id="tx-input" spellcheck="false" autocomplete="off">
  <button id="generate-btn" aria-label="Generate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
  <div id="loading" class="hidden">
    <div class="spinner"></div>
    <div class="progress-bar-container hidden" id="progress-container">
      <div class="progress-bar" id="progress-bar"></div>
    </div>
  </div>
  <div id="error" class="error hidden" role="alert"></div>
  <div id="actions-bar" class="actions-bar hidden">
    <button class="card-btn card-btn-back" id="export-csv-btn" aria-label="Download CSV"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
  </div>
  <div id="result" class="hidden">
    <div class="receipt-card" id="receipt-card"></div>
    <div id="statement-card" class="hidden"></div>
  </div>
`;

// Suppress [Kaspa Statement] logs during tests
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// let/const declarations in indirect eval don't leak to global scope.
// Patch them to use globalThis so tests can access them.
let appCode = readFileSync(resolve(__dirname, '..', 'app.js'), 'utf-8');

appCode = appCode
  .replace('const ICONS = {', 'globalThis.ICONS = {')
  .replace('let receiptTx = null;', 'globalThis.receiptTx = null;')
  .replace('let statement = null;', 'globalThis.statement = null;')
  .replace('let priceMap = null;', 'globalThis.priceMap = null;')
  .replace('let currentPrice = null;', 'globalThis.currentPrice = null;');

// Evaluate app.js in global scope so its functions are available
(0, eval)(appCode);

// const declarations still need manual exposure
globalThis.API_BASE = 'https://api.kaspa.org';
globalThis.TX_HASH_REGEX = /^[a-f0-9]{64}$/;
globalThis.ADDRESS_REGEX = /^kaspa:[a-z0-9]{61,63}$/;
globalThis.PAGE_SIZE = 50;
globalThis.BYBIT_BASE = 'https://api.bybit.com';

// Mock clipboard API (not available in jsdom)
globalThis.navigator.clipboard = { writeText: () => {} };

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = () => {};

// Restore console
console.log = origLog;
console.warn = origWarn;
console.error = origError;
