"""Full x402 payment test against Render."""
import asyncio
import httpx
from k402 import HotWallet, PnnBackend, UtxoOffer

BUYER_PKEY = "9697293a33f87b136e63d34c5ce53e903bfc4edf3e804d8d251e47e0c186cb64"
BUYER_ADDR = "kaspatest:qqgvsqtjj3l7ewzrneg9tk96kn705h2x4p8gxmsxrme5andd7dj2qjgs02kua"
RENDER_URL = "https://kaspa-statement.onrender.com"

async def main():
    wallet = HotWallet(BUYER_PKEY, network="testnet", backend=PnnBackend("testnet-10"))
    wallet.network = "testnet-10"
    balance = await wallet.balance_sompi()
    print(f"Buyer wallet: {BUYER_ADDR}")
    print(f"Balance: {balance / 1e8} KAS")

    if balance < 10000000:
        raise SystemExit("Need at least 0.1 KAS in buyer wallet")

    async with httpx.AsyncClient() as http:
        print("\n1) Getting x402 offer from Render...")
        r = await http.post(
            f"{RENDER_URL}/api/x402/statement",
            json={"address": BUYER_ADDR},
        )
        assert r.status_code == 402, f"Expected 402, got {r.status_code}"

        # Check PAYMENT-REQUIRED header
        pr_header = r.headers.get("payment-required") or r.headers.get("PAYMENT-REQUIRED")
        print(f"   PAYMENT-REQUIRED header: {'PRESENT' if pr_header else 'MISSING'}")

        offer = r.json()
        accept = offer["accepts"][0]
        payment_id = accept["extra"]["paymentId"]
        print(f"   x402Version: {offer.get('x402Version')}")
        print(f"   scheme: {accept['scheme']}")
        print(f"   amount: {int(accept['amount']) / 1e8} KAS")
        print(f"   payTo: {accept['payTo'][:20]}...")
        print(f"   paymentId: {payment_id[:20]}...")

        print("\n2) Broadcasting 0.1 KAS payment...")
        utxo_offer = UtxoOffer(
            network="testnet-10",
            amount_sompi=str(accept["amount"]),
            pay_to=accept["payTo"],
            payment_id=payment_id,
            expires=int(60 + 120),
            description=accept.get("description", ""),
        )
        txid = await wallet.pay(utxo_offer)
        print(f"   Transaction broadcast! txid: {txid}")

        await asyncio.sleep(3)

        print("\n3) Retrying x402 call with payment proof...")
        header = f"kaspa-utxo {txid} {payment_id}"
        r = await http.post(
            f"{RENDER_URL}/api/x402/statement",
            headers={"X-K402-Payment": header},
            json={"address": BUYER_ADDR},
        )

        if r.status_code == 200:
            data = r.json()
            print(f"   [OK] PAYMENT ACCEPTED!")
            print(f"   Transactions: {len(data['txs'])}")
            print(f"   Balance: {int(data['balance']) / 1e8} KAS")
            if data.get('fifoSummary'):
                print(f"   Cost Basis: ${data['fifoSummary'].get('remainingCostBasis', 0):.2f}")
        else:
            print(f"   [FAIL] Status: {r.status_code}")
            print(f"   Response: {r.text[:200]}")

        new_balance = await wallet.balance_sompi()
        print(f"\nBuyer wallet now: {new_balance / 1e8} KAS")

asyncio.run(main())
