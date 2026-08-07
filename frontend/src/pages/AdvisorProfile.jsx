import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, Star, Coins, Clock, ChevronDown } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { Starfield } from "../components/Cosmic";

const STATUS_DOT = { online: "bg-emerald-400", busy: "bg-amber-400", offline: "bg-white/30" };

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between p-4 text-left">
        <span className="text-sm font-semibold pr-3">{q}</span>
        <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4 text-sm text-white/60 leading-relaxed">{a}</div>}
    </div>
  );
}

export default function AdvisorProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const [advisor, setAdvisor] = useState(null);

  useEffect(() => {
    api.get(`/content/advisors/${id}?lang=${lang}`).then((r) => setAdvisor(r.data)).catch(() => setAdvisor(false));
  }, [id, lang]);

  const faqs = [
    [t("faq_q_credits"), t("faq_a_credits")],
    [t("faq_q_real"), t("faq_a_real")],
    [t("faq_q_private"), t("faq_a_private")],
    [t("faq_q_cancel"), t("faq_a_cancel")],
  ];

  if (advisor === false) {
    return (
      <div className="app-frame cosmic-bg min-h-screen grid place-items-center text-white/60">
        <button onClick={() => nav(-1)} className="absolute top-5 left-5"><ChevronLeft /></button>
        {t("advisor_not_found")}
      </div>
    );
  }
  if (!advisor) return <div className="app-frame cosmic-bg min-h-screen" />;

  return (
    <div className="app-frame cosmic-bg min-h-screen relative">
      <Starfield count={30} />
      <div className="relative z-10 pb-28">
        <div className="p-5 flex items-center justify-between">
          <button onClick={() => nav(-1)} data-testid="advisor-back"><ChevronLeft /></button>
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="px-5 flex flex-col items-center text-center">
          <div className="relative">
            <img src={advisor.avatar} alt={advisor.name} className="w-24 h-24 rounded-full object-cover" />
            <span className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-[#0b0718] ${STATUS_DOT[advisor.status]}`} />
          </div>
          <h1 className="font-display text-2xl mt-4">{advisor.name}</h1>
          <p className="text-white/55 text-sm">{advisor.title}</p>
          <div className="flex items-center gap-1.5 mt-2 text-[#e7c46a] text-sm">
            <Star size={14} className="fill-current" /> {advisor.rating}
            <span className="text-white/40">· {advisor.reviews} {t("reviews")} · {advisor.years} {t("years_exp")}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-white/50">
            <Clock size={12} /> {t("avg_response")}: {advisor.avg_response}
          </div>
        </motion.div>

        <div className="px-5 mt-6 flex flex-wrap gap-2 justify-center">
          {(advisor.specialties || []).map((s) => (
            <span key={s} className="glass rounded-full px-3 py-1.5 text-xs capitalize">{s}</span>
          ))}
        </div>

        <div className="px-5 mt-6">
          <div className="glass rounded-2xl p-4 flex items-center justify-between">
            <span className="text-sm text-white/70">{t("price_per_message")}</span>
            <span className="font-display text-lg flex items-center gap-1"><Coins size={16} className="text-[#e7c46a]" /> {advisor.price}</span>
          </div>
        </div>

        <div className="px-5 mt-6">
          <h2 className="text-lg font-bold mb-2">{t("about_advisor")}</h2>
          <p className="text-sm text-white/65 leading-relaxed">{advisor.bio}</p>
        </div>

        <div className="px-5 mt-8 space-y-2">
          <h2 className="text-lg font-bold mb-2">{t("faq_title")}</h2>
          {faqs.map(([q, a]) => <FaqItem key={q} q={q} a={a} />)}
        </div>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] p-4 glass border-t border-white/10"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <button onClick={() => nav(`/app/chat/${id}`)} data-testid="advisor-start-chat"
          className="w-full grad-btn text-white font-bold py-4 rounded-2xl">{t("start_chat")}</button>
      </div>
    </div>
  );
}
