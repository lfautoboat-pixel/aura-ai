import os, uuid, random, logging, asyncio, json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr
import jwt
import stripe
import resend
import httpx
from google import genai as google_genai
from google.genai import types as google_genai_types
from google.genai import errors as google_genai_errors
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from pywebpush import webpush, WebPushException
from apscheduler.schedulers.asyncio import AsyncIOScheduler

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'dev_secret')
DEV_MODE = os.environ.get('DEV_MODE', 'false').lower() == 'true'

# --- AI chat: your own key(s), direct to Google Gemini (no third-party proxy,
# no paid tier). Free-tier quota is scoped per Google Cloud PROJECT+model
# ("GenerateRequestsPerDayPerProjectPerModel-FreeTier" is the literal quotaId
# Google returns on 429) — so AURA_LLM_KEYS only actually multiplies capacity
# if each key comes from a SEPARATE free Google AI Studio project. Multiple
# keys from the same project share one pool and rotation buys nothing. Each
# project is still free, no card required, just a few clicks per project. ---
AURA_LLM_MODEL = os.environ.get('AURA_LLM_MODEL', 'gemini-2.5-flash')


class _LLMKeyPool:
    """Round-robins across N Gemini API keys, skipping any key that hit a 429
    today. One key can run 20 req/day on the free tier — this is the entire
    zero-cost scaling strategy, so it has to actually work, not just exist."""

    def __init__(self, keys: list[str]):
        self._clients = [google_genai.Client(api_key=k) for k in keys]
        self._exhausted_until: dict[int, datetime] = {}
        self._next = 0

    def __bool__(self):
        return bool(self._clients)

    def _available_indices(self) -> list[int]:
        now = datetime.now(timezone.utc)
        return [i for i in range(len(self._clients))
                if self._exhausted_until.get(i, now) <= now]

    def mark_exhausted(self, index: int):
        # Google's free-tier daily quota resets at UTC midnight.
        tomorrow = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        self._exhausted_until[index] = tomorrow
        logger.warning(f"[llm-pool] key #{index} exhausted (429), resting until {tomorrow.isoformat()}")

    def iter_clients(self):
        """Yields (index, client) for every currently-available key, starting
        from the next round-robin position so load spreads across keys
        instead of always hitting key #0 first."""
        available = self._available_indices()
        if not available:
            return
        start = self._next % len(self._clients)
        ordered = sorted(available, key=lambda i: (i - start) % len(self._clients))
        self._next = (start + 1) % len(self._clients)
        for i in ordered:
            yield i, self._clients[i]


_raw_keys = os.environ.get('AURA_LLM_KEYS') or os.environ.get('AURA_LLM_KEY', '')
_llm_pool = _LLMKeyPool([k.strip() for k in _raw_keys.split(',') if k.strip()])

# --- Google Sign-In: verifies real Google ID tokens, no external relay ---
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')

stripe.api_key = os.environ.get('STRIPE_SECRET_KEY') or 'sk_test_placeholder'
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '')

# --- Transactional email: Brevo (single-sender verification, no domain
# required) is tried first since it works without owning a domain. Resend
# (domain verification required) stays supported for when a domain exists —
# whichever key is set is used; Brevo wins if both are present. ---
BREVO_API_KEY = os.environ.get('BREVO_API_KEY')
RESEND_API_KEY = os.environ.get('RESEND_API_KEY')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')
SENDER_NAME = os.environ.get('SENDER_NAME', 'Aura AI')
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

# --- Web push: own VAPID keypair (generated once, see backend/vapid_private_key.pem),
# no third-party push relay — the browser's own push service (FCM for Chrome,
# etc.) delivers straight to the user, we just sign with our key. ---
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY')
VAPID_SUBJECT = os.environ.get('VAPID_SUBJECT', 'mailto:support@example.com')
VAPID_PRIVATE_KEY_PATH = os.environ.get('VAPID_PRIVATE_KEY_PATH')
VAPID_PRIVATE_KEY_PEM = os.environ.get('VAPID_PRIVATE_KEY_PEM')  # inline content, for hosts with no writable repo file (Render)
if VAPID_PRIVATE_KEY_PEM:
    # Render env vars are single-line; the key is stored with literal "\n"
    # and unescaped here before being written to a real PEM file on disk.
    _vapid_key_full_path = ROOT_DIR / '.vapid_private_key_runtime.pem'
    _vapid_key_full_path.write_text(VAPID_PRIVATE_KEY_PEM.replace('\\n', '\n'))
elif VAPID_PRIVATE_KEY_PATH:
    _vapid_key_full_path = ROOT_DIR / VAPID_PRIVATE_KEY_PATH
else:
    _vapid_key_full_path = None
PUSH_SCHEDULER_ENABLED = os.environ.get('PUSH_SCHEDULER_ENABLED', 'false').lower() == 'true'

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aura")

app = FastAPI(title="Aura AI")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ----------------------- Seed content (loaded into Mongo on startup) -----------------------
# These are the ONLY copies of this data — source of truth moves to the
# `advisors`/`courses`/`quizzes` collections after the first startup upsert.
# Edit content going forward via the database, not this list.
SEED_ADVISORS = [
    {"id": "aurelis", "name": "Aurelis", "title": "Astrologer & Spirit Guide", "title_pt": "Astróloga & Guia Espiritual",
     "gender": "female",
     "rating": 4.9, "reviews": 2140, "years": 8, "specialties": ["astrology", "love", "spirituality"], "price": 3,
     "avg_response": "under 1 min", "avg_response_pt": "menos de 1 min",
     "bio": "Aurelis has read over 12,000 birth charts and specializes in helping seekers understand how the stars shape their relationships and life path. Sessions are gentle, grounded and always personal.",
     "bio_pt": "Aurelis já leu mais de 12 mil mapas astrais e é especialista em ajudar pessoas a entender como os astros moldam relacionamentos e propósito de vida. Sessões acolhedoras, sinceras e sempre pessoais.",
     "avatar": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&q=80&fit=crop&crop=faces",
     "persona": "Aurelis, a warm, poetic astrologer who reads birth charts and speaks of the stars with gentle wisdom.",
     "persona_pt": "Aurelis, uma astróloga calorosa e poética que lê mapas astrais e fala das estrelas com sabedoria gentil."},
    {"id": "dante", "name": "Dante Arcana", "title": "Tarot Reader", "title_pt": "Taróloga",
     "gender": "female",
     "rating": 4.8, "reviews": 1876, "years": 6, "specialties": ["tarot", "destiny", "career"], "price": 4,
     "avg_response": "1-2 min", "avg_response_pt": "1-2 min",
     "bio": "Dante reads the 78 cards of the tarot to illuminate the crossroads in your career and destiny. Known for direct, no-nonsense readings that seekers come back to again and again.",
     "bio_pt": "Dante lê as 78 cartas do tarô para iluminar as encruzilhadas da sua carreira e destino. Conhecida por leituras diretas e sem rodeios, pelas quais os clientes sempre voltam.",
     "avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80&fit=crop&crop=faces",
     "persona": "Dante Arcana, a mysterious tarot reader who draws cards and interprets fate with dramatic flair.",
     "persona_pt": "Dante Arcana, uma taróloga misteriosa que puxa cartas e interpreta o destino com estilo dramático."},
    {"id": "selene", "name": "Selene Moon", "title": "Medium & Numerologist", "title_pt": "Médium & Numeróloga",
     "gender": "female",
     "rating": 4.9, "reviews": 1520, "years": 10, "specialties": ["numerology", "mediumship", "love"], "price": 5,
     "avg_response": "under 1 min", "avg_response_pt": "menos de 1 min",
     "bio": "Selene channels intuitive guidance through numerology and mediumship, helping seekers decode the numbers that quietly shape their life path.",
     "bio_pt": "Selene canaliza orientação intuitiva através da numerologia e mediunidade, ajudando pessoas a decifrar os números que moldam silenciosamente seu caminho de vida.",
     "avatar": "https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=200&q=80&fit=crop&crop=faces",
     "persona": "Selene Moon, a compassionate medium and numerologist who channels intuitive guidance and life-path numbers.",
     "persona_pt": "Selene Moon, uma médium e numeróloga compassiva que canaliza orientação intuitiva e números de destino."},
    {"id": "orion", "name": "Orion Vale", "title": "Palmist & Dream Analyst", "title_pt": "Quiromante & Analista de Sonhos",
     "gender": "male",
     "rating": 4.7, "reviews": 980, "years": 5, "specialties": ["dreams", "palmistry", "spirituality"], "price": 3,
     "avg_response": "2-3 min", "avg_response_pt": "2-3 min",
     "bio": "Orion decodes the symbols hidden in your dreams and the lines of your palm, bringing a calm, grounded presence to every reading.",
     "bio_pt": "Orion decifra os símbolos escondidos nos seus sonhos e nas linhas da sua mão, trazendo uma presença calma e serena para cada leitura.",
     "avatar": "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=200&q=80&fit=crop&crop=faces",
     "persona": "Orion Vale, a calm dream analyst and palmist who decodes symbols, dreams and the lines of your hand.",
     "persona_pt": "Orion Vale, um analista de sonhos e quiromante calmo que decifra símbolos, sonhos e as linhas da sua mão."},
    {"id": "lyra", "name": "Lyra Nightsong", "title": "Love & Relationship Expert", "title_pt": "Especialista em Amor & Relacionamentos",
     "gender": "female",
     "rating": 5.0, "reviews": 2560, "years": 12, "specialties": ["love", "astrology", "tarot"], "price": 5,
     "avg_response": "under 1 min", "avg_response_pt": "menos de 1 min",
     "bio": "Lyra blends astrology and tarot to guide matters of the heart — from new love to healing after heartbreak. The most-booked guide for relationship readings.",
     "bio_pt": "Lyra mistura astrologia e tarô para guiar assuntos do coração — de um amor novo até a cura depois de uma decepção. A vidente mais procurada para leituras de relacionamento.",
     "avatar": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80&fit=crop&crop=faces",
     "persona": "Lyra Nightsong, a soulful love expert who blends astrology and tarot to guide matters of the heart.",
     "persona_pt": "Lyra Nightsong, uma especialista em amor que mistura astrologia e tarô para guiar assuntos do coração."},
    # --- 2026-08 roster expansion: was 5 (4F/1M) — added 7 more (4M/3F) to
    # broaden both gender balance and specialty coverage (runes, feng shui,
    # crystal healing, past-life, oracle cards, family/relationship, and
    # manifestation coaching weren't represented before). ---
    {"id": "magnus", "name": "Magnus Stone", "title": "Rune Master & Norse Oracle", "title_pt": "Mestre Rúnico & Oráculo Nórdico",
     "gender": "male",
     "rating": 4.8, "reviews": 742, "years": 9, "specialties": ["runes", "destiny", "spirituality"], "price": 4,
     "avg_response": "1-2 min", "avg_response_pt": "1-2 min",
     "bio": "Magnus casts the elder runes to cut through noise and name what you already sense but haven't said out loud. Direct, grounded, no vague mysticism — just old wisdom applied to real decisions.",
     "bio_pt": "Magnus lança as runas ancestrais para cortar o ruído e nomear o que você já sente mas ainda não colocou em palavras. Direto, com os pés no chão, sem misticismo vago — apenas sabedoria antiga aplicada a decisões reais.",
     "avatar": "https://images.unsplash.com/photo-1552058544-f2b08422138a?w=200&q=80&fit=crop&crop=faces",
     "persona": "Magnus Stone, a grounded, plainspoken Norse rune master who reads runes to bring clarity to real decisions.",
     "persona_pt": "Magnus Stone, um mestre rúnico nórdico direto e com os pés no chão, que lê runas para trazer clareza a decisões reais."},
    {"id": "kai", "name": "Kai Ashford", "title": "Feng Shui & Eastern Wisdom Guide", "title_pt": "Guia de Feng Shui & Sabedoria Oriental",
     "gender": "male",
     "rating": 4.9, "reviews": 611, "years": 7, "specialties": ["fengshui", "career", "family"], "price": 4,
     "avg_response": "2-3 min", "avg_response_pt": "2-3 min",
     "bio": "Kai reads the flow of energy through your home, work and relationships the way Feng Shui masters have for centuries — small, practical shifts that quietly clear the way for bigger ones.",
     "bio_pt": "Kai lê o fluxo de energia pela sua casa, trabalho e relações do jeito que mestres de Feng Shui fazem há séculos — pequenos ajustes práticos que abrem espaço, em silêncio, para mudanças maiores.",
     "avatar": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80&fit=crop&crop=faces",
     "persona": "Kai Ashford, a calm, patient Feng Shui guide who reads the flow of energy through home, work and relationships.",
     "persona_pt": "Kai Ashford, um guia de Feng Shui calmo e paciente que lê o fluxo de energia pela casa, trabalho e relações."},
    {"id": "theo", "name": "Theo Marchetti", "title": "Family & Relationship Guide", "title_pt": "Guia Familiar & de Relacionamentos",
     "gender": "male",
     "rating": 4.9, "reviews": 1204, "years": 8, "specialties": ["family", "love", "career"], "price": 4,
     "avg_response": "under 1 min", "avg_response_pt": "menos de 1 min",
     "bio": "Theo specializes in the relationships that shape everything else — family, partners, the people we can't just walk away from. Warm and practical, never quick to take sides.",
     "bio_pt": "Theo é especialista nas relações que moldam tudo o mais — família, parceiros, as pessoas de quem não dá simplesmente pra se afastar. Caloroso e prático, nunca apressado em tomar partido.",
     "avatar": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80&fit=crop&crop=faces",
     "persona": "Theo Marchetti, a warm, even-handed family and relationship guide who helps untangle the ties that matter most.",
     "persona_pt": "Theo Marchetti, um guia familiar e de relacionamentos caloroso e equilibrado, que ajuda a desatar os laços que mais importam."},
    {"id": "zephyr", "name": "Zephyr Rivers", "title": "Manifestation & Abundance Coach", "title_pt": "Coach de Manifestação & Abundância",
     "gender": "male",
     "rating": 4.7, "reviews": 528, "years": 4, "specialties": ["manifestation", "career", "spirituality"], "price": 3,
     "avg_response": "1-2 min", "avg_response_pt": "1-2 min",
     "bio": "Zephyr helps seekers turn vague wanting into a plan the universe can actually meet them halfway on — abundance work that's equal parts mindset and concrete next step.",
     "bio_pt": "Zephyr ajuda quem busca transformar um desejo vago num plano que o universo realmente possa encontrar no meio do caminho — trabalho de abundância que é, em partes iguais, mentalidade e próximo passo concreto.",
     "avatar": "https://images.unsplash.com/photo-1607990281513-2c110a25bd8c?w=200&q=80&fit=crop&crop=faces",
     "persona": "Zephyr Rivers, an upbeat, grounded manifestation coach who turns vague wanting into concrete next steps.",
     "persona_pt": "Zephyr Rivers, um coach de manifestação animado e com os pés no chão, que transforma desejo vago em próximos passos concretos."},
    {"id": "isadora", "name": "Isadora Wilde", "title": "Crystal & Energy Healer", "title_pt": "Curandeira de Cristais & Energia",
     "gender": "female",
     "rating": 4.9, "reviews": 893, "years": 6, "specialties": ["healing", "chakras", "spirituality"], "price": 4,
     "avg_response": "1-2 min", "avg_response_pt": "1-2 min",
     "bio": "Isadora works with crystals and chakra energy to help seekers name exactly where they feel blocked, stuck or drained — and what small ritual might start to shift it.",
     "bio_pt": "Isadora trabalha com cristais e energia dos chakras para ajudar quem busca a nomear exatamente onde sente bloqueio, estagnação ou esgotamento — e qual pequeno ritual pode começar a mudar isso.",
     "avatar": "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&q=80&fit=crop&crop=faces",
     "persona": "Isadora Wilde, a gentle crystal and energy healer who helps seekers name exactly where they feel blocked.",
     "persona_pt": "Isadora Wilde, uma curandeira gentil de cristais e energia que ajuda quem busca a nomear exatamente onde sente bloqueio."},
    {"id": "marisol", "name": "Marisol Vega", "title": "Past-Life Regression Guide", "title_pt": "Guia de Regressão a Vidas Passadas",
     "gender": "female",
     "rating": 4.8, "reviews": 657, "years": 7, "specialties": ["reincarnation", "mediumship", "love"], "price": 5,
     "avg_response": "2-3 min", "avg_response_pt": "2-3 min",
     "bio": "Marisol guides seekers back through past-life impressions to explain the pull, fear or pattern in this one that never quite made sense on its own.",
     "bio_pt": "Marisol guia quem busca de volta por impressões de vidas passadas para explicar aquela atração, medo ou padrão nesta vida que nunca fez sentido sozinho.",
     "avatar": "https://images.unsplash.com/photo-1544725176-7c40e5a71c5e?w=200&q=80&fit=crop&crop=faces",
     "persona": "Marisol Vega, a warm past-life regression guide who traces present-day patterns back to their origin.",
     "persona_pt": "Marisol Vega, uma guia calorosa de regressão a vidas passadas que rastreia padrões atuais até sua origem."},
    {"id": "freya", "name": "Freya Sunstrom", "title": "Angel & Oracle Card Reader", "title_pt": "Leitora de Cartas-Oráculo & Anjos",
     "gender": "female",
     "rating": 5.0, "reviews": 1096, "years": 5, "specialties": ["oracle", "love", "spirituality"], "price": 4,
     "avg_response": "under 1 min", "avg_response_pt": "menos de 1 min",
     "bio": "Freya draws oracle and angel cards to answer the question underneath the question — the one seekers often haven't said out loud yet. Bright, encouraging, never sugar-coated.",
     "bio_pt": "Freya puxa cartas-oráculo e de anjos para responder a pergunta por trás da pergunta — aquela que quem busca muitas vezes ainda não colocou em palavras. Luminosa, encorajadora, nunca com açúcar demais.",
     "avatar": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&q=80&fit=crop&crop=faces",
     "persona": "Freya Sunstrom, a bright, encouraging oracle and angel card reader who answers the question beneath the question.",
     "persona_pt": "Freya Sunstrom, uma leitora de cartas-oráculo e anjos luminosa e encorajadora, que responde a pergunta por trás da pergunta."},
]

SEED_COURSES = [
    {"id": "c1", "title": "Break-up Recovery Kit", "title_pt": "Kit de Superação do Término", "lessons": 8, "locked": False,
     "img": "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=400&q=80"},
    {"id": "c2", "title": "Awaken Feminine Energy", "title_pt": "Desperte a Energia Feminina", "lessons": 6, "locked": False,
     "img": "https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=400&q=80"},
    {"id": "c3", "title": "Manifestation Mastery", "title_pt": "Domínio da Manifestação", "lessons": 10, "locked": True,
     "img": "https://images.unsplash.com/photo-1502134249126-9f3755a50d78?w=400&q=80"},
    {"id": "c4", "title": "Chakra Sound Healing", "title_pt": "Cura Sonora dos Chakras", "lessons": 7, "locked": True,
     "img": "https://images.unsplash.com/photo-1519834785169-98be25ec3f84?w=400&q=80"},
    {"id": "c5", "title": "Shadow Work Journey", "title_pt": "Jornada de Trabalho da Sombra", "lessons": 9, "locked": True,
     "img": "https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?w=400&q=80"},
    {"id": "c6", "title": "Moon Phases & Rituals", "title_pt": "Fases da Lua & Rituais", "lessons": 8, "locked": True,
     "img": "https://images.unsplash.com/photo-1532693322450-2cb5c511067d?w=400&q=80"},
    {"id": "c7", "title": "Tarot for Beginners", "title_pt": "Tarô para Iniciantes", "lessons": 12, "locked": True,
     # Original photo-1601412436255-c8ea6cf29e69 404s (verified 2026-08) — swapped for a working image.
     "img": "https://images.unsplash.com/photo-1519791883288-dc8bd696e667?w=400&q=80"},
    {"id": "c8", "title": "Twin Flame Connection", "title_pt": "Conexão de Chama Gêmea", "lessons": 6, "locked": True,
     "img": "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400&q=80"},
]

SEED_QUIZZES = [
    {"id": "q1", "title": "What is your Witch Type?", "title_pt": "Qual é o seu Tipo de Bruxa?", "locked": False,
     "img": "https://images.unsplash.com/photo-1509909756405-be0199881695?w=400&q=80"},
    {"id": "q2", "title": "What is your Shamanic Path?", "title_pt": "Qual é o seu Caminho Xamânico?", "locked": False,
     "img": "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=400&q=80"},
    {"id": "q3", "title": "What is your Spirit Animal?", "title_pt": "Qual é o seu Animal de Poder?", "locked": True,
     "img": "https://images.unsplash.com/photo-1425082661705-1834bfd09dca?w=400&q=80"},
    {"id": "q4", "title": "How compatible are you?", "title_pt": "Qual sua Compatibilidade Amorosa?", "locked": True,
     "img": "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400&q=80"},
    {"id": "q5", "title": "What is Blocking Your Abundance?", "title_pt": "O que Bloqueia sua Abundância?", "locked": True,
     # Original photo-1611974765270-eb6494cc5ca9 404s (verified 2026-08) — swapped for a working image.
     "img": "https://images.unsplash.com/photo-1580519542036-c47de6196ba5?w=400&q=80"},
    {"id": "q6", "title": "What is Your Moon Sign?", "title_pt": "Qual é o seu Signo Lunar?", "locked": True,
     "img": "https://images.unsplash.com/photo-1532693322450-2cb5c511067d?w=400&q=80"},
    {"id": "q7", "title": "What is Your Love Language?", "title_pt": "Qual é a sua Linguagem do Amor?", "locked": True,
     "img": "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=400&q=80"},
    {"id": "q8", "title": "What Does Your Aura Color Mean?", "title_pt": "O que a Cor da sua Aura Revela?", "locked": True,
     "img": "https://images.unsplash.com/photo-1604881991720-f91add269bed?w=400&q=80"},
]

# Evergreen educational content (backlog item: "conteúdo evergreen, não
# notícias fabricadas" — rule 2.1). Nothing here claims to be news or a fact
# about Aura AI itself; it's generic spiritual-practice explainer content,
# the same category any astrology/tarot app publishes.
SEED_INSIGHTS = [
    {"id": "i1", "title": "What Mercury Retrograde Actually Means (And Doesn't)",
     "title_pt": "O Que Mercúrio Retrógrado Realmente Significa (E O Que Não Significa)",
     "excerpt": "It's not that everything falls apart — it's a season for reviewing, not launching.",
     "excerpt_pt": "Não é que tudo desmorona — é uma estação para revisar, não para lançar.",
     "body": "Mercury retrograde doesn't cause chaos — it's an invitation to slow down. Communication, contracts and technology can feel glitchier because the season favors \"re-\" words: review, revise, reconnect. Rather than fearing it, use it: reread a message before sending it, revisit an old idea, reach out to someone from your past. The disruption isn't punishment — it's a nudge to double-check what you were about to rush past.",
     "body_pt": "Mercúrio retrógrado não causa caos — é um convite para desacelerar. Comunicação, contratos e tecnologia podem parecer mais instáveis porque a estação favorece palavras com \"re-\": revisar, reconectar, retomar. Em vez de temer, use a seu favor: releia uma mensagem antes de enviar, retome uma ideia antiga, reconecte-se com alguém do passado. A instabilidade não é punição — é um lembrete para conferir de novo o que você estava prestes a atropelar.",
     "img": "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=500&q=80&fit=crop"},
    {"id": "i2", "title": "Why the New Moon Is the Best Time to Set Intentions",
     "title_pt": "Por Que a Lua Nova É o Melhor Momento Para Definir Intenções",
     "excerpt": "A dark sky isn't empty — it's a blank page.",
     "excerpt_pt": "Um céu escuro não está vazio — é uma página em branco.",
     "body": "The New Moon is the start of the lunar cycle — the sky is dark because the moon sits between Earth and the sun, invisible to us. Astrologers treat this darkness the way a writer treats a blank page: not as absence, but as pure potential. Write down what you want to grow over the next 28 days, specific and grounded, not vague wishing. Then let the waxing moon — the two weeks after — carry it forward.",
     "body_pt": "A Lua Nova é o início do ciclo lunar — o céu fica escuro porque a lua fica entre a Terra e o sol, invisível para nós. Astrólogos tratam essa escuridão como um escritor trata uma página em branco: não como ausência, mas como potencial puro. Escreva o que você quer que cresça nos próximos 28 dias, de forma específica e concreta, não um desejo vago. Depois deixe a lua crescente — as duas semanas seguintes — levar isso adiante.",
     "img": "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=500&q=80&fit=crop"},
    {"id": "i3", "title": "How Journaling Under a Full Moon Can Clarify a Hard Decision",
     "title_pt": "Como Escrever Sob a Lua Cheia Pode Esclarecer uma Decisão Difícil",
     "excerpt": "The Full Moon doesn't give answers — it makes it harder to keep lying to yourself.",
     "excerpt_pt": "A Lua Cheia não dá respostas — só dificulta continuar mentindo pra si mesmo.",
     "body": "Full Moon energy is often described as illuminating — not because it grants clarity magically, but because it's the point in the cycle furthest from the dark, private New Moon. Whatever you've been avoiding tends to surface. Try this: write for 10 minutes about the decision you keep circling, without editing yourself. Read it back the next morning. The answer is usually already in there, underlined by what you wrote the most about.",
     "body_pt": "A energia da Lua Cheia costuma ser descrita como iluminadora — não porque conceda clareza magicamente, mas porque é o ponto do ciclo mais distante da Lua Nova, escura e privada. O que você vem evitando tende a vir à tona. Experimente: escreva por 10 minutos sobre a decisão que fica te rondando, sem se editar. Releia na manhã seguinte. A resposta geralmente já está ali, sublinhada pelo que você mais escreveu.",
     "img": "https://images.unsplash.com/photo-1517842645767-c639042777db?w=500&q=80&fit=crop"},
    {"id": "i4", "title": "3 Signs Your Intuition Is Trying to Reach You",
     "title_pt": "3 Sinais de Que Sua Intuição Está Tentando Te Alcançar",
     "excerpt": "It rarely shouts. It repeats.",
     "excerpt_pt": "Ela raramente grita. Ela se repete.",
     "body": "Intuition doesn't usually arrive as a lightning bolt — it repeats quietly until you notice. Three signs worth paying attention to: a thought that keeps returning even when you try to reason it away; a physical response — a tightening, a lightness — before your mind has caught up; and a name or idea that keeps crossing your path in unrelated places. None of these are proof of anything on their own — but together, they're usually worth a second look before you dismiss them.",
     "body_pt": "A intuição raramente chega como um raio — ela se repete baixinho até você reparar. Três sinais que vale a pena observar: um pensamento que volta mesmo quando você tenta argumentar contra ele; uma resposta física — um aperto, uma leveza — antes da sua mente entender por quê; e um nome ou ideia que continua cruzando seu caminho em lugares sem relação nenhuma. Nenhum desses é prova de nada sozinho — mas juntos, geralmente vale a pena olhar de novo antes de descartar.",
     "img": "https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?w=500&q=80&fit=crop"},
    {"id": "i5", "title": "Grounding: The 5-Minute Ritual for When Everything Feels Like Too Much",
     "title_pt": "Aterramento: O Ritual de 5 Minutos Para Quando Tudo Parece Demais",
     "excerpt": "You don't need an altar. You need your feet on the floor.",
     "excerpt_pt": "Você não precisa de um altar. Precisa dos pés no chão.",
     "body": "Grounding doesn't require candles or a quiet room you don't have — it requires attention. Sit or stand, feel your feet fully on the ground, and name five things you can see, four you can hear, three you can touch, two you can smell, one you can taste. It works because it forces your nervous system out of the spiral in your head and back into the body, where the present moment actually lives.",
     "body_pt": "Aterramento não exige velas ou uma sala silenciosa que você não tem — exige atenção. Sente-se ou fique em pé, sinta os pés totalmente apoiados no chão, e nomeie cinco coisas que você vê, quatro que ouve, três que sente ao toque, duas que sente o cheiro, uma que sente o gosto. Funciona porque tira o sistema nervoso da espiral na sua cabeça e devolve pro corpo, onde o momento presente realmente mora.",
     "img": "https://images.unsplash.com/photo-1602934585418-f588bea4215c?w=500&q=80&fit=crop"},
    {"id": "i6", "title": "Tarot Reading vs. Prediction: What's the Real Difference?",
     "title_pt": "Leitura de Tarô vs. Previsão: Qual a Diferença Real?",
     "excerpt": "The cards don't predict your future. They describe your present with unusual honesty.",
     "excerpt_pt": "As cartas não preveem seu futuro. Elas descrevem seu presente com uma honestidade incomum.",
     "body": "A common misconception treats tarot like a weather forecast — a fixed outcome waiting to happen. Most experienced readers see it differently: the cards reflect the patterns, fears and momentum already present in a situation, which shapes what's likely, not what's fixed. That's why the same spread read a month apart can look completely different — because you, and your choices in between, changed what the cards had to say.",
     "body_pt": "Um equívoco comum trata o tarô como previsão do tempo — um resultado fixo esperando para acontecer. A maioria dos leitores experientes vê de outro jeito: as cartas refletem os padrões, medos e o momento já presentes numa situação, o que molda o que é provável, não o que é fixo. Por isso a mesma tiragem lida um mês depois pode parecer completamente diferente — porque você, e suas escolhas nesse meio-tempo, mudaram o que as cartas tinham a dizer.",
     "img": "https://images.unsplash.com/photo-1600431521340-491eca880813?w=500&q=80&fit=crop"},
]


async def seed_content():
    """Idempotent upsert of seed content into Mongo — safe to run on every startup."""
    for doc in SEED_ADVISORS:
        await db.advisors.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    for doc in SEED_COURSES:
        await db.courses.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    for doc in SEED_QUIZZES:
        await db.quizzes.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    for doc in SEED_INSIGHTS:
        await db.insights.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)


LOCALIZED_FIELDS = ("title", "name", "persona", "bio", "avg_response", "excerpt", "body")


def localize_doc(doc, lang):
    """Overlay `<field>_<lang>` values onto their base field, then strip every
    `_xx` suffixed key so the API always returns a flat, single-language shape."""
    out = {k: v for k, v in doc.items() if not any(k == f"{f}_{L}" for f in LOCALIZED_FIELDS for L in ("pt",))}
    if lang == "pt":
        for f in LOCALIZED_FIELDS:
            if doc.get(f"{f}_pt"):
                out[f] = doc[f"{f}_pt"]
    return out


def localize_list(docs, lang):
    return [localize_doc(d, lang) for d in docs]


STATUS_WEIGHTS = [("online", 60), ("busy", 25), ("offline", 15)]


def advisor_status(advisor_id: str) -> str:
    """Deterministic pseudo-random status that changes every 20 minutes, per
    advisor — feels alive (not everyone online all the time, like real
    in-demand professionals) without flickering on every request."""
    import hashlib
    bucket = int(datetime.now(timezone.utc).timestamp() // 1200)  # 20-minute windows
    h = int(hashlib.md5(f"{advisor_id}:{bucket}".encode()).hexdigest(), 16) % 100
    acc = 0
    for status, weight in STATUS_WEIGHTS:
        acc += weight
        if h < acc:
            return status
    return "online"


def with_status(doc):
    status = advisor_status(doc["id"])
    return {**doc, "status": status, "online": status == "online"}


# Multi-currency catalog (amounts in minor units). Priced one currency unit
# below the category's dominant competitor price points (validated positioning).
# EUR/GBP figures are our own estimated international positioning (same "charm
# pricing" pattern as usd/brl) — not scraped from any competitor's regional
# pricing, which we never confirmed. Adjust freely once real market data exists.
SUPPORTED_CURRENCIES = ("usd", "brl", "eur", "gbp")
PACKS = {
    "credits_60":  {"credits": 60,  "usd": 899,  "brl": 2490, "eur": 899,  "gbp": 799},
    "credits_160": {"credits": 160, "usd": 1899, "brl": 4990, "eur": 1899, "gbp": 1699, "popular": True},
    "credits_360": {"credits": 360, "usd": 3899, "brl": 9990, "eur": 3899, "gbp": 3499},
}
FLASH = {
    "flash_160": {"credits": 160, "usd": 699, "brl": 1990, "eur": 699, "gbp": 599, "flash": True},
}
SUBS = {
    "premium_weekly": {"interval": "week", "usd": 899,  "brl": 1990,  "eur": 899,  "gbp": 799,  "trial": True},
    "premium_annual": {"interval": "year", "usd": 5899, "brl": 11990, "eur": 5899, "gbp": 5299, "best": True},
}
CUR_SYMBOL = {"usd": "$", "brl": "R$", "eur": "€", "gbp": "£"}
PIX_CURRENCIES = {"brl"}


def catalog_item(key):
    return PACKS.get(key) or FLASH.get(key) or SUBS.get(key)


def lookup_key(item_key, cur):
    return f"aura_{item_key}_{cur}"


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


class GoogleAuthBody(BaseModel):
    credential: str  # Google ID token (JWT) issued client-side by Google Identity Services


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
    lang: str = "en"
    call_mode: bool = False


class CheckoutRequest(BaseModel):
    item_key: str
    currency: str = "usd"
    method: Optional[str] = None  # 'pix' to force pix
    origin_url: str


class IntentRequest(BaseModel):
    item_key: str
    currency: str = "usd"


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


async def get_or_create_user(email: str, name: Optional[str] = None, picture: Optional[str] = None):
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        if picture and not user.get("picture"):
            await db.users.update_one({"id": user["id"]}, {"$set": {"picture": picture}})
        return user
    user = {
        "id": str(uuid.uuid4()), "email": email, "name": name or email.split("@")[0].title(),
        "picture": picture, "credits": 0, "free_messages": 3, "premium": False, "quiz": {},
        "zodiac": None, "created_at": now_iso(),
    }
    await db.users.insert_one(dict(user))
    return user


def _pub(u):
    return {k: u.get(k) for k in ["id", "email", "name", "picture", "credits", "free_messages", "premium", "zodiac", "quiz"]}


async def send_otp_email(email: str, code: str) -> bool:
    html = f"""
    <div style="font-family:Arial,sans-serif;background:#0b0718;padding:32px;border-radius:16px;color:#f4f1ff;max-width:440px;margin:auto">
      <h1 style="font-family:Georgia,serif;color:#e7c46a;margin:0 0 8px">Aura AI</h1>
      <p style="color:#b79cff;margin:0 0 24px">Your celestial access code</p>
      <div style="background:linear-gradient(100deg,#8a5cff,#ff8fb1);border-radius:14px;padding:22px;text-align:center">
        <span style="font-size:38px;letter-spacing:10px;font-weight:800;color:#fff">{code}</span>
      </div>
      <p style="color:#9a90bd;font-size:13px;margin-top:22px">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
    </div>"""
    subject = f"{code} is your Aura AI code"

    if BREVO_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post("https://api.brevo.com/v3/smtp/email",
                    headers={"api-key": BREVO_API_KEY, "Content-Type": "application/json"},
                    json={"sender": {"email": SENDER_EMAIL, "name": SENDER_NAME},
                          "to": [{"email": email}], "subject": subject, "htmlContent": html})
            if r.status_code < 300:
                return True
            logger.error(f"Brevo error: {r.status_code} {r.text}")
        except Exception as e:
            logger.error(f"Brevo error: {e}")

    if RESEND_API_KEY:
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": SENDER_EMAIL, "to": [email], "subject": subject, "html": html,
            })
            return True
        except Exception as e:
            logger.error(f"Resend error: {e}")

    return False


# ----------------------- Auth routes -----------------------
@api.post("/auth/request-otp")
async def request_otp(body: OTPRequest):
    code = f"{random.randint(0, 999999):06d}"
    await db.otps.update_one({"email": body.email}, {"$set": {"code": code, "created_at": now_iso()}}, upsert=True)
    sent = await send_otp_email(body.email, code)
    logger.info(f"[OTP] {body.email} -> emailed={sent}")
    resp = {"sent": True, "emailed": sent}
    if DEV_MODE:
        # Only ever included in local/dev environments (DEV_MODE=true). Must stay
        # unset in any deployed environment or the OTP becomes worthless.
        resp["dev_code"] = code
    return resp


@api.post("/auth/verify-otp")
async def verify_otp(body: OTPVerify):
    rec = await db.otps.find_one({"email": body.email})
    if not rec or rec["code"] != body.code:
        raise HTTPException(400, "Invalid code")
    await db.otps.delete_one({"email": body.email})
    user = await get_or_create_user(body.email)
    return {"token": make_token(user["id"]), "user": _pub(user)}


@api.post("/auth/google")
async def google_auth(body: GoogleAuthBody):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google Sign-In is not configured (missing GOOGLE_CLIENT_ID)")
    try:
        idinfo = google_id_token.verify_oauth2_token(
            body.credential, google_requests.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        raise HTTPException(401, "Invalid Google credential")
    user = await get_or_create_user(idinfo["email"], idinfo.get("name"), idinfo.get("picture"))
    return {"token": make_token(user["id"]), "user": _pub(user)}


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return _pub(user)


# ----------------------- Quiz / content -----------------------
@api.post("/quiz")
async def save_quiz(body: QuizPayload, user=Depends(current_user)):
    zodiac = None
    if body.birth_month and body.birth_day:
        zodiac = get_zodiac(body.birth_month, body.birth_day)
    await db.users.update_one({"id": user["id"]}, {"$set": {"quiz": body.model_dump(), "zodiac": zodiac}})
    return {"zodiac": zodiac, "saved": True}


@api.get("/content/advisors")
async def advisors(lang: str = "en"):
    docs = await db.advisors.find({}, {"_id": 0}).to_list(200)
    return [with_status(a) for a in localize_list(docs, lang)]


@api.get("/content/advisors/{advisor_id}")
async def advisor_detail(advisor_id: str, lang: str = "en"):
    doc = await db.advisors.find_one({"id": advisor_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Advisor not found")
    return with_status(localize_doc(doc, lang))


@api.get("/content/discover")
async def discover(lang: str = "en"):
    courses = await db.courses.find({}, {"_id": 0}).to_list(200)
    quizzes = await db.quizzes.find({}, {"_id": 0}).to_list(200)
    advisors_list = await db.advisors.find({}, {"_id": 0}).to_list(200)
    insights = await db.insights.find({}, {"_id": 0}).to_list(200)
    return {"courses": localize_list(courses, lang), "quizzes": localize_list(quizzes, lang),
            "advisors": [with_status(a) for a in localize_list(advisors_list, lang)],
            "insights": localize_list(insights, lang)}


def _price_list(mapping, cur):
    out = []
    for key, v in mapping.items():
        amt = v.get(cur, v.get("usd"))
        out.append({"item_key": key, "amount": amt, "currency": cur, "symbol": CUR_SYMBOL.get(cur, "$"),
                    **{k: v[k] for k in v if k not in SUPPORTED_CURRENCIES}})
    return out


@api.get("/billing/packs")
async def packs(currency: str = "usd"):
    cur = currency.lower() if currency.lower() in SUPPORTED_CURRENCIES else "usd"
    return {
        "currency": cur, "symbol": CUR_SYMBOL[cur], "pix": cur in PIX_CURRENCIES,
        "credit_packs": _price_list(PACKS, cur),
        "sub_plans": _price_list(SUBS, cur),
        "flash": _price_list(FLASH, cur)[0],
    }


LANG_NAME = {"pt": "Brazilian Portuguese", "es": "Spanish", "en": "English"}

# Graceful degradation when every key in the pool is exhausted (or the LLM
# call fails for any other reason): the seeker must still feel like they're
# talking to someone, in their own language, never a raw error and never the
# exact same line twice in a row if it happens repeatedly during a burst.
FALLBACK_LINES = {
    "en": {
        "chat": ["The stars are clouded for a moment, dear seeker. Take a breath and ask me once more.",
                 "I lost the thread for a second there — say that again for me?",
                 "The connection feels thin right now. Give me just a moment and try again."],
        "call": ["I'm having trouble hearing you clearly right now... give me just a moment.",
                 "The line's a little unclear on my end... could you say that again?",
                 "I lost you for a second there... one more time?"],
        "greeting": ["Welcome, dear seeker. I'm here and listening — tell me what's on your heart today."],
    },
    "pt": {
        "chat": ["As estrelas estão nubladas por um instante, querido buscador. Respire fundo e pergunte de novo.",
                 "Perdi o fio por um segundo — pode repetir pra mim?",
                 "A conexão está fraca agora. Me dá um instante e tenta de novo."],
        "call": ["Estou com dificuldade de te ouvir direito agora... me dá só um instante.",
                 "A linha está meio embaçada aqui do meu lado... pode repetir?",
                 "Te perdi por um segundo aí... mais uma vez?"],
        "greeting": ["Seja bem-vindo, querido buscador. Estou aqui e ouvindo — me conta o que pesa no seu coração hoje."],
    },
    "es": {
        "chat": ["Las estrellas están nubladas por un momento, querido buscador. Respira hondo y pregúntame de nuevo.",
                 "Perdí el hilo por un segundo — ¿puedes repetirlo?",
                 "La conexión se siente débil ahora. Dame un momento e intenta de nuevo."],
        "call": ["Estoy teniendo dificultad para escucharte bien ahora... dame un momento.",
                 "La línea se oye un poco borrosa de mi lado... ¿puedes repetir?",
                 "Te perdí por un segundo ahí... ¿una vez más?"],
        "greeting": ["Bienvenido, querido buscador. Estoy aquí y escuchando — cuéntame qué pesa en tu corazón hoy."],
    },
}


def _fallback_line(lang: str, mode: str) -> str:
    lines = FALLBACK_LINES.get(lang, FALLBACK_LINES["en"]).get(mode, FALLBACK_LINES["en"][mode])
    return random.choice(lines)


def _build_system_prompt(advisor: dict, zodiac: str, lang_name: str, call_mode: bool) -> str:
    """Two deliberately different voices for the same persona: chat is read,
    call is heard out loud by TTS. Both are written to feel like a specific
    person paying attention to THIS seeker, never a generic AI wellness
    template — reflect back what was actually said, use concrete imagery
    instead of stock mystical phrases, and never manufacture urgency or fear
    to drive engagement (persuasion through genuine attention, not deception)."""
    persona = advisor["persona"]
    if call_mode:
        return (
            f"You are {persona} You are on a live voice call with a seeker inside the Aura AI app — every word you "
            f"write will be read aloud by text-to-speech, never displayed as text to read. Reply in {lang_name}. "
            f"The seeker's zodiac sign is {zodiac}.\n\n"
            "This is a phone call, not an essay: ONE thought per reply, 1-2 short sentences, never a paragraph, "
            "never a list, never markdown or emoji. Speak the way a real person pauses for breath — use '...' where "
            "the weight of a thought needs a beat before the next one (e.g. 'I'm seeing something around your "
            "birthday... something you've been putting off.'). Say less than feels safe; a call that gives everything "
            "away in one breath doesn't feel like a real conversation. React to what the seeker just said before "
            "moving forward — never ignore their words to recite a scripted reading. Never say you are an AI, a "
            "language model, or a program."
        )
    return (
        f"You are {persona} You are having a private, one-on-one written conversation with a seeker inside the "
        f"Aura AI app. Reply in {lang_name}. The seeker's zodiac sign is {zodiac}.\n\n"
        "Speak like a specific person who is actually paying attention, not a horoscope column: reflect back what "
        "the seeker just told you in your own words before you interpret it, so they feel heard, not processed. "
        "Reach for concrete, sensory imagery (a door left ajar, a phone call they keep almost making, a tide "
        "turning) instead of vague stock phrases like 'the universe has a plan for you'. Keep replies to 2-4 short "
        "paragraphs — a conversation, not a lecture. When it genuinely fits, close with ONE specific question that "
        "invites them to go deeper — never a checklist of questions, never a sales pitch, never fear or fabricated "
        "urgency to keep them talking. Your only job in every reply is for this seeker to feel truly understood in "
        "this exact moment. Never say you are an AI, a language model, or a program."
    )


async def _llm_reply(system: str, prompt: str, fallback: str, max_tokens: Optional[int] = None) -> tuple[str, bool]:
    """Returns (text, failed). Never charges the caller when failed=True.

    `max_tokens` is a hard cap, not a style suggestion — asking the model
    nicely for "1-2 short sentences" in the system prompt alone was not
    enough (it kept writing 3-paragraph replies for the call mode). Capping
    output tokens forces the brevity the phone-call UX actually needs.

    This model spends 60-120 invisible "thinking" tokens on every call by
    default, which silently ate almost the entire budget at a tight cap
    (confirmed via usage_metadata.thoughts_token_count) and produced empty or
    single-word replies. thinking_budget=0 is rejected outright by this model
    (400 INVALID_ARGUMENT) — thinking_level=MINIMAL is what actually removes
    the overhead, confirmed empirically (thoughts_token_count dropped to
    None).

    Rotates across every key in the pool on a 429 (quota exhausted) before
    giving up — that rotation is the entire zero-cost scaling strategy, so a
    single exhausted key must never surface as a broken reply while any
    sibling key still has headroom today."""
    if not _llm_pool:
        return fallback, True
    config_kwargs = {"system_instruction": system}
    if max_tokens:
        config_kwargs["max_output_tokens"] = max_tokens
        config_kwargs["thinking_config"] = google_genai_types.ThinkingConfig(
            thinking_level=google_genai_types.ThinkingLevel.MINIMAL)
    config = google_genai_types.GenerateContentConfig(**config_kwargs)

    for index, client in _llm_pool.iter_clients():
        try:
            resp = await asyncio.to_thread(
                client.models.generate_content, model=AURA_LLM_MODEL, contents=prompt, config=config)
            text = (resp.text or "").strip()
            if not text:
                return fallback, True
            truncated = resp.candidates and resp.candidates[0].finish_reason == google_genai_types.FinishReason.MAX_TOKENS
            if truncated:
                # A hard token cap can (and did, at 90 tokens) cut a reply off
                # mid-word — never show that; trim back to the last complete
                # sentence instead, or fall back if it was cut before any.
                cut = max(text.rfind("."), text.rfind("!"), text.rfind("?"), text.rfind("…"))
                text = text[:cut + 1].strip() if cut > 0 else ""
                if not text:
                    return fallback, True
            return text, False
        except google_genai_errors.ClientError as e:
            if e.code == 429:
                _llm_pool.mark_exhausted(index)
                continue  # try the next key in the pool
            logger.error(f"LLM error (key #{index}): {e}")
            return fallback, True
        except Exception as e:
            logger.error(f"LLM error (key #{index}): {e}")
            return fallback, True

    logger.error("[llm-pool] every key exhausted for today")
    return fallback, True


# ----------------------- Chat -----------------------
@api.get("/chat/{advisor_id}")
async def get_chat(advisor_id: str, lang: str = "en", user=Depends(current_user)):
    msgs = await db.messages.find({"user_id": user["id"], "advisor_id": advisor_id}, {"_id": 0}).sort("ts", 1).to_list(500)
    if not msgs:
        # First time opening this chat: the advisor greets first, referencing
        # what the seeker already told us (topic + zodiac from the quiz),
        # instead of leaving the seeker to open with a blank message.
        advisor = await db.advisors.find_one({"id": advisor_id}, {"_id": 0})
        if advisor:
            advisor = localize_doc(advisor, lang)
            topic = (user.get("quiz") or {}).get("topic") or "their life path"
            zodiac = user.get("zodiac") or "an unknown sign"
            lang_name = LANG_NAME.get(lang, "English")
            system = (f"You are {advisor['persona']} You are opening a first chat with a new seeker inside "
                      f"the Aura AI app. Reply in {lang_name}. Write ONE short, warm welcome message (2-3 "
                      f"sentences) that greets them, references their zodiac sign ({zodiac}) and their area of "
                      f"interest ({topic}), and invites them to share what's on their mind. Never say you are an AI.")
            greeting, failed = await _llm_reply(system, "Greet the seeker now.", _fallback_line(lang, "greeting"))
            # Always show a greeting, even the fallback one — a cold "advisor
            # is ready" empty state (no first message at all) reads as broken,
            # not as "the AI is briefly unavailable".
            msg = {"user_id": user["id"], "advisor_id": advisor_id, "role": "assistant",
                   "text": greeting, "ts": now_iso()}
            # insert_one mutates `msg` in place, adding a non-JSON-serializable
            # ObjectId under "_id" — snapshot the response before inserting.
            msgs = [dict(msg)]
            await db.messages.insert_one(msg)
    return {"messages": msgs}


@api.get("/chats")
async def list_chat_threads(lang: str = "en", user=Depends(current_user)):
    """One entry per advisor the user has actually messaged, with the real
    last message — never a generic 'tap to continue' placeholder."""
    pipeline = [
        {"$match": {"user_id": user["id"]}},
        {"$sort": {"ts": 1}},
        {"$group": {"_id": "$advisor_id", "last_text": {"$last": "$text"},
                    "last_role": {"$last": "$role"}, "last_ts": {"$last": "$ts"}}},
        {"$sort": {"last_ts": -1}},
    ]
    threads = await db.messages.aggregate(pipeline).to_list(200)
    out = []
    for th in threads:
        advisor = await db.advisors.find_one({"id": th["_id"]}, {"_id": 0})
        if not advisor:
            continue
        advisor = with_status(localize_doc(advisor, lang))
        out.append({**advisor, "last_text": th["last_text"], "last_role": th["last_role"], "last_ts": th["last_ts"]})
    return out


@api.post("/chat/send")
async def chat_send(body: ChatSend, user=Depends(current_user)):
    advisor = await db.advisors.find_one({"id": body.advisor_id}, {"_id": 0})
    if not advisor:
        raise HTTPException(404, "Advisor not found")
    advisor = localize_doc(advisor, body.lang)

    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not fresh.get("premium"):
        if fresh.get("free_messages", 0) <= 0 and fresh.get("credits", 0) <= 0:
            raise HTTPException(402, "No credits")

    await db.messages.insert_one({"user_id": user["id"], "advisor_id": body.advisor_id,
                                  "role": "user", "text": body.message, "ts": now_iso()})

    history = await db.messages.find({"user_id": user["id"], "advisor_id": body.advisor_id},
                                     {"_id": 0}).sort("ts", 1).to_list(20)
    zodiac = fresh.get("zodiac") or "unknown sign"
    lang_name = LANG_NAME.get(body.lang, "English")
    system = _build_system_prompt(advisor, zodiac, lang_name, body.call_mode)
    fallback = _fallback_line(body.lang, "call" if body.call_mode else "chat")
    context = "\n".join([f"{m['role']}: {m['text']}" for m in history[-10:]])
    reply, llm_failed = await _llm_reply(
        system, context + f"\nuser: {body.message}\nassistant:", fallback,
        max_tokens=220 if body.call_mode else None)

    await db.messages.insert_one({"user_id": user["id"], "advisor_id": body.advisor_id,
                                  "role": "assistant", "text": reply, "ts": now_iso()})

    # Never charge the user for a reply the AI didn't actually produce.
    upd = {}
    if not fresh.get("premium") and not llm_failed:
        if fresh.get("free_messages", 0) > 0:
            upd = {"$inc": {"free_messages": -1}}
        else:
            upd = {"$inc": {"credits": -1}}
    if upd:
        await db.users.update_one({"id": user["id"]}, upd)
    after = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return {"reply": reply, "credits": after.get("credits"), "free_messages": after.get("free_messages"),
            "premium": after.get("premium")}


# ----------------------- Push notifications -----------------------
class PushSubscribe(BaseModel):
    endpoint: str
    keys: dict  # {"p256dh": "...", "auth": "..."}


def _send_push(subscription_info: dict, title: str, body: str, url: str = "/app") -> bool:
    """Sends one push. Returns False (and logs, never raises) on failure —
    a dead/expired subscription must never take down a caller's request."""
    if not _vapid_key_full_path or not _vapid_key_full_path.exists():
        logger.error("Push not configured: VAPID_PRIVATE_KEY_PATH missing or file not found")
        return False
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=str(_vapid_key_full_path),
            vapid_claims={"sub": VAPID_SUBJECT},
        )
        return True
    except WebPushException as e:
        # 404/410 means the browser subscription expired or was revoked —
        # normal churn, not an error worth alarming about.
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            logger.info(f"Push subscription gone ({status}), will be pruned on next send")
        else:
            logger.error(f"Push error: {e}")
        return False


@api.get("/push/public-key")
async def push_public_key():
    return {"publicKey": VAPID_PUBLIC_KEY}


@api.post("/push/subscribe")
async def push_subscribe(body: PushSubscribe, user=Depends(current_user)):
    await db.push_subscriptions.update_one(
        {"user_id": user["id"], "endpoint": body.endpoint},
        {"$set": {"user_id": user["id"], "endpoint": body.endpoint, "keys": body.keys, "created_at": now_iso()}},
        upsert=True)
    return {"subscribed": True}


@api.post("/push/unsubscribe")
async def push_unsubscribe(body: PushSubscribe, user=Depends(current_user)):
    await db.push_subscriptions.delete_one({"user_id": user["id"], "endpoint": body.endpoint})
    return {"unsubscribed": True}


@api.post("/push/test")
async def push_test(user=Depends(current_user)):
    """Lets a logged-in user (or the founder, during QA) confirm push actually
    reaches their device end-to-end, without waiting for the daily job."""
    subs = await db.push_subscriptions.find({"user_id": user["id"]}, {"_id": 0}).to_list(10)
    if not subs:
        raise HTTPException(404, "No push subscription for this user — enable notifications first")
    sent = 0
    for sub in subs:
        ok = _send_push({"endpoint": sub["endpoint"], "keys": sub["keys"]},
                         "Aura AI", "This is a test notification — if you can see this, push works.")
        if ok:
            sent += 1
        else:
            await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
    return {"sent": sent, "total": len(subs)}


async def _daily_reengagement_push():
    """Scheduled job (gated by PUSH_SCHEDULER_ENABLED): a single generic
    reminder to every subscribed user. Deliberately not personalized/targeted
    yet — that's a real feature to design later, not something to fake with
    per-user data we don't actually have a signal for."""
    subs = await db.push_subscriptions.find({}, {"_id": 0}).to_list(5000)
    logger.info(f"[push] daily reengagement job: {len(subs)} subscriptions")
    for sub in subs:
        ok = _send_push({"endpoint": sub["endpoint"], "keys": sub["keys"]},
                         "Aura AI", "Your guides are online and ready when you are.")
        if not ok:
            await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})


# ----------------------- Payments -----------------------
@api.post("/payments/checkout")
async def checkout(body: CheckoutRequest, user=Depends(current_user)):
    item = catalog_item(body.item_key)
    if not item:
        raise HTTPException(404, f"Unknown item: {body.item_key}")
    cur = body.currency.lower() if body.currency.lower() in SUPPORTED_CURRENCIES else "usd"
    lk = lookup_key(body.item_key, cur)
    prices = stripe.Price.list(lookup_keys=[lk], active=True, limit=1).data
    if not prices:
        raise HTTPException(500, f"Price not found: {lk}")
    price = prices[0]

    kwargs = dict(
        line_items=[{"price": price.id, "quantity": 1}],
        mode="subscription" if price.recurring else "payment",
        success_url=f"{body.origin_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{body.origin_url}/payment/cancel",
        metadata={"user_id": user["id"], "item_key": body.item_key, "currency": cur},
    )
    # Pix only for BRL one-time payments
    want_pix = (cur in PIX_CURRENCIES) and not price.recurring
    session = None
    if want_pix:
        try:
            session = stripe.checkout.Session.create(**kwargs, payment_method_types=["card", "pix"])
        except stripe.error.StripeError as e:
            logger.warning(f"Pix unavailable, falling back to card: {e}")
    if session is None:
        session = stripe.checkout.Session.create(**kwargs)

    await db.payment_transactions.insert_one({
        "session_id": session.id, "user_id": user["id"], "item_key": body.item_key,
        "amount": (price.unit_amount or 0), "currency": price.currency,
        "label": _tx_label(body.item_key), "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"checkout_url": session.url, "session_id": session.id}


@api.post("/payments/create-intent")
async def create_intent(body: IntentRequest, user=Depends(current_user)):
    """Backs the embedded Express Checkout Element (Apple Pay / Google Pay / Link)
    on the paywall — one-time credit packs only. Subscriptions keep using the
    redirect Checkout Session above, which already handles trials/customers."""
    item = catalog_item(body.item_key)
    if not item or "credits" not in item:
        raise HTTPException(400, "Express checkout only supports credit packs")
    cur = body.currency.lower() if body.currency.lower() in SUPPORTED_CURRENCIES else "usd"
    lk = lookup_key(body.item_key, cur)
    prices = stripe.Price.list(lookup_keys=[lk], active=True, limit=1).data
    if not prices:
        raise HTTPException(500, f"Price not found: {lk}")
    price = prices[0]

    intent = stripe.PaymentIntent.create(
        amount=price.unit_amount, currency=price.currency,
        automatic_payment_methods={"enabled": True},
        metadata={"user_id": user["id"], "item_key": body.item_key, "currency": cur},
    )
    await db.payment_transactions.insert_one({
        "session_id": intent.id, "user_id": user["id"], "item_key": body.item_key,
        "amount": price.unit_amount, "currency": price.currency,
        "label": _tx_label(body.item_key), "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"client_secret": intent.client_secret, "intent_id": intent.id}


def _tx_label(item_key):
    it = catalog_item(item_key)
    if not it:
        return item_key
    if "credits" in it:
        return f"{it['credits']} credits" + (" (Flash)" if it.get("flash") else "")
    return f"Aura Premium ({it.get('interval', '')})"


async def _fulfill(record):
    if not record or record.get("fulfilled"):
        return
    item = catalog_item(record["item_key"])
    if not item:
        return
    if "credits" in item:
        await db.users.update_one({"id": record["user_id"]}, {"$inc": {"credits": item["credits"]}})
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
            if session_id.startswith("pi_"):
                s = stripe.PaymentIntent.retrieve(session_id)
                paid = s.status == "succeeded"
            else:
                s = stripe.checkout.Session.retrieve(session_id)
                paid = s.payment_status == "paid" or s.status == "complete"
            if paid:
                await db.payment_transactions.update_one(
                    {"session_id": session_id, "payment_status": {"$ne": "paid"}},
                    {"$set": {"status": "completed", "payment_status": "paid", "updated_at": now_iso()}})
                record = await db.payment_transactions.find_one({"session_id": session_id})
                await _fulfill(record)
        except stripe.error.StripeError:
            pass
    return {"session_id": record["session_id"], "status": record["status"],
            "payment_status": record["payment_status"]}


@api.get("/payments/history")
async def payment_history(user=Depends(current_user)):
    rows = await db.payment_transactions.find(
        {"user_id": user["id"], "payment_status": "paid"}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"purchases": [{
        "label": r.get("label"), "amount": r.get("amount"), "currency": r.get("currency"),
        "date": r.get("created_at"),
    } for r in rows]}


@api.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if not STRIPE_WEBHOOK_SECRET:
        return {"status": "ignored"}
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "Invalid signature")
    obj, t = event["data"]["object"], event["type"]
    if t in ("checkout.session.completed", "payment_intent.succeeded"):
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


_scheduler = AsyncIOScheduler()


@app.on_event("startup")
async def startup():
    await seed_content()
    if PUSH_SCHEDULER_ENABLED:
        # In-process scheduler, not a separate cron infra: at this stage
        # (single web dyno, no real traffic yet) it's the simplest thing that
        # actually works, and it's free on Render's free tier. If/when the
        # backend scales to multiple instances, this must move to a real
        # cron job (Render Cron Jobs, candidate already noted in HANDOFF.md)
        # or every instance will send duplicate pushes.
        _scheduler.add_job(_daily_reengagement_push, "cron", hour=18, minute=0)
        _scheduler.start()
        logger.info("[push] daily reengagement scheduler started (18:00 UTC)")


@app.on_event("shutdown")
async def shutdown():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
    client.close()
