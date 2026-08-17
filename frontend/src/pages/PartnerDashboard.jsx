import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, Check, MousePointerClick, Users, TrendingUp, Wallet, Sparkles, Loader2, Clock, CheckCircle2, Gem } from "lucide-react";
import api from "../api";
import { Logo, Starfield } from "../components/Cosmic";
import { referralLink } from "../partnerConfig";

const POLL_MS = 20000;

function money(minor, currency) {
  const val = (minor || 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "usd").toUpperCase() }).format(val);
  } catch {
    return `${val.toFixed(2)} ${(currency || "usd").toUpperCase()}`;
  }
}

function useAgo(timestamp) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!timestamp) return "";
  const secs = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}min ago`;
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
        {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
      </span>
    </button>
  );
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="glass rounded-2xl p-4 text-center border border-white/5">
      <Icon size={16} className="mx-auto text-[#b79cff]" />
      <div className="font-display text-2xl mt-2 tabular-nums">{value}</div>
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
  const [lastSync, setLastSync] = useState(null);
  const syncAgo = useAgo(lastSync);

  const load = () => {
    api.get(`/partner/${token}`).then(({ data }) => {
      setData(data);
      setState("ready");
      setLastSync(Date.now());
      setSelectedCurrency((prev) => {
        const currencies = Object.keys(data.earnings_owed || {}).filter((c) => data.earnings_owed[c] > 0);
        return prev && currencies.includes(prev) ? prev : (currencies[0] || null);
      });
    }).catch(() => setState("notfound"));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  // Keeps clicks/signups/earnings current without a manual refresh — the
  // whole pitch to partners is "real time," so it has to actually be live,
  // not just described that way. Paused off-screen to avoid wasted calls.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
      setRequestMsg("Request sent — you'll be paid on your usual channel once it's confirmed.");
      setNote("");
      load();
    } catch {
      setRequestMsg("Couldn't send the request right now. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "loading") return <div className="app-frame cosmic-bg min-h-screen" />;

  if (state === "notfound") {
    return (
      <div className="app-frame cosmic-bg min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo />
        <p className="font-display text-xl mt-4">Link not found</p>
        <p className="text-white/50 text-sm max-w-xs">This dashboard link isn't valid or has been replaced. Reach out to whoever sent you access.</p>
      </div>
    );
  }

  return (
    <div className="app-frame cosmic-bg min-h-screen relative overflow-hidden pb-16">
      <Starfield count={40} />
      <div className="relative z-10">
        <div className="p-5 flex items-center justify-between">
          <Logo />
          {lastSync && (
            <span className="flex items-center gap-1.5 text-white/30 text-[10px] uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              live · {syncAgo}
            </span>
          )}
        </div>

        <div className="px-5 mt-3 rise">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#e7c46a] border border-[#e7c46a]/30 bg-[#e7c46a]/10 rounded-full px-3 py-1">
            <Gem size={11} /> Private invitation
          </div>
          <p className="text-white/40 text-[11px] mt-2 leading-relaxed max-w-[38ch]">
            This dashboard isn't public — it exists because you were personally invited into the Aura AI Partner Program.
          </p>
        </div>

        <div className="px-5 mt-4 rise">
          <p className="text-white/50 text-sm">Welcome,</p>
          <h1 className="font-display text-2xl mt-0.5">{data.name}</h1>
        </div>

        <div className="px-5 mt-5">
          <div className="text-white/40 text-[11px] uppercase tracking-wider mb-1.5">Your link</div>
          <CopyRow value={referralLink(data.code)} />
          <p className="text-white/30 text-[11px] mt-2 leading-relaxed">
            Anyone who signs up through this link is tied to you permanently — you earn {Math.round(data.commission_rate * 100)}% of every payment they make, including future renewals.
          </p>
        </div>

        <div className="px-5 mt-6 grid grid-cols-3 gap-2.5">
          <Stat icon={MousePointerClick} value={data.clicks} label="clicks" />
          <Stat icon={Users} value={data.signups} label="signups" />
          <Stat icon={TrendingUp} value={`${conversion}%`} label="conversion" />
        </div>

        <div className="px-5 mt-4">
          <div className="glass rounded-2xl p-5 border border-[#e7c46a]/25" style={{ background: "linear-gradient(145deg,rgba(231,196,106,0.08),rgba(138,92,255,0.06))" }}>
            <div className="flex items-center gap-2 text-[#e7c46a] text-xs font-bold uppercase tracking-wider">
              <Wallet size={14} /> Available
            </div>
            <div className="mt-2 space-y-0.5">
              {owedCurrencies.length ? owedCurrencies.map(([cur, amt]) => (
                <div key={cur} className="font-display text-2xl tabular-nums">{money(amt, cur)}</div>
              )) : <div className="text-white/40 text-sm">Nothing available yet</div>}
            </div>
            {Object.entries(data.earnings_total || {}).some(([, v]) => v > 0) && (
              <div className="text-white/30 text-[11px] mt-2">
                Earned since day one: {Object.entries(data.earnings_total).map(([cur, amt]) => money(amt, cur)).join(" + ")}
              </div>
            )}
          </div>
        </div>

        {!!owedCurrencies.length && (
          <div className="px-5 mt-4">
            <form onSubmit={requestPayout} className="glass rounded-2xl p-4 border border-white/10 space-y-3">
              <div className="font-bold text-sm flex items-center gap-2"><Sparkles size={14} className="text-[#b79cff]" /> Request payout</div>
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
              <input placeholder="Note (Wise e-mail, bank details — optional)" value={note} onChange={(e) => setNote(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#e7c46a]/50" />
              <button disabled={submitting} className="w-full grad-btn text-white font-bold py-3 rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2">
                {submitting && <Loader2 size={15} className="animate-spin" />}
                Request {selectedCurrency ? money(data.earnings_owed[selectedCurrency], selectedCurrency) : ""}
              </button>
              {requestMsg && <p className="text-white/60 text-xs text-center">{requestMsg}</p>}
            </form>
          </div>
        )}

        {!!data.payout_requests?.length && (
          <div className="px-5 mt-6">
            <div className="text-white/40 text-[11px] uppercase tracking-wider mb-2">Payout history</div>
            <div className="space-y-2">
              {data.payout_requests.map((r) => (
                <div key={r.id} className="glass rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-white/70">
                    {r.status === "paid" ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Clock size={14} className="text-amber-400" />}
                    {money(r.amount, r.currency)}
                  </span>
                  <span className="text-white/30 text-xs">{r.status === "paid" ? "paid" : "pending"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!data.recent_earnings?.length && (
          <div className="px-5 mt-6">
            <div className="text-white/40 text-[11px] uppercase tracking-wider mb-2">Recent activity</div>
            <div className="space-y-2">
              {data.recent_earnings.slice(0, 10).map((e) => (
                <div key={e.id} className="glass rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                  <span className="text-white/70">{e.source === "renewal" ? "Renewal" : "New subscriber"}</span>
                  <span className="text-emerald-400 font-bold tabular-nums">+{money(e.commission_amount, e.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
