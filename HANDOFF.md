# Aura AI — Protocolo de Handoff de Sessão

Documento vivo para retomar o projeto em uma sessão nova sem perder contexto. Cole este arquivo inteiro (ou peça pra IA ler `HANDOFF.md` na raiz do projeto) como primeira mensagem da sessão nova.

**Projeto**: Aura AI (antigo Nebula 2.0) — PWA de orientação espiritual (funil → chat com IA → paywall/créditos/assinatura).
**Localização**: `C:\Users\agdam\OneDrive\Desktop\NEBULA 2.0\projeto\`
**Stack**: React 19 (CRA/craco) + FastAPI + MongoDB (motor/pymongo) + Stripe + Gemini + Brevo.

---

## 1. Como subir o ambiente local do zero

```bash
# 1. Mongo portátil (já baixado e funcionando — VC++ Redistributable já instalado)
"C:/Users/agdam/OneDrive/Desktop/NEBULA 2.0/mongo-portable/mongodb-win32-x86_64-windows-8.3.7/bin/mongod.exe" \
  --dbpath "C:/Users/agdam/OneDrive/Desktop/NEBULA 2.0/mongo-portable/data" \
  --port 27017 --bind_ip 127.0.0.1

# 2. Backend (venv já criado em backend/.venv)
cd "NEBULA 2.0/projeto/backend"
.venv/Scripts/python.exe -m uvicorn server:app --host 0.0.0.0 --port 8006 --reload

# 3. Frontend
cd "NEBULA 2.0/projeto/frontend"
npm start   # porta fixa 3005 via .env
```

**IMPORTANTE — `frontend/.env` → `REACT_APP_BACKEND_URL` precisa apontar pro mesmo número de porta que o backend está rodando.** Historicamente subiu de 8001→8006 nesta sessão porque o ambiente tem um bug de socket "fantasma" (processo morto ainda aparece como LISTENING no `netstat` às vezes) — quando isso acontecer de novo, **não insista tentando matar o processo**, só incrementa a porta e atualiza os dois `.env` (`backend/.env` não tem porta fixa, mas `frontend/.env` precisa refletir).

### Peculiaridades deste ambiente (não são bugs do app)
- **HMR do frontend às vezes não pega mudanças** (pasta sincronizada via OneDrive pode atrasar o file-watcher) — se parecer travado, mate o processo `node` do craco e rode `npm start` de novo.
- **`--reload` do uvicorn às vezes trava silenciosamente** sem terminar o reload — se as respostas da API não refletirem uma mudança recente no `server.py`, mate tudo e suba limpo de novo em vez de confiar no auto-reload.
- **Paths do Windows em scripts Python via Bash**: use `C:/Users/...` (barra normal, letra de drive), nunca `/c/Users/...` (estilo Git Bash) dentro de um `python -c "..."` chamando o Python nativo do Windows — dá `FileNotFoundError`.
- **Mojibake no terminal** (ex: "Dom�nio") é só exibição do console Windows, não corrupção real — confirme sempre com `sys.stdout.reconfigure(encoding='utf-8')` antes de assumir que é bug de dado.
- **Painel do Browser (preview) às vezes fica com `document.visibilityState: "hidden"`** — quando isso acontece, `setTimeout`/`setInterval` da página ficam bloqueados pelo throttling do Chrome (não só screenshot falha, a lógica da própria página trava). Confirme com `tabs_select` na tab certa antes de insistir.

---

## 2. Chaves reais já injetadas em `backend/.env` (não pedir de novo)

| Chave | Status | Observação |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `REACT_APP_GOOGLE_CLIENT_ID` | ✅ real | Autorizado só pra `localhost:3005` por enquanto no Google Cloud Console |
| `AURA_LLM_KEY` | ✅ real, testado | **Use sempre `AURA_LLM_MODEL=gemini-flash-latest`** — `gemini-2.5-flash` e outros nomes antigos dão 404/429 pra essa chave |
| `BREVO_API_KEY` | ✅ real, testado | Envia pra qualquer destinatário (confirmado). `SENDER_EMAIL=lfautoboat@gmail.com` já verificado na Brevo |
| `RESEND_API_KEY` | ✅ real, mas sandbox | Só envia pro próprio dono da conta até verificar domínio — mantido como fallback caso a Brevo falhe |
| `STRIPE_SECRET_KEY`/`PUBLISHABLE_KEY`/`WEBHOOK_SECRET` | ✅ reais, modo **test** | Compra completa testada de ponta a ponta (cartão 4242, 60 créditos creditados de verdade) |
| `DEV_MODE=true` | ⚠️ só local | Expõe `dev_code` do OTP na resposta da API — **nunca deixar true em produção** (`render.yaml` já força `false`) |

**Conta Stripe**: estava com "dados comerciais incompletos" (nome público mostrava "aura-connect-36", badge "Área restrita"). Usuário reportou ter feito verificação de telefone — **confirmar se isso já resolveu ou se ainda falta completar Empresa → Dados da empresa no dashboard Stripe** antes de ir pra produção/modo live.

---

## 3. O que já foi construído e validado ao vivo (rodadas 1–4)

- Infra local completa (Mongo + backend + frontend rodando e comunicando)
- White-label 100% — zero rastro de "Emergent"/plataforma original no código
- Segurança: `dev_code` do OTP não vaza mais em produção; falha da IA não desconta crédito do usuário
- Login Google real (ID token verificado no backend); Apple Sign-In corretamente desabilitado até haver conta Apple Developer
- Chat com Gemini real, funcionando, com **mensagem de abertura automática** do conselheiro (referencia signo + tópico do quiz do usuário)
- Bug corrigido: ordem dos campos de data de nascimento (Mês/Dia vs Dia/Mês) causava signo errado pra usuários BR
- Conteúdo (conselheiros/cursos/quizzes) localizado PT, com fallback EN
- Catálogo expandido: 8 cursos + 8 quizzes (era 4+4)
- Lista de chats mostra só conversas reais com prévia da última mensagem (não mais texto genérico)
- Multi-moeda real (USD/BRL/EUR/GBP) com Price objects reais no Stripe, detecção automática por locale
- Stripe Express Checkout Element (Apple Pay/Google Pay) implementado no paywall — Apple Pay confirmado aparecendo na página real do Stripe
- Deep-linking real nas abas do app (`/app/chats`, `/app/discover` etc, refresh-safe)
- Soft-lock com glassmorphism quando créditos acabam (em vez de erro seco)
- **Perfil denso do conselheiro** (`/app/advisor/:id`): avaliações, anos, tempo médio de resposta, especialidades, preço/mensagem, bio, FAQ
- **Status dinâmico Online/Ocupado/Offline** por conselheiro (determinístico, muda a cada 20 min, pesos 60/25/15)
- **Filtros de categoria** por especialidade na aba Videntes
- **Modo de chamada de voz (Call)** — Web Speech API nativa (STT+TTS), sem custo de API nova. Bug de CSS corrigido (avatar virando oval por conflito `absolute inset-*` + `<img>` + preflight `height:auto` do Tailwind)
- Deploy preparado (não publicado ainda): `render.yaml` (backend) + `frontend/netlify.toml`, guia completo no `README.md`
- PWA service worker reescrito pra network-first no app shell (corrigiu bug real: usuário sendo redirecionado pro domínio antigo por causa de bundle JS cacheado)

## 4. Backlog conhecido — não implementado ainda

- **Voz do TTS não respeita gênero do conselheiro** (reportado pelo usuário nesta sessão, ainda não corrigido) — `speechSynthesis` pega a voz padrão do SO, não filtra por gênero
- **System prompt do modo Call não é diferenciado** do modo texto — respostas longas demais pra uma "ligação", sem pontuação estratégica pra pausas naturais
- **Roster de apenas 5 conselheiros** — usuário quer catálogo bem mais amplo
- Feed de Insights/curiosidades (conteúdo evergreen, não notícias fabricadas)
- Notificações push agendadas (precisa VAPID keys + decisão de infra de cron — Render Cron Jobs é candidato)
- Deploy real (Atlas/Render/Netlify): contas criadas pelo usuário, código nunca foi de fato publicado

## 5. Diretrizes/limites mantidos nesta sessão (não renegociar do zero)

- **Nunca fazer engenharia reversa exaustiva do Nebula 1.0 vivo/logado** (navegar clicando em tudo, minerar UX) — isso foi pedido várias vezes e recusado consistentemente; o app já foi construído a partir disso antes desta sessão, o trabalho atual é evolução própria com padrões de mercado genéricos, não mineração contínua do concorrente
- **Nunca implementar dark patterns** ("induzir a gastar sem perceber", venda casada) — persuasão sim, engano não
- Preços seguem a estratégia "1 unidade abaixo" já validada — não mudar sem pedido explícito
- Sempre validar mudanças **ao vivo** (navegador/curl), nunca declarar pronto só por leitura de código

---

## 6. Próximas 3 diretrizes já alinhadas (aguardando execução na sessão nova)

1. **Realismo da chamada de voz**: corrigir voz TTS por gênero (`speechSynthesis.getVoices()` + filtro), system prompt específico pro modo Call (respostas curtas, pontuação estratégica pra pausas naturais tipo "...", ritmo de conversa telefônica real)
2. **Engenharia de diálogo**: reescrever system prompts (chat E call) com intencionalidade psicológica — sem enchimento genérico de IA, linguagem humana e direta que gera conexão emocional e conduz à conversão
3. **Escala do roster**: expandir estrutura de dados + interface pra suportar um catálogo bem maior de conselheiros
