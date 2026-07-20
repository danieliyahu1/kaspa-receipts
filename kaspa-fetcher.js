const MAINNET_API = 'https://api.kaspa.org';
const TESTNET_API = 'https://api-tn10.kaspa.org';
const BYBIT_BASE = 'https://api.bybit.com';

function apiBase(address) {
  return address && address.startsWith('kaspatest:') ? TESTNET_API : MAINNET_API;
}

function getDateKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function getKasAmount(sompi) {
  return Number(sompi) / 1e8;
}

function getTxDirection(tx, address) {
  const isSender = tx.inputs && tx.inputs.some(i => i.previous_outpoint_address === address);
  const hasExternalOutput = tx.outputs && tx.outputs.some(o => o.script_public_key_address !== address);
  return isSender && hasExternalOutput ? 'sent' : isSender ? 'self' : 'received';
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

function buildFIFOQueue(txs, address, priceMap) {
  const lots = [];
  const txGains = {};

  for (const tx of txs) {
    const direction = getTxDirection(tx, address);
    if (direction === 'self') continue;

    const amount = getTxAmount(tx, address, direction);
    const dateKey = getDateKey(tx.block_time);
    const price = priceMap ? priceMap[dateKey] : null;

    if (direction === 'received') {
      lots.push({
        amount,
        costBasisPerKas: price || 0,
        timestamp: tx.block_time,
        txId: tx.transaction_id
      });
    } else if (direction === 'sent') {
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

        lot.amount -= consumed;
        remaining -= consumed;
        if (lot.amount === 0) lots.shift();
      }

      const gain = totalSaleValue - totalCostBasis;
      txGains[tx.transaction_id] = { gain, saleValue: totalSaleValue, costBasis: totalCostBasis };
    }
  }

  let remainingCostBasis = 0;
  let remainingAmountSompi = 0;
  for (const lot of lots) {
    remainingCostBasis += getKasAmount(lot.amount) * lot.costBasisPerKas;
    remainingAmountSompi += lot.amount;
  }

  return { txGains, remainingCostBasis, remainingAmountSompi };
}

async function fetchAddressBalance(address) {
  const base = apiBase(address);
  const res = await fetch(`${base}/addresses/${address}/balance`);
  if (!res.ok) throw new Error('Could not fetch address balance.');
  const data = await res.json();
  return data.balance;
}

async function fetchAddressTxCount(address) {
  const base = apiBase(address);
  const res = await fetch(`${base}/addresses/${address}/transactions-count`);
  if (!res.ok) throw new Error('Could not fetch transaction count.');
  const data = await res.json();
  return data.total;
}

async function fetchAddressTxsPage(address, before) {
  const base = apiBase(address);
  let url;
  if (before) {
    url = `${base}/addresses/${address}/full-transactions-page?after=0&before=${before}&limit=500&resolve_previous_outpoints=light`;
  } else {
    url = `${base}/addresses/${address}/full-transactions-page?after=0&limit=500&resolve_previous_outpoints=light`;
  }
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Address not found. Check the address and try again.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  const txs = await res.json();
  const nextBefore = res.headers.get('X-Next-Page-Before');
  return { txs, nextBefore: nextBefore || null };
}

async function fetchAddressTxsOffset(address, offset, limit = 500) {
  const base = apiBase(address);
  const url = `${base}/addresses/${address}/full-transactions?limit=${limit}&offset=${offset}&resolve_previous_outpoints=light`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Address not found.');
    throw new Error('The Kaspa network is currently unavailable. Please try again.');
  }
  return res.json();
}

const MAX_TXS = 10000;

async function fetchAllTxsFromGenesis(address) {
  const total = await fetchAddressTxCount(address);
  if (total === 0) return [];

  const allTxs = [];
  const { txs: firstPageTxs, nextBefore } = await fetchAddressTxsPage(address, null);
  allTxs.push(...firstPageTxs);

  if (nextBefore && allTxs.length < MAX_TXS) {
    const offsets = [];
    const maxFetch = Math.min(total, MAX_TXS);
    for (let o = 500; o < maxFetch; o += 500) offsets.push(o);

    let pending = [...offsets];
    while (pending.length > 0 && allTxs.length < MAX_TXS) {
      const batch = pending.splice(0, 20);
      const results = await Promise.all(
        batch.map(off =>
          fetchAddressTxsOffset(address, off, 500)
            .then(txs => ({ offset: off, txs, ok: true }))
            .catch(() => ({ offset: off, ok: false }))
        )
      );

      const failed = [];
      for (const r of results) {
        if (r.ok) {
          allTxs.push(...r.txs);
          if (allTxs.length >= MAX_TXS) break;
        } else {
          failed.push(r.offset);
        }
      }
      if (failed.length > 0) pending = [...failed, ...pending];
    }
  }

  allTxs.reverse();
  return allTxs;
}

async function fetchPriceMap() {
  try {
    const res = await fetch(`${BYBIT_BASE}/v5/market/kline?category=spot&symbol=KASUSDT&interval=D&limit=1000`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.retCode !== 0 || !json.result?.list) return null;
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
    return map;
  } catch {
    return null;
  }
}

async function fetchCurrentPrice() {
  try {
    const res = await fetch(`${MAINNET_API}/info/price`);
    if (!res.ok) return null;
    const json = await res.json();
    return parseFloat(json.price);
  } catch {
    return null;
  }
}

async function fetchTransaction(txId, network) {
  const bases = network
    ? [network === 'kaspa:testnet-10' ? TESTNET_API : MAINNET_API]
    : [TESTNET_API, MAINNET_API];
  const params = new URLSearchParams({
    inputs: 'true', outputs: 'true', resolve_previous_outpoints: 'light'
  });

  let lastErr;
  for (const base of bases) {
    const url = `${base}/transactions/${txId}?${params}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 404) {
            lastErr = new Error('Transaction not found. Check the hash and try again.');
            break;
          }
          if (res.status === 422) throw new Error('Invalid transaction hash format.');
          throw new Error('The Kaspa network is currently unavailable. Please try again.');
        }
        return res.json();
      } catch (err) {
        if (attempt === 3) { lastErr = err; break; }
        const isNetworkError = err.message.includes('Failed to fetch') || err.message === 'Network error';
        if (isNetworkError) {
          await new Promise(r => setTimeout(r, attempt * 1000));
        } else { lastErr = err; break; }
      }
    }
    if (!lastErr || (lastErr.message !== 'Transaction not found. Check the hash and try again.' && lastErr.message !== 'The Kaspa network is currently unavailable. Please try again.')) break;
  }
  throw lastErr || new Error('Transaction not found');
}

export async function fetchStatement(address) {
  const [balance, txs, priceMap, currentPrice] = await Promise.all([
    fetchAddressBalance(address),
    fetchAllTxsFromGenesis(address),
    fetchPriceMap(),
    fetchCurrentPrice()
  ]);

  const fifoResult = buildFIFOQueue(txs, address, priceMap);

  return {
    address,
    balance,
    txs,
    txGains: fifoResult.txGains,
    fifoSummary: {
      remainingCostBasis: fifoResult.remainingCostBasis,
      remainingAmountSompi: fifoResult.remainingAmountSompi
    },
    priceMap,
    currentPrice
  };
}

export async function fetchReceipt(txId) {
  const [tx, priceMap] = await Promise.all([
    fetchTransaction(txId),
    fetchPriceMap()
  ]);

  const price = priceMap ? priceMap[getDateKey(tx.block_time)] : null;

  return { tx, price, priceMap };
}
