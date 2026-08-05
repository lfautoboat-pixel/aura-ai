import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Coins, Crown, Check } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { useAuth } from "../store";
import { Starfield } from "../components/Cosmic";

export default function Paywall() {
  const nav = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  const [packs, setPacks] = useState({ credit_packs: [], sub_plans: [] });
  const [busy, setBusy] = useState("");

  useEffect(() => { api.get("/billing/packs").then((r) => setPacks(r.data)); }, []);

  const buy = async (lookup_key) => {
    setBusy(lookup_key);
    try {
      const { data } = await api.post("/payments/checkout", { lookup_key, origin_url: window.location.origin });
      window.location.href = data.checkout_url;
    } catch { setBusy(""); }
  };

  const money = (c) => `$${(c / 100).toFixed(2)}`;

  return (
    <div className="app-frame cosmic-bg min-h-screen relative">
      <Starfield count={40} />
      <div className="relative z-10 p-5 pb-16">
        <button onClick={() => nav(-1)} data-testid="paywall-back" className="mb-4"><ChevronLeft /></button>

        <div className="text-center">
          <div className="w-16 h-16 rounded-full grad-btn grid place-items-center mx-auto floaty"><Coins className="text-white" /></div>
          <h1 className="font-display text-3xl mt-4">{t("recharge")}</h1>
          <p className="text-white/60 text-sm mt-1">Current balance: {user?.premium ? "∞" : (user?.credits || 0)} {t("credits")}</p>
        </div>

        <div className="space-y-3 mt-6">
          {packs.credit_packs.map((p) => (
            <button key={p.lookup_key} onClick={() => buy(p.lookup_key)} disabled={!!busy} data-testid={`pack-${p.lookup_key}`}
              className={`w-full rounded-2xl p-4 flex items-center gap-4 border text-left transition-all ${p.popular ? "grad-btn text-white border-transparent" : "glass border-white/10"}`}>
              <Coins className={p.popular ? "text-white" : "text-[#e7c46a]"} />
              <div className="flex-1">
                <div className="font-bold">{p.credits} {t("credits")}</div>
                {p.popular && <div className="text-[11px] font-bold opacity-90">✦ {t("popular")}</div>}
              </div>
              <div className="text-right">
                <div className="font-display text-lg">{money(p.amount)}</div>
                {p.old && <div className="text-[11px] line-through opacity-50">{money(p.old)}</div>}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3"><Crown className="text-[#e7c46a]" size={18} /><h2 className="font-display text-xl">{t("premium_title")}</h2></div>
          <p className="text-white/55 text-sm mb-3">{t("premium_sub")}</p>
          <div className="space-y-3">
            {packs.sub_plans.map((p) => (
              <button key={p.lookup_key} onClick={() => buy(p.lookup_key)} disabled={!!busy} data-testid={`sub-${p.lookup_key}`}
                className={`w-full rounded-2xl p-4 flex items-center justify-between border text-left ${p.best ? "grad-btn text-white border-transparent" : "glass border-white/10"}`}>
                <div>
                  <div className="font-bold">{p.label}</div>
                  <div className="text-[11px] opacity-80">{p.best ? "Best value · save 60%" : p.trial}</div>
                </div>
                <div className="font-display text-lg">{money(p.amount)}<span className="text-xs opacity-70">/{p.interval}</span></div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 glass rounded-2xl p-4 space-y-2">
          {["Unlimited priority guidance", "All courses & rituals", "Daily personalized horoscope"].map((f) => (
            <div key={f} className="flex items-center gap-2 text-sm text-white/80"><Check size={16} className="text-emerald-400" /> {f}</div>
          ))}
        </div>
        <p className="text-center text-white/30 text-[11px] mt-4">Secured by Stripe · Cancel anytime · Test card 4242 4242 4242 4242</p>
      </div>
    </div>
  );
}
