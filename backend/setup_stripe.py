import os
from dotenv import load_dotenv
from pathlib import Path
import stripe

load_dotenv(Path(__file__).parent / '.env')
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY') or 'sk_test_placeholder'

CURRENCIES = ("usd", "brl", "eur", "gbp")

# item_key -> {currency: amount(minor), interval optional}
CREDITS = {
    "credits_60":  {"usd": 899,  "brl": 2490,  "eur": 899,  "gbp": 799},
    "credits_160": {"usd": 1899, "brl": 4990,  "eur": 1899, "gbp": 1699},
    "credits_360": {"usd": 3899, "brl": 9990,  "eur": 3899, "gbp": 3499},
    "flash_160":   {"usd": 699,  "brl": 1990,  "eur": 699,  "gbp": 599},
}
SUBS = {
    "premium_weekly": {"usd": 899,  "brl": 1990,  "eur": 899,  "gbp": 799,  "interval": "week"},
    "premium_annual": {"usd": 5899, "brl": 11990, "eur": 5899, "gbp": 5299, "interval": "year"},
}

PRODUCTS = {
    "aura_credits": {"name": "Aura Credits", "tax_code": "txcd_10000000"},
    "aura_premium": {"name": "Aura Premium", "tax_code": "txcd_10103001"},
}


def get_or_create_product(pid, meta):
    for p in stripe.Product.list(active=True, limit=100).auto_paging_iter():
        if p.to_dict().get("metadata", {}).get("aura_product_id") == pid:
            return p
    return stripe.Product.create(name=meta["name"], tax_code=meta.get("tax_code"),
        metadata={"managed_by": "aura_ai", "aura_product_id": pid})


def ensure_price(product_id, item_key, cur, amount, interval=None):
    lk = f"aura_{item_key}_{cur}"
    existing = stripe.Price.list(lookup_keys=[lk], active=True, limit=1).data
    if existing:
        if existing[0].unit_amount != amount or existing[0].currency != cur:
            stripe.Price.modify(existing[0].id, active=False)
        else:
            print("exists", lk); return
    kwargs = dict(product=product_id, unit_amount=amount, currency=cur, lookup_key=lk, transfer_lookup_key=True)
    if interval:
        kwargs["recurring"] = {"interval": interval}
    stripe.Price.create(**kwargs)
    print("created", lk)


cred_prod = get_or_create_product("aura_credits", PRODUCTS["aura_credits"])
prem_prod = get_or_create_product("aura_premium", PRODUCTS["aura_premium"])

for key, m in CREDITS.items():
    for cur in CURRENCIES:
        ensure_price(cred_prod.id, key, cur, m[cur])
for key, m in SUBS.items():
    for cur in CURRENCIES:
        ensure_price(prem_prod.id, key, cur, m[cur], m["interval"])

print("DONE")
