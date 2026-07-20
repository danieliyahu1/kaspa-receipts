"""Validate x402 response against schema."""
import json
import sys
import httpx

path = sys.argv[1]
with open(path) as f:
    offer = json.load(f)

http = httpx.Client()
pr_schema = http.get("https://kaspa-x402.org/schemas/payment-required.schema.json").json()
extra_schema = http.get("https://kaspa-x402.org/schemas/kaspa-requirements-extra.schema.json").json()

accept = offer["accepts"][0]
extra = accept.get("extra", {})

all_ok = True
required_extra = ["binding", "profile", "finality", "transactionEncoding", "payToScriptPublicKey"]
for field in required_extra:
    val = str(extra.get(field, ""))[:40]
    status = "PRESENT" if field in extra else "MISSING"
    print(f"  extra.{field}: {status} ({val}...)")
    if field not in extra:
        all_ok = False

for field in ["scheme", "network", "amount", "asset", "payTo", "maxTimeoutSeconds", "extra"]:
    print(f"  accept.{field}: {'PRESENT' if field in accept else 'MISSING'}")
    if field not in accept:
        all_ok = False

print(f"  x402Version: {offer.get('x402Version')}")
res = offer.get("resource", {})
print(f"  resource.url: {'PRESENT' if res.get('url') else 'MISSING'}")
if "resource" not in offer or not res.get("url"):
    all_ok = False

try:
    import jsonschema
    jsonschema.validate(offer, pr_schema)
    jsonschema.validate(extra, extra_schema)
    print("\nSCHEMA VALIDATION: PASSED")
except ImportError:
    print("\n(jsonschema not installed)")
except Exception as e:
    print(f"\nSCHEMA VALIDATION FAILED: {e}")
    all_ok = False

if all_ok:
    print("All checks passed!")
else:
    print("Some checks failed!")
    sys.exit(1)
