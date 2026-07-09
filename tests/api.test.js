import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── fetchTransaction ─────────────────────────────────────────

describe('fetchTransaction', () => {
  const txId = 'a'.repeat(64);
  const mockTx = { transaction_id: txId, is_accepted: true, block_time: 1704067200000, inputs: [], outputs: [] };

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns transaction data on success', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTx),
    });

    const result = await fetchTransaction(txId);
    expect(result).toEqual(mockTx);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/transactions/')
    );
  });

  it('throws "Transaction not found" on 404', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(fetchTransaction(txId)).rejects.toThrow('Transaction not found');
  });

  it('throws "Invalid transaction hash" on 422', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 422 });
    await expect(fetchTransaction(txId)).rejects.toThrow('Invalid transaction hash');
  });

  it('throws generic error on other status', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(fetchTransaction(txId)).rejects.toThrow('The Kaspa network is currently unavailable');
  });

  it('includes required query parameters', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTx),
    });

    await fetchTransaction(txId);
    const url = fetch.mock.calls[0][0];
    expect(url).toContain('inputs=true');
    expect(url).toContain('outputs=true');
    expect(url).toContain('resolve_previous_outpoints=light');
  });
});

// ─── fetchAddressBalance ──────────────────────────────────────

describe('fetchAddressBalance', () => {
  const address = 'kaspa:' + 'a'.repeat(61);

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns balance on success', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ balance: '123456789' }),
    });
    const balance = await fetchAddressBalance(address);
    expect(balance).toBe('123456789');
  });

  it('throws on error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(fetchAddressBalance(address)).rejects.toThrow('Could not fetch address balance');
  });
});

// ─── fetchAddressTxs ──────────────────────────────────────────

describe('fetchAddressTxs', () => {
  const address = 'kaspa:' + 'a'.repeat(61);

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns transaction list', async () => {
    const mockData = [{ transaction_id: 'abc' }];
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });
    const result = await fetchAddressTxs(address, 0);
    expect(result).toEqual(mockData);
  });

  it('throws on 404', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(fetchAddressTxs(address, 0)).rejects.toThrow('Address not found');
  });

  it('includes pagination params', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });
    await fetchAddressTxs(address, 100);
    const url = fetch.mock.calls[0][0];
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=100');
  });
});

// ─── fetchPriceMap ────────────────────────────────────────────

describe('fetchPriceMap', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses Bybit kline response into date-keyed map', async () => {
    const now = Date.now();
    const today = new Date(now);
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

    const yesterday = new Date(now - 86400000);
    const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        retCode: 0,
        result: {
          list: [
            [yesterday.getTime().toString(), '100', '110', '90', '105', '1000'],
            [now.toString(), '200', '210', '190', '205', '2000'],
          ],
        },
      }),
    });

    const map = await fetchPriceMap();
    // For today, uses open price (index 1); for past, uses close (index 4)
    expect(map[yesterdayKey]).toBe(105);
    // Use .toBeCloseTo for the numeric = check
    expect(typeof map[todayKey]).toBe('number');
    expect(map._earliest).toBe(yesterday.getTime());
  });

  it('returns null on API error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const map = await fetchPriceMap();
    expect(map).toBeNull();
  });

  it('returns null on non-zero retCode', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ retCode: 10001, result: null }),
    });
    const map = await fetchPriceMap();
    expect(map).toBeNull();
  });

  it('returns null on fetch throw', async () => {
    fetch.mockRejectedValueOnce(new Error('Network error'));
    const map = await fetchPriceMap();
    expect(map).toBeNull();
  });
});
