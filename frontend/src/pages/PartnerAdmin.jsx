import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Copy, Check, Pause, Play, RefreshCw, Trash2, Users, MousePointerClick, Wallet, Loader2, Sparkles } from "lucide-react";
import api from "../api";
import { useAuth } from "../store";
import { referralLink } from "../partnerConfig";

const POLL_MS = 30000;

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <div>
      {label && <div className="text-white/40 text-[11px] uppercase tracking-wider mb-1">{label}</div>}
      <button onClick={copy} className="w-full glass rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 text-left border border-white/10 hover:border-[#b79cff]/50 transition-colors">
        <span className="text-white/80 text-xs truncate font-mono">{value}</span>
        {copied ? <Check size={15} className="text-emerald-400 shrink-0" /> : <Copy size={15} className="text-white/40 shrink-0" />}
      </button>
    </div>
  );
}

function money(minor, currency) {
  const val = (minor || 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "usd").toUpperCase() }).format(val);
  } catch {
    return `${val.toFixed(2)} ${(currency || "usd").toUpperCase()}`;
  }
}

function currencyMap(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return "—";
  return entries.map(([cur, amt]) => money(amt, cur)).join(" + ");
}

function useAgo(timestamp) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!timestamp) return "";
  const secs = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (secs < 5) return "agora";
  if (secs < 60) return `há ${secs}s`;
  return `há ${Math.round(secs / 60)}min`;
}

export default function PartnerAdmin() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [access, setAccess] = useState("checking"); // checking | granted | denied
  const [partners, setPartners] = useState(null);
  const [payouts, setPayouts] = useState(null);
  const [form, setForm] = useState({ name: "", rate: "30", contact: "", payout_note: "" });
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [regenerated, setRegenerated] = useState({});
  const [lastSync, setLastSync] = useState(null);
  const syncAgo = useAgo(lastSync);

  const loadAll = () => {
    Promise.all([api.get("/admin/partners"), api.get("/admin/payouts")])
      .then(([p, o]) => { setPartners(p.data); setPayouts(o.data); setAccess("granted"); setLastSync(Date.now()); })
      .catch((e) => setAccess(e?.response?.status === 401 || e?.response?.status === 403 ? "denied" : "error"));
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setAccess("denied"); return; }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  // Live-updating list: a solo operator checking in on partner activity
  // shouldn't have to remember to hit refresh. Paused while the tab isn't
  // visible so it never burns calls on a backgrounded browser tab.
  useEffect(() => {
    if (access !== "granted") return;
    const tick = () => { if (document.visibilityState === "visible") loadAll(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access]);

  const createPartner = async (e) => {
    e.preventDefault();
    const rate = Number(form.rate) / 100;
    if (!form.name.trim() || !(rate > 0 && rate < 1)) { setError("Nome e comissão (1–99%) são obrigatórios."); return; }
    setCreating(true);
    setError("");
    try {
      const { data } = await api.post("/admin/partners", {
        name: form.name.trim(), commission_rate: rate,
        contact: form.contact.trim() || null, payout_note: form.payout_note.trim() || null,
      });
      setJustCreated(data);
      setForm({ name: "", rate: "30", contact: "", payout_note: "" });
      loadAll();
    } catch {
      setError("Não foi possível criar o parceiro. Tente novamente.");
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (p) => {
    setBusyId(p.id);
    try {
      await api.patch(`/admin/partners/${p.id}`, { status: p.status === "active" ? "paused" : "active" });
      loadAll();
    } finally { setBusyId(null); }
  };

  const deletePartner = async (p) => {
    if (!window.confirm(`Apagar "${p.name}" permanentemente? Isso remove o parceiro e todo o histórico de ganhos/saques dele(a). Não dá pra desfazer.`)) return;
    setBusyId(p.id);
    try {
      await api.delete(`/admin/partners/${p.id}`);
      loadAll();
    } finally { setBusyId(null); }
  };

  const regenerateLink = async (p) => {
    if (!window.confirm(`Isso invalida o link antigo de "${p.name}" imediatamente. Só use se o link original nunca chegou a ser enviado. Continuar?`)) return;
    setBusyId(p.id);
    try {
      const { data } = await api.post(`/admin/partners/${p.id}/regenerate-link`);
      setRegenerated((r) => ({ ...r, [p.id]: data.dashboard_token }));
    } finally { setBusyId(null); }
  };

  const markPaid = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/admin/payouts/${id}/mark-paid`);
      loadAll();
    } finally { setBusyId(null); }
  };

  if (access === "checking" || authLoading) {
    return <div className="app-frame cosmic-bg min-h-screen" />;
  }

  if (access === "denied" || access === "error") {
    return (
      <div className="app-frame cosmic-bg min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display text-xl">Acesso restrito</p>
        <p className="text-white/50 text-sm max-w-xs">Esta área é exclusiva da administração. Entre com a conta autorizada para continuar.</p>
        <button onClick={() => nav("/app")} className="grad-btn text-white font-bold px-6 py-3 rounded-2xl">Voltar ao app</button>
      </div>
    );
  }

  const pendingPayouts = (payouts || []).filter((p) => p.status === "pending");
  const paidPayouts = (payouts || []).filter((p) => p.status === "paid");

  return (
    <div className="app-frame cosmic-bg min-h-screen pb-16">
      <div className="p-5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md bg-[#0b0718]/70">
        <div className="flex items-center gap-3">
          <button onClick={() => nav("/app")}><ChevronLeft /></button>
          <h1 className="font-display text-xl">Parceiros</h1>
        </div>
        {lastSync && (
          <span className="flex items-center gap-1.5 text-white/30 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            atualizado {syncAgo}
          </span>
        )}
      </div>

      <div className="px-5 space-y-8">
        {/* Create partner */}
        <section className="glass rounded-2xl p-4 border border-white/10">
          <h2 className="font-bold text-sm mb-3">Novo parceiro</h2>
          <form onSubmit={createPartner} className="space-y-3">
            <input placeholder="Nome (ex: Mariana Astro)" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#b79cff]/60" />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-white/40 text-[11px] uppercase tracking-wider">Comissão (%)</label>
                <input type="number" min="1" max="99" value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#b79cff]/60 mt-1" />
              </div>
            </div>
            <input placeholder="Contato (TikTok, e-mail — opcional)" value={form.contact}
              onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#b79cff]/60" />
            <input placeholder="Chave de pagamento — Wise/Pix (opcional, só anotação)" value={form.payout_note}
              onChange={(e) => setForm((f) => ({ ...f, payout_note: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#b79cff]/60" />
            {error && <p className="text-rose-400 text-xs">{error}</p>}
            <button disabled={creating} className="w-full grad-btn text-white font-bold py-3 rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2">
              {creating && <Loader2 size={15} className="animate-spin" />} Criar parceiro
            </button>
          </form>
        </section>

        {justCreated && (
          <section className="glass rounded-2xl p-4 border border-amber-400/40 space-y-3">
            <p className="text-amber-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles size={13} /> Copie agora — este link não aparece de novo
            </p>
            <p className="text-white/70 text-sm">
              Parceiro <strong>{justCreated.name}</strong> criado. Mande só o link abaixo — é o convite completo, o link de divulgação já vem pronto pra copiar de dentro do painel dela(e).
            </p>
            <CopyField label="Convite / painel do parceiro — o único link que você precisa enviar" value={`${window.location.origin}/partner/${justCreated.dashboard_token}`} />
            <details className="text-white/40 text-xs">
              <summary className="cursor-pointer">Ver link de divulgação (referência sua — não precisa enviar)</summary>
              <div className="mt-2"><CopyField value={referralLink(justCreated.code)} /></div>
            </details>
            <button onClick={() => setJustCreated(null)} className="text-white/40 text-xs underline">Fechar</button>
          </section>
        )}

        {/* Partners list */}
        <section>
          <h2 className="font-bold text-sm mb-3">Todos os parceiros ({partners?.length || 0})</h2>
          {!partners?.length && <p className="text-white/40 text-sm">Nenhum parceiro ainda.</p>}
          <div className="space-y-3">
            {partners?.map((p) => (
              <div key={p.id} className="glass rounded-2xl p-4 border border-white/10">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-sm flex items-center gap-2">
                      {p.name}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.status === "active" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/40"}`}>
                        {p.status === "active" ? "ativo" : "pausado"}
                      </span>
                    </div>
                    <div className="text-white/40 text-xs mt-0.5">{p.code} · {Math.round(p.commission_rate * 100)}% comissão{p.contact ? ` · ${p.contact}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => toggleStatus(p)} disabled={busyId === p.id}
                      className="glass rounded-lg p-2 border border-white/10" title={p.status === "active" ? "Pausar" : "Ativar"}>
                      {p.status === "active" ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button onClick={() => deletePartner(p)} disabled={busyId === p.id}
                      className="glass rounded-lg p-2 border border-white/10 hover:border-rose-400/50 hover:text-rose-400" title="Apagar permanentemente">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="glass rounded-xl p-2.5 text-center">
                    <MousePointerClick size={14} className="mx-auto text-white/40" />
                    <div className="font-display text-lg mt-1 tabular-nums">{p.clicks}</div>
                    <div className="text-white/40 text-[10px]">cliques</div>
                  </div>
                  <div className="glass rounded-xl p-2.5 text-center">
                    <Users size={14} className="mx-auto text-white/40" />
                    <div className="font-display text-lg mt-1 tabular-nums">{p.signups}</div>
                    <div className="text-white/40 text-[10px]">cadastros</div>
                  </div>
                  <div className="glass rounded-xl p-2.5 text-center">
                    <Wallet size={14} className="mx-auto text-white/40" />
                    <div className="font-display text-sm mt-1.5 tabular-nums">{currencyMap(p.earnings_owed)}</div>
                    <div className="text-white/40 text-[10px]">a pagar</div>
                  </div>
                </div>
                <div className="text-white/30 text-[11px] mt-2">Total gerado (histórico): {currencyMap(p.earnings_total)}</div>

                {regenerated[p.id] ? (
                  <div className="mt-2">
                    <CopyField label="Novo link do convite/painel — copie e envie agora" value={`${window.location.origin}/partner/${regenerated[p.id]}`} />
                  </div>
                ) : (
                  <button onClick={() => regenerateLink(p)} disabled={busyId === p.id}
                    className="mt-2 text-white/40 text-xs flex items-center gap-1.5 hover:text-white/70">
                    <RefreshCw size={12} /> Gerar novo link do convite (perdeu o original?)
                  </button>
                )}
                <details className="mt-2 text-white/30 text-[11px]">
                  <summary className="cursor-pointer">Link de divulgação (referência)</summary>
                  <div className="mt-1.5"><CopyField value={referralLink(p.code)} /></div>
                </details>
              </div>
            ))}
          </div>
        </section>

        {/* Payouts */}
        <section>
          <h2 className="font-bold text-sm mb-3">Saques pendentes ({pendingPayouts.length})</h2>
          {!pendingPayouts.length && <p className="text-white/40 text-sm">Nenhum pedido pendente.</p>}
          <div className="space-y-2">
            {pendingPayouts.map((o) => (
              <div key={o.id} className="glass rounded-2xl p-3.5 border border-white/10 flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm">{o.partner_code}</div>
                  <div className="text-white/50 text-xs">{money(o.amount, o.currency)}{o.note ? ` · ${o.note}` : ""}</div>
                </div>
                <button onClick={() => markPaid(o.id)} disabled={busyId === o.id}
                  className="grad-btn text-white text-xs font-bold px-3.5 py-2 rounded-xl shrink-0">
                  Marcar pago
                </button>
              </div>
            ))}
          </div>
          {!!paidPayouts.length && (
            <details className="mt-4">
              <summary className="text-white/40 text-xs cursor-pointer">Histórico pago ({paidPayouts.length})</summary>
              <div className="space-y-2 mt-2">
                {paidPayouts.map((o) => (
                  <div key={o.id} className="text-white/30 text-xs flex justify-between py-1.5 border-b border-white/5">
                    <span>{o.partner_code}</span><span>{money(o.amount, o.currency)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
