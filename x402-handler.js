import crypto from 'crypto';

const MAINNET_API = 'https://api.kaspa.org';
const TESTNET_API = 'https://api-tn10.kaspa.org';

const usedPaymentIds = new Set();
const balanceSnapshots = new Map();
const pendingOffers = new Map();
const snapshotLocks = new Set();

const EXPIRY_SECONDS = 120;

function apiBase(network) {
  return network === 'kaspa:testnet-10' ? TESTNET_API : MAINNET_API;
}

async function ensureSnapshot(payTo, network) {
  const key = `snap_${payTo}`;
  if (!balanceSnapshots.has(key) && !snapshotLocks.has(key)) {
    snapshotLocks.add(key);
    try {
      const base = apiBase(network);
      const res = await fetch(`${base}/addresses/${payTo}/balance`);
      if (res.ok) {
        const data = await res.json();
        balanceSnapshots.set(key, BigInt(data.balance));
      }
    } catch {
    } finally {
      snapshotLocks.delete(key);
    }
  }
}

export async function generateOffer({ payTo, amountSompi, network }) {
  const paymentId = 'p_' + crypto.randomBytes(16).toString('hex');
  const expires = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;

  await ensureSnapshot(payTo, network);

  pendingOffers.set(paymentId, {
    payTo,
    amountSompi,
    network,
    expires,
    createdAt: Date.now()
  });

  return {
    k402: '0.2',
    accepts: [{
      scheme: 'kaspa-utxo',
      network,
      amount_sompi: String(amountSompi),
      pay_to: payTo,
      payment_id: paymentId,
      expires,
      description: 'Kaspa Statement'
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
  const base = apiBase(offer.network);

  try {
    const res = await fetch(`${base}/addresses/${payTo}/balance`);
    if (!res.ok) {
      return { valid: false, reason: 'Could not verify payment' };
    }
    const data = await res.json();
    const currentBalance = BigInt(data.balance);

    const snapshotKey = `snap_${payTo}`;
    const snapshot = balanceSnapshots.get(snapshotKey);
    if (snapshot === undefined) {
      usedPaymentIds.add(paymentId);
      pendingOffers.delete(paymentId);
      return { valid: false, reason: 'No balance baseline available' };
    }

    if (currentBalance < snapshot + expectedAmount) {
      return { valid: false, reason: 'Insufficient payment detected' };
    }

    usedPaymentIds.add(paymentId);
    balanceSnapshots.set(snapshotKey, currentBalance);
    pendingOffers.delete(paymentId);

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Verification error: ${err.message}` };
  }
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

async function sendOffer(res, reason) {
  const offer = await generateOffer({
    payTo: getPaymentAddress(),
    amountSompi: getPriceSompi(),
    network: getNetwork()
  });
  if (reason) offer.reason = reason;
  return res.status(402).set('Content-Type', 'application/json').json(offer);
}

export function x402Middleware(req, res, next) {
  // TEST ONLY: bypass payment verification. Remove for production.
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
