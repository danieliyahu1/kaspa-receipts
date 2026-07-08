const API_BASE = 'https://api.kaspa.org';
const TX_HASH_REGEX = /^[a-f0-9]{64}$/;

const $ = (id) => document.getElementById(id);

const input = $('tx-input');
const button = $('generate-btn');
const loadingEl = $('loading');
const errorEl = $('error');
const resultEl = $('result');
const receiptCard = $('receipt-card');

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

function renderReceipt(tx) {
  const accepted = tx.is_accepted;
  const blockTime = tx.block_time;
  const blueScore = tx.accepting_block_blue_score;
  const inputs = tx.inputs || [];
  const outputs = tx.outputs || [];

  const fromAddresses = [...new Set(
    inputs.map(i => i.previous_outpoint_address).filter(Boolean)
  )];

  const totalSompi = outputs.reduce((sum, o) => sum + Number(o.amount), 0);

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
      <div class="meta-row">
        <span class="meta-label">Mass</span>
        <span class="meta-value">${formatNumber(tx.mass)}</span>
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
      <span class="total-amount">${formatKAS(totalSompi)}</span>
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
      <button class="btn-print" onclick="window.print()">Print Receipt</button>
      <button class="btn-new" onclick="resetForm()">New Receipt</button>
    </div>
  `;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resetForm() {
  input.value = '';
  input.focus();
  resultEl.classList.add('hidden');
  hideError();
}

async function handleGenerate() {
  const raw = input.value.trim().toLowerCase();
  hideError();
  resultEl.classList.add('hidden');

  if (!raw) {
    input.classList.add('error');
    showError('Please enter a transaction hash.');
    input.focus();
    return;
  }

  if (!TX_HASH_REGEX.test(raw)) {
    input.classList.add('error');
    showError('Transaction hash must be exactly 64 lowercase hexadecimal characters (0-9, a-f).');
    input.focus();
    return;
  }

  input.classList.remove('error');
  showLoading(true);

  try {
    const tx = await fetchTransaction(raw);
    renderReceipt(tx);
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
