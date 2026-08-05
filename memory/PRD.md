# Aura AI — PRD

## Original Problem Statement
Build "Aura AI", a PWA equivalent in structure, navigation and conversion intelligence to Nebula (spiritual guidance app). Reverse-engineer from 164 reference screenshots. Requirements: PWA (installable, offline shell, push-ready), high-conversion multi-step funnel, strategic paywall, logged-in app with AI chat/credits/courses/readings/rewards, passwordless auth (Google/Apple/Email OTP), Stripe-ready payments, 7-language i18n with auto-detection, silent-luxury mystical UI, custom "Aura AI" logo.

## Architecture
- **Frontend**: React 19 + react-router 7, framer-motion, Tailwind, PWA (manifest + service worker). Mobile-first 480px frame.
- **Backend**: FastAPI + MongoDB (motor). JWT passwordless auth. Emergent LLM key (Gemini 3 Flash) for AI chat. Stripe (claimable sandbox, plain checkout — BR account).
- **i18n**: `src/i18n.js` — 7 langs (en/es/pt/hi/de/fr/it), detection order URL ?lang= → navigator.language → en fallback. en/pt/es fully translated; de/fr/it/hi structured, fallback to en.

## User Personas
- Ad-traffic seeker landing on funnel wanting a quick personalized spiritual reading.
- Returning user chatting with advisors, buying credits/premium.

## Core Requirements (static)
- Zero-friction funnel; passwordless account creation; credit/paywall monetization; AI spiritual chat; installable PWA; multi-language.

## Implemented (2026-06)
- PWA infra: manifest.json, sw.js (cache-first shell), install prompt handling, generated Aura app icons (192/512), apple-touch meta.
- Funnel: gender → topic → reading type → DOB (zodiac calc) → animated loading → free-3-min offer → profile (Google/Apple/Email) → Email OTP → advisor picker. Light theme, gradient banner, progress bar, framer-motion transitions.
- Auth: Email OTP (dev_code returned until Resend keys added) + Google/Apple silent account creation, JWT (60d).
- Logged app (dark cosmic): bottom nav (Chats, Discover, Guides, Readings, Rewards), credits pill, install button, logout.
- AI Chat: per-advisor personas via Gemini 3 Flash, connecting animation, typing indicator, persisted history, 3 free messages then credit-based, out-of-credits modal.
- Discover: premium banner, courses carousel, quiz cards. Readings: personalized horoscope by zodiac + courses. Rewards: cosmic points.
- Payments: Stripe checkout for 3 credit packs + 2 subscription plans; success/cancel pages with polling + fulfillment (credits granted / premium unlocked).
- Verified: backend 12/12 pytest pass; frontend E2E 95% (real Gemini replies, Stripe redirect, full funnel).

## Backlog
- P1: Resend transactional email for real OTP/Magic-link delivery (endpoints structured, currently dev_code).
- P1: Real Google One-Tap / Apple Sign-In (currently silent email-based account creation).
- P2: Full translations for hi/de/fr/it; language switcher UI.
- P2: Course/lesson content pages, tarot card-draw animation, live typing SSE streaming.
- P2: Push notifications, deep-link tab routes.

## Next Tasks
- Wire Resend keys for OTP emails.
- Add native Google/Apple auth.
- Expand content depth (courses, tarot spreads).
