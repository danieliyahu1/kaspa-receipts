import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── renderReceipt ────────────────────────────────────────────

describe('renderReceipt', () => {
  const mockTx = {
    transaction_id: 'a'.repeat(64),
    is_accepted: true,
    block_time: 1704067200000, // Jan 1, 2024
    inputs: [
      { previous_outpoint_address: 'kaspa:sender1234567890abcdef' },
    ],
    outputs: [
      { script_public_key_address: 'kaspa:receiver1234567890abcdef', amount: '100000000' },
      { script_public_key_address: 'kaspa:receiver1234567890abcdef', amount: '200000000' },
    ],
  };

  it('renders confirmed receipt', () => {
    renderReceipt(mockTx, null);

    const card = document.getElementById('receipt-card');
    expect(card.innerHTML).toContain('Kaspa Receipt');
    expect(card.innerHTML).toContain('Confirmed');
    expect(card.innerHTML).toContain('3.00 KAS'); // total of both outputs
    expect(card.innerHTML).toContain('Copy');
  });

  it('renders pending status for unaccepted tx', () => {
    renderReceipt({ ...mockTx, is_accepted: false }, null);
    const card = document.getElementById('receipt-card');
    expect(card.innerHTML).toContain('Pending');
  });

  it('shows USD total when price is provided', () => {
    renderReceipt(mockTx, 0.5); // $0.50 per KAS, total 3 KAS = $1.50
    const card = document.getElementById('receipt-card');
    expect(card.innerHTML).toContain('$1.50 USD');
  });

  it('shows N/A when price is null', () => {
    renderReceipt(mockTx, null);
    const card = document.getElementById('receipt-card');
    expect(card.innerHTML).toContain('$N/A');
  });

  it('displays coinbase when no sender inputs', () => {
    renderReceipt({ ...mockTx, inputs: [] }, null);
    const card = document.getElementById('receipt-card');
    expect(card.innerHTML).toContain('Coinbase');
  });

  it('does not include action buttons in receipt card', () => {
    renderReceipt(mockTx, null);
    const card = document.getElementById('receipt-card');
    expect(card.innerHTML).not.toContain('Back to Statement');
    expect(card.innerHTML).not.toContain('New Receipt');
  });

  it('unhides receipt card', () => {
    const card = document.getElementById('receipt-card');
    card.classList.add('hidden');
    renderReceipt(mockTx, null);
    expect(card.classList.contains('hidden')).toBe(false);
  });
});

// ─── renderStatement ──────────────────────────────────────────

describe('renderStatement', () => {
  const address = 'kaspa:' + 'a'.repeat(61);

  it('renders empty state when no txs', () => {
    statement = { address, balance: '500000000', txs: [], page: 0 };
    renderStatement();
    const card = document.getElementById('statement-card');
    expect(card.innerHTML).toContain('Kaspa Statement');
    expect(card.innerHTML).toContain('5.00 KAS'); // balance
    expect(card.innerHTML).toContain('No transactions found');
    statement = null;
  });

  it('renders transaction rows', () => {
    const txs = [
      {
        transaction_id: 'a'.repeat(64),
        is_accepted: true,
        block_time: 1704067200000,
        inputs: [{ previous_outpoint_address: 'kaspa:sender' }],
        outputs: [{ script_public_key_address: address, amount: '100000000' }],
      },
    ];
    statement = { address, balance: '100000000', txs, page: 0 };
    renderStatement();
    const card = document.getElementById('statement-card');
    expect(card.innerHTML).toContain('1 transaction');
    expect(card.innerHTML).toContain('Received');
    expect(card.innerHTML).toContain('1.00 KAS');
    statement = null;
  });

  it('shows Sent direction', () => {
    const txs = [
      {
        transaction_id: 'b'.repeat(64),
        is_accepted: true,
        block_time: 1704067200000,
        inputs: [{ previous_outpoint_address: address }],
        outputs: [
          { script_public_key_address: address, amount: '100000000' },
          { script_public_key_address: 'kaspa:other', amount: '200000000' },
        ],
      },
    ];
    statement = { address, balance: '100000000', txs, page: 0 };
    renderStatement();
    const card = document.getElementById('statement-card');
    expect(card.innerHTML).toContain('Sent');
    expect(card.innerHTML).toContain('2.00 KAS');
    statement = null;
  });

  it('shows Self direction for self-transfers', () => {
    const txs = [
      {
        transaction_id: 'c'.repeat(64),
        is_accepted: true,
        block_time: 1704067200000,
        inputs: [{ previous_outpoint_address: address }],
        outputs: [{ script_public_key_address: address, amount: '500000000' }],
      },
    ];
    statement = { address, balance: '500000000', txs, page: 0 };
    renderStatement();
    const card = document.getElementById('statement-card');
    expect(card.innerHTML).toContain('Self');
    expect(card.innerHTML).toContain('5.00 KAS');
    statement = null;
  });

  it('shows unconfirmed badge for pending txs', () => {
    const txs = [
      {
        transaction_id: 'd'.repeat(64),
        is_accepted: false,
        block_time: 1704067200000,
        inputs: [{ previous_outpoint_address: address }],
        outputs: [{ script_public_key_address: 'kaspa:other', amount: '100000000' }],
      },
    ];
    statement = { address, balance: '100000000', txs, page: 0 };
    renderStatement();
    const card = document.getElementById('statement-card');
    expect(card.innerHTML).toContain('Pending');
    statement = null;
  });

  it('switches to receipt view when a tx row is clicked', () => {
    const txs = [
      {
        transaction_id: 'e'.repeat(64),
        is_accepted: true,
        block_time: 1704067200000,
        inputs: [{ previous_outpoint_address: address }],
        outputs: [{ script_public_key_address: address, amount: '100000000' }],
      },
    ];
    statement = { address, balance: '100000000', txs, page: 0 };
    renderStatement();

    const row = document.querySelector('.tx-row');
    expect(row).not.toBeNull();
    expect(row.dataset.txId).toBe('e'.repeat(64));
    statement = null;
  });

  it('shows pagination when txs exceed PAGE_SIZE', () => {
    const txs = Array.from({ length: 60 }, (_, i) => ({
      transaction_id: String(i).padStart(64, '0'),
      is_accepted: true,
      block_time: 1704067200000,
      inputs: [{ previous_outpoint_address: 'kaspa:sender' }],
      outputs: [{ script_public_key_address: address, amount: '100000000' }],
    }));
    statement = { address, balance: '100000000', txs, page: 0 };
    renderStatement();
    const card = document.getElementById('statement-card');
    expect(card.innerHTML).toContain('Next');
    expect(card.innerHTML).toContain('60 transactions');
    statement = null;
  });

  it('shows actions bar with Export button', () => {
    statement = { address, balance: '0', txs: [], page: 0 };
    renderStatement();
    const bar = document.getElementById('actions-bar');
    expect(bar.classList.contains('hidden')).toBe(false);
    expect(bar.innerHTML).toContain('Export');
    statement = null;
  });
});

// ─── generate / handleGenerate ────────────────────────────────

describe('handleGenerate', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    document.getElementById('tx-input').value = '';
    document.getElementById('receipt-card').classList.add('hidden');
    document.getElementById('statement-card').classList.add('hidden');
    document.getElementById('result').classList.add('hidden');
    document.getElementById('error').classList.add('hidden');
    receiptTx = null;
    statement = null;
    priceMap = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error for empty input', async () => {
    await handleGenerate();
    expect(document.getElementById('error').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error').textContent).toContain('enter a transaction ID');
  });

  it('shows error for invalid input', async () => {
    document.getElementById('tx-input').value = 'not a valid tx or address';
    await handleGenerate();
    expect(document.getElementById('error').textContent).toContain('doesn\'t look like');
  });

  it('fetches and renders receipt for valid tx hash', async () => {
    const txHash = 'a'.repeat(64);
    document.getElementById('tx-input').value = txHash;

    const mockTx = {
      transaction_id: txHash,
      is_accepted: true,
      block_time: 1704067200000,
      inputs: [{ previous_outpoint_address: 'kaspa:sender' }],
      outputs: [{ script_public_key_address: 'kaspa:receiver', amount: '100000000' }],
    };
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTx),
    });

    await handleGenerate();
    const card = document.getElementById('receipt-card');
    expect(card.innerHTML).toContain('1.00 KAS');
    expect(document.getElementById('result').classList.contains('hidden')).toBe(false);
  });

  it('fetches balance and txs for valid address', async () => {
    const addr = 'kaspa:' + 'a'.repeat(61);
    document.getElementById('tx-input').value = addr;

    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ balance: '500000000' }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ total: 0 }),
    });

    await handleGenerate();
    const card = document.getElementById('statement-card');
    expect(card.innerHTML).toContain('5.00 KAS');
    expect(card.classList.contains('hidden')).toBe(false);
  });
});

// ─── goToPage ─────────────────────────────────────────────────

describe('goToPage', () => {
  it('updates page and re-renders statement', () => {
    const addr = 'kaspa:' + 'a'.repeat(61);
    const txs = Array.from({ length: 60 }, (_, i) => ({
      transaction_id: String(i).padStart(64, '0'),
      is_accepted: true,
      block_time: 1704067200000,
      inputs: [{ previous_outpoint_address: 'kaspa:sender' }],
      outputs: [{ script_public_key_address: addr, amount: '100000000' }],
    }));
    statement = { address: addr, balance: '0', txs, page: 0 };

    goToPage(1);
    expect(statement.page).toBe(1);

    const card = document.getElementById('statement-card');
    // Page 1 should have only 10 txs (50 per page, 60 total, page 1 = last 10)
    const activeBtn = card.querySelector('.page-btn.active');
    expect(activeBtn).not.toBeNull();
    expect(activeBtn.textContent).toBe('2');

    statement = null;
  });

  it('does nothing for out of range pages', () => {
    const addr = 'kaspa:' + 'a'.repeat(61);
    statement = { address: addr, balance: '0', txs: [{ transaction_id: 'a'.repeat(64), is_accepted: true, block_time: 1704067200000, inputs: [], outputs: [] }], page: 0 };

    goToPage(5);
    expect(statement.page).toBe(0);

    statement = null;
  });
});

// ─── showTxDetail ─────────────────────────────────────────────

describe('showTxDetail', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches tx and renders receipt', async () => {
    const txHash = 'a'.repeat(64);
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        transaction_id: txHash,
        is_accepted: true,
        block_time: 1704067200000,
        inputs: [],
        outputs: [{ script_public_key_address: 'kaspa:addr', amount: '100000000' }],
      }),
    });

    await showTxDetail(txHash);
    const card = document.getElementById('receipt-card');
    expect(card.innerHTML).toContain('1.00 KAS');
  });

  it('shows error on fetch failure', async () => {
    fetch.mockRejectedValueOnce(new Error('Network error'));
    await showTxDetail('a'.repeat(64));
    expect(document.getElementById('error').textContent).toContain('Network error');
  });
});

// ─── resetForm ────────────────────────────────────────────────

describe('resetForm', () => {
  it('clears input and hides all result cards', () => {
    document.getElementById('tx-input').value = 'some value';
    document.getElementById('receipt-card').innerHTML = 'some content';
    document.getElementById('result').classList.remove('hidden');
    receiptTx = { tx: {}, price: null };
    statement = {};

    resetForm();

    expect(document.getElementById('tx-input').value).toBe('');
    expect(document.getElementById('result').classList.contains('hidden')).toBe(true);
    expect(receiptTx).toBeNull();
    expect(statement).toBeNull();
  });
});

// ─── renderProfitSummary ──────────────────────────────────────

describe('renderProfitSummary', () => {
  const address = 'kaspa:' + 'a'.repeat(61);

  it('returns empty string for empty txs', () => {
    expect(renderProfitSummary([], address, {})).toBe('');
  });

  it('calculates received/sent totals', () => {
    const txs = [
      {
        transaction_id: 'a'.repeat(64),
        is_accepted: true,
        block_time: 1704067200000,
        inputs: [{ previous_outpoint_address: 'kaspa:sender' }],
        outputs: [{ script_public_key_address: address, amount: '300000000' }],
      },
      {
        transaction_id: 'b'.repeat(64),
        is_accepted: true,
        block_time: 1704067200000,
        inputs: [{ previous_outpoint_address: address }],
        outputs: [
          { script_public_key_address: address, amount: '100000000' },
          { script_public_key_address: 'kaspa:other', amount: '200000000' },
        ],
      },
    ];

    const html = renderProfitSummary(txs, address, {});
    expect(html).toContain('Summary');
    expect(html).toContain('Received');
    expect(html).toContain('Sent');
    expect(html).toContain('3.00 KAS'); // received
    expect(html).toContain('2.00 KAS'); // sent
  });

  it('handles self-transactions correctly', () => {
    const txs = [
      {
        transaction_id: 'c'.repeat(64),
        is_accepted: true,
        block_time: 1704067200000,
        inputs: [{ previous_outpoint_address: address }],
        outputs: [{ script_public_key_address: address, amount: '500000000' }],
      },
    ];

    const html = renderProfitSummary(txs, address, {});
    expect(html).toContain('5.00 KAS'); // both received and sent
  });
});

// ─── buildPagination ──────────────────────────────────────────

describe('buildPagination', () => {
  it('returns empty string for single page', () => {
    expect(buildPagination(0, 1)).toBe('');
  });

  it('includes prev/next buttons', () => {
    const html = buildPagination(0, 5);
    expect(html).toContain('Prev');
    expect(html).toContain('Next');
  });

  it('disables prev on first page', () => {
    const html = buildPagination(0, 5);
    expect(html).toContain('disabled');
  });

  it('disables next on last page', () => {
    const html = buildPagination(4, 5);
    expect(html).toContain('disabled');
  });

  it('marks current page active', () => {
    const html = buildPagination(2, 5);
    expect(html).toContain('class="page-btn active"');
  });

  it('shows ellipsis for many pages', () => {
    const html = buildPagination(0, 20);
    expect(html).toContain('&#8230;');
    expect(html).toContain('page-ellipsis');
  });
});
