import os, uuid, random, logging, asyncio, json, base64, re, secrets
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form
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
# Partner-program admin access piggybacks on the same login every other admin
# task uses here — no separate password to create or lose. Comma-separated;
# case-insensitive so a stray capital letter never silently locks you out.
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get('ADMIN_EMAILS', 'solutionslfdigital@gmail.com').split(',') if e.strip()}

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

C1_LESSONS = [
    {"title": "The First 48 Hours", "title_pt": "As Primeiras 48 Horas",
     "body": "The instinct after a break-up is to fix the feeling immediately — distract, explain, replay, reach out. Don't. The first 48 hours aren't for solving anything; they're for letting the nervous system register that something real ended. Cry if it comes. Sleep if you can. Don't make decisions, don't send the text you're rehearsing. You have permission to feel this exactly as badly as you feel it, for exactly as long as it takes — grief on a deadline isn't grief, it's suppression with a schedule.",
     "body_pt": "O instinto depois de um término é resolver o sentimento na hora — distrair, explicar, reviver, procurar a pessoa. Não faça isso. As primeiras 48 horas não são para resolver nada; são para o sistema nervoso registrar que algo real terminou. Chore se vier. Durma se conseguir. Não tome decisões, não mande a mensagem que você está ensaiando. Você tem permissão de sentir exatamente tão mal quanto sente, pelo tempo que precisar — luto com prazo não é luto, é supressão com cronograma."},
    {"title": "Why Your Brain Keeps Replaying It", "title_pt": "Por Que Sua Mente Fica Revivendo Tudo",
     "body": "The looping — the same conversation, the same what-if, on repeat — isn't a character flaw, it's your brain trying to find the moment it could have changed the outcome, because unresolved things get more mental real estate than resolved ones. The loop won't stop because you 'figure it out'; it stops when you stop needing an answer to feel safe. Try this: when it starts, name it out loud — 'I'm looping again' — and physically stand up. Interrupting the body interrupts the loop faster than out-arguing it in your head ever will.",
     "body_pt": "O loop mental — a mesma conversa, o mesmo 'e se', em repetição — não é um defeito seu, é sua mente tentando achar o momento em que poderia ter mudado o resultado, porque coisas não resolvidas ocupam mais espaço mental do que as resolvidas. O loop não para porque você 'descobre a resposta'; ele para quando você para de precisar de uma resposta pra se sentir segura. Tente isso: quando começar, nomeie em voz alta — 'estou em loop de novo' — e levante-se fisicamente. Interromper o corpo interrompe o loop mais rápido do que discutir com ele na sua cabeça."},
    {"title": "Rebuilding Your Own Orbit", "title_pt": "Reconstruindo Sua Própria Órbita",
     "body": "Long relationships quietly merge routines, playlists, even opinions. Losing that isn't just losing a person — it's losing the shape of your days. Don't rush to fill it with someone new; fill it with something that's undeniably, only yours. One meal you used to skip because they didn't like it. One route you used to avoid. Reclaiming small, specific things does more for identity than any big gesture — it proves, in a way you can feel, that your life still belongs to you.",
     "body_pt": "Relacionamentos longos misturam, sem perceber, rotinas, playlists, até opiniões. Perder isso não é só perder uma pessoa — é perder o formato dos seus dias. Não corra pra preencher com outra pessoa; preencha com algo que é inegavelmente só seu. Uma comida que você deixava de comer porque a outra pessoa não gostava. Um caminho que você evitava. Reconquistar coisas pequenas e específicas faz mais pela sua identidade do que qualquer gesto grande — prova, de um jeito que dá pra sentir, que sua vida ainda é sua."},
    {"title": "Closure Without Needing a Reply", "title_pt": "Fechamento Sem Precisar de Resposta",
     "body": "Most people wait for the other person to provide closure — an explanation, an apology, a clean conversation. It rarely comes, and waiting for it hands them the last word on your own healing. Closure is something you're allowed to build yourself: write the letter you'll never send, say out loud the sentence you needed to hear, then physically close something — a box, a drawer, a tab. The universe doesn't owe you an ending that makes narrative sense. You're allowed to write your own.",
     "body_pt": "A maioria das pessoas espera que a outra parte dê o fechamento — uma explicação, um pedido de desculpas, uma conversa limpa. Raramente isso vem, e esperar por ele entrega a última palavra da sua própria cura pra outra pessoa. Fechamento é algo que você pode construir sozinha: escreva a carta que nunca vai enviar, diga em voz alta a frase que precisava ouvir, depois feche algo fisicamente — uma caixa, uma gaveta, uma aba. O universo não te deve um final que faça sentido narrativo. Você pode escrever o seu."},
]
C2_LESSONS = [
    {"title": "What 'Feminine Energy' Actually Means", "title_pt": "O Que 'Energia Feminina' Realmente Significa",
     "body": "Feminine energy gets reduced to softness or passivity, and that's a disservice to what it actually is: receptivity. It's the capacity to sense what's true before you can explain why, to let things arrive instead of forcing them, to lead with intuition alongside logic instead of overriding it. It has nothing to do with how you dress or how quiet you are — some of the most 'feminine-energy-aligned' people you'll meet are loud, direct and impossible to overlook. This isn't about becoming someone softer. It's about trusting the parts of you that already know things your logic hasn't caught up to yet.",
     "body_pt": "Energia feminina costuma ser reduzida a suavidade ou passividade, e isso é um desserviço ao que ela realmente é: receptividade. É a capacidade de sentir o que é verdadeiro antes de conseguir explicar por quê, de deixar as coisas chegarem em vez de forçá-las, de liderar com intuição junto da lógica em vez de anulá-la. Não tem nada a ver com como você se veste ou o quão quieta você é — algumas das pessoas mais 'alinhadas com energia feminina' que você vai conhecer são barulhentas, diretas e impossíveis de ignorar. Isso não é sobre virar alguém mais suave. É sobre confiar nas partes de você que já sabem coisas que sua lógica ainda não alcançou."},
    {"title": "The Body as the First Signal", "title_pt": "O Corpo Como Primeiro Sinal",
     "body": "Intuition rarely arrives as a clear sentence in your head — it arrives in the body first: a tightening before you know why, a lightness before you've decided anything. Most of us are trained to override that signal in favor of what sounds reasonable. Try this for one week: before making any decision, big or small, pause and notice what happens in your chest and stomach before you think about it. You're not looking for magic. You're re-learning a language your body never stopped speaking.",
     "body_pt": "A intuição raramente chega como uma frase clara na cabeça — ela chega no corpo primeiro: um aperto antes de você saber por quê, uma leveza antes de você ter decidido qualquer coisa. A maioria de nós foi treinada pra anular esse sinal em favor do que soa razoável. Experimente por uma semana: antes de tomar qualquer decisão, grande ou pequena, pare e note o que acontece no seu peito e estômago antes de pensar sobre isso. Você não está procurando magia. Está reaprendendo uma língua que seu corpo nunca parou de falar."},
    {"title": "Boundaries Are a Feminine Practice Too", "title_pt": "Limites Também São uma Prática Feminina",
     "body": "Boundaries get filed under 'masculine' or 'harsh,' but a boundary stated calmly, without justification or apology, is one of the purest expressions of receptivity there is — it's you honoring what you actually feel instead of managing what someone else might feel about it. A soft no is still a complete no. Practice one this week: say it without over-explaining, without softening it into three sentences of context nobody asked for. Notice how much energy you get back the moment you stop auditioning for permission to have a limit.",
     "body_pt": "Limites costumam ser classificados como 'masculinos' ou 'ríspidos', mas um limite dito com calma, sem justificativa ou pedido de desculpas, é uma das expressões mais puras de receptividade que existe — é você honrando o que realmente sente em vez de administrar o que a outra pessoa pode sentir sobre isso. Um não suave ainda é um não completo. Pratique um esta semana: diga sem explicar demais, sem amaciar em três frases de contexto que ninguém pediu. Repare quanta energia volta pra você no momento em que você para de pedir permissão pra ter um limite."},
    {"title": "A 10-Minute Evening Ritual", "title_pt": "Um Ritual Noturno de 10 Minutos",
     "body": "Feminine energy is cyclical, not constant — it needs a real close to the day, not just a slide into sleep with a screen in your hand. Try this: light something (a candle is enough), write three lines about what your body felt today — not what happened, what it felt — then name one thing you're releasing before tomorrow. It takes ten minutes. The ritual isn't the candle or the notebook; it's the ten minutes where nothing is being produced, achieved, or optimized — just felt.",
     "body_pt": "Energia feminina é cíclica, não constante — precisa de um fechamento real do dia, não só um deslize pro sono com uma tela na mão. Experimente: acenda algo (uma vela já basta), escreva três linhas sobre o que seu corpo sentiu hoje — não o que aconteceu, o que sentiu — depois nomeie uma coisa que você está soltando antes de amanhã. Leva dez minutos. O ritual não é a vela nem o caderno; são os dez minutos em que nada está sendo produzido, conquistado ou otimizado — só sentido."},
]

SEED_COURSES = [
    {"id": "c1", "title": "Break-up Recovery Kit", "title_pt": "Kit de Superação do Término", "lessons": 4, "locked": False,
     "img": "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=400&q=80", "lessons_content": C1_LESSONS},
    {"id": "c2", "title": "Awaken Feminine Energy", "title_pt": "Desperte a Energia Feminina", "lessons": 4, "locked": False,
     "img": "https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=400&q=80", "lessons_content": C2_LESSONS},
    {"id": "c3", "title": "Manifestation Mastery", "title_pt": "Domínio da Manifestação", "lessons": 10, "locked": True,
     "teaser": "Turn vague wanting into a plan the universe can meet you halfway on.",
     "teaser_pt": "Transforme um desejo vago num plano que o universo consiga encontrar no meio do caminho.",
     "img": "https://images.unsplash.com/photo-1502134249126-9f3755a50d78?w=400&q=80"},
    {"id": "c4", "title": "Chakra Sound Healing", "title_pt": "Cura Sonora dos Chakras", "lessons": 7, "locked": True,
     "teaser": "Frequency-based practices to release what's stuck before it becomes a pattern.",
     "teaser_pt": "Práticas sonoras pra soltar o que está travado antes que vire padrão.",
     "img": "https://images.unsplash.com/photo-1519834785169-98be25ec3f84?w=400&q=80"},
    {"id": "c5", "title": "Shadow Work Journey", "title_pt": "Jornada de Trabalho da Sombra", "lessons": 9, "locked": True,
     "teaser": "The parts of yourself you edited out are still running the show — meet them on purpose.",
     "teaser_pt": "As partes de você que foram editadas ainda estão no comando — encontre-as de propósito.",
     "img": "https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?w=400&q=80"},
    {"id": "c6", "title": "Moon Phases & Rituals", "title_pt": "Fases da Lua & Rituais", "lessons": 8, "locked": True,
     "teaser": "A practice for every phase — when to start, when to release, when to simply rest.",
     "teaser_pt": "Uma prática pra cada fase — quando começar, quando soltar, quando só descansar.",
     "img": "https://images.unsplash.com/photo-1532693322450-2cb5c511067d?w=400&q=80"},
    {"id": "c7", "title": "Tarot for Beginners", "title_pt": "Tarô para Iniciantes", "lessons": 12, "locked": True,
     "teaser": "Read your first spread with real confidence — the 78 cards, decoded plainly.",
     "teaser_pt": "Leia sua primeira tiragem com confiança de verdade — as 78 cartas, decodificadas sem enrolação.",
     # Original photo-1601412436255-c8ea6cf29e69 404s (verified 2026-08) — swapped for a working image.
     "img": "https://images.unsplash.com/photo-1519791883288-dc8bd696e667?w=400&q=80"},
    {"id": "c8", "title": "Twin Flame Connection", "title_pt": "Conexão de Chama Gêmea", "lessons": 6, "locked": True,
     "teaser": "The difference between a twin flame and a familiar wound wearing a disguise.",
     "teaser_pt": "A diferença entre uma chama gêmea e uma ferida familiar disfarçada.",
     "img": "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400&q=80"},
]

Q1_QUESTIONS = [
    {"q": "It's a free evening. Where do you actually want to be?", "q_pt": "Uma noite livre. Onde você realmente quer estar?",
     "options": [
        {"label": "In the kitchen, making something from scratch", "label_pt": "Na cozinha, fazendo algo do zero", "type": "kitchen"},
        {"label": "Outside, hands in soil or surrounded by plants", "label_pt": "Lá fora, com as mãos na terra ou cercada de plantas", "type": "green"},
        {"label": "Alone, lights low, journal open", "label_pt": "Sozinha, luz baixa, diário aberto", "type": "moon"},
        {"label": "Home, candles lit, making the space feel like yours", "label_pt": "Em casa, velas acesas, deixando o espaço com a sua cara", "type": "hearth"}]},
    {"q": "A friend is going through something hard. Your instinct is to:", "q_pt": "Uma amiga está passando por algo difícil. Seu instinto é:",
     "options": [
        {"label": "Show up with food — comfort through the senses", "label_pt": "Aparecer com comida — conforto pelos sentidos", "type": "kitchen"},
        {"label": "Take her outside — a walk fixes more than talking", "label_pt": "Levar ela pra fora — uma caminhada resolve mais que conversa", "type": "green"},
        {"label": "Sit with the silence, no need to fix it", "label_pt": "Ficar no silêncio junto, sem precisar consertar", "type": "moon"},
        {"label": "Make her a space to land — tea, blanket, no rush", "label_pt": "Criar um espaço pra ela pousar — chá, cobertor, sem pressa", "type": "hearth"}]},
    {"q": "Your power object would most likely be:", "q_pt": "Seu objeto de poder provavelmente seria:",
     "options": [
        {"label": "A well-used wooden spoon", "label_pt": "Uma colher de pau bem usada", "type": "kitchen"},
        {"label": "A pressed flower or a jar of herbs", "label_pt": "Uma flor prensada ou um pote de ervas", "type": "green"},
        {"label": "A mirror or a piece of moonstone", "label_pt": "Um espelho ou uma pedra-da-lua", "type": "moon"},
        {"label": "A candle that's burned down halfway", "label_pt": "Uma vela já pela metade", "type": "hearth"}]},
    {"q": "What drains you fastest?", "q_pt": "O que te esgota mais rápido?",
     "options": [
        {"label": "A kitchen I can't make my own", "label_pt": "Uma cozinha que não é do meu jeito", "type": "kitchen"},
        {"label": "Too many days without going outside", "label_pt": "Muitos dias sem sair", "type": "green"},
        {"label": "Constant noise, no time alone", "label_pt": "Barulho constante, sem tempo sozinha", "type": "moon"},
        {"label": "A home that doesn't feel lived-in", "label_pt": "Uma casa que não parece habitada de verdade", "type": "hearth"}]},
    {"q": "Your ideal kind of magic is:", "q_pt": "Sua magia ideal é:",
     "options": [
        {"label": "Practical — a remedy, a recipe, something you can use", "label_pt": "Prática — um remédio, uma receita, algo que se usa", "type": "kitchen"},
        {"label": "Grown — patience, seasons, things that take time", "label_pt": "Cultivada — paciência, estações, coisas que levam tempo", "type": "green"},
        {"label": "Inward — dreams, cycles, what the night reveals", "label_pt": "Interior — sonhos, ciclos, o que a noite revela", "type": "moon"},
        {"label": "Domestic — protection, warmth, making a space sacred", "label_pt": "Doméstica — proteção, aconchego, tornar um espaço sagrado", "type": "hearth"}]},
]
Q1_RESULTS = [
    {"key": "kitchen", "title": "The Kitchen Witch", "title_pt": "A Bruxa da Cozinha",
     "desc": "Your magic is tactile — it lives in what you can stir, season and share. You believe (correctly) that a meal made with real intention is its own kind of spell. Your gift is turning the ordinary — dinner, tea, a shared table — into something that quietly heals people without them noticing it happened.",
     "desc_pt": "Sua magia é tátil — vive no que se mexe, tempera e divide. Você acredita (com razão) que uma refeição feita com intenção real é um tipo de feitiço. Seu dom é transformar o comum — o jantar, o chá, a mesa compartilhada — em algo que cura as pessoas sem que elas percebam que aconteceu."},
    {"key": "green", "title": "The Green Witch", "title_pt": "A Bruxa Verde",
     "desc": "You're tuned to growth cycles most people walk past without noticing. Plants, seasons, patience — your practice is rooted (literally) in the natural world's own timing. Your gift is knowing that not everything can be rushed, and having the discipline to let things take exactly as long as they need to.",
     "desc_pt": "Você está sintonizada com ciclos de crescimento que a maioria passa sem notar. Plantas, estações, paciência — sua prática é enraizada (literalmente) no próprio ritmo da natureza. Seu dom é saber que nem tudo pode ser apressado, e ter a disciplina de deixar as coisas levarem exatamente o tempo que precisam."},
    {"key": "moon", "title": "The Moon Witch", "title_pt": "A Bruxa da Lua",
     "desc": "Your practice lives inward — dreams, cycles, the parts of yourself that only show up in quiet. You process the world by feeling it fully before naming it, which can look like withdrawal but is actually depth. Your gift is a kind of self-knowledge most people spend their whole lives avoiding.",
     "desc_pt": "Sua prática vive por dentro — sonhos, ciclos, as partes de você que só aparecem no silêncio. Você processa o mundo sentindo por completo antes de nomear, o que pode parecer isolamento mas na verdade é profundidade. Seu dom é um autoconhecimento que a maioria evita a vida inteira."},
    {"key": "hearth", "title": "The Hearth Witch", "title_pt": "A Bruxa do Lar",
     "desc": "You practice through the space you build — the home that feels different the moment someone walks into it. Warmth, protection, ritual woven into ordinary domestic life. Your gift is making a room feel safe without anyone being able to say exactly why.",
     "desc_pt": "Você pratica através do espaço que constrói — a casa que parece diferente assim que alguém entra. Aconchego, proteção, ritual tecido na vida doméstica comum. Seu dom é fazer um ambiente parecer seguro sem ninguém saber dizer exatamente por quê."},
]

Q2_QUESTIONS = [
    {"q": "Someone you love is in pain. You feel called to:", "q_pt": "Alguém que você ama está sofrendo. Você se sente chamada a:",
     "options": [
        {"label": "Hold space and help them process it", "label_pt": "Segurar espaço e ajudar a processar", "type": "healer"},
        {"label": "Understand why it's really happening", "label_pt": "Entender por que isso está realmente acontecendo", "type": "seer"},
        {"label": "Get them out of that environment entirely", "label_pt": "Tirar a pessoa completamente daquele ambiente", "type": "wanderer"},
        {"label": "Protect what matters to them from getting worse", "label_pt": "Proteger o que importa pra pessoa de piorar", "type": "keeper"}]},
    {"q": "You feel most yourself when:", "q_pt": "Você se sente mais você mesma quando:",
     "options": [
        {"label": "Someone finally feels understood because of you", "label_pt": "Alguém finalmente se sente compreendido por sua causa", "type": "healer"},
        {"label": "You notice the thing nobody else saw coming", "label_pt": "Você percebe o que ninguém mais viu chegando", "type": "seer"},
        {"label": "You're somewhere new, with no fixed plan", "label_pt": "Você está em um lugar novo, sem plano fixo", "type": "wanderer"},
        {"label": "Something you built is still standing, intact", "label_pt": "Algo que você construiu ainda está de pé, intacto", "type": "keeper"}]},
    {"q": "Your recurring dreams tend to involve:", "q_pt": "Seus sonhos recorrentes costumam envolver:",
     "options": [
        {"label": "People you need to help or comfort", "label_pt": "Pessoas que você precisa ajudar ou confortar", "type": "healer"},
        {"label": "Symbols and messages you wake up trying to decode", "label_pt": "Símbolos e mensagens que você acorda tentando decifrar", "type": "seer"},
        {"label": "Travel, movement, unfamiliar places", "label_pt": "Viagem, movimento, lugares desconhecidos", "type": "wanderer"},
        {"label": "A home, a family, something worth defending", "label_pt": "Uma casa, uma família, algo que vale defender", "type": "keeper"}]},
    {"q": "What do people come to you for, without you asking?", "q_pt": "Pelo que as pessoas te procuram, sem você pedir?",
     "options": [
        {"label": "To feel less alone in something hard", "label_pt": "Pra se sentir menos sozinhas em algo difícil", "type": "healer"},
        {"label": "A read on a situation they can't see clearly", "label_pt": "Uma leitura de uma situação que não conseguem ver claro", "type": "seer"},
        {"label": "The push to finally make a change", "label_pt": "O empurrão pra finalmente mudar algo", "type": "wanderer"},
        {"label": "Steadiness — you're who they call in a crisis", "label_pt": "Estabilidade — você é quem chamam numa crise", "type": "keeper"}]},
    {"q": "Your biggest fear, if you're honest, is:", "q_pt": "Seu maior medo, sendo honesta, é:",
     "options": [
        {"label": "Not being able to ease someone's pain", "label_pt": "Não conseguir aliviar a dor de alguém", "type": "healer"},
        {"label": "Seeing something true and not being believed", "label_pt": "Ver algo verdadeiro e não ser acreditada", "type": "seer"},
        {"label": "Staying somewhere too long and losing yourself", "label_pt": "Ficar em algum lugar tempo demais e se perder", "type": "wanderer"},
        {"label": "Something you protect falling apart on your watch", "label_pt": "Algo que você protege desmoronar sob seus cuidados", "type": "keeper"}]},
]
Q2_RESULTS = [
    {"key": "healer", "title": "The Healer", "title_pt": "A Curandeira",
     "desc": "You're wired to sense pain before it's spoken and sit with it without flinching. Your path isn't about having answers — it's about presence so steady that people finally feel safe enough to fall apart, and then rebuild.",
     "desc_pt": "Você é feita pra sentir a dor antes de ela ser dita e ficar com ela sem se afastar. Seu caminho não é sobre ter respostas — é sobre uma presença tão firme que as pessoas finalmente se sentem seguras pra desmoronar, e depois se reconstruir."},
    {"key": "seer", "title": "The Seer", "title_pt": "A Vidente",
     "desc": "You notice the pattern before anyone names it. Your gift isn't prediction — it's clarity, the ability to see a situation for what it actually is while everyone else is still arguing about what they wish it were.",
     "desc_pt": "Você percebe o padrão antes de qualquer um nomear. Seu dom não é previsão — é clareza, a capacidade de ver uma situação pelo que ela realmente é enquanto todo mundo ainda discute o que gostaria que fosse."},
    {"key": "wanderer", "title": "The Wanderer", "title_pt": "A Andarilha",
     "desc": "You're not built to stay still, and that's not restlessness — it's how you learn. Every place you pass through leaves something in you and takes something you didn't need anymore. Your path is movement itself, not a destination.",
     "desc_pt": "Você não foi feita pra ficar parada, e isso não é inquietação — é como você aprende. Todo lugar por onde passa deixa algo em você e leva algo que você não precisava mais. Seu caminho é o movimento em si, não um destino."},
    {"key": "keeper", "title": "The Keeper", "title_pt": "A Guardiã",
     "desc": "You hold things together — people, homes, traditions — often without being thanked for the weight of it. Your path is quiet strength: the reason something fragile survived wasn't luck, it was you standing in front of it.",
     "desc_pt": "Você mantém as coisas de pé — pessoas, lares, tradições — muitas vezes sem ser agradecida pelo peso disso. Seu caminho é força silenciosa: a razão de algo frágil ter sobrevivido não foi sorte, foi você na frente dele."},
]

SEED_QUIZZES = [
    {"id": "q1", "title": "What is your Witch Type?", "title_pt": "Qual é o seu Tipo de Bruxa?", "locked": False,
     "img": "https://images.unsplash.com/photo-1509909756405-be0199881695?w=400&q=80",
     "questions": Q1_QUESTIONS, "results": Q1_RESULTS},
    {"id": "q2", "title": "What is your Shamanic Path?", "title_pt": "Qual é o seu Caminho Xamânico?", "locked": False,
     "img": "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=400&q=80",
     "questions": Q2_QUESTIONS, "results": Q2_RESULTS},
    {"id": "q3", "title": "What is your Spirit Animal?", "title_pt": "Qual é o seu Animal de Poder?", "locked": True,
     "teaser": "The animal that keeps appearing in your life isn't a coincidence.",
     "teaser_pt": "O animal que continua aparecendo na sua vida não é coincidência.",
     "img": "https://images.unsplash.com/photo-1425082661705-1834bfd09dca?w=400&q=80"},
    {"id": "q4", "title": "How compatible are you?", "title_pt": "Qual sua Compatibilidade Amorosa?", "locked": True,
     "teaser": "What actually makes two charts work — beyond sun sign compatibility charts.",
     "teaser_pt": "O que realmente faz dois mapas funcionarem — além das tabelas genéricas de compatibilidade.",
     "img": "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400&q=80"},
    {"id": "q5", "title": "What is Blocking Your Abundance?", "title_pt": "O que Bloqueia sua Abundância?", "locked": True,
     "teaser": "The exact belief quietly capping what you let yourself receive.",
     "teaser_pt": "A crença exata que está limitando, em silêncio, o que você se permite receber.",
     # Original photo-1611974765270-eb6494cc5ca9 404s (verified 2026-08) — swapped for a working image.
     "img": "https://images.unsplash.com/photo-1580519542036-c47de6196ba5?w=400&q=80"},
    {"id": "q6", "title": "What is Your Moon Sign?", "title_pt": "Qual é o seu Signo Lunar?", "locked": True,
     "teaser": "Your sun sign is who you show the world. Your moon sign is who you are at 2am.",
     "teaser_pt": "Seu signo solar é quem você mostra ao mundo. Seu signo lunar é quem você é às 2h da manhã.",
     "img": "https://images.unsplash.com/photo-1532693322450-2cb5c511067d?w=400&q=80"},
    {"id": "q7", "title": "What is Your Love Language?", "title_pt": "Qual é a sua Linguagem do Amor?", "locked": True,
     "teaser": "Why you keep feeling unloved by people who insist they love you.",
     "teaser_pt": "Por que você continua se sentindo mal amada por pessoas que insistem que te amam.",
     "img": "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=400&q=80"},
    {"id": "q8", "title": "What Does Your Aura Color Mean?", "title_pt": "O que a Cor da sua Aura Revela?", "locked": True,
     "teaser": "The color people unconsciously associate with you — and what it says about this season of your life.",
     "teaser_pt": "A cor que as pessoas associam a você sem perceber — e o que ela diz sobre esta fase da sua vida.",
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
    {"id": "i7", "title": "The Difference Between Manifesting and Denial",
     "title_pt": "A Diferença Entre Manifestar e Negar a Realidade",
     "excerpt": "Manifesting isn't pretending the bad thing didn't happen. It's deciding what happens next.",
     "excerpt_pt": "Manifestar não é fingir que o problema não aconteceu. É decidir o que vem depois.",
     "body": "A common trap: manifestation gets used to skip feeling something hard, dressed up as positivity — 'I don't dwell on it, I just manifest better.' That's not manifesting, it's avoidance with better branding. Real manifestation starts after the hard feeling, not instead of it: you feel the disappointment fully, then consciously choose what you're building next. Skipping the first step doesn't make you more powerful — it just means the unfelt feeling resurfaces later, usually at a worse time.",
     "body_pt": "Uma armadilha comum: manifestação é usada pra pular um sentimento difícil, disfarçada de positividade — 'eu não fico remoendo, eu só manifesto coisa melhor'. Isso não é manifestar, é evitação com marketing melhor. Manifestação de verdade começa depois do sentimento difícil, não no lugar dele: você sente a decepção por completo, depois escolhe conscientemente o que vai construir a seguir. Pular a primeira etapa não te torna mais poderosa — só significa que o sentimento não sentido volta depois, geralmente numa hora pior.",
     "img": "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=500&q=80&fit=crop"},
    {"id": "i8", "title": "The Ritual of Letting Go (And Why It Has to Be Physical)",
     "title_pt": "O Ritual de Soltar (E Por Que Ele Precisa Ser Físico)",
     "excerpt": "Deciding to let go in your head rarely works. Your body needs its own version of the memo.",
     "excerpt_pt": "Decidir soltar algo só na cabeça raramente funciona. Seu corpo precisa da própria versão do recado.",
     "body": "Thinking 'I'm letting this go' rarely convinces the nervous system of anything — thoughts are cheap, and the body knows it. That's why physical release rituals work better than mental ones: write it down and burn the paper, throw a stone into water, exhale hard and audibly on purpose. The content of the ritual matters less than the fact that it's physical, deliberate, and has a clear end point. Your body needs proof the thing is actually over — not another thought promising it is.",
     "body_pt": "Pensar 'estou soltando isso' raramente convence o sistema nervoso de nada — pensamento é barato, e o corpo sabe disso. Por isso rituais de liberação físicos funcionam melhor que os mentais: escreva e queime o papel, jogue uma pedra na água, expire forte e audível de propósito. O conteúdo do ritual importa menos do que ele ser físico, deliberado, e ter um ponto final claro. Seu corpo precisa de prova de que a coisa realmente acabou — não de mais um pensamento prometendo que acabou.",
     "img": "https://images.unsplash.com/photo-1533228876829-65c94e7b5025?w=500&q=80&fit=crop"},
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


LOCALIZED_FIELDS = ("title", "name", "persona", "bio", "avg_response", "excerpt", "body", "teaser")


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
    ref: Optional[str] = None  # partner referral code, see Partners section below


class GoogleAuthBody(BaseModel):
    credential: str  # Google ID token (JWT) issued client-side by Google Identity Services
    ref: Optional[str] = None


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


async def require_admin(user=Depends(current_user)):
    if (user.get("email") or "").lower() not in ADMIN_EMAILS:
        raise HTTPException(403, "Admin access required")
    return user


async def get_or_create_user(email: str, name: Optional[str] = None, picture: Optional[str] = None, ref: Optional[str] = None):
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        if picture and not user.get("picture"):
            await db.users.update_one({"id": user["id"]}, {"$set": {"picture": picture}})
        return user
    # First-touch attribution only: a brand-new account may carry a partner's
    # referral code, but only if that partner actually exists and is active —
    # never trust the client's claim blindly, this decides real money later.
    referred_by = None
    if ref:
        partner = await db.partners.find_one({"code": ref, "status": "active"}, {"_id": 0})
        if partner:
            referred_by = partner["code"]
    user = {
        "id": str(uuid.uuid4()), "email": email, "name": name or email.split("@")[0].title(),
        "picture": picture, "credits": 0, "free_messages": 3, "premium": False, "quiz": {},
        "zodiac": None, "created_at": now_iso(), "referred_by": referred_by,
        "stripe_customer_id": None, "stripe_subscription_id": None,
    }
    await db.users.insert_one(dict(user))
    if referred_by:
        await db.partners.update_one({"code": referred_by}, {"$inc": {"signups": 1}})
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
    user = await get_or_create_user(body.email, ref=body.ref)
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
    user = await get_or_create_user(idinfo["email"], idinfo.get("name"), idinfo.get("picture"), ref=body.ref)
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


@api.get("/content/courses/{course_id}")
async def course_detail(course_id: str, user=Depends(current_user)):
    """Full detail incl. lesson content. Returns both language variants raw —
    the nested lesson/question shape isn't worth teaching the generic
    top-level `_pt`-suffix localizer, so the client picks per its own `lang`.
    Requires auth (not just to view a title) because gating a locked course's
    real content behind `user.premium` happens here, server-side — a client
    that never got the content in the first place can't leak it via devtools."""
    doc = await db.courses.find_one({"id": course_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Course not found")
    if doc.get("locked") and not user.get("premium"):
        return {k: v for k, v in doc.items() if k != "lessons_content"}
    return doc


@api.get("/content/quizzes/{quiz_id}")
async def quiz_detail(quiz_id: str, user=Depends(current_user)):
    doc = await db.quizzes.find_one({"id": quiz_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Quiz not found")
    if doc.get("locked") and not user.get("premium"):
        return {k: v for k, v in doc.items() if k not in ("questions", "results")}
    return doc


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


# ----------------------- Partner / affiliate program -----------------------
# One collection of truth (db.partners) + an append-only ledger (db.partner_earnings)
# rather than mutating a single running total anywhere — every commission a
# partner is ever owed can always be reconstructed and audited from the
# ledger alone, which is the whole point when real people's money is on the
# line. earnings_owed/earnings_total on the partner doc are a cache for fast
# dashboard reads, kept in sync by $inc at the moment each ledger row is
# written (see _credit_partner_commission) and by mark-paid (below).

class PartnerCreate(BaseModel):
    name: str
    commission_rate: float = 0.30  # 0.30 == 30% of every charge, initial + each renewal — the studio's standard offer
    contact: Optional[str] = None  # how to reach them — TikTok handle, email, whatever
    payout_note: Optional[str] = None  # Wise email / Pix key / etc — free text, paid manually


class PartnerUpdate(BaseModel):
    name: Optional[str] = None
    commission_rate: Optional[float] = None
    contact: Optional[str] = None
    payout_note: Optional[str] = None
    status: Optional[str] = None  # active | paused


class PayoutRequestCreate(BaseModel):
    currency: str
    amount: Optional[int] = None  # minor units; omit to request the full owed balance
    note: Optional[str] = None


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "partner"


async def _unique_partner_code(name: str) -> str:
    base = _slugify(name)
    code = base
    i = 1
    while await db.partners.find_one({"code": code}):
        i += 1
        code = f"{base}-{i}"
    return code


def _partner_public(p: dict, site_url: str = None) -> dict:
    """Never leak the dashboard_token in any admin-listing response body by
    accident — it's a bearer secret, it goes out exactly once, at creation."""
    out = {k: v for k, v in p.items() if k not in ("_id", "dashboard_token")}
    if site_url:
        out["referral_url"] = f"{site_url}/?ref={p['code']}"
    return out


@api.post("/admin/partners")
async def create_partner(body: PartnerCreate, admin=Depends(require_admin)):
    if not (0 < body.commission_rate < 1):
        raise HTTPException(400, "commission_rate must be a fraction between 0 and 1, e.g. 0.25 for 25%")
    code = await _unique_partner_code(body.name)
    partner = {
        "id": str(uuid.uuid4()), "code": code, "name": body.name,
        "commission_rate": body.commission_rate, "contact": body.contact, "payout_note": body.payout_note,
        "status": "active", "dashboard_token": secrets.token_urlsafe(24),
        "clicks": 0, "signups": 0, "earnings_owed": {}, "earnings_total": {},
        "created_at": now_iso(),
    }
    await db.partners.insert_one(dict(partner))
    return partner  # only place the raw dashboard_token is ever returned


@api.get("/admin/partners")
async def list_partners(admin=Depends(require_admin)):
    partners = await db.partners.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_partner_public(p) for p in partners]


@api.patch("/admin/partners/{partner_id}")
async def update_partner(partner_id: str, body: PartnerUpdate, admin=Depends(require_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "commission_rate" in updates and not (0 < updates["commission_rate"] < 1):
        raise HTTPException(400, "commission_rate must be a fraction between 0 and 1")
    if updates:
        await db.partners.update_one({"id": partner_id}, {"$set": updates})
    p = await db.partners.find_one({"id": partner_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Partner not found")
    return _partner_public(p)


@api.post("/admin/partners/{partner_id}/regenerate-link")
async def regenerate_partner_link(partner_id: str, admin=Depends(require_admin)):
    """Safety net for a solo non-technical operator: the dashboard_token is
    only ever shown once, at creation. If it's lost before being copied and
    sent to the partner, this is the only way to recover access — issuing a
    fresh token immediately invalidates whatever the partner may have already
    bookmarked, so this should only be used when the original was never sent."""
    new_token = secrets.token_urlsafe(24)
    result = await db.partners.update_one({"id": partner_id}, {"$set": {"dashboard_token": new_token}})
    if result.matched_count == 0:
        raise HTTPException(404, "Partner not found")
    return {"dashboard_token": new_token}


@api.get("/admin/partners/{partner_id}/earnings")
async def partner_earnings_ledger(partner_id: str, admin=Depends(require_admin)):
    rows = await db.partner_earnings.find({"partner_id": partner_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows


@api.get("/admin/payouts")
async def list_payouts(admin=Depends(require_admin)):
    rows = await db.payout_requests.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows


@api.post("/admin/payouts/{payout_id}/mark-paid")
async def mark_payout_paid(payout_id: str, admin=Depends(require_admin)):
    payout = await db.payout_requests.find_one({"id": payout_id}, {"_id": 0})
    if not payout:
        raise HTTPException(404, "Payout request not found")
    if payout["status"] == "paid":
        return payout
    await db.payout_requests.update_one({"id": payout_id}, {"$set": {"status": "paid", "paid_at": now_iso()}})
    await db.partners.update_one(
        {"id": payout["partner_id"]},
        {"$inc": {f"earnings_owed.{payout['currency']}": -payout["amount"]}},
    )
    payout["status"] = "paid"
    return payout


@api.post("/partners/track")
async def track_partner_click(body: dict):
    code = (body or {}).get("code")
    if not code:
        return {"tracked": False}
    result = await db.partners.update_one({"code": code, "status": "active"}, {"$inc": {"clicks": 1}})
    return {"tracked": result.matched_count > 0}


@api.get("/partner/{token}")
async def partner_dashboard(token: str):
    partner = await db.partners.find_one({"dashboard_token": token}, {"_id": 0})
    if not partner:
        raise HTTPException(404, "Not found")
    recent = await db.partner_earnings.find({"partner_id": partner["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    payouts = await db.payout_requests.find({"partner_id": partner["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {**_partner_public(partner), "recent_earnings": recent, "payout_requests": payouts}


@api.post("/partner/{token}/payout-request")
async def request_payout(token: str, body: PayoutRequestCreate):
    partner = await db.partners.find_one({"dashboard_token": token}, {"_id": 0})
    if not partner:
        raise HTTPException(404, "Not found")
    owed = partner.get("earnings_owed", {}).get(body.currency, 0)
    amount = body.amount if body.amount is not None else owed
    if amount <= 0 or amount > owed:
        raise HTTPException(400, "Requested amount exceeds the current owed balance")
    request_doc = {
        "id": str(uuid.uuid4()), "partner_id": partner["id"], "partner_code": partner["code"],
        "amount": amount, "currency": body.currency, "note": body.note,
        "status": "pending", "created_at": now_iso(),
    }
    await db.payout_requests.insert_one(dict(request_doc))
    return request_doc


# ----------------------- Soulmate Sketch (Nebula pre-landing funnel) -----------------------
# Fully local/free image generation (Pillow) — no third-party API, no keys, no
# per-request cost. Ported verbatim from the Emergent-delivered funnel prototype
# (memory/PRD.md in that export) into this backend since both are already FastAPI.
# Stateless by design: the selfie is never persisted, only transformed in-memory
# and returned as base64 — matches the privacy posture already used elsewhere
# in this file (see /auth/request-otp) of not storing more than necessary.
class SoulmateSketch(BaseModel):
    reading_id: str
    status: str
    image_base64: str


def _pencil_sketch(contents: bytes) -> bytes:
    """Selfie -> mystical pencil-sketch portrait: dodge-blend edges, violet
    astral halo, graphite-to-violet duotone, vignette. See rule 2.6 of the
    studio manual — every filter here runs once, offline per request, never
    in a scroll/animation loop, so the Pillow cost is a one-shot, not a tax
    paid on every frame."""
    from PIL import Image, ImageOps, ImageFilter, ImageChops, ImageEnhance, ImageDraw
    import io

    src = Image.open(io.BytesIO(contents)).convert("RGB")
    src = ImageOps.exif_transpose(src)
    side = min(src.size)
    left = (src.width - side) // 2
    top = (src.height - side) // 2
    src = src.crop((left, top, left + side, top + side)).resize((768, 768), Image.LANCZOS)

    gray = src.convert("L")
    inverted = ImageOps.invert(gray)
    blurred = inverted.filter(ImageFilter.GaussianBlur(radius=18))

    def _dodge(front: Image.Image, back: Image.Image) -> Image.Image:
        return ImageChops.subtract(front, ImageChops.invert(back), scale=1.0, offset=0)

    sketch = _dodge(gray, blurred)
    sketch = ImageEnhance.Contrast(sketch).enhance(1.35)
    sketch = ImageEnhance.Brightness(sketch).enhance(1.05)

    tinted = ImageOps.colorize(sketch, black=(24, 12, 38), white=(245, 236, 255), mid=(155, 122, 216))

    vignette = Image.new("L", tinted.size, 0)
    draw = ImageDraw.Draw(vignette)
    for radius in range(0, 220, 4):
        alpha = int(215 * (radius / 220))
        draw.ellipse([radius, radius, tinted.width - radius, tinted.height - radius], fill=alpha)
    vignette = vignette.filter(ImageFilter.GaussianBlur(60))
    tinted.putalpha(vignette)
    canvas = Image.new("RGB", tinted.size, (11, 7, 20))
    canvas.paste(tinted, mask=tinted.split()[-1])

    glow = Image.new("RGB", canvas.size, (11, 7, 20))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse((-150, -150, 500, 500), fill=(90, 60, 165))
    gdraw.ellipse((350, 350, 900, 900), fill=(50, 30, 100))
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    canvas = ImageChops.screen(canvas, glow)

    output = io.BytesIO()
    canvas.save(output, format="PNG", optimize=True)
    return output.getvalue()


def _astral_portrait(answers: str, language: str) -> bytes:
    """No-selfie branch: deterministic-per-answers abstract astral portrait
    (nebula haze, silhouette moon, mandala rings, stars) so skipping the
    selfie still returns a real, unique visual."""
    from PIL import Image, ImageDraw, ImageFilter
    import io
    import random
    import math

    seed = sum(ord(c) for c in (answers or "")) + sum(ord(c) for c in (language or "en"))
    rng = random.Random(seed or 1)

    size = 768
    canvas = Image.new("RGB", (size, size), (11, 7, 20))

    haze = Image.new("RGB", (size, size), (11, 7, 20))
    hdraw = ImageDraw.Draw(haze)
    for _ in range(4):
        cx = rng.randint(80, size - 80)
        cy = rng.randint(80, size - 80)
        r = rng.randint(180, 340)
        tint = rng.choice([(90, 60, 165), (60, 40, 130), (120, 90, 210), (40, 30, 100)])
        hdraw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=tint)
    haze = haze.filter(ImageFilter.GaussianBlur(150))
    canvas = Image.blend(canvas, haze, 0.9)

    draw = ImageDraw.Draw(canvas)
    cx, cy, radius = size // 2, size // 2 - 30, 210
    for i in range(radius, 0, -3):
        alpha = 1 - i / radius
        shade = int(20 + alpha * 60)
        draw.ellipse((cx - i, cy - i, cx + i, cy + i), fill=(shade + 30, shade + 20, shade + 60))
    draw.ellipse((cx - radius + 40, cy - radius, cx + radius + 40, cy + radius), fill=(11, 7, 20))

    for ring in range(3):
        rr = radius + 60 + ring * 42
        for angle in range(0, 360, 6):
            a = math.radians(angle + ring * 15)
            x = cx + math.cos(a) * rr
            y = cy + math.sin(a) * rr
            draw.ellipse((x - 1.5, y - 1.5, x + 1.5, y + 1.5), fill=(200, 170, 255))

    for _ in range(70):
        sx = rng.randint(0, size)
        sy = rng.randint(0, size)
        sr = rng.choice([1, 1, 1, 2, 2, 3])
        tone = rng.choice([(245, 236, 255), (200, 170, 255), (155, 122, 216)])
        draw.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), fill=tone)

    vignette = Image.new("L", canvas.size, 0)
    vdraw = ImageDraw.Draw(vignette)
    for radius_step in range(0, 240, 6):
        alpha = int(220 * (radius_step / 240))
        vdraw.ellipse([radius_step, radius_step, canvas.width - radius_step, canvas.height - radius_step], fill=alpha)
    vignette = vignette.filter(ImageFilter.GaussianBlur(70))
    canvas.putalpha(vignette)
    base = Image.new("RGB", canvas.size, (7, 4, 14))
    base.paste(canvas, mask=canvas.split()[-1])

    output = io.BytesIO()
    base.save(output, format="PNG", optimize=True)
    return output.getvalue()


@api.post("/soulmate/sketch", response_model=SoulmateSketch)
async def generate_soulmate_sketch(
    selfie: UploadFile | None = File(None),
    answers: str = Form("{}"),
    language: str = Form("en"),
):
    if selfie is not None:
        if not selfie.content_type or not selfie.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Please upload an image file")
        contents = await selfie.read()
        if not contents or len(contents) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Image must be between 1 byte and 10 MB")
        try:
            rendered = _pencil_sketch(contents)
        except Exception:
            logger.exception("Soulmate sketch rendering failed")
            raise HTTPException(status_code=422, detail="Could not read this selfie, please try another photo")
    else:
        rendered = _astral_portrait(answers, language)
    return SoulmateSketch(
        reading_id=str(uuid.uuid4()),
        status="ready",
        image_base64=base64.b64encode(rendered).decode("ascii"),
    )


class SoulmateQuiz(BaseModel):
    answers: dict = {}
    language: str = "en"


@api.post("/soulmate/quiz")
async def save_soulmate_quiz(body: SoulmateQuiz, user=Depends(current_user)):
    """Persists the Nebula funnel's own quiz answers separately from the
    legacy /quiz payload (different question set — see QuizPayload above,
    kept intact for the /legacy funnel route)."""
    await db.users.update_one({"id": user["id"]}, {"$set": {"soulmate_quiz": body.answers, "soulmate_lang": body.language}})
    return {"saved": True}


# ----------------------- Soulmate Sketch as an in-app feature -----------------------
# Whoever converts through the Nebula funnel and pays already has `premium`
# set the same way any other subscription does (shared catalog, see
# /payments/checkout). This makes the reading itself a persistent, premium-gated
# feature inside the app — same locked/unlocked contract as
# /content/courses/{id} and /content/quizzes/{id} above, not a new pattern.
class SoulmateReadingSave(BaseModel):
    answers: dict = {}
    compatibility: dict = {}
    image_base64: str
    language: str = "en"


def _zodiac_from_answers(answers: dict):
    dob = answers.get("q5")  # ISO date string "YYYY-MM-DD", set by the date-of-birth question
    if not dob or not isinstance(dob, str):
        return None
    try:
        _, month, day = dob.split("-")
        return get_zodiac(int(month), int(day))
    except (ValueError, TypeError):
        return None


@api.get("/soulmate/reading")
async def get_soulmate_reading(user=Depends(current_user)):
    if not user.get("premium"):
        return {"locked": True}
    reading = await db.soulmate_readings.find_one({"user_id": user["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    return {"locked": False, "reading": reading}


@api.post("/soulmate/reading")
async def save_soulmate_reading(body: SoulmateReadingSave, user=Depends(current_user)):
    if not user.get("premium"):
        raise HTTPException(402, "Premium required to save a soulmate reading")
    record = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "answers": body.answers,
        "compatibility": body.compatibility,
        "zodiac": _zodiac_from_answers(body.answers),
        "image_base64": body.image_base64,
        "language": body.language,
        "created_at": now_iso(),
    }
    await db.soulmate_readings.insert_one(dict(record))
    record.pop("_id", None)
    return record


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


async def _credit_partner_commission(user: dict, amount: int, currency: str, source: str, stripe_invoice_id: str = None):
    """Recurring commission only works if this fires on every real charge —
    initial AND renewal (see the invoice.paid handler below). A partner's
    code is trusted here because it was already validated once, against a
    real active partner, at signup time (see get_or_create_user)."""
    code = user.get("referred_by") if user else None
    if not code or not amount:
        return
    partner = await db.partners.find_one({"code": code, "status": "active"}, {"_id": 0})
    if not partner:
        return
    commission = round(amount * partner["commission_rate"])
    await db.partner_earnings.insert_one({
        "id": str(uuid.uuid4()), "partner_id": partner["id"], "partner_code": code,
        "user_id": user["id"], "user_email": user.get("email"), "source": source,
        "amount": amount, "currency": currency, "commission_amount": commission,
        "stripe_invoice_id": stripe_invoice_id, "created_at": now_iso(),
    })
    await db.partners.update_one(
        {"id": partner["id"]},
        {"$inc": {f"earnings_owed.{currency}": commission, f"earnings_total.{currency}": commission}},
    )


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
    user = await db.users.find_one({"id": record["user_id"]}, {"_id": 0})
    await _credit_partner_commission(user, record.get("amount", 0), record.get("currency", "usd"), "initial")


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
        # Subscription mode Sessions carry the Stripe customer/subscription
        # ids the moment checkout completes — capture them now, it's the
        # only reliable hook we get before the *next* billing cycle fires
        # its own separate event (invoice.paid, below) with no link back to
        # our session_id at all, only to the customer id.
        if rec and t == "checkout.session.completed" and obj.get("mode") == "subscription":
            await db.users.update_one(
                {"id": rec["user_id"]},
                {"$set": {"stripe_customer_id": obj.get("customer"), "stripe_subscription_id": obj.get("subscription")}},
            )
        await _fulfill(rec)

    elif t == "invoice.paid" and obj.get("billing_reason") == "subscription_cycle":
        # A renewal — the customer's card was charged again automatically by
        # Stripe, with no checkout.session in the loop at all. This is the
        # ONLY signal that a recurring partner commission is owed again.
        # Guard against Stripe's at-least-once delivery (retries on any
        # non-2xx, occasional genuine duplicates) crediting the same
        # invoice twice — check before inserting, not after.
        already = await db.partner_earnings.find_one({"stripe_invoice_id": obj["id"]})
        if not already:
            user = await db.users.find_one({"stripe_customer_id": obj.get("customer")}, {"_id": 0})
            if user:
                await _credit_partner_commission(user, obj.get("amount_paid", 0), obj.get("currency", "usd"), "renewal", stripe_invoice_id=obj["id"])

    elif t in ("customer.subscription.deleted",):
        # Subscription genuinely ended (cancelled, or payment finally failed
        # past all retries) — Premium and future renewal commissions both
        # stop here. Never leave premium=True forever just because it was
        # never explicitly turned back off.
        await db.users.update_one({"stripe_subscription_id": obj.get("id")}, {"$set": {"premium": False}})

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
