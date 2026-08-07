# Aura AI — PRD

## Original Problem Statement
Build "Aura AI": an original, independently-branded PWA spiritual-guidance product. Requirements: PWA (installable, offline shell, push-ready), high-conversion multi-step funnel, strategic paywall, logged-in app with AI chat/credits/courses/readings/rewards, passwordless auth (Google/Apple/Email OTP), Stripe-ready payments, 7-language i18n with auto-detection, silent-luxury mystical UI, custom "Aura AI" logo.

## Architecture
- **Frontend**: React 19 + react-router 7, framer-motion, Tailwind, PWA (manifest + service worker). Mobile-first 480px frame.
- **Backend**: FastAPI + MongoDB (motor). JWT passwordless auth + real Google Sign-In (ID token verification). Direct Gemini API key (`AURA_LLM_KEY`) for AI chat — no third-party proxy. Stripe (own account, plain checkout).
- **i18n**: `src/i18n.js` — 7 langs (en/es/pt/hi/de/fr/it), detection order URL ?lang= → navigator.language → en fallback. en/pt/es fully translated; de/fr/it/hi structured, fallback to en.

## User Personas
- Ad-traffic seeker landing on funnel wanting a quick personalized spiritual reading.
- Returning user chatting with advisors, buying credits/premium.

## Core Requirements (static)
- Zero-friction funnel; passwordless account creation; credit/paywall monetization; AI spiritual chat; installable PWA; multi-language.

## Implemented (2026-06)
- PWA infra: manifest.json, sw.js (cache-first shell), install prompt handling, generated Aura app icons (192/512), apple-touch meta.
- Funnel: gender → topic → reading type → DOB (zodiac calc) → animated loading → free-3-min offer → profile (Google/Apple/Email) → Email OTP → advisor picker. Light theme, gradient banner, progress bar, framer-motion transitions.
- Auth: Email OTP, JWT (60d).
- Logged app (dark cosmic): bottom nav (Chats, Discover, Guides, Readings, Rewards), credits pill, install button, logout.
- AI Chat: per-advisor personas, connecting animation, typing indicator, persisted history, 3 free messages then credit-based, out-of-credits modal.
- Discover: premium banner, courses carousel, quiz cards. Readings: personalized horoscope by zodiac + courses. Rewards: cosmic points.
- Payments: Stripe checkout for 3 credit packs + 2 subscription plans; success/cancel pages with polling + fulfillment (credits granted / premium unlocked).

## Round 2026-08 — independence & production hardening (in progress)
- Removed third-party proxy dependency for AI chat: now calls Gemini directly via `AURA_LLM_KEY` (needs a real key from the founder — see README "Chaves pendentes").
- Removed third-party OAuth relay: `/auth/google` now verifies a real Google ID token via `GOOGLE_CLIENT_ID` (needs founder-generated Google Cloud OAuth client).
- Fixed: OTP code was being returned in the API response to anyone (`dev_code`) — now gated behind `DEV_MODE` env flag, off by default.
- Fixed: a failed AI reply still charged the user a free message/credit — now only successful replies are charged.
- Local dev stack: MongoDB running as a portable, non-service local instance; Python deps installed in venv (`backend/.venv`).

## Backlog
- P1: Resend transactional email for real OTP/Magic-link delivery (needs founder-verified sender domain).
- P1: Apple Sign-In (needs Apple Developer Program enrollment — external, founder-only step).
- P1: Migrate hardcoded advisors/courses/quizzes lists into real Mongo collections.
- P1: Deep-linking routes for AppShell tabs (currently local component state).
- P2: Full translations for hi/de/fr/it; language switcher UI.
- P2: Course/lesson content pages, tarot card-draw animation, live typing SSE streaming.
- P2: Push notifications.
- P2: Stripe Express Checkout Element (Apple Pay/Google Pay) on the paywall.
- P2: `backend/tests/backend_test.py` is stale against the current API shape (old silent-email `/auth/google` payload instead of real Google ID token; `lookup_key` vs. current `item_key` field name on billing/checkout) — needs a rewrite pass before it can be trusted again. The "12/12 pytest pass" claim in `test_reports/iteration_1.json` reflects an earlier code snapshot, not current `server.py`.

## Pending external credentials (founder action required)
- `GOOGLE_CLIENT_ID` — Google Cloud Console → OAuth consent screen + Web client ID.
- `AURA_LLM_KEY` — Google AI Studio Gemini API key (or swap provider).
- `RESEND_API_KEY` + verified sending domain (already has a key name in `.env`; needs domain verification).
- Apple Developer Program membership, for Apple Sign-In.
- Stripe: confirm `STRIPE_MODE` (test/live) and that `setup_stripe.py` has been run against the connected account.
