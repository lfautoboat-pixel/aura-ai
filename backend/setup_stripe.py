import os
from dotenv import load_dotenv
from pathlib import Path
import stripe

load_dotenv(Path(__file__).parent / '.env')
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY') or 'sk_test_emergent'

CATALOG = [
    {"pid": "aura_credits", "name": "Aura Credits", "tax_code": "txcd_10000000", "prices": [
        {"lookup_key": "aura_credits_60", "amount": 499, "currency": "usd"},
        {"lookup_key": "aura_credits_160", "amount": 999, "currency": "usd"},
        {"lookup_key": "aura_credits_360", "amount": 1999, "currency": "usd"},
    ]},
    {"pid": "aura_premium", "name": "Aura Premium", "tax_code": "txcd_10103001", "prices": [
        {"lookup_key": "aura_premium_weekly", "amount": 999, "currency": "usd", "interval": "week"},
        {"lookup_key": "aura_premium_annual", "amount": 5999, "currency": "usd", "interval": "year"},
    ]},
]


def get_or_create_product(entry):
    for p in stripe.Product.list(active=True).auto_paging_iter():
        if p.to_dict().get("metadata", {}).get("emergent_product_id") == entry["pid"]:
            return p
    return stripe.Product.create(name=entry["name"], tax_code=entry.get("tax_code"),
        metadata={"managed_by": "emergent", "emergent_product_id": entry["pid"]})


for entry in CATALOG:
    product = get_or_create_product(entry)
    for p in entry["prices"]:
        existing = stripe.Price.list(lookup_keys=[p["lookup_key"]], active=True, limit=1).data
        if existing and (existing[0].unit_amount != p["amount"]):
            stripe.Price.modify(existing[0].id, active=False)
            existing = []
        if not existing:
            kwargs = dict(product=product.id, unit_amount=p["amount"], currency=p["currency"],
                          lookup_key=p["lookup_key"], transfer_lookup_key=True)
            if p.get("interval"):
                kwargs["recurring"] = {"interval": p["interval"]}
            stripe.Price.create(**kwargs)
            print("created", p["lookup_key"])
        else:
            print("exists", p["lookup_key"])
print("DONE")
