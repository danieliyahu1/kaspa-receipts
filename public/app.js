const TX_HASH_REGEX = /^[a-f0-9]{64}$/;
const ADDRESS_REGEX = /^kaspa(?:test)?:[a-z0-9]{61,63}$/;
const PAGE_SIZE = 50;

const debugLog = [];
const MAX_DEBUG_LOG = 500;

function debugEntry(level, args) {
  const entry = { level, timestamp: Date.now(), args: args.map(a => a instanceof Error ? { message: a.message, stack: a.stack } : a) };
  debugLog.push(entry);
  if (debugLog.length > MAX_DEBUG_LOG) debugLog.shift();
}

function dumpDebugLog() {
  console.group('[Kaspa Statement] Debug Log');
  debugLog.forEach(e => {
    const time = new Date(e.timestamp).toISOString().slice(11, 23);
    console.log(`[${time}] [${e.level}]`, ...e.args);
  });
  console.groupEnd();
}

function log(...args) {
  debugEntry('log', args);
  console.log('[Kaspa Statement]', ...args);
}

function warn(...args) {
  debugEntry('warn', args);
  console.warn('[Kaspa Statement]', ...args);
}

function error(...args) {
  debugEntry('error', args);
  console.error('[Kaspa Statement]', ...args);
}

const $ = (id) => document.getElementById(id);

const ICONS = {
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  arrowLeft: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  chevronLeft: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  chevronRight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
};

const input = $('tx-input');
const button = $('generate-btn');
const loadingEl = $('loading');
const errorEl = $('error');
const resultEl = $('result');
const receiptCard = $('receipt-card');
const statementCard = $('statement-card');

let cachedStatement = null;
let cachedReceipt = null;
let cachedPriceMap = null;
let cachedCurrentPrice = null;

const API_PATH = window.location.origin;

function showLoading(show) {
  loadingEl.classList.toggle('hidden', !show);
  button.classList.toggle('loading', show);
  button.disabled = show;
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
    btnEl.innerHTML = ICONS.check;
    btnEl.classList.add('copied');
    setTimeout(() => {
      btnEl.innerHTML = ICONS.copy;
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

function getTxDirection(tx, address) {
  const isSender = tx.inputs && tx.inputs.some(i => i.previous_outpoint_address === address);
  const hasExternalOutput = tx.outputs && tx.outputs.some(o => o.script_public_key_address !== address);
  return isSender && hasExternalOutput ? 'sent' : isSender ? 'self' : 'received';
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

function renderReceipt(tx, price, priceMap) {
  cachedReceipt = { tx, price, priceMap };
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
              <button class="copy-btn" data-copy="${escapeHtml(addr)}">${ICONS.copy}</button>
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
              <button class="copy-btn" data-copy="${escapeHtml(o.script_public_key_address)}">${ICONS.copy}</button>
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
        <button class="copy-btn" data-copy="${escapeHtml(tx.transaction_id)}">${ICONS.copy}</button>
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
    const price = cachedPriceMap ? cachedPriceMap[getDateKey(tx.block_time)] : null;
    if (!price && cachedPriceMap) hadMissingPrice = true;

    if (direction === 'received') {
      receivedSompi += amount;
    } else if (direction === 'sent') {
      sentSompi += amount;
    } else if (direction === 'self') {
      receivedSompi += amount;
      sentSompi += amount;
    }
  });

  const hasUsd = cachedPriceMap !== null;
  const { remainingCostBasis = 0, remainingAmountSompi = 0 } = fifoSummary || {};
  const remainingKas = remainingAmountSompi ? getKasAmount(remainingAmountSompi) : 0;
  const showCostBasis = hasUsd && (remainingCostBasis > 0 || remainingAmountSompi > 0);

  let costBasisContent = '';
  let avgPriceContent = '';
  let pAndLContent = '';

  if (showCostBasis) {
    costBasisContent = `<div class="summary-row summary-cost-basis">
      <span class="summary-label">Cost Basis</span>
      <div class="summary-values">
        <div class="summary-usd cost-basis-value">${formatUSD(remainingCostBasis)}</div>
      </div>
    </div>`;
  }
  if (remainingKas > 0 && showCostBasis) {
    avgPriceContent = `<div class="summary-row summary-avg-price">
      <span class="summary-label">Avg Buy Price</span>
      <div class="summary-values">
        <div class="summary-usd avg-price-value">${formatUSD(remainingCostBasis / remainingKas)} per KAS</div>
      </div>
    </div>`;
  }
  if (cachedCurrentPrice !== null && balance > 0) {
    pAndLContent += `<div class="summary-row summary-current-value">
      <span class="summary-label">Current Value</span>
      <div class="summary-values">
        <div class="summary-usd current-value-amount">${formatUSD(getKasAmount(balance) * cachedCurrentPrice)}</div>
      </div>
    </div>`;
  }
  if (cachedCurrentPrice !== null && balance > 0 && showCostBasis) {
    const currentValue = getKasAmount(balance) * cachedCurrentPrice;
    const profit = currentValue - remainingCostBasis;
    const isProfit = profit >= 0;
    pAndLContent += `<div class="summary-row summary-profit">
      <span class="summary-label">Unrealized Profit</span>
      <div class="summary-values">
        <div class="summary-usd profit-value">${isProfit ? '+' : ''}${formatUSD(profit)}</div>
      </div>
    </div>`;
  }
  if (hasUsd) {
    let totalRealized = 0;
    for (const txId of Object.keys(txGains || {})) {
      totalRealized += txGains[txId].gain;
    }
    pAndLContent += `<div class="summary-row summary-profit">
      <span class="summary-label">Realized Profit</span>
      <div class="summary-values">
        <div class="summary-usd profit-value">${totalRealized >= 0 ? '+' : ''}${formatUSD(totalRealized)}</div>
      </div>
    </div>`;
  }

  const hasCostGroup = costBasisContent || avgPriceContent;
  const hasPandL = pAndLContent.length > 0;

  return `
    <div class="net-summary">
      <div class="summary-group-label">Activity</div>
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
      ${hasCostGroup ? '<div class="summary-divider"></div><div class="summary-group-label">Cost Basis</div>' : ''}
      ${costBasisContent}
      ${avgPriceContent}
      ${hasPandL ? '<div class="summary-divider"></div><div class="summary-group-label">Profit &amp; Loss</div>' : ''}
      ${pAndLContent}
      ${hadMissingPrice ? `<div class="summary-note">Some prices estimated prior to ${formatShortDate(cachedPriceMap._earliest)}</div>` : ''}
    </div>
  `;
}

function exportCSV() {
  if (!cachedStatement) { warn('exportCSV called but no data'); return; }
  const { address, txs, txGains } = cachedStatement;

  const headers = ['Date', 'Direction', 'Amount (KAS)', 'USD Value', 'Cost Basis (USD)', 'Realized Gain (USD)', 'Counterparty', 'Transaction ID', 'Status'];
  const rows = txs.map(tx => {
    const direction = getTxDirection(tx, address);
    const counterparty = getCounterparty(tx, address, direction);
    const amount = getTxAmount(tx, address, direction);
    const kas = getKasAmount(amount);
    const price = cachedPriceMap ? cachedPriceMap[getDateKey(tx.block_time)] : null;
    const usd = price ? formatUSD(kas * price) : '';
    const status = tx.is_accepted ? 'Confirmed' : 'Pending';
    const gain = (txGains || {})[tx.transaction_id];
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
}

function exportReceiptCSV() {
  if (!cachedReceipt) { warn('exportReceiptCSV called but no data'); return; }
  const { tx, price } = cachedReceipt;
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
    return [formatShortDate(blockTime), status, fromStr, o.script_public_key_address, kas, usd, tx.transaction_id];
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
}

function buildPagination(current, total) {
  if (total <= 1) return '';

  let html = '<div class="pagination">';
  html += `<button class="page-btn" data-page="${current - 1}" ${current === 0 ? 'disabled' : ''} aria-label="Previous">${ICONS.chevronLeft}</button>`;

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

  html += `<button class="page-btn" data-page="${current + 1}" ${current >= total - 1 ? 'disabled' : ''} aria-label="Next">${ICONS.chevronRight}</button>`;
  html += `<span class="page-jump"><label for="page-jump-input">Go to</label><input type="number" id="page-jump-input" class="page-jump-input" min="1" max="${total}" value="${current + 1}" aria-label="Page number"><button class="page-btn page-jump-btn" data-jump>Go</button></span>`;
  html += '</div>';
  return html;
}

function renderStatement() {
  if (!cachedStatement) { warn('renderStatement called but no data'); return; }
  const { address, balance, txs, txGains, fifoSummary, page = 0 } = cachedStatement;
  const startIdx = page * PAGE_SIZE;
  const pageTxs = txs.slice(startIdx, startIdx + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(txs.length / PAGE_SIZE));

  const summaryHtml = renderProfitSummary(txs, address, txGains, fifoSummary, balance, false);

  let txRows = '';
  pageTxs.forEach((tx) => {
    const direction = getTxDirection(tx, address);
    const counterparty = getCounterparty(tx, address, direction);
    const amount = getTxAmount(tx, address, direction);
    const price = cachedPriceMap ? cachedPriceMap[getDateKey(tx.block_time)] : null;
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

  statementCard.innerHTML = `
    <div class="statement-header">
      <h2>Kaspa Statement</h2>
      <div class="statement-address">
        ${shortenHash(address, 12)}
        <button class="copy-btn" data-copy="${escapeHtml(address)}" aria-label="Copy address">${ICONS.copy}</button>
      </div>
      <div class="statement-balance">Balance: <strong>${formatKAS(balance)}</strong></div>
      ${summaryHtml}
    </div>
    <div class="tx-list">
      <div class="tx-list-header">Transactions</div>
      ${txRows || '<div class="tx-empty">No transactions found.</div>'}
    </div>
    ${buildPagination(page, totalPages)}
  `;

  receiptCard.classList.add('hidden');
  statementCard.classList.remove('hidden');
  $('actions-bar').innerHTML = `<button class="card-btn card-btn-back" id="export-csv-btn" aria-label="Download CSV">${ICONS.download}</button>`;
  $('actions-bar').classList.remove('hidden');
}

function goToPage(page) {
  if (!cachedStatement) { warn('goToPage called but no data'); return; }
  const totalPages = Math.ceil(cachedStatement.txs.length / PAGE_SIZE);
  if (page < 0 || page >= totalPages) { warn('goToPage: invalid page', page, 'totalPages:', totalPages); return; }
  cachedStatement.page = page;
  renderStatement();
}

function jumpToPageFromInput(input) {
  if (!input) return;
  const val = parseInt(input.value, 10);
  if (isNaN(val) || val < 1) return;
  goToPage(val - 1);
}

async function showTxDetail(txId) {
  log('Showing tx detail:', txId);
  showLoading(true);
  try {
    const res = await fetch(`${API_PATH}/api/web/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid: txId })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch receipt');
    }
    const data = await res.json();
    cachedPriceMap = data.priceMap;
    statementCard.classList.add('hidden');
    receiptCard.classList.remove('hidden');
    renderReceipt(data.tx, data.price, data.priceMap);
    $('actions-bar').innerHTML = `<button class="card-btn card-btn-back" id="back-btn" aria-label="Back to Statement">${ICONS.arrowLeft}</button><button class="card-btn card-btn-back" id="export-receipt-btn" aria-label="Download CSV">${ICONS.download}</button>`;
    $('actions-bar').classList.remove('hidden');
  } catch (err) {
    error('showTxDetail error:', err.message);
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

function resetForm() {
  input.value = '';
  input.focus();
  resultEl.classList.add('hidden');
  receiptCard.classList.add('hidden');
  statementCard.classList.add('hidden');
  $('actions-bar').classList.add('hidden');
  cachedStatement = null;
  cachedReceipt = null;
  hideError();
}

async function handleGenerate() {
  const raw = input.value.trim().toLowerCase();
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
    if (TX_HASH_REGEX.test(raw)) {
      const res = await fetch(`${API_PATH}/api/web/receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid: raw })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch receipt');
      }
      const data = await res.json();
      cachedPriceMap = data.priceMap;
      cachedReceipt = { tx: data.tx, price: data.price };
      renderReceipt(data.tx, data.price, data.priceMap);
      $('actions-bar').innerHTML = `<button class="card-btn card-btn-back" id="export-receipt-btn" aria-label="Download CSV">${ICONS.download}</button>`;
      $('actions-bar').classList.remove('hidden');
    } else if (ADDRESS_REGEX.test(raw)) {
      const res = await fetch(`${API_PATH}/api/web/statement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: raw })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch statement');
      }
      const data = await res.json();
      cachedPriceMap = data.priceMap;
      cachedCurrentPrice = data.currentPrice;
      cachedStatement = {
        address: data.address,
        balance: data.balance,
        txs: data.txs,
        txGains: data.txGains,
        fifoSummary: data.fifoSummary,
        page: 0
      };
      renderStatement();
    } else {
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
  input.classList.remove('error');
  hideError();
}

function initEventListeners() {
  input.addEventListener('input', handleInput);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleGenerate(); });
  button.addEventListener('click', handleGenerate);

  receiptCard.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn && copyBtn.dataset.copy) { copyToClipboard(copyBtn.dataset.copy, copyBtn); return; }
  });

  statementCard.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn && copyBtn.dataset.copy) { copyToClipboard(copyBtn.dataset.copy, copyBtn); return; }

    const row = e.target.closest('.tx-row');
    if (row && row.dataset.txId) { showTxDetail(row.dataset.txId); return; }

    const pageBtn = e.target.closest('.page-btn');
    if (pageBtn && !pageBtn.disabled && pageBtn.dataset.page !== undefined) {
      goToPage(parseInt(pageBtn.dataset.page));
      return;
    }

    const jumpBtn = e.target.closest('.page-jump-btn');
    if (jumpBtn) {
      const input = jumpBtn.parentElement.querySelector('.page-jump-input');
      jumpToPageFromInput(input);
      return;
    }
  });

  statementCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = e.target.closest('.page-jump-input');
      if (input) {
        jumpToPageFromInput(input);
      }
    }
  });

  $('actions-bar').addEventListener('click', (e) => {
    if (e.target.closest('#back-btn') && cachedStatement) {
      renderStatement();
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (e.target.closest('#export-receipt-btn')) {
      exportReceiptCSV();
      return;
    }
    if (e.target.closest('#export-csv-btn')) {
      exportCSV();
    }
  });
}

function initGlobalErrorHandler() {
  window.onerror = (msg, source, line, col, err) => {
    const detail = err && err.stack ? err.stack : `${msg} (${source}:${line}:${col})`;
    error('Uncaught exception:', detail);
    dumpDebugLog();
    const el = $('error');
    if (el) {
      el.textContent = `An unexpected error occurred. Please try again. (${msg})`;
      el.classList.remove('hidden');
    }
  };

  window.onunhandledrejection = (e) => {
    const reason = e.reason;
    const detail = reason && reason.stack ? reason.stack : String(reason);
    error('Unhandled promise rejection:', detail);
    dumpDebugLog();
    const el = $('error');
    if (el) {
      el.textContent = `An unexpected error occurred. Please try again. (${reason?.message || reason})`;
      el.classList.remove('hidden');
    }
  };
}

log('App starting...');
initGlobalErrorHandler();
initEventListeners();
log('App initialized.');
