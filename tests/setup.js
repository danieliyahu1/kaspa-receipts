import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set up required DOM elements before app.js runs
document.body.innerHTML = `
  <input type="text" id="tx-input" spellcheck="false" autocomplete="off">
  <button id="generate-btn">Look Up</button>
  <div id="loading" class="hidden">
    <div class="spinner"></div>
    <p id="loading-text">Looking up your transaction…</p>
  </div>
  <div id="error" class="error hidden" role="alert"></div>
  <div id="result" class="hidden">
    <div class="receipt-card" id="receipt-card"></div>
    <div id="statement-card" class="hidden"></div>
  </div>
  <div id="date-range-section" class="date-range hidden">
    <label for="from-date">From</label>
    <input type="date" id="from-date" class="date-input" min="2021-11-11">
    <label for="to-date">To</label>
    <input type="date" id="to-date" class="date-input">
  </div>
`;

// Suppress [Kaspa Receipts] logs during tests
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
  .replace('let receiptTx = null;', 'globalThis.receiptTx = null;')
  .replace('let statement = null;', 'globalThis.statement = null;')
  .replace('let priceMap = null;', 'globalThis.priceMap = null;');

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
