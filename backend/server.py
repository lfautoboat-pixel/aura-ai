import os, uuid, random, logging, json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
import jwt
import stripe
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'dev_secret')
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY') or 'sk_test_emergent'
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '')

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aura")

app = FastAPI(title="Aura AI")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ----------------------- Static data -----------------------
ADVISORS = [
    {"id": "aurelis", "name": "Aurelis", "title": "Astrologer & Spirit Guide", "rating": 4.9, "reviews": 2140,
     "years": 8, "specialties": ["astrology", "love", "spirituality"], "price": 3, "online": True,
     "avatar": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&q=80&fit=crop&crop=faces",
     "persona": "Aurelis, a warm, poetic astrologer who reads birth charts and speaks of the stars with gentle wisdom."},
    {"id": "dante", "name": "Dante Arcana", "title": "Tarot Reader", "rating": 4.8, "reviews": 1876,
     "years": 6, "specialties": ["tarot", "destiny", "career"], "price": 4, "online": True,
     "avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80&fit=crop&crop=faces",
     "persona": "Dante Arcana, a mysterious tarot reader who draws cards and interprets fate with dramatic flair."},
    {"id": "selene", "name": "Selene Moon", "title": "Medium & Numerologist", "rating": 4.9, "reviews": 1520,
     "years": 10, "specialties": ["numerology", "mediumship", "love"], "price": 5, "online": True,
     "avatar": "https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=200&q=80&fit=crop&crop=faces",
     "persona": "Selene Moon, a compassionate medium and numerologist who channels intuitive guidance and life-path numbers."},
    {"id": "orion", "name": "Orion Vale", "title": "Palmist & Dream Analyst", "rating": 4.7, "reviews": 980,
     "years": 5, "specialties": ["dreams", "palmistry", "spirituality"], "price": 3, "online": False,
     "avatar": "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=200&q=80&fit=crop&crop=faces",
     "persona": "Orion Vale, a calm dream analyst and palmist who decodes symbols, dreams and the lines of your hand."},
    {"id": "lyra", "name": "Lyra Nightsong", "title": "Love & Relationship Expert", "rating": 5.0, "reviews": 2560,
     "years": 12, "specialties": ["love", "astrology", "tarot"], "price": 5, "online": True,
     "avatar": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80&fit=crop&crop=faces",
     "persona": "Lyra Nightsong, a soulful love expert who blends astrology and tarot to guide matters of the heart."},
]

COURSES = [
    {"id": "c1", "title": "Break-up Recovery Kit", "lessons": 8, "img": "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=400&q=80"},
    {"id": "c2", "title": "Awaken Feminine Energy", "lessons": 6, "img": "https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=400&q=80"},
    {"id": "c3", "title": "Manifestation Mastery", "lessons": 10, "img": "https://images.unsplash.com/photo-1502134249126-9f3755a50d78?w=400&q=80"},
    {"id": "c4", "title": "Chakra Sound Healing", "lessons": 7, "img": "https://images.unsplash.com/photo-1519834785169-98be25ec3f84?w=400&q=80"},
]

QUIZZES = [
    {"id": "q1", "title": "What is your Witch Type?", "img": "https://images.unsplash.com/photo-1509909756405-be0199881695?w=400&q=80"},
    {"id": "q2", "title": "What is your Shamanic Path?", "img": "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=400&q=80"},
    {"id": "q3", "title": "What is your Spirit Animal?", "img": "https://images.unsplash.com/photo-1425082661705-1834bfd09dca?w=400&q=80"},
    {"id": "q4", "title": "How compatible are you?", "img": "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400&q=80"},
]

CREDIT_PACKS = [
    {"lookup_key": "aura_credits_60", "credits": 60, "amount": 499, "label": "60 credits", "old": 999},
    {"lookup_key": "aura_credits_160", "credits": 160, "amount": 999, "label": "160 credits", "old": 1999, "popular": True},
    {"lookup_key": "aura_credits_360", "credits": 360, "amount": 1999, "label": "360 credits", "old": 3999},
]
SUB_PLANS = [
    {"lookup_key": "aura_premium_weekly", "amount": 999, "interval": "week", "label": "Weekly", "trial": "3-day free trial"},
    {"lookup_key": "aura_premium_annual", "amount": 5999, "interval": "year", "label": "Annual", "best": True},
]

ZODIAC = [
    (120, "Capricorn"), (218, "Aquarius"), (320, "Pisces"), (420, "Aries"), (521, "Taurus"),
    (621, "Gemini"), (722, "Cancer"), (823, "Leo"), (923, "Virgo"), (1023, "Libra"),
    (1122, "Scorpio"), (1222, "Sagittarius"), (1231, "Capricorn"),
]


def get_zodiac(month: int, day: int) -> str:
    md = month * 100 + day
    for cut, sign in ZODIAC:
        if md <= cut:
            return sign
    return "Capricorn"


# ----------------------- Models -----------------------
class OTPRequest(BaseModel):
    email: EmailStr


class OTPVerify(BaseModel):
    email: EmailStr
    code: str


class GoogleAuth(BaseModel):
    email: EmailStr
    name: Optional[str] = None


class QuizPayload(BaseModel):
    gender: Optional[str] = None
    topic: Optional[str] = None
    reading_type: Optional[str] = None
    birth_month: Optional[int] = None
    birth_day: Optional[int] = None
    birth_year: Optional[int] = None
    goals: Optional[List[str]] = None


class ChatSend(BaseModel):
    advisor_id: str
    message: str


class CheckoutRequest(BaseModel):
    lookup_key: str
    origin_url: str


def make_token(uid: str) -> str:
    return jwt.encode({"uid": uid, "exp": datetime.now(timezone.utc) + timedelta(days=60)}, JWT_SECRET, algorithm="HS256")


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["uid"]}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


async def get_or_create_user(email: str, name: Optional[str] = None):
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        return user
    user = {
        "id": str(uuid.uuid4()), "email": email, "name": name or email.split("@")[0].title(),
        "credits": 0, "free_messages": 3, "premium": False, "quiz": {}, "zodiac": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(dict(user))
    return user


def _pub(u):
    return {k: u.get(k) for k in ["id", "email", "name", "credits", "free_messages", "premium", "zodiac", "quiz"]}


# ----------------------- Auth routes -----------------------
@api.post("/auth/request-otp")
async def request_otp(body: OTPRequest):
    code = f"{random.randint(0, 999999):06d}"
    await db.otps.update_one({"email": body.email}, {"$set": {"code": code, "created_at": now_iso()}}, upsert=True)
    logger.info(f"[OTP] {body.email} -> {code}")
    return {"sent": True, "dev_code": code}


@api.post("/auth/verify-otp")
async def verify_otp(body: OTPVerify):
    rec = await db.otps.find_one({"email": body.email})
    if not rec or rec["code"] != body.code:
        raise HTTPException(400, "Invalid code")
    await db.otps.delete_one({"email": body.email})
    user = await get_or_create_user(body.email)
    return {"token": make_token(user["id"]), "user": _pub(user)}


@api.post("/auth/google")
async def google_auth(body: GoogleAuth):
    user = await get_or_create_user(body.email, body.name)
    return {"token": make_token(user["id"]), "user": _pub(user)}


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return _pub(user)


# ----------------------- Quiz -----------------------
@api.post("/quiz")
async def save_quiz(body: QuizPayload, user=Depends(current_user)):
    zodiac = None
    if body.birth_month and body.birth_day:
        zodiac = get_zodiac(body.birth_month, body.birth_day)
    await db.users.update_one({"id": user["id"]}, {"$set": {"quiz": body.model_dump(), "zodiac": zodiac}})
    return {"zodiac": zodiac, "saved": True}


@api.get("/content/advisors")
async def advisors():
    return ADVISORS


@api.get("/content/discover")
async def discover():
    return {"courses": COURSES, "quizzes": QUIZZES, "advisors": ADVISORS}


@api.get("/billing/packs")
async def packs():
    return {"credit_packs": CREDIT_PACKS, "sub_plans": SUB_PLANS}


# ----------------------- Chat -----------------------
@api.get("/chat/{advisor_id}")
async def get_chat(advisor_id: str, user=Depends(current_user)):
    msgs = await db.messages.find({"user_id": user["id"], "advisor_id": advisor_id}, {"_id": 0}).sort("ts", 1).to_list(500)
    return {"messages": msgs}


@api.post("/chat/send")
async def chat_send(body: ChatSend, user=Depends(current_user)):
    advisor = next((a for a in ADVISORS if a["id"] == body.advisor_id), None)
    if not advisor:
        raise HTTPException(404, "Advisor not found")

    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not fresh.get("premium"):
        if fresh.get("free_messages", 0) <= 0 and fresh.get("credits", 0) <= 0:
            raise HTTPException(402, "No credits")

    ts = now_iso()
    await db.messages.insert_one({"user_id": user["id"], "advisor_id": body.advisor_id,
                                  "role": "user", "text": body.message, "ts": ts})

    history = await db.messages.find({"user_id": user["id"], "advisor_id": body.advisor_id},
                                     {"_id": 0}).sort("ts", 1).to_list(20)
    zodiac = fresh.get("zodiac") or "unknown sign"
    system = (f"You are {advisor['persona']} You are chatting inside the Aura AI spiritual guidance app. "
              f"The seeker's zodiac sign is {zodiac}. Be warm, mystical, concise (2-4 short paragraphs), "
              f"empathetic and personal. Use their sign and intuitive imagery. Never say you are an AI.")
    try:
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"{user['id']}_{body.advisor_id}",
                       system_message=system).with_model("gemini", "gemini-3-flash-preview")
        context = "\n".join([f"{m['role']}: {m['text']}" for m in history[-10:]])
        reply = await chat.send_message(UserMessage(text=context + f"\nuser: {body.message}\nassistant:"))
    except Exception as e:
        logger.error(f"LLM error: {e}")
        reply = "The stars are clouded for a moment, dear seeker. Take a breath and ask me once more."

    ts2 = now_iso()
    await db.messages.insert_one({"user_id": user["id"], "advisor_id": body.advisor_id,
                                  "role": "assistant", "text": reply, "ts": ts2})

    upd = {}
    llm_ok = "clouded for a moment" not in reply
    if not fresh.get("premium") and llm_ok:
        if fresh.get("free_messages", 0) > 0:
            upd = {"$inc": {"free_messages": -1}}
        else:
            upd = {"$inc": {"credits": -1}}
    if upd:
        await db.users.update_one({"id": user["id"]}, upd)
    after = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return {"reply": reply, "credits": after.get("credits"), "free_messages": after.get("free_messages"),
            "premium": after.get("premium")}


# ----------------------- Payments (Stripe Flow A) -----------------------
def _find_pack(lk):
    for p in CREDIT_PACKS + SUB_PLANS:
        if p["lookup_key"] == lk:
            return p
    return None


@api.post("/payments/checkout")
async def checkout(body: CheckoutRequest, user=Depends(current_user)):
    prices = stripe.Price.list(lookup_keys=[body.lookup_key], active=True, limit=1).data
    if not prices:
        raise HTTPException(500, f"Price not found: {body.lookup_key}")
    price = prices[0]
    kwargs = dict(
        line_items=[{"price": price.id, "quantity": 1}],
        mode="subscription" if price.recurring else "payment",
        success_url=f"{body.origin_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{body.origin_url}/payment/cancel",
        metadata={"user_id": user["id"], "lookup_key": body.lookup_key},
    )
    try:
        session = stripe.checkout.Session.create(**kwargs, managed_payments={"enabled": True})
    except stripe.error.InvalidRequestError:
        session = stripe.checkout.Session.create(**kwargs)
    await db.payment_transactions.insert_one({
        "session_id": session.id, "user_id": user["id"], "lookup_key": body.lookup_key,
        "amount": (price.unit_amount or 0), "currency": price.currency,
        "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"checkout_url": session.url, "session_id": session.id}


async def _fulfill(record):
    if not record or record.get("fulfilled"):
        return
    pack = _find_pack(record["lookup_key"])
    if not pack:
        return
    if "credits" in pack:
        await db.users.update_one({"id": record["user_id"]}, {"$inc": {"credits": pack["credits"]}})
    else:
        await db.users.update_one({"id": record["user_id"]}, {"$set": {"premium": True}})
    await db.payment_transactions.update_one({"session_id": record["session_id"]}, {"$set": {"fulfilled": True}})


@api.get("/payments/status/{session_id}")
async def payment_status(session_id: str):
    record = await db.payment_transactions.find_one({"session_id": session_id})
    if not record:
        raise HTTPException(404, "Transaction not found")
    if record.get("payment_status") != "paid":
        try:
            s = stripe.checkout.Session.retrieve(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                await db.payment_transactions.update_one(
                    {"session_id": session_id, "payment_status": {"$ne": "paid"}},
                    {"$set": {"status": "completed", "payment_status": "paid", "updated_at": now_iso()}})
                record = await db.payment_transactions.find_one({"session_id": session_id})
                await _fulfill(record)
        except stripe.error.StripeError:
            pass
    return {"session_id": record["session_id"], "status": record["status"],
            "payment_status": record["payment_status"]}


@api.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "Invalid signature")
    obj, t = event["data"]["object"], event["type"]
    if t == "checkout.session.completed":
        await db.payment_transactions.update_one(
            {"session_id": obj["id"], "payment_status": {"$ne": "paid"}},
            {"$set": {"status": "completed", "payment_status": "paid", "updated_at": now_iso()}})
        rec = await db.payment_transactions.find_one({"session_id": obj["id"]})
        await _fulfill(rec)
    return {"status": "ok"}


@api.get("/")
async def root():
    return {"app": "Aura AI", "status": "ok"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware, allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
