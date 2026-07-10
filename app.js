const API_BASE = 'https://api.kaspa.org';
const TX_HASH_REGEX = /^[a-f0-9]{64}$/;
const ADDRESS_REGEX = /^kaspa:[a-z0-9]{61,63}$/;
const PAGE_SIZE = 50;
const BYBIT_BASE = 'https://api.bybit.com';

function log(...args) {
  console.log('[Kaspa Statement]', ...args);
}

function warn(...args) {
  console.warn('[Kaspa Statement]', ...args);
}

function error(...args) {
  console.error('[Kaspa Statement]', ...args);
}

const $ = (id) => document.getElementById(id);

const input = $('tx-input');
const button = $('generate-btn');
const loadingEl = $('loading');
const errorEl = $('error');
const resultEl = $('result');
const receiptCard = $('receipt-card');
const statementCard = $('statement-card');
let receiptTx = null;
let statement = null;
let priceMap = null;
let priceMapPromise = null;
let currentPrice = null;
let currentPricePromise = null;
let fetchGeneration = 0;

function showLoading(show) {
  loadingEl.classList.toggle('hidden', !show);
  button.classList.toggle('loading', show);
  button.disabled = show;
  if (!show) resetProgress();
}

function showError(message) {
  warn('Showing error:', message);
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  resultEl.classList.add('hidden');
}

function hideError() {
  errorEl.classList.add('hidden');
}

function formatDate(epochMs) {
  const d = new Date(epochMs);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short'
  });
}

function formatShortDate(epochMs) {
  const d = new Date(epochMs);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

function formatKAS(sompi) {
  const kas = Number(sompi) / 1e8;
  return kas.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' KAS';
}

function shortenHash(hash, chars = 8) {
  if (hash.length <= chars * 2) return hash;
  return hash.slice(0, chars) + '\u2026' + hash.slice(-chars);
}

function copyToClipboard(text, btnEl) {
  navigator.clipboard.writeText(text).then(() => {
    btnEl.textContent = 'Copied!';
    btnEl.classList.add('copied');
    setTimeout(() => {
      btnEl.textContent = 'Copy';
      btnEl.classList.remove('copied');
    }, 2000);
  });
}

function formatUSD(amount) {
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function getKasAmount(sompi) {
  return Number(sompi) / 1e8;
}

function getDateKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showProgress(current, total) {
  const bar = $('progress-bar');
  const container = $('progress-container');
  if (container) container.classList.remove('hidden');
  if (bar) {
    const pct = Math.min(100, Math.round((current / total) * 100));
    bar.style.width = pct + '%';
  }
}

function resetProgress() {
  const bar = $('progress-bar');
  const container = $('progress-container');
  if (container) container.classList.add('hidden');
  if (bar) bar.style.width = '0%';
}

async function fetchTransaction(txId) {
  log('Fetching transaction:', txId);
  const params = new URLSearchParams({
    inputs: 'true',
    outputs: 'true',
    resolve_previous_outpoints: 'light'
  });
  const url = `${API_BASE}/transactions/${txId}?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    error('Transaction fetch failed:', res.status, res.statusText);
    if (res.status === 404) throw new Error('Transaction not found. Check the hash and try again.');
    if (res.status === 422) throw new Error('Invalid transaction hash format.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  const data = await res.json();
  log('Transaction fetched:', txId, 'accepted:', data.is_accepted, 'time:', data.block_time);
  return data;
}

async function fetchAddressBalance(address) {
  log('Fetching balance for address:', address);
  const res = await fetch(`${API_BASE}/addresses/${address}/balance`);
  if (!res.ok) {
    error('Balance fetch failed:', res.status, res.statusText);
    throw new Error('Could not fetch address balance.');
  }
  const data = await res.json();
  log('Address balance:', address, 'balance:', data.balance);
  return data.balance;
}

async function fetchAddressTxs(address, offset = 0) {
  const url = `${API_BASE}/addresses/${address}/full-transactions?limit=${PAGE_SIZE}&offset=${offset}&resolve_previous_outpoints=light`;
  log('Fetching address txs:', address, 'offset:', offset);
  const res = await fetch(url);
  if (!res.ok) {
    error('Address txs fetch failed:', res.status, res.statusText);
    if (res.status === 404) throw new Error('Address not found. Check the address and try again.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  const data = await res.json();
  log('Address txs page:', offset, 'count:', data.length);
  return data;
}

async function fetchAddressTxCount(address) {
  log('Fetching tx count for address:', address);
  const res = await fetch(`${API_BASE}/addresses/${address}/transactions-count`);
  if (!res.ok) {
    error('Tx count fetch failed:', res.status, res.statusText);
    throw new Error('Could not fetch transaction count.');
  }
  const data = await res.json();
  log('Address tx count:', address, 'total:', data.total);
  return data.total;
}

async function fetchAddressTxsPage(address, before) {
  let url;
  if (before) {
    url = `${API_BASE}/addresses/${address}/full-transactions-page?after=0&before=${before}&limit=500&resolve_previous_outpoints=light`;
  } else {
    url = `${API_BASE}/addresses/${address}/full-transactions-page?after=0&limit=500&resolve_previous_outpoints=light`;
  }
  log('Fetching address txs page', before ? 'before: ' + before : '(first page)');
  const res = await fetch(url);
  if (!res.ok) {
    error('Address txs page fetch failed:', res.status, res.statusText);
    if (res.status === 404) throw new Error('Address not found. Check the address and try again.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  const txs = await res.json();
  const nextBefore = res.headers.get('X-Next-Page-Before');
  log('Address txs page count:', txs.length, 'nextBefore:', nextBefore);
  return { txs, nextBefore: nextBefore || null };
}

async function fetchAddressTxsOffset(address, offset, limit = 500) {
  const url = `${API_BASE}/addresses/${address}/full-transactions?limit=${limit}&offset=${offset}&resolve_previous_outpoints=light`;
  log('Fetching address txs offset:', address, 'offset:', offset, 'limit:', limit);
  const res = await fetch(url);
  if (!res.ok) {
    error('Address txs offset fetch failed:', res.status, res.statusText);
    if (res.status === 404) throw new Error('Address not found. Check the address and try again.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  const data = await res.json();
  log('Address txs offset page:', offset, 'count:', data.length);
  return data;
}

async function fetchPriceMap() {
  log('Fetching price map from Bybit...');
  try {
    const res = await fetch(`${BYBIT_BASE}/v5/market/kline?category=spot&symbol=KASUSDT&interval=D&limit=1000`);
    if (!res.ok) {
      warn('Price fetch returned', res.status);
      return null;
    }
    const json = await res.json();
    if (json.retCode !== 0 || !json.result?.list) {
      warn('Price API returned unexpected response:', json.retCode);
      return null;
    }
    const map = {};
    const todayKey = getDateKey(Date.now());
    let earliestTs = Infinity;
    json.result.list.forEach(candle => {
      const ts = parseInt(candle[0]);
      const key = getDateKey(ts);
      map[key] = key === todayKey ? parseFloat(candle[1]) : parseFloat(candle[4]);
      if (ts < earliestTs) earliestTs = ts;
    });
    if (earliestTs !== Infinity) map._earliest = earliestTs;
    log('Price map loaded. Entries:', Object.keys(map).length, 'earliest:', map._earliest ? formatShortDate(map._earliest) : 'N/A');
    return map;
  } catch (e) {
    warn('Price map fetch failed:', e.message);
    return null;
  }
}

async function fetchCurrentPrice() {
  log('Fetching current KAS price from kaspa.org...');
  try {
    const res = await fetch(`${API_BASE}/info/price`);
    if (!res.ok) {
      warn('Current price fetch returned', res.status);
      return null;
    }
    const json = await res.json();
    const price = parseFloat(json.price);
    log('Current KAS price:', price);
    return price;
  } catch (e) {
    warn('Current price fetch failed:', e.message);
    return null;
  }
}

function getTxDirection(tx, address) {
  const isSender = tx.inputs && tx.inputs.some(i => i.previous_outpoint_address === address);
  const hasExternalOutput = tx.outputs && tx.outputs.some(o => o.script_public_key_address !== address);
  const direction = isSender && hasExternalOutput ? 'sent' : isSender ? 'self' : 'received';
  log('Tx direction:', direction, 'for tx', tx.transaction_id?.slice(0, 12));
  return direction;
}

function getCounterparty(tx, address, direction) {
  if (direction === 'received') {
    const sender = tx.inputs && tx.inputs.find(i => i.previous_outpoint_address && i.previous_outpoint_address !== address);
    return sender ? sender.previous_outpoint_address : 'Coinbase';
  }
  if (direction === 'sent') {
    const receiver = tx.outputs && tx.outputs.find(o => o.script_public_key_address !== address);
    return receiver ? receiver.script_public_key_address : 'Unknown';
  }
  return address;
}

function getTxAmount(tx, address, direction) {
  if (direction === 'received') {
    return tx.outputs
      .filter(o => o.script_public_key_address === address)
      .reduce((sum, o) => sum + Number(o.amount), 0);
  }
  if (direction === 'sent') {
    return tx.outputs
      .filter(o => o.script_public_key_address !== address)
      .reduce((sum, o) => sum + Number(o.amount), 0);
  }
  return tx.outputs
    .filter(o => o.script_public_key_address === address)
    .reduce((sum, o) => sum + Number(o.amount), 0);
}

async function fetchAllTxsFromGenesis(address, onPage) {
  log('Fetching all txs from genesis for address:', address);
  const total = await fetchAddressTxCount(address);
  if (total === 0) {
    log('No transactions found for address');
    return [];
  }

  const allTxs = [];
  let pageNum = 0;
  const totalPages = Math.ceil(total / 500);

  showLoading(true);
  const { txs: firstPageTxs, nextBefore } = await fetchAddressTxsPage(address, null);
  pageNum++;
  allTxs.push(...firstPageTxs);
  showProgress(pageNum, totalPages);
  if (onPage) onPage([...allTxs], pageNum, totalPages, total);

  if (nextBefore) {
    const promises = [];
    let done = 0;
    let offset = 500;
    while (offset < total) {
      const off = offset;
      promises.push(
        fetchAddressTxsOffset(address, off, 500)
          .catch(err => {
            error('Parallel fetch failed at offset', off, err.message);
            return [];
          })
          .then(txs => {
            done++;
            showProgress(pageNum + done, totalPages);
            return txs;
          })
      );
      offset += 500;
    }
    const results = await Promise.all(promises);
    await new Promise(r => setTimeout(r, 0));
    for (const txs of results) {
      allTxs.push(...txs);
    }
  }

  allTxs.reverse();
  log('All txs fetched from genesis and reversed. Total:', allTxs.length);
  return allTxs;
}

function buildFIFOQueue(txs, address, priceMap) {
  log('Building FIFO queue from', txs.length, 'transactions');
  const lots = [];
  const txGains = {};

  for (const tx of txs) {
    const direction = getTxDirection(tx, address);
    if (direction === 'self') {
      log('FIFO: skip self tx', tx.transaction_id?.slice(0, 12));
      continue;
    }

    const amount = getTxAmount(tx, address, direction);
    const dateKey = getDateKey(tx.block_time);
    const price = priceMap ? priceMap[dateKey] : null;

    if (priceMap && price === null && priceMap[dateKey] === undefined) {
      log('FIFO: no price entry for date key', dateKey, 'tx', tx.transaction_id?.slice(0, 12), '— priceMap has', Object.keys(priceMap).length, 'keys');
    }

    if (direction === 'received') {
      lots.push({
        amount,
        costBasisPerKas: price || 0,
        timestamp: tx.block_time,
        txId: tx.transaction_id
      });
      log('FIFO: lot created for', tx.transaction_id?.slice(0, 12), '—', getKasAmount(amount), 'KAS at $' + (price != null ? price : 0), 'per KAS');
    } else if (direction === 'sent') {
      log('FIFO: processing send', tx.transaction_id?.slice(0, 12), '—', getKasAmount(amount), 'KAS, sale price:', price != null ? '$' + price : 'N/A', ', lots available:', lots.length);

      let remaining = amount;
      let totalSaleValue = 0;
      let totalCostBasis = 0;

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const consumed = Math.min(remaining, lot.amount);
        const kasConsumed = getKasAmount(consumed);
        const salePrice = price || 0;

        totalSaleValue += kasConsumed * salePrice;
        totalCostBasis += kasConsumed * lot.costBasisPerKas;

        log('FIFO: consumed', kasConsumed, 'KAS from lot', lot.txId?.slice(0, 12), '(cost basis: $' + lot.costBasisPerKas + '/KAS)');

        lot.amount -= consumed;
        remaining -= consumed;
        if (lot.amount === 0) lots.shift();
      }

      if (remaining > 0) {
        warn('FIFO: insufficient lots for tx', tx.transaction_id?.slice(0, 12), '— unmatched:', getKasAmount(remaining), 'KAS');
      }

      const gain = totalSaleValue - totalCostBasis;
      txGains[tx.transaction_id] = {
        gain,
        saleValue: totalSaleValue,
        costBasis: totalCostBasis
      };
      log('FIFO: send complete', tx.transaction_id?.slice(0, 12), '— gain: $' + gain, 'saleValue: $' + totalSaleValue, 'costBasis: $' + totalCostBasis);
    }
  }

  let remainingCostBasis = 0;
  let remainingAmountSompi = 0;
  for (const lot of lots) {
    remainingCostBasis += getKasAmount(lot.amount) * lot.costBasisPerKas;
    remainingAmountSompi += lot.amount;
  }

  log('FIFO queue built. Lots remaining:', lots.length, 'txs with gains:', Object.keys(txGains).length);
  log('FIFO queue: remaining cost basis: $' + remainingCostBasis.toFixed(2), 'remaining KAS:', getKasAmount(remainingAmountSompi));
  return { txGains, remainingCostBasis, remainingAmountSompi };
}

function renderReceipt(tx, price) {
  log('Rendering receipt for tx:', tx.transaction_id?.slice(0, 12), 'price:', price);
  receiptTx = { tx, price };
  receiptCard.classList.remove('hidden');
  const accepted = tx.is_accepted;
  const blockTime = tx.block_time;
  const inputs = tx.inputs || [];
  const outputs = tx.outputs || [];

  const fromAddresses = [...new Set(
    inputs.map(i => i.previous_outpoint_address).filter(Boolean)
  )];

  const externalOutputs = outputs
    .filter(o => !fromAddresses.includes(o.script_public_key_address))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  const changeOutputs = outputs.filter(o => fromAddresses.includes(o.script_public_key_address));
  const sortedOutputs = [...externalOutputs, ...changeOutputs];

  const totalSompi = outputs.reduce((sum, o) => sum + Number(o.amount), 0);
  const totalKas = getKasAmount(totalSompi);
  const usdTotal = price ? totalKas * price : null;

  receiptCard.innerHTML = `
    <div class="receipt-header">
      <h2>Kaspa Receipt</h2>
    </div>

    <div class="receipt-status">
      <span class="status-badge ${accepted ? 'accepted' : 'pending'}">
        ${accepted ? '<span class="check">&#10003;</span> Confirmed' : '<span class="check">&#9679;</span> Pending'}
      </span>
    </div>

    <div class="receipt-meta">
      <div class="meta-row">
        <span class="meta-label">Date &amp; Time</span>
        <span class="meta-value">${formatDate(blockTime)}</span>
      </div>
    </div>

    <div class="receipt-section">
      <div class="section-label">From</div>
      ${fromAddresses.length
        ? fromAddresses.map(addr => `
            <div class="address-block">
              <span class="address">${shortenHash(addr, 12)}</span>
              <button class="copy-btn" data-copy="${escapeHtml(addr)}">Copy</button>
            </div>
          `).join('')
        : '<span class="address" style="color:#aeaeb2">Coinbase (new block reward)</span>'
      }
    </div>

    <div class="receipt-section">
      <div class="section-label">To</div>
      <div class="output-list">
        ${sortedOutputs.map(o => `
          <div class="output-row">
            <span class="output-address">
              ${shortenHash(o.script_public_key_address, 12)}
              <button class="copy-btn" data-copy="${escapeHtml(o.script_public_key_address)}">Copy</button>
            </span>
            <span class="output-amount">${formatKAS(o.amount)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="receipt-total">
      <span class="total-label">Total</span>
      <div class="total-values">
        <span class="total-amount">${formatKAS(totalSompi)}</span>
        ${usdTotal !== null ? `<span class="total-usd">≈ ${formatUSD(usdTotal)} USD</span>` : `<span class="total-usd na">$N/A</span>${priceMap?._earliest ? `<div class="receipt-note">No price data prior to ${formatShortDate(priceMap._earliest)}</div>` : ''}`}
      </div>
    </div>

    <div class="receipt-ref">
      <span class="receipt-ref-label">Transaction ID</span>
      <div class="receipt-ref-hash">
        ${shortenHash(tx.transaction_id, 12)}
        <button class="copy-btn" data-copy="${escapeHtml(tx.transaction_id)}">Copy</button>
      </div>
    </div>

  `;
}

function renderProfitSummary(txs, address, txGains, fifoSummary, balance, loadingMore) {
  if (!txs.length) return '';

  let receivedSompi = 0, sentSompi = 0;
  let hadMissingPrice = false;

  txs.forEach(tx => {
    const direction = getTxDirection(tx, address);
    const amount = getTxAmount(tx, address, direction);
    const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
    if (!price && priceMap) hadMissingPrice = true;

    if (direction === 'received') {
      receivedSompi += amount;
    } else if (direction === 'sent') {
      sentSompi += amount;
    } else if (direction === 'self') {
      receivedSompi += amount;
      sentSompi += amount;
    }
  });
  log('ProfitSummary: received:', getKasAmount(receivedSompi), 'KAS, sent:', getKasAmount(sentSompi), 'KAS, hasUsd:', !!priceMap);

  const netSompi = receivedSompi - sentSompi;
  const hasUsd = priceMap !== null;
  const { remainingCostBasis = 0, remainingAmountSompi = 0 } = fifoSummary || {};
  const remainingKas = remainingAmountSompi ? getKasAmount(remainingAmountSompi) : 0;
  const showCostBasis = hasUsd && (remainingCostBasis > 0 || remainingAmountSompi > 0);

  const costBasisRow = loadingMore && hasUsd
    ? `<div class="summary-divider"></div>
      <div class="summary-row summary-cost-basis">
        <span class="summary-label">Cost Basis</span>
        <div class="summary-values">
          <div class="summary-usd cost-basis-value loading-placeholder"><span class="placeholder-spinner"></span></div>
        </div>
      </div>`
    : showCostBasis
      ? `<div class="summary-divider"></div>
        <div class="summary-row summary-cost-basis">
          <span class="summary-label">Cost Basis</span>
          <div class="summary-values">
            <div class="summary-usd cost-basis-value">${formatUSD(remainingCostBasis)}</div>
          </div>
        </div>`
      : '';

  const avgPriceRow = loadingMore && hasUsd
    ? `<div class="summary-row summary-avg-price">
        <span class="summary-label">Avg Buy Price</span>
        <div class="summary-values">
          <div class="summary-usd avg-price-value loading-placeholder"><span class="placeholder-spinner"></span></div>
        </div>
      </div>`
    : remainingKas > 0 && showCostBasis
      ? `<div class="summary-row summary-avg-price">
          <span class="summary-label">Avg Buy Price</span>
          <div class="summary-values">
            <div class="summary-usd avg-price-value">${formatUSD(remainingCostBasis / remainingKas)} per KAS</div>
          </div>
        </div>`
      : '';

  const currentValueRow = loadingMore && balance > 0
    ? `<div class="summary-divider"></div>
      <div class="summary-row summary-current-value">
        <span class="summary-label">Current Value</span>
        <div class="summary-values">
          <div class="summary-usd current-value-amount loading-placeholder"><span class="placeholder-spinner"></span></div>
        </div>
      </div>`
    : currentPrice !== null && balance > 0
      ? `<div class="summary-divider"></div>
        <div class="summary-row summary-current-value">
          <span class="summary-label">Current Value</span>
          <div class="summary-values">
            <div class="summary-usd current-value-amount">${formatUSD(getKasAmount(balance) * currentPrice)}</div>
          </div>
        </div>`
      : '';

  const profitRow = loadingMore && hasUsd && balance > 0
    ? `<div class="summary-divider"></div>
      <div class="summary-row summary-current-value">
        <span class="summary-label">Profit / Loss</span>
        <div class="summary-values">
          <div class="summary-usd current-value-amount loading-placeholder"><span class="placeholder-spinner"></span></div>
        </div>
      </div>`
    : currentPrice !== null && balance > 0 && showCostBasis
      ? (() => {
          const currentValue = getKasAmount(balance) * currentPrice;
          const profit = currentValue - remainingCostBasis;
          const isProfit = profit >= 0;
          return `<div class="summary-divider"></div>
            <div class="summary-row summary-profit">
              <span class="summary-label">Unrealized Profit</span>
              <div class="summary-values">
                <div class="summary-usd profit-value">${isProfit ? '+' : ''}${formatUSD(profit)}</div>
              </div>
            </div>`;
      })()
    : '';

  const realizedGainRow = loadingMore && hasUsd
    ? `<div class="summary-divider"></div>
      <div class="summary-row summary-profit">
        <span class="summary-label">Realized Gain</span>
        <div class="summary-values">
          <div class="summary-usd profit-value loading-placeholder"><span class="placeholder-spinner"></span></div>
        </div>
      </div>`
    : hasUsd
      ? (() => {
          let totalRealized = 0;
          for (const txId of Object.keys(txGains || {})) {
            totalRealized += txGains[txId].gain;
          }
          return `<div class="summary-divider"></div>
            <div class="summary-row summary-profit">
              <span class="summary-label">Realized Profit</span>
              <div class="summary-values">
                <div class="summary-usd profit-value">${totalRealized >= 0 ? '+' : ''}${formatUSD(totalRealized)}</div>
              </div>
            </div>`;
        })()
      : '';

  return `
    <div class="net-summary">
      <div class="summary-title">Summary</div>
      <div class="summary-row">
        <span class="summary-label">Received</span>
        <div class="summary-values">
          <div class="summary-kas">${formatKAS(receivedSompi)}</div>
        </div>
      </div>
      <div class="summary-row">
        <span class="summary-label">Sent</span>
        <div class="summary-values">
          <div class="summary-kas">${formatKAS(sentSompi)}</div>
        </div>
      </div>
      ${costBasisRow}
      ${avgPriceRow}
      ${currentValueRow}
      ${profitRow}
      ${realizedGainRow}
      ${hadMissingPrice ? `<div class="summary-note">Some prices estimated prior to ${formatShortDate(priceMap._earliest)}</div>` : ''}
    </div>
  `;
}

function exportCSV() {
  if (!statement) { warn('exportCSV called but statement is null'); return; }
  if (statement._loadingMore) { warn('exportCSV called while data still loading'); return; }
  const { address, txs } = statement;

  const headers = ['Date', 'Direction', 'Amount (KAS)', 'USD Value', 'Cost Basis (USD)', 'Realized Gain (USD)', 'Counterparty', 'Transaction ID', 'Status'];
  const rows = txs.map(tx => {
    const direction = getTxDirection(tx, address);
    const counterparty = getCounterparty(tx, address, direction);
    const amount = getTxAmount(tx, address, direction);
    const kas = getKasAmount(amount);
    const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
    const usd = price ? formatUSD(kas * price) : '';
    const status = tx.is_accepted ? 'Confirmed' : 'Pending';
    const gain = (statement.txGains || {})[tx.transaction_id];
    const costBasis = gain ? formatUSD(gain.costBasis) : '';
    const realizedGain = gain ? `${gain.gain >= 0 ? '+' : ''}${formatUSD(gain.gain)}` : '';
    return [
      formatShortDate(tx.block_time),
      direction === 'sent' ? 'Sent' : (direction === 'self' ? 'Self' : 'Received'),
      kas,
      usd,
      costBasis,
      realizedGain,
      counterparty,
      tx.transaction_id,
      status
    ];
  });

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => {
      const str = String(cell);
      return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kaspa-history-${address.slice(0, 12)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  log('CSV exported:', link.download);
}

function exportReceiptCSV() {
  if (!receiptTx) { warn('exportReceiptCSV called but no receipt'); return; }
  const { tx, price } = receiptTx;
  const accepted = tx.is_accepted;
  const blockTime = tx.block_time;
  const inputs = tx.inputs || [];
  const outputs = tx.outputs || [];
  const fromAddresses = [...new Set(inputs.map(i => i.previous_outpoint_address).filter(Boolean))];
  const fromStr = fromAddresses.length ? fromAddresses.join('; ') : 'Coinbase';
  const status = accepted ? 'Confirmed' : 'Pending';

  const headers = ['Date', 'Status', 'From', 'To', 'Amount (KAS)', 'USD Value', 'Transaction ID'];
  const rows = outputs.map(o => {
    const kas = getKasAmount(o.amount);
    const usd = price ? formatUSD(kas * price) : '';
    return [
      formatShortDate(blockTime),
      status,
      fromStr,
      o.script_public_key_address,
      kas,
      usd,
      tx.transaction_id
    ];
  });

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => {
      const str = String(cell);
      return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kaspa-tx-${tx.transaction_id.slice(0, 12)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  log('Receipt CSV exported:', link.download);
}

function buildPagination(current, total) {
  if (total <= 1) return '';

  let html = '<div class="pagination">';

  html += `<button class="page-btn" data-page="${current - 1}" ${current === 0 ? 'disabled' : ''}>&#171; Prev</button>`;

  const maxVisible = 7;
  let start = Math.max(0, current - Math.floor(maxVisible / 2));
  let end = Math.min(total - 1, start + maxVisible - 1);
  if (end - start < maxVisible - 1) {
    start = Math.max(0, end - maxVisible + 1);
  }

  if (start > 0) {
    html += `<button class="page-btn" data-page="0">1</button>`;
    if (start > 1) html += '<span class="page-ellipsis">&#8230;</span>';
  }

  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn${i === current ? ' active' : ''}" data-page="${i}">${i + 1}</button>`;
  }

  if (end < total - 1) {
    if (end < total - 2) html += '<span class="page-ellipsis">&#8230;</span>';
    html += `<button class="page-btn" data-page="${total - 1}">${total}</button>`;
  }

  html += `<button class="page-btn" data-page="${current + 1}" ${current >= total - 1 ? 'disabled' : ''}>Next &#187;</button>`;

  html += '</div>';
  return html;
}

function renderStatement() {
  if (!statement) { warn('renderStatement called but statement is null'); return; }
  const { address, balance, txs, page, _loadingMore } = statement;
  const startIdx = page * PAGE_SIZE;
  const pageTxs = txs.slice(startIdx, startIdx + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(txs.length / PAGE_SIZE));

  const summaryHtml = renderProfitSummary(txs, address, statement.txGains, statement.fifoSummary, statement.balance, _loadingMore);

  let txRows = '';
  pageTxs.forEach((tx) => {
    const direction = getTxDirection(tx, address);
    const counterparty = getCounterparty(tx, address, direction);
    const amount = getTxAmount(tx, address, direction);
    const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
    const usdAmount = price ? getKasAmount(amount) * price : null;

    const isSent = direction === 'sent';
    const symbol = isSent ? '&#8599;' : '&#8600;';
    const label = isSent ? 'Sent' : (direction === 'self' ? 'Self' : 'Received');
    const amtClass = direction === 'self' ? 'amt-self' : (isSent ? 'amt-sent' : 'amt-received');

    const counterShort = counterparty.length > 30
      ? counterparty.slice(0, 16) + '\u2026' + counterparty.slice(-6)
      : counterparty;

    const status = !tx.is_accepted
      ? '<span class="tx-status unconfirmed">Pending</span>'
      : '';

    txRows += `
      <div class="tx-row" data-tx-id="${tx.transaction_id}">
        <div class="tx-left">
          <span class="tx-date">${formatShortDate(tx.block_time)}</span>
          <span class="tx-counter">${escapeHtml(counterShort)}</span>
        </div>
        <div class="tx-right">
          <span class="tx-direction ${amtClass}">${symbol} ${label}</span>
          <span class="tx-amount ${amtClass}">${formatKAS(amount)}</span>
          ${usdAmount !== null ? `<span class="tx-usd">${formatUSD(usdAmount)}</span>` : '<span class="tx-usd na">$N/A</span>'}
          ${status}
        </div>
      </div>
    `;
  });

  const loadingBanner = _loadingMore ? `
    <div class="loading-more">
      <span class="spinner"></span>
      <span class="loading-more-text">Loading remaining pages\u2026</span>
    </div>
  ` : '';

  statementCard.innerHTML = `
    <div class="statement-header">
      <h2>Kaspa Statement</h2>
      <div class="statement-address">
        ${shortenHash(address, 12)}
        <button class="copy-btn" data-copy="${escapeHtml(address)}">Copy</button>
      </div>
      <div class="statement-balance">Balance: <strong>${formatKAS(balance)}</strong></div>
      ${summaryHtml}
    </div>
    <div class="tx-list">
      <div class="tx-list-header">
        <span>${_loadingMore ? `${formatNumber(txs.length)} of ${formatNumber(statement._totalTxCount)} transactions` : `${txs.length} transaction${txs.length !== 1 ? 's' : ''}`}</span>
      </div>
      ${txRows || '<div class="tx-empty">No transactions found in this date range.</div>'}
      ${loadingBanner}
    </div>
    ${_loadingMore ? `<div class="pagination"><button class="page-btn" disabled>&#171; Prev</button><span class="page-info">Page 1 of ${Math.ceil(statement._totalTxCount / PAGE_SIZE)}</span><button class="page-btn" disabled>Next &#187;</button></div>` : buildPagination(page, totalPages)}
  `;

  receiptCard.classList.add('hidden');
  statementCard.classList.remove('hidden');
  $('actions-bar').innerHTML = '<button class="card-btn card-btn-back" id="export-csv-btn">Download CSV</button>';
  $('actions-bar').classList.remove('hidden');
}

function goToPage(page) {
  if (!statement) { warn('goToPage called but statement is null'); return; }
  if (statement._loadingMore) { warn('goToPage: data still loading'); return; }
  const totalPages = Math.ceil(statement.txs.length / PAGE_SIZE);
  if (page < 0 || page >= totalPages) { warn('goToPage: invalid page', page, 'totalPages:', totalPages); return; }
  log('Going to page:', page);
  statement.page = page;
  renderStatement();
}

async function showTxDetail(txId) {
  log('Showing tx detail:', txId);
  showLoading(true);
  try {
    const tx = await fetchTransaction(txId);
    const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
    statementCard.classList.add('hidden');
    receiptCard.classList.remove('hidden');
    renderReceipt(tx, price);
    $('actions-bar').innerHTML = '<button class="card-btn card-btn-back" id="back-btn">&#8592; Back to Statement</button><button class="card-btn card-btn-back" id="export-receipt-btn">Download CSV</button>';
    $('actions-bar').classList.remove('hidden');
  } catch (err) {
    error('showTxDetail error:', err.message);
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

function refreshUSD() {
  if (!priceMap) { log('refreshUSD: no price map, skipping'); return; }
  log('refreshUSD: refreshing USD values');
  if (receiptTx) {
    const price = priceMap[getDateKey(receiptTx.tx.block_time)] ?? null;
    renderReceipt(receiptTx.tx, price);
  } else if (statement) {
    if (statement.allTxs && !statement._gainsComputed) {
      log('refreshUSD: re-computing FIFO gains with price data');
      const fifoResult = buildFIFOQueue(statement.allTxs, statement.address, priceMap);
      statement.txGains = fifoResult.txGains;
      statement.fifoSummary = { remainingCostBasis: fifoResult.remainingCostBasis, remainingAmountSompi: fifoResult.remainingAmountSompi };
      statement._gainsComputed = true;
    }
    renderStatement();
  }
}

function resetForm() {
  log('Resetting form');
  input.value = '';
  input.focus();
  resultEl.classList.add('hidden');
  receiptCard.classList.add('hidden');
  statementCard.classList.add('hidden');
  $('actions-bar').classList.add('hidden');
  receiptTx = null;
  statement = null;
  hideError();
}

async function handleGenerate() {
  const raw = input.value.trim().toLowerCase();
  log('handleGenerate triggered with input:', raw);
  hideError();
  resultEl.classList.add('hidden');
  receiptCard.classList.add('hidden');
  statementCard.classList.add('hidden');

  if (!raw) {
    input.classList.add('error');
    showError('Please enter a transaction ID or wallet address.');
    input.focus();
    return;
  }

  input.classList.remove('error');
  showLoading(true);

  try {
    if (priceMapPromise) {
      log('Waiting for price map to load...');
      await priceMapPromise;
      log('Price map ready:', !!priceMap);
    }

    if (TX_HASH_REGEX.test(raw)) {
      log('Input matched TX hash pattern');
      receiptTx = null;
      statement = null;
      const tx = await fetchTransaction(raw);
      const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
      renderReceipt(tx, price);
      $('actions-bar').innerHTML = '<button class="card-btn card-btn-back" id="export-receipt-btn">Download CSV</button>';
      $('actions-bar').classList.remove('hidden');
    } else if (ADDRESS_REGEX.test(raw)) {
      log('Input matched address pattern');
      statement = null;
      const bal = await fetchAddressBalance(raw);

      let firstPage = true;
      const gen = ++fetchGeneration;
      const allTxs = await fetchAllTxsFromGenesis(raw, (partialTxs, pageNum, totalPages, total) => {
        if (gen !== fetchGeneration) return;
        if (firstPage && partialTxs.length > 0) {
          firstPage = false;
          statement = {
            address: raw, balance: bal,
            txs: partialTxs,
            allTxs: null,
            txGains: {}, fifoSummary: {},
            page: 0, _gainsComputed: false, _loadingMore: true,
            _totalTxCount: total
          };
          renderStatement();
          resultEl.classList.remove('hidden');
          resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });

      log('All txs from genesis:', allTxs.length);
      const fifoResult = buildFIFOQueue(allTxs, raw, priceMap);
      const txs = [...allTxs].reverse();
      log('Display txs:', txs.length);
      statement = {
        address: raw, balance: bal, txs, allTxs,
        txGains: fifoResult.txGains,
        fifoSummary: { remainingCostBasis: fifoResult.remainingCostBasis, remainingAmountSompi: fifoResult.remainingAmountSompi },
        page: 0, _gainsComputed: true, _loadingMore: false
      };
      renderStatement();
    } else {
      warn('Input did not match TX hash or address pattern');
      showError('That doesn\'t look like a Kaspa transaction or address. Try again.');
      showLoading(false);
      return;
    }
    resultEl.classList.remove('hidden');
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    error('handleGenerate error:', err.message);
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

function handleInput() {
  const val = input.value.trim().toLowerCase();
  log('Input changed:', val);
  input.classList.remove('error');
  hideError();
}

function initEventListeners() {
  log('Initializing event listeners');
  input.addEventListener('input', handleInput);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleGenerate(); });
  button.addEventListener('click', handleGenerate);

  receiptCard.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn && copyBtn.dataset.copy) { log('Copy clicked:', copyBtn.dataset.copy.slice(0, 12)); copyToClipboard(copyBtn.dataset.copy, copyBtn); return; }
  });

  statementCard.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn && copyBtn.dataset.copy) { copyToClipboard(copyBtn.dataset.copy, copyBtn); return; }

    const row = e.target.closest('.tx-row');
    if (row && row.dataset.txId) { log('Tx row clicked:', row.dataset.txId); showTxDetail(row.dataset.txId); return; }

    const pageBtn = e.target.closest('.page-btn');
    if (pageBtn && !pageBtn.disabled && pageBtn.dataset.page !== undefined) {
      const page = parseInt(pageBtn.dataset.page);
      log('Page button clicked:', page);
      goToPage(page);
      return;
    }

  });

  $('actions-bar').addEventListener('click', (e) => {
    if (e.target.closest('#back-btn') && statement) {
      log('Back to statement clicked');
      renderStatement();
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (e.target.closest('#export-receipt-btn')) {
      log('Export receipt clicked');
      exportReceiptCSV();
      return;
    }

    if (e.target.closest('#export-csv-btn')) {
      log('Export CSV clicked');
      exportCSV();
    }
  });
}

log('App starting...');
priceMapPromise = fetchPriceMap().then(map => {
  log('Price map initialization complete. Available:', !!map);
  priceMap = map;
  refreshUSD();
  return map;
});
currentPricePromise = fetchCurrentPrice().then(price => {
  log('Current price initialization complete. Price:', price);
  currentPrice = price;
  refreshUSD();
  return price;
});
initEventListeners();
log('App initialized.');
