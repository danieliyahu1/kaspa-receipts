import crypto from 'crypto';

const MAINNET_API = 'https://api.kaspa.org';
const TESTNET_API = 'https://api-tn10.kaspa.org';

const usedPaymentIds = new Set();
const pendingOffers = new Map();
const scriptKeyCache = new Map();

const EXPIRY_SECONDS = 120;

function apiBase(network) {
  return network === 'kaspa:testnet-10' ? TESTNET_API : MAINNET_API;
}

async function fetchScriptPublicKey(address, network) {
  const cacheKey = `${network}:${address}`;
  if (scriptKeyCache.has(cacheKey)) return scriptKeyCache.get(cacheKey);

  const base = apiBase(network);
  try {
    const res = await fetch(`${base}/addresses/${address}/full-transactions?limit=1`);
    if (res.ok) {
      const txs = await res.json();
      for (const tx of txs) {
        for (const out of (tx.outputs || [])) {
          if (out.script_public_key_address === address && out.script_public_key) {
            const key = `0000${out.script_public_key}`;
            scriptKeyCache.set(cacheKey, key);
            return key;
          }
        }
      }
    }
  } catch {
  }

  const fallback = `0000206f44308e6e4658ab5113c40d3d524df841875a49ed6a5f4f4de3d4604cd115bdac`;
  scriptKeyCache.set(cacheKey, fallback);
  return fallback;
}

export async function generateOffer({ payTo, amountSompi, network }) {
  const paymentId = 'p_' + crypto.randomBytes(16).toString('hex');
  const expires = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;

  pendingOffers.set(paymentId, {
    payTo,
    amountSompi,
    network,
    expires,
    createdAt: Date.now()
  });

  const [payToScriptPublicKey] = await Promise.all([
    fetchScriptPublicKey(payTo, network)
  ]);

  return {
    x402Version: 2,
    resource: {
      url: `${process.env.SERVICE_URL || 'http://localhost:3000'}/api/x402/statement`,
      description: 'Kaspa Statement Generator',
      serviceName: 'Kaspa Statement'
    },
    accepts: [{
      scheme: 'exact',
      network,
      amount: String(amountSompi),
      asset: 'KAS',
      payTo,
      maxTimeoutSeconds: EXPIRY_SECONDS,
      extra: {
        binding: 'kaspa-exact-v2',
        profile: 'standard-native',
        finality: 'accepted',
        transactionEncoding: 'kaspa-sdk-safe-json-v2.0.0',
        payToScriptPublicKey,
        paymentId,
        description: 'Kaspa Statement'
      }
    }]
  };
}

export async function verifyPayment(paymentId, txid) {
  const offer = pendingOffers.get(paymentId);
  if (!offer) {
    return { valid: false, reason: 'Unknown or expired payment_id' };
  }

  if (usedPaymentIds.has(paymentId)) {
    return { valid: false, reason: 'Payment ID already used' };
  }

  if (Date.now() / 1000 > offer.expires) {
    pendingOffers.delete(paymentId);
    return { valid: false, reason: 'Offer expired' };
  }

  const payTo = offer.payTo;
  const expectedAmount = BigInt(offer.amountSompi);

  try {
    const tx = await fetchTxByNetwork(txid, offer.network);

    if (!tx) {
      return { valid: false, reason: 'Transaction not found on chain' };
    }

    if (!tx.is_accepted) {
      return { valid: false, reason: 'Transaction not yet accepted' };
    }

    const outputs = tx.outputs || [];
    let matched = false;
    for (const out of outputs) {
      if (out.script_public_key_address === payTo && BigInt(out.amount) >= expectedAmount) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      return { valid: false, reason: 'No output paying expected amount to seller address' };
    }

    usedPaymentIds.add(paymentId);
    pendingOffers.delete(paymentId);

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Verification error: ${err.message}` };
  }
}

async function fetchTxByNetwork(txid, network) {
  const bases = network === 'kaspa:testnet-10'
    ? [TESTNET_API]
    : [MAINNET_API];
  const params = `?inputs=true&outputs=true&resolve_previous_outpoints=light`;

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/transactions/${txid}${params}`);
      if (res.ok) return res.json();
    } catch {
    }
  }
  return null;
}

export function paymentIdFromHeader(header) {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length < 3) return null;
  if (parts[0] !== 'kaspa-utxo') return null;
  return {
    scheme: parts[0],
    txid: parts[1],
    paymentId: parts[2]
  };
}

export function getPaymentAddress() {
  return process.env.PAYTO_ADDRESS || 'kaspatest:qph5gvywder93263z0zq602jfhuyrp66f8kk5h60fh3agczv6y2m67j5rtkk6';
}

export function getNetwork() {
  return process.env.KASPA_NETWORK || 'kaspa:testnet-10';
}

export function getPriceSompi() {
  return parseInt(process.env.PRICE_SOMPI || '10000000', 10);
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function encodeBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

async function sendOffer(res, reason) {
  const offer = await generateOffer({
    payTo: getPaymentAddress(),
    amountSompi: getPriceSompi(),
    network: getNetwork()
  });
  if (reason) offer.error = reason;

  const jsonStr = stableStringify(offer);
  const b64 = encodeBase64(jsonStr);

  return res
    .status(402)
    .set('Content-Type', 'application/json')
    .set('PAYMENT-REQUIRED', b64)
    .json(offer);
}

export function x402Middleware(req, res, next) {
  if (process.env.NODE_ENV !== 'production' && req.headers['x-test-bypass'] === 'bypass') {
    req.x402Payment = { scheme: 'test-bypass', txid: 'test', paymentId: 'test' };
    return next();
  }

  const paymentHeader = req.headers['x-k402-payment'];

  if (!paymentHeader) {
    return sendOffer(res);
  }

  const parsed = paymentIdFromHeader(paymentHeader);
  if (!parsed) {
    return sendOffer(res);
  }

  verifyPayment(parsed.paymentId, parsed.txid).then(result => {
    if (result.valid) {
      req.x402Payment = parsed;
      next();
    } else {
      sendOffer(res, result.reason);
    }
  }).catch(() => {
    sendOffer(res);
  });
}
