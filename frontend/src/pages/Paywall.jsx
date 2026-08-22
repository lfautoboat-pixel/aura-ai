import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, Coins, Crown, Check, Zap, Smartphone } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { useAuth } from "../store";
import { Starfield } from "../components/Cosmic";
import { startCheckout, useCountdown, ExpressCheckout } from "../components/Monetize";

export default function Paywall() {
  const nav = useNavigate();
  const { t, currency, money } = useI18n();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const { label } = useCountdown(900);

  useEffect(() => { api.get(`/billing/packs?currency=${currency}`).then((r) => setData(r.data)); }, [currency]);

  const buy = (item_key) => startCheckout(item_key, currency, setBusy);
  const popular = data?.credit_packs?.find((p) => p.popular);

  return (
    <div className="app-frame cosmic-bg min-h-screen relative">
      <Starfield count={40} />
      <div className="relative z-10 p-5 pb-16">
        <button onClick={() => nav(-1)} data-testid="paywall-back" className="mb-4"><ChevronLeft /></button>

        <div className="text-center">
          <div className="w-16 h-16 rounded-full grad-btn grid place-items-center mx-auto floaty"><Coins className="text-white" /></div>
          <h1 className="font-display text-3xl mt-4">{t("recharge")}</h1>
          <p className="text-white/60 text-sm mt-1">{user?.premium ? "∞" : (user?.credits || 0)} {t("credits")}</p>
        </div>

        {/* One-tap Apple Pay / Google Pay for the recommended pack — hidden automatically if unavailable */}
        {popular && (
          <div className="mt-6">
            <ExpressCheckout itemKey={popular.item_key} currency={currency} amount={popular.amount} />
          </div>
        )}

        {/* Flash offer */}
        {data?.flash && (
          <motion.button initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="flash-offer"
            onClick={() => buy("flash_160")} disabled={!!busy}
            className="w-full mt-6 rounded-2xl p-4 flex items-center gap-3 text-left relative overflow-hidden"
            style={{ background: "linear-gradient(100deg,#e7c46a,#ff8fb1,#8a5cff)" }}>
            <Zap className="text-white shrink-0" />
            <div className="flex-1">
              <div className="font-bold text-white flex items-center gap-2">{t("flash_title")} <span className="bg-black/25 rounded-full px-2 py-0.5 text-[10px]">{label}</span></div>
              <div className="text-white/90 text-xs">{data.flash.credits} {t("credits")}</div>
            </div>
            <div className="text-right text-white"><div className="font-display text-lg">{money(data.flash.amount)}</div></div>
          </motion.button>
        )}

        {/* Credit packs */}
        <div className="space-y-3 mt-4">
          {(data?.credit_packs || []).map((p, i) => (
            <motion.button key={p.item_key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              onClick={() => buy(p.item_key)} disabled={!!busy} data-testid={`pack-${p.item_key}`}
              className={`w-full rounded-2xl p-4 flex items-center gap-4 border text-left transition-transform active:scale-[0.98] ${p.popular ? "grad-btn text-white border-transparent" : "glass border-white/10"}`}>
              <Coins className={p.popular ? "text-white" : "text-[#e7c46a]"} />
              <div className="flex-1">
                <div className="font-bold">{p.credits} {t("credits")}</div>
                {p.popular && <div className="text-[11px] font-bold opacity-90">✦ {t("popular")}</div>}
              </div>
              <div className="font-display text-lg">{money(p.amount)}</div>
            </motion.button>
          ))}
        </div>

        {/* payment methods note */}
        <div className="glass rounded-2xl p-3 mt-4 flex items-center gap-2 text-xs text-white/70">
          <Smartphone size={16} className="text-[#b79cff]" />
          {currency === "brl" ? t("pix_note") : t("wallets_note")} · {t("express_pay")}
        </div>

        {/* Premium */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3"><Crown className="text-[#e7c46a]" size={18} /><h2 className="font-display text-xl">{t("premium_title")}</h2></div>
          <p className="text-white/55 text-sm mb-3">{t("premium_sub")}</p>
          <div className="space-y-3">
            {(data?.sub_plans || []).map((p) => (
              <button key={p.item_key} onClick={() => buy(p.item_key)} disabled={!!busy} data-testid={`sub-${p.item_key}`}
                className={`w-full rounded-2xl p-4 flex items-center justify-between border text-left ${p.best ? "grad-btn text-white border-transparent" : "glass border-white/10"}`}>
                <div>
                  <div className="font-bold capitalize">{p.interval === "year" ? "Annual" : "Weekly"}</div>
                  <div className="text-[11px] opacity-80">{p.best ? t("best_value") : (p.trial ? "3-day free trial" : "")}</div>
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
        <p className="text-center text-white/30 text-[11px] mt-4">Secured by Stripe · Cancel anytime</p>
      </div>
    </div>
  );
}
