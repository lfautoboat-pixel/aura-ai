import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, Check, MousePointerClick, Users, TrendingUp, Wallet, Sparkles, Loader2, Clock, CheckCircle2 } from "lucide-react";
import api from "../api";
import { Logo, Starfield } from "../components/Cosmic";
import { referralLink } from "../partnerConfig";

function money(minor, currency) {
  const val = (minor || 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "usd").toUpperCase() }).format(val);
  } catch {
    return `${val.toFixed(2)} ${(currency || "usd").toUpperCase()}`;
  }
}

function CopyRow({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };
  return (
    <button onClick={copy} className="w-full glass rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 border border-white/10 hover:border-[#e7c46a]/50 transition-colors">
      <span className="text-white/90 text-sm truncate font-mono">{value}</span>
      <span className={`shrink-0 text-xs font-bold flex items-center gap-1.5 ${copied ? "text-emerald-400" : "text-[#e7c46a]"}`}>
        {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
      </span>
    </button>
  );
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="glass rounded-2xl p-4 text-center border border-white/5">
      <Icon size={16} className="mx-auto text-[#b79cff]" />
      <div className="font-display text-2xl mt-2">{value}</div>
      <div className="text-white/40 text-[11px] mt-0.5">{label}</div>
    </div>
  );
}

export default function PartnerDashboard() {
  const { token } = useParams();
  const [state, setState] = useState("loading"); // loading | ready | notfound
  const [data, setData] = useState(null);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestMsg, setRequestMsg] = useState("");

  const load = () => {
    api.get(`/partner/${token}`).then(({ data }) => {
      setData(data);
      setState("ready");
      const currencies = Object.keys(data.earnings_owed || {}).filter((c) => data.earnings_owed[c] > 0);
      setSelectedCurrency(currencies[0] || null);
    }).catch(() => setState("notfound"));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  const owedCurrencies = useMemo(
    () => Object.entries(data?.earnings_owed || {}).filter(([, v]) => v > 0),
    [data]
  );
  const conversion = data?.clicks ? Math.round(((data.signups || 0) / data.clicks) * 100) : 0;

  const requestPayout = async (e) => {
    e.preventDefault();
    if (!selectedCurrency) return;
    setSubmitting(true);
    setRequestMsg("");
    try {
      await api.post(`/partner/${token}/payout-request`, { currency: selectedCurrency, note: note.trim() || undefined });
      setRequestMsg("Pedido enviado! Você será pago no canal combinado assim que confirmado.");
      setNote("");
      load();
    } catch {
      setRequestMsg("Não foi possível enviar o pedido agora. Tente novamente em instantes.");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "loading") return <div className="app-frame cosmic-bg min-h-screen" />;

  if (state === "notfound") {
    return (
      <div className="app-frame cosmic-bg min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo />
        <p className="font-display text-xl mt-4">Link não encontrado</p>
        <p className="text-white/50 text-sm max-w-xs">Este link de painel não é válido ou foi substituído. Fale com quem te enviou o acesso.</p>
      </div>
    );
  }

  return (
    <div className="app-frame cosmic-bg min-h-screen relative overflow-hidden pb-16">
      <Starfield count={40} />
      <div className="relative z-10">
        <div className="p-5 flex items-center justify-between">
          <Logo />
          <span className="text-[10px] uppercase tracking-widest text-white/30">Painel de Parceiro</span>
        </div>

        <div className="px-5 mt-2">
          <p className="text-white/50 text-sm">Bem-vindo(a),</p>
          <h1 className="font-display text-2xl mt-0.5">{data.name}</h1>
        </div>

        <div className="px-5 mt-5">
          <div className="text-white/40 text-[11px] uppercase tracking-wider mb-1.5">Seu link de divulgação</div>
          <CopyRow value={referralLink(data.code)} />
          <p className="text-white/30 text-[11px] mt-2 leading-relaxed">
            Cada pessoa que criar conta a partir deste link fica atrelada ao seu perfil para sempre — você recebe {Math.round(data.commission_rate * 100)}% de cada pagamento dela, incluindo renovações futuras.
          </p>
        </div>

        <div className="px-5 mt-6 grid grid-cols-3 gap-2.5">
          <Stat icon={MousePointerClick} value={data.clicks} label="cliques" />
          <Stat icon={Users} value={data.signups} label="cadastros" />
          <Stat icon={TrendingUp} value={`${conversion}%`} label="conversão" />
        </div>

        <div className="px-5 mt-4">
          <div className="glass rounded-2xl p-5 border border-[#e7c46a]/25" style={{ background: "linear-gradient(145deg,rgba(231,196,106,0.08),rgba(138,92,255,0.06))" }}>
            <div className="flex items-center gap-2 text-[#e7c46a] text-xs font-bold uppercase tracking-wider">
              <Wallet size={14} /> A receber
            </div>
            <div className="mt-2 space-y-0.5">
              {owedCurrencies.length ? owedCurrencies.map(([cur, amt]) => (
                <div key={cur} className="font-display text-2xl">{money(amt, cur)}</div>
              )) : <div className="text-white/40 text-sm">Nenhum valor disponível ainda</div>}
            </div>
            {Object.entries(data.earnings_total || {}).some(([, v]) => v > 0) && (
              <div className="text-white/30 text-[11px] mt-2">
                Total gerado desde o início: {Object.entries(data.earnings_total).map(([cur, amt]) => money(amt, cur)).join(" + ")}
              </div>
            )}
          </div>
        </div>

        {!!owedCurrencies.length && (
          <div className="px-5 mt-4">
            <form onSubmit={requestPayout} className="glass rounded-2xl p-4 border border-white/10 space-y-3">
              <div className="font-bold text-sm flex items-center gap-2"><Sparkles size={14} className="text-[#b79cff]" /> Solicitar saque</div>
              {owedCurrencies.length > 1 && (
                <div className="flex gap-2">
                  {owedCurrencies.map(([cur]) => (
                    <button type="button" key={cur} onClick={() => setSelectedCurrency(cur)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${selectedCurrency === cur ? "grad-btn text-white" : "glass text-white/50"}`}>
                      {cur.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
              <input placeholder="Observação (chave Pix, e-mail Wise — opcional)" value={note} onChange={(e) => setNote(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#e7c46a]/50" />
              <button disabled={submitting} className="w-full grad-btn text-white font-bold py-3 rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2">
                {submitting && <Loader2 size={15} className="animate-spin" />}
                Solicitar {selectedCurrency ? money(data.earnings_owed[selectedCurrency], selectedCurrency) : ""}
              </button>
              {requestMsg && <p className="text-white/60 text-xs text-center">{requestMsg}</p>}
            </form>
          </div>
        )}

        {!!data.payout_requests?.length && (
          <div className="px-5 mt-6">
            <div className="text-white/40 text-[11px] uppercase tracking-wider mb-2">Histórico de saques</div>
            <div className="space-y-2">
              {data.payout_requests.map((r) => (
                <div key={r.id} className="glass rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-white/70">
                    {r.status === "paid" ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Clock size={14} className="text-amber-400" />}
                    {money(r.amount, r.currency)}
                  </span>
                  <span className="text-white/30 text-xs">{r.status === "paid" ? "pago" : "pendente"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!data.recent_earnings?.length && (
          <div className="px-5 mt-6">
            <div className="text-white/40 text-[11px] uppercase tracking-wider mb-2">Atividade recente</div>
            <div className="space-y-2">
              {data.recent_earnings.slice(0, 10).map((e) => (
                <div key={e.id} className="glass rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                  <span className="text-white/70">{e.source === "renewal" ? "Renovação" : "Nova assinante"}</span>
                  <span className="text-emerald-400 font-bold">+{money(e.commission_amount, e.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
