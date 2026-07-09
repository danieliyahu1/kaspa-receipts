const API_BASE = 'https://api.kaspa.org';
const TX_HASH_REGEX = /^[a-f0-9]{64}$/;
const ADDRESS_REGEX = /^kaspa:[a-z0-9]{61,63}$/;
const PAGE_SIZE = 50;
const BYBIT_BASE = 'https://api.bybit.com';

const $ = (id) => document.getElementById(id);

const input = $('tx-input');
const button = $('generate-btn');
const loadingEl = $('loading');
const loadingText = $('loading-text');
const errorEl = $('error');
const resultEl = $('result');
const receiptCard = $('receipt-card');
const statementCard = $('statement-card');
const fromDateInput = $('from-date');
const toDateInput = $('to-date');
const dateRangeSection = $('date-range-section');

let receiptTx = null;
let statement = null;
let priceMap = null;

function showLoading(show, text) {
  loadingEl.classList.toggle('hidden', !show);
  button.classList.toggle('loading', show);
  button.disabled = show;
  if (text !== undefined) loadingText.textContent = text;
}

function showError(message) {
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
    maximumFractionDigits: 8
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
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchTransaction(txId) {
  const params = new URLSearchParams({
    inputs: 'true',
    outputs: 'true',
    resolve_previous_outpoints: 'light'
  });
  const url = `${API_BASE}/transactions/${txId}?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Transaction not found. Check the hash and try again.');
    if (res.status === 422) throw new Error('Invalid transaction hash format.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  return res.json();
}

async function fetchAddressBalance(address) {
  const res = await fetch(`${API_BASE}/addresses/${address}/balance`);
  if (!res.ok) {
    throw new Error('Could not fetch address balance.');
  }
  const data = await res.json();
  return data.balance;
}

async function fetchAddressTxs(address, offset = 0) {
  const url = `${API_BASE}/addresses/${address}/full-transactions?limit=${PAGE_SIZE}&offset=${offset}&resolve_previous_outpoints=light`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Address not found. Check the address and try again.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  return res.json();
}

async function fetchPriceMap() {
  try {
    const res = await fetch(`${BYBIT_BASE}/v5/market/kline?category=spot&symbol=KASUSDT&interval=D&limit=1000`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.retCode !== 0 || !json.result?.list) return null;
    const map = {};
    const todayKey = getDateKey(Date.now());
    json.result.list.forEach(candle => {
      const key = getDateKey(parseInt(candle[0]));
      map[key] = key === todayKey ? parseFloat(candle[1]) : parseFloat(candle[4]);
    });
    return map;
  } catch {
    return null;
  }
}

function getTxDirection(tx, address) {
  const isSender = tx.inputs && tx.inputs.some(i => i.previous_outpoint_address === address);
  const hasExternalOutput = tx.outputs && tx.outputs.some(o => o.script_public_key_address !== address);
  if (isSender && hasExternalOutput) return 'sent';
  if (isSender) return 'self';
  return 'received';
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
  return Number(tx.outputs[0].amount);
}

async function fetchAllAddressTxs(address, fromMs, toMs) {
  const allTxs = [];
  let offset = 0;
  let done = false;

  while (!done) {
    const page = await fetchAddressTxs(address, offset);
    if (!page || page.length === 0) break;

    for (const tx of page) {
      if (tx.block_time < fromMs) { done = true; break; }
      if (tx.block_time <= toMs) {
        allTxs.push(tx);
      }
    }

    offset += page.length;
    loadingText.textContent = `Fetching transactions\u2026 page ${Math.ceil(offset / PAGE_SIZE)} (${allTxs.length} found)`;

    if (page.length < PAGE_SIZE || done) break;
  }

  return allTxs;
}

function renderReceipt(tx, price) {
  receiptTx = { tx, price };
  receiptCard.classList.remove('hidden');
  const accepted = tx.is_accepted;
  const blockTime = tx.block_time;
  const inputs = tx.inputs || [];
  const outputs = tx.outputs || [];

  const fromAddresses = [...new Set(
    inputs.map(i => i.previous_outpoint_address).filter(Boolean)
  )];

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
        ${outputs.map(o => `
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
        ${usdTotal !== null ? `<span class="total-usd">≈ ${formatUSD(usdTotal)} USD</span>` : '<span class="total-usd na unavailable" title="No price data for this date">— USD</span>'}
      </div>
    </div>

    <div class="receipt-ref">
      ${shortenHash(tx.transaction_id, 12)}
      <button class="copy-btn" data-copy="${escapeHtml(tx.transaction_id)}">Copy</button>
    </div>

    <div class="receipt-actions">
      ${statement ? '<button class="btn-back" id="back-btn">Back to Statement</button>' : ''}
      <button class="btn-new" id="new-receipt-btn">New Receipt</button>
    </div>
  `;
}

function renderNetSummary(txs, address) {
  if (!txs.length) return '';

  let receivedSompi = 0, sentSompi = 0;
  let receivedUsd = 0, sentUsd = 0;
  let hadMissingPrice = false;

  txs.forEach(tx => {
    const direction = getTxDirection(tx, address);
    const amount = getTxAmount(tx, address, direction);
    const kas = getKasAmount(amount);
    const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
    if (!price && priceMap) hadMissingPrice = true;
    const usd = price ? kas * price : 0;

    if (direction === 'received') { receivedSompi += amount; receivedUsd += usd; }
    else if (direction === 'sent') { sentSompi += amount; sentUsd += usd; }
  });

  const netSompi = receivedSompi - sentSompi;
  const netUsd = receivedUsd - sentUsd;
  const hasUsd = priceMap !== null;

  return `
    <div class="net-summary">
      <div class="summary-title">Summary</div>
      <div class="summary-row">
        <span class="summary-label">Received</span>
        <div class="summary-values">
          <div class="summary-kas">${formatKAS(receivedSompi)}</div>
          ${hasUsd ? `<div class="summary-usd">≈ ${formatUSD(receivedUsd)} USD</div>` : ''}
        </div>
      </div>
      <div class="summary-row">
        <span class="summary-label">Sent</span>
        <div class="summary-values">
          <div class="summary-kas">${formatKAS(sentSompi)}</div>
          ${hasUsd ? `<div class="summary-usd">≈ ${formatUSD(sentUsd)} USD</div>` : ''}
        </div>
      </div>
      <div class="summary-row summary-net">
        <span class="summary-label">Change</span>
        <div class="summary-values">
          <div class="summary-kas">${formatKAS(netSompi)}</div>
          ${hasUsd ? `<div class="summary-usd">≈ ${formatUSD(netUsd)} USD</div>` : ''}
        </div>
      </div>
      ${hasUsd && hadMissingPrice ? '<div class="summary-note">* Price data unavailable for some transactions</div>' : ''}
    </div>
  `;
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
  if (!statement) return;
  const { address, balance, txs, fromDate, toDate, page } = statement;
  const startIdx = page * PAGE_SIZE;
  const pageTxs = txs.slice(startIdx, startIdx + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(txs.length / PAGE_SIZE));

  const summaryHtml = renderNetSummary(txs, address);

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
          ${usdAmount !== null ? `<span class="tx-usd">${formatUSD(usdAmount)}</span>` : '<span class="tx-usd na unavailable" title="No price data for this date">—</span>'}
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
        <button class="copy-btn" data-copy="${escapeHtml(address)}">Copy</button>
      </div>
      <div class="statement-balance">Balance: <strong>${formatKAS(balance)}</strong></div>
      ${summaryHtml}
    </div>
    <div class="tx-list">
      <div class="tx-list-header">
        <span>${txs.length} transaction${txs.length !== 1 ? 's' : ''}</span>
        <span class="loading-txs">${fromDate} to ${toDate}</span>
      </div>
      ${txRows || '<div class="tx-empty">No transactions found in this date range.</div>'}
    </div>
    ${buildPagination(page, totalPages)}
    <div class="receipt-actions">
      <button class="btn-new" id="search-btn">New Search</button>
    </div>
  `;

  receiptCard.classList.add('hidden');
  statementCard.classList.remove('hidden');
}

function goToPage(page) {
  if (!statement) return;
  const totalPages = Math.ceil(statement.txs.length / PAGE_SIZE);
  if (page < 0 || page >= totalPages) return;
  statement.page = page;
  renderStatement();
}

async function showTxDetail(txId) {
  showLoading(true);
  try {
    const tx = await fetchTransaction(txId);
    const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
    statementCard.classList.add('hidden');
    receiptCard.classList.remove('hidden');
    renderReceipt(tx, price);
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

function refreshUSD() {
  if (!priceMap) return;
  if (receiptTx) {
    const price = priceMap[getDateKey(receiptTx.tx.block_time)] ?? null;
    renderReceipt(receiptTx.tx, price);
  } else if (statement) {
    renderStatement();
  }
}

function setDefaultDateRange() {
  const today = new Date();
  const yearAgo = new Date();
  yearAgo.setFullYear(today.getFullYear() - 1);
  fromDateInput.value = yearAgo.toISOString().split('T')[0];
  toDateInput.value = today.toISOString().split('T')[0];
  toDateInput.max = today.toISOString().split('T')[0];
}

function resetForm() {
  input.value = '';
  input.focus();
  resultEl.classList.add('hidden');
  receiptCard.classList.add('hidden');
  statementCard.classList.add('hidden');
  receiptTx = null;
  statement = null;
  dateRangeSection.classList.add('hidden');
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
      receiptTx = null;
      statement = null;
      const tx = await fetchTransaction(raw);
      const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
      renderReceipt(tx, price);
    } else if (ADDRESS_REGEX.test(raw)) {
      statement = null;
      const fromDate = fromDateInput.value;
      const toDate = toDateInput.value;
      if (!fromDate || !toDate) {
        showError('Please select a date range for address lookups.');
        showLoading(false);
        return;
      }
      if (fromDate > toDate) {
        showError('The "From" date must be before the "To" date.');
        showLoading(false);
        return;
      }
      const fromMs = new Date(fromDate + 'T00:00:00').getTime();
      const toMs = new Date(toDate + 'T23:59:59').getTime();
      const [bal, txs] = await Promise.all([
        fetchAddressBalance(raw),
        fetchAllAddressTxs(raw, fromMs, toMs)
      ]);
      statement = { address: raw, balance: bal, txs, fromDate, toDate, page: 0 };
      renderStatement();
    } else {
      showError('That doesn\'t look like a Kaspa transaction or address. Try again.');
      showLoading(false);
      return;
    }
    resultEl.classList.remove('hidden');
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

function handleInput() {
  input.classList.remove('error');
  hideError();
  const val = input.value.trim().toLowerCase();
  if (val.startsWith('kaspa:')) {
    dateRangeSection.classList.remove('hidden');
  } else {
    dateRangeSection.classList.add('hidden');
  }
}

function initEventListeners() {
  input.addEventListener('input', handleInput);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleGenerate(); });
  button.addEventListener('click', handleGenerate);

  receiptCard.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn && copyBtn.dataset.copy) { copyToClipboard(copyBtn.dataset.copy, copyBtn); return; }

    if (e.target.closest('#back-btn') && statement) {
      renderStatement();
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (e.target.closest('#new-receipt-btn')) {
      resetForm();
    }
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

    if (e.target.closest('#search-btn')) {
      resetForm();
    }
  });
}

setDefaultDateRange();
fetchPriceMap().then(map => { priceMap = map; refreshUSD(); });
initEventListeners();
