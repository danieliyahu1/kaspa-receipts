import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchStatement, fetchReceipt } from './kaspa-fetcher.js';
import { x402Middleware } from './x402-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

function validateAddress(addr) {
  return /^kaspa(?:test)?:[a-z0-9]{61,63}$/.test(addr);
}

function validateTxId(txid) {
  return /^[a-f0-9]{64}$/.test(txid);
}

app.post('/api/web/statement', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || !validateAddress(address)) {
      return res.status(400).json({ error: 'Invalid Kaspa address' });
    }

    const result = await fetchStatement(address);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/web/receipt', async (req, res) => {
  try {
    const { txid } = req.body;
    if (!txid || !validateTxId(txid)) {
      return res.status(400).json({ error: 'Invalid transaction hash' });
    }

    const result = await fetchReceipt(txid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/x402/statement', x402Middleware, async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || !validateAddress(address)) {
      return res.status(400).json({ error: 'Invalid Kaspa address' });
    }

    const result = await fetchStatement(address);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/x402/receipt', x402Middleware, async (req, res) => {
  try {
    const { txid } = req.body;
    if (!txid || !validateTxId(txid)) {
      return res.status(400).json({ error: 'Invalid transaction hash' });
    }

    const result = await fetchReceipt(txid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Kaspa Statement server running on http://localhost:${PORT}`);
  console.log(`Network: ${process.env.KASPA_NETWORK || 'kaspa:testnet-10'}`);
  console.log(`Price: ${parseInt(process.env.PRICE_SOMPI || '10000000') / 1e8} KAS`);
  console.log(`Pay-to: ${process.env.PAYTO_ADDRESS || 'kaspatest:qph5gvywder93263z0zq602jfhuyrp66f8kk5h60fh3agczv6y2m67j5rtkk6'}`);
});
