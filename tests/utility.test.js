import { describe, it, expect, vi } from 'vitest';

// ─── formatNumber ──────────────────────────────────────────────

describe('formatNumber', () => {
  it('formats integers with locale separators', () => {
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(42)).toBe('42');
  });

  it('formats decimal numbers', () => {
    expect(formatNumber(1234.56)).toBe('1,234.56');
  });
});

// ─── formatKAS ─────────────────────────────────────────────────

describe('formatKAS', () => {
  it('converts sompi to KAS with correct formatting', () => {
    expect(formatKAS(100000000)).toBe('1.00 KAS');
    expect(formatKAS(50000000)).toBe('0.50 KAS');
    expect(formatKAS(123456789)).toBe('1.23456789 KAS');
    expect(formatKAS(0)).toBe('0.00 KAS');
  });

  it('handles large amounts', () => {
    expect(formatKAS(100000000000)).toBe('1,000.00 KAS');
    expect(formatKAS(12345678901234)).toBe('123,456.78901234 KAS');
  });

  it('has at least 2 fraction digits', () => {
    expect(formatKAS(1)).toBe('0.00000001 KAS');
    expect(formatKAS(100000000)).toBe('1.00 KAS');
  });
});

// ─── getKasAmount ──────────────────────────────────────────────

describe('getKasAmount', () => {
  it('converts sompi to KAS number', () => {
    expect(getKasAmount(100000000)).toBe(1);
    expect(getKasAmount(50000000)).toBe(0.5);
    expect(getKasAmount(1)).toBe(0.00000001);
    expect(getKasAmount(0)).toBe(0);
  });
});

// ─── formatUSD ─────────────────────────────────────────────────

describe('formatUSD', () => {
  it('formats USD with $ and 2 decimals', () => {
    expect(formatUSD(1234.5)).toBe('$1,234.50');
    expect(formatUSD(0)).toBe('$0.00');
    expect(formatUSD(1.2)).toBe('$1.20');
    expect(formatUSD(1234567.89)).toBe('$1,234,567.89');
  });
});

// ─── shortenHash ───────────────────────────────────────────────

describe('shortenHash', () => {
  it('shortens long hashes with ellipsis', () => {
    const hash = 'abcdef1234567890abcdef1234567890abcdef12';
    const result = shortenHash(hash, 8);
    expect(result).toBe('abcdef12…abcdef12');
    expect(result.length).toBeLessThan(hash.length);
  });

  it('returns full hash if short enough', () => {
    expect(shortenHash('abc', 8)).toBe('abc');
    expect(shortenHash('12345678', 8)).toBe('12345678');
  });

  it('uses default 8 chars', () => {
    const hash = 'aaaaaaaaaaaabbbbbbbbbbbccccccccccc';
    const result = shortenHash(hash);
    expect(result).toContain('…');
  });
});

// ─── escapeHtml ────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('hello & world')).toBe('hello &amp; world');
    expect(escapeHtml('"quote"')).toBe('&quot;quote&quot;');
    expect(escapeHtml("it's")).toBe("it's");
    expect(escapeHtml('<a href="#">Link</a>')).toBe('&lt;a href=&quot;#&quot;&gt;Link&lt;/a&gt;');
  });
});

// ─── getDateKey ────────────────────────────────────────────────

describe('getDateKey', () => {
  it('returns YYYY-M-D format', () => {
    const d = new Date(2024, 0, 15); // Jan 15, 2024
    expect(getDateKey(d.getTime())).toBe('2024-0-15');
  });

  it('handles different months', () => {
    expect(getDateKey(new Date(2024, 11, 25).getTime())).toBe('2024-11-25');
    expect(getDateKey(new Date(2024, 6, 4).getTime())).toBe('2024-6-4');
  });
});

// ─── getTxDirection ────────────────────────────────────────────

describe('getTxDirection', () => {
  const address = 'kaspa:testaddress123';

  it('returns "sent" when address is sender and has external output', () => {
    const tx = {
      inputs: [{ previous_outpoint_address: address }],
      outputs: [
        { script_public_key_address: address, amount: '100' },
        { script_public_key_address: 'kaspa:other', amount: '200' },
      ],
    };
    expect(getTxDirection(tx, address)).toBe('sent');
  });

  it('returns "self" when all outputs go back to sender', () => {
    const tx = {
      inputs: [{ previous_outpoint_address: address }],
      outputs: [
        { script_public_key_address: address, amount: '300' },
      ],
    };
    expect(getTxDirection(tx, address)).toBe('self');
  });

  it('returns "received" when address is only in outputs', () => {
    const tx = {
      inputs: [{ previous_outpoint_address: 'kaspa:sender' }],
      outputs: [
        { script_public_key_address: address, amount: '100' },
      ],
    };
    expect(getTxDirection(tx, address)).toBe('received');
  });

  it('returns "received" for coinbase (no inputs)', () => {
    const tx = {
      inputs: [],
      outputs: [
        { script_public_key_address: address, amount: '500' },
      ],
    };
    expect(getTxDirection(tx, address)).toBe('received');
  });
});

// ─── getCounterparty ───────────────────────────────────────────

describe('getCounterparty', () => {
  const address = 'kaspa:testaddress123';

  it('returns sender address for received txs', () => {
    const tx = {
      inputs: [
        { previous_outpoint_address: 'kaspa:sender123' },
        { previous_outpoint_address: address },
      ],
      outputs: [{ script_public_key_address: address }],
    };
    expect(getCounterparty(tx, address, 'received')).toBe('kaspa:sender123');
  });

  it('returns "Coinbase" when no sender input found', () => {
    const tx = {
      inputs: [{ previous_outpoint_address: null }],
      outputs: [{ script_public_key_address: address }],
    };
    expect(getCounterparty(tx, address, 'received')).toBe('Coinbase');
  });

  it('returns external receiver for sent txs', () => {
    const tx = {
      inputs: [{ previous_outpoint_address: address }],
      outputs: [
        { script_public_key_address: address, amount: '100' },
        { script_public_key_address: 'kaspa:receiver', amount: '200' },
      ],
    };
    expect(getCounterparty(tx, address, 'sent')).toBe('kaspa:receiver');
  });
});

// ─── getTxAmount ───────────────────────────────────────────────

describe('getTxAmount', () => {
  const address = 'kaspa:testaddress123';

  it('sums received outputs for "received" direction', () => {
    const tx = {
      outputs: [
        { script_public_key_address: address, amount: '100' },
        { script_public_key_address: address, amount: '200' },
        { script_public_key_address: 'kaspa:other', amount: '50' },
      ],
    };
    expect(getTxAmount(tx, address, 'received')).toBe(300);
  });

  it('sums external outputs for "sent" direction', () => {
    const tx = {
      outputs: [
        { script_public_key_address: address, amount: '100' },
        { script_public_key_address: 'kaspa:other', amount: '200' },
      ],
    };
    expect(getTxAmount(tx, address, 'sent')).toBe(200);
  });

  it('sums own outputs for "self" direction', () => {
    const tx = {
      outputs: [
        { script_public_key_address: address, amount: '300' },
      ],
    };
    expect(getTxAmount(tx, address, 'self')).toBe(300);
  });
});

// ─── formatDate / formatShortDate ─────────────────────────────

describe('formatDate', () => {
  it('formats a valid epoch', () => {
    const result = formatDate(1704067200000); // Jan 1, 2024
    expect(result).toContain('2024');
    expect(result).toContain('January');
    expect(result).toContain('1');
  });
});

describe('formatShortDate', () => {
  it('formats a valid epoch to short date', () => {
    const result = formatShortDate(1704067200000);
    expect(result).toContain('2024');
    expect(result).toContain('Jan');
  });
});

// ─── copyToClipboard ─────────────────────────────────────────

describe('copyToClipboard', () => {
  it('copies text and shows feedback', async () => {
    const writeText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = vi.fn(() => Promise.resolve());

    const btn = document.createElement('button');
    btn.textContent = 'Copy';
    await copyToClipboard('test text', btn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test text');
    expect(btn.textContent).toBe('Copied!');
    expect(btn.classList.contains('copied')).toBe(true);

    navigator.clipboard.writeText = writeText;
  });
});

// ─── Constants ────────────────────────────────────────────────

describe('constants', () => {
  it('defines TX_HASH_REGEX', () => {
    expect(TX_HASH_REGEX.test('a'.repeat(64))).toBe(true);
    expect(TX_HASH_REGEX.test('abc')).toBe(false);
    expect(TX_HASH_REGEX.test('g'.repeat(64))).toBe(false); // invalid hex
    expect(TX_HASH_REGEX.test('A'.repeat(64))).toBe(false); // lowercase only
  });

  it('defines ADDRESS_REGEX', () => {
    expect(ADDRESS_REGEX.test('kaspa:' + 'a'.repeat(61))).toBe(true);
    expect(ADDRESS_REGEX.test('kaspa:' + 'a'.repeat(63))).toBe(true);
    expect(ADDRESS_REGEX.test('kaspa:abc')).toBe(false);
    expect(ADDRESS_REGEX.test('bitcoin:abc')).toBe(false);
  });
});
