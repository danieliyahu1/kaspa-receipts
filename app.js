const API_BASE = 'https://api.kaspa.org';
const TX_HASH_REGEX = /^[a-f0-9]{64}$/;
const ADDRESS_REGEX = /^kaspa:[a-z0-9]{61,63}$/;

const $ = (id) => document.getElementById(id);

const input = $('tx-input');
const button = $('generate-btn');
const loadingEl = $('loading');
const errorEl = $('error');
const resultEl = $('result');
const receiptCard = $('receipt-card');
const statementCard = $('statement-card');
let lastStatementAddress = null;

function showLoading(show) {
  loadingEl.classList.toggle('hidden', !show);
  button.classList.toggle('loading', show);
  button.disabled = show;
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
  return hash.slice(0, chars) + '…' + hash.slice(-chars);
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

async function fetchAddressTransactions(address) {
  const params = new URLSearchParams({
    limit: '50',
    resolve_previous_outpoints: 'light'
  });
  const res = await fetch(`${API_BASE}/addresses/${address}/full-transactions?${params}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Address not found. Check the address and try again.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  return res.json();
}

const HTX_BASE = 'https://api.huobi.pro';

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

async function fetchPriceRange() {
  try {
    const res = await fetch(`${HTX_BASE}/market/history/kline?symbol=kasusdt&period=1day&size=2000`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 'ok' || !json.data) return null;
    const map = {};
    json.data.forEach(candle => {
      map[getDateKey(candle.id * 1000)] = candle.close;
    });
    return map;
  } catch {
    return null;
  }
}

function getTxDirection(tx, address) {
  const isSender = tx.inputs && tx.inputs.some(i => i.previous_outpoint_address === address);
  const isReceiver = tx.outputs && tx.outputs.some(o => o.script_public_key_address === address);
  if (isSender && isReceiver) return 'self';
  if (isSender) return 'sent';
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

function renderReceipt(tx, price) {
  const accepted = tx.is_accepted;
  const blockTime = tx.block_time;
  const blueScore = tx.accepting_block_blue_score;
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
      <div class="receipt-id">#${shortenHash(tx.transaction_id, 12)}</div>
    </div>

    <div class="receipt-status">
      <span class="status-badge ${accepted ? 'accepted' : 'pending'}">
        ${accepted ? '<span class="check">&#10003;</span> Confirmed' : '<span class="check">&#9679;</span> Pending'}
      </span>
      ${accepted ? `<span class="confirmations">${formatNumber(blueScore)} confirmations</span>` : ''}
    </div>

    <div class="receipt-meta">
      <div class="meta-row">
        <span class="meta-label">Date &amp; Time</span>
        <span class="meta-value">${formatDate(blockTime)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Block</span>
        <span class="meta-value">#${formatNumber(blueScore)}</span>
      </div>
    </div>

    <div class="receipt-section">
      <div class="section-label">From</div>
      ${fromAddresses.length
        ? fromAddresses.map(addr => `
            <div class="address-block">
              <span class="address">${escapeHtml(addr)}</span>
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
            <span class="output-address">${escapeHtml(o.script_public_key_address)}</span>
            <span class="output-amount">${formatKAS(o.amount)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="receipt-total">
      <span class="total-label">Total</span>
      <div class="total-values">
        <span class="total-amount">${formatKAS(totalSompi)}</span>
        ${usdTotal !== null ? `<span class="total-usd">≈ ${formatUSD(usdTotal)} USD</span>` : ''}
      </div>
    </div>

    <div class="receipt-footer">
      <div class="footer-row">
        <span class="footer-label">Transaction Hash</span>
        <span class="footer-value">
          ${shortenHash(tx.transaction_id, 16)}
          <button class="copy-btn" data-copy="${escapeHtml(tx.transaction_id)}">Copy</button>
        </span>
      </div>
      <div class="footer-row">
        <span class="footer-label">Accepting Block</span>
        <span class="footer-value">${shortenHash(tx.accepting_block_hash, 16)}</span>
      </div>
    </div>

    <div class="receipt-actions">
      ${lastStatementAddress ? '<button class="btn-back" onclick="showStatement()">Back to Statement</button>' : ''}
      <button class="btn-new" onclick="resetForm()">New Receipt</button>
    </div>
  `;
}

function renderAddressStatement(txs, address, balance, priceMap) {
  const sorted = [...txs].sort((a, b) => b.block_time - a.block_time);

  let totalReceived = 0;
  let totalSent = 0;
  let usdReceived = 0;
  let usdSent = 0;
  let txRows = '';

  sorted.forEach((tx) => {
    const direction = getTxDirection(tx, address);
    const counterparty = getCounterparty(tx, address, direction);
    const amount = getTxAmount(tx, address, direction);
    const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
    const usdAmount = price ? getKasAmount(amount) * price : null;

    if (direction === 'received') {
      totalReceived += amount;
      if (usdAmount) usdReceived += usdAmount;
    } else if (direction === 'sent') {
      totalSent += amount;
      if (usdAmount) usdSent += usdAmount;
    }

    const isSent = direction === 'sent';
    const symbol = isSent ? '&#8599;' : '&#8600;';
    const label = isSent ? 'Sent' : (direction === 'self' ? 'Self' : 'Received');
    const amtClass = isSent ? 'amt-sent' : 'amt-received';

    const counterShort = counterparty.length > 30
      ? counterparty.slice(0, 16) + '…' + counterparty.slice(-6)
      : counterparty;

    const status = tx.is_accepted
      ? '<span class="tx-status confirmed">Confirmed</span>'
      : '<span class="tx-status unconfirmed">Pending</span>';

    txRows += `
      <div class="tx-row" onclick="showTxDetail('${tx.transaction_id}')">
        <div class="tx-left">
          <span class="tx-date">${formatDate(tx.block_time)}</span>
          <span class="tx-counter">${escapeHtml(counterShort)}</span>
        </div>
        <div class="tx-right">
          <span class="tx-direction ${amtClass}">${symbol} ${label}</span>
          <span class="tx-amount ${amtClass}">${formatKAS(amount)}</span>
          ${usdAmount !== null ? `<span class="tx-usd">${formatUSD(usdAmount)}</span>` : ''}
          ${status}
        </div>
      </div>
    `;
  });

  const net = totalReceived - totalSent;
  const netUsd = usdReceived - usdSent;

  statementCard.innerHTML = `
    <div class="statement-header">
      <h2>Kaspa Statement</h2>
      <div class="statement-address">${shortenHash(address, 16)}</div>
      <div class="statement-balance">Balance: <strong>${formatKAS(balance)}</strong></div>
    </div>

    <div class="summary-row">
      <div class="summary-card received">
        <span class="summary-label">Received</span>
        <span class="summary-value">${formatKAS(totalReceived)}</span>
        ${usdReceived ? `<span class="summary-usd">${formatUSD(usdReceived)}</span>` : ''}
      </div>
      <div class="summary-card sent">
        <span class="summary-label">Sent</span>
        <span class="summary-value">${formatKAS(totalSent)}</span>
        ${usdSent ? `<span class="summary-usd">${formatUSD(usdSent)}</span>` : ''}
      </div>
      <div class="summary-card ${net >= 0 ? 'net-positive' : 'net-negative'}">
        <span class="summary-label">Net</span>
        <span class="summary-value">${net >= 0 ? '+' : ''}${formatKAS(net)}</span>
        ${netUsd ? `<span class="summary-usd">${netUsd >= 0 ? '+' : ''}${formatUSD(netUsd)}</span>` : ''}
      </div>
    </div>

    <div class="tx-list">
      <div class="tx-list-header">
        <span>${sorted.length} transaction${sorted.length !== 1 ? 's' : ''}</span>
      </div>
      ${txRows || '<div class="tx-empty">No transactions found.</div>'}
    </div>

    <div class="receipt-actions">
      <button class="btn-new" onclick="resetForm()">New Search</button>
    </div>
  `;

  lastStatementAddress = address;
  receiptCard.classList.add('hidden');
  statementCard.classList.remove('hidden');
}

async function showStatement() {
  if (!lastStatementAddress) {
    resetForm();
    return;
  }
  showLoading(true);
  try {
    const [balance, txs] = await Promise.all([
      fetchAddressBalance(lastStatementAddress),
      fetchAddressTransactions(lastStatementAddress)
    ]);
    const priceMap = await fetchPriceRange();
    renderAddressStatement(txs, lastStatementAddress, balance, priceMap);
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

async function showTxDetail(txId) {
  showLoading(true);
  try {
    const tx = await fetchTransaction(txId);
    const priceMap = await fetchPriceRange();
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

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resetForm() {
  input.value = '';
  input.focus();
  resultEl.classList.add('hidden');
  receiptCard.classList.add('hidden');
  statementCard.classList.add('hidden');
  lastStatementAddress = null;
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
    showError('Please enter a transaction hash or wallet address.');
    input.focus();
    return;
  }

  input.classList.remove('error');
  showLoading(true);

  try {
    if (TX_HASH_REGEX.test(raw)) {
      lastStatementAddress = null;
      const [tx] = await Promise.all([
        fetchTransaction(raw)
      ]);
      const priceMap = await fetchPriceRange();
      const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;
      renderReceipt(tx, price);
    } else if (ADDRESS_REGEX.test(raw)) {
      const [balance, txs, priceMap] = await Promise.all([
        fetchAddressBalance(raw),
        fetchAddressTransactions(raw),
        fetchPriceRange()
      ]);
      renderAddressStatement(txs, raw, balance, priceMap);
    } else {
      showError('Invalid format. Enter a 64-character transaction hash or a kaspa: address.');
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
}

receiptCard.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (btn) {
    const text = btn.dataset.copy;
    if (text) copyToClipboard(text, btn);
  }
});

input.addEventListener('input', handleInput);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleGenerate();
});
button.addEventListener('click', handleGenerate);
