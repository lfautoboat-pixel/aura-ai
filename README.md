# Aura AI

PWA de orientação espiritual: funil de conversão, chat com IA, sistema de créditos/assinatura e pagamentos via Stripe.

## Rodando localmente

**Backend** (`backend/`):
```
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn server:app --reload --port 8001
```

**Frontend** (`frontend/`):
```
npm start
```

## Variáveis de ambiente (`backend/.env`)

| Variável | Status | Onde gerar | Necessária para |
|---|---|---|---|
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | ✅ real (modo **test**) | dashboard.stripe.com | Pagamentos (checkout + Express Checkout) |
| `STRIPE_WEBHOOK_SECRET` | ✅ real, aguardando validação com tráfego real | dashboard.stripe.com → Webhooks | Confirmação assíncrona de pagamento |
| `GOOGLE_CLIENT_ID` / `REACT_APP_GOOGLE_CLIENT_ID` | ✅ real (autorizado só pra `localhost:3005` por enquanto) | Google Cloud Console | Login com Google |
| `AURA_LLM_KEY` | ✅ real e testado — resposta real da IA confirmada | Google AI Studio | Chat com IA (`AURA_LLM_MODEL=gemini-flash-latest`) |
| `AURA_LLM_KEYS` | ⚙️ opcional — pool de chaves separadas por vírgula (`key1,key2,...`), tem prioridade sobre `AURA_LLM_KEY` | Google AI Studio, **um projeto novo por chave** (grátis, sem cartão) | Escala a cota de 20 req/dia sem billing — só funciona se cada chave vier de um projeto Google diferente; chaves do mesmo projeto dividem a mesma cota e não somam nada |
| `BREVO_API_KEY` | ⏳ pendente — **grátis, sem domínio** (recomendado) | brevo.com → SMTP & API | Envio real do OTP por e-mail pra qualquer destinatário |
| `RESEND_API_KEY` | ✅ real, mas restrito ao sandbox (só envia pro seu próprio e-mail) até verificar um domínio | resend.com | Alternativa ao Brevo, exige domínio próprio |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY_PATH` (local) ou `VAPID_PRIVATE_KEY_PEM` (Render) | ✅ real, par já gerado (`backend/vapid_private_key.pem`, gitignored) | Já gerado — só copiar `VAPID_PUBLIC_KEY` pro `frontend/.env` como `REACT_APP_VAPID_PUBLIC_KEY` | Notificações push |
| `PUSH_SCHEDULER_ENABLED` | ⚙️ `false` por padrão | — | Liga o job diário de notificação (18h UTC) quando quiser ativar |
| Apple Sign-In | ⏳ pendente (precisa de Apple Developer Program, US$99/ano) | developer.apple.com | Login com Apple |

### Como resolver o Brevo (grátis, sem domínio)
1. Crie conta grátis em brevo.com.
2. Em Senders → Add a Sender, verifique um único e-mail que você já tenha (ex: o mesmo do Resend) — confirma por link, sem DNS.
3. Em SMTP & API → API Keys, gere uma chave e me envie.
4. Defina `SENDER_EMAIL` nesse mesmo `.env` para o e-mail que você acabou de verificar.

O código já está pronto pra usar isso (Brevo tem prioridade se as duas chaves estiverem preenchidas; Resend continua funcionando como alternativa caso você compre um domínio no futuro).

`DEV_MODE=true` no `.env` local expõe o código OTP na resposta da API para facilitar testes sem e-mail configurado — **nunca deixar `true` em produção** (o `render.yaml` já vem com `DEV_MODE=false` fixo).

Antes de mudar preços/moedas, rode `backend/setup_stripe.py` de novo para sincronizar os Price objects no Stripe.

## Deploy gratuito

Esta é uma aplicação full-stack (React + FastAPI + MongoDB) — não cabe num único host estático. Combinação recomendada, toda em tier gratuito:

1. **Banco — MongoDB Atlas** (mongodb.com/cloud/atlas): crie um cluster free tier (M0), copie a connection string (`mongodb+srv://...`).
2. **Backend — Render** (render.com): "New → Blueprint", aponte para este repositório (o `render.yaml` na raiz já configura tudo). Preencha `MONGO_URL` (do Atlas), `CORS_ORIGINS` (o domínio do frontend, passo 3) e as demais chaves da tabela acima direto no painel do Render.
3. **Frontend — Netlify** (netlify.com): arraste a pasta `frontend/` ou conecte o repo (`frontend/netlify.toml` já configura build e as rotas do React Router). Defina `REACT_APP_BACKEND_URL` nas env vars do Netlify apontando para a URL pública do backend no Render.
4. Volte no Render e ajuste `CORS_ORIGINS` para o domínio real do Netlify.

Nenhum desses 3 passos pode ser feito por mim — todos exigem criar conta em serviço de terceiro.
