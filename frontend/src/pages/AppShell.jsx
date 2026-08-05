import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageCircle, Compass, Users, BookOpen, Gift, Sparkles, Star, Coins, Crown, Download, LogOut } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { useAuth } from "../store";
import { Logo, Starfield, SIGN_GLYPH } from "../components/Cosmic";

function Header({ onInstall, installable }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <div className="sticky top-0 z-20 cosmic-bg/90 backdrop-blur-md px-5 py-3 flex items-center justify-between border-b border-white/5">
      <Logo size={20} />
      <div className="flex items-center gap-2">
        {installable && (
          <button data-testid="install-btn" onClick={onInstall} className="glass rounded-full px-3 py-1.5 text-xs font-semibold flex items-center gap-1">
            <Download size={13} /> {t("install_btn")}
          </button>
        )}
        <button data-testid="credits-pill" onClick={() => nav("/app/recharge")} className="grad-btn rounded-full px-3 py-1.5 text-xs font-bold flex items-center gap-1 text-white">
          <Coins size={14} /> {user?.premium ? "∞" : (user?.credits || 0)}
        </button>
        <button data-testid="logout-btn" onClick={logout} className="glass rounded-full p-2"><LogOut size={14} /></button>
      </div>
    </div>
  );
}

function GuidesView({ advisors }) {
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <div className="p-5 space-y-4">
      <h1 className="font-display text-3xl">{t("advisors_title")}</h1>
      <p className="text-white/60 text-sm">{t("advisors_sub")}</p>
      <div className="space-y-3">
        {advisors.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="glass rounded-2xl p-4 flex items-center gap-3" data-testid={`guide-${a.id}`}>
            <div className="relative">
              <img src={a.avatar} alt={a.name} className="w-16 h-16 rounded-2xl object-cover" />
              {a.online && <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-[#0b0718]" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold">{a.name}</div>
              <div className="text-xs text-white/55 truncate">{a.title}</div>
              <div className="text-xs mt-1 flex gap-2 text-[#e7c46a]">★ {a.rating} <span className="text-white/40">· {a.reviews} {t("reviews")} · {a.years} {t("years_exp")}</span></div>
            </div>
            <button onClick={() => nav(`/app/chat/${a.id}`)} className="grad-btn text-white text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap" data-testid={`chat-btn-${a.id}`}>{t("start_chat")}</button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function DiscoverView({ data }) {
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <div className="p-5 space-y-6">
      <h1 className="font-display text-3xl">{t("discover_title")}</h1>
      <div className="grad-btn rounded-2xl p-5 flex items-center gap-3" data-testid="premium-banner" onClick={() => nav("/app/recharge")} role="button">
        <Crown className="text-white" />
        <div className="flex-1"><div className="font-bold text-white">{t("premium_title")}</div><div className="text-white/85 text-xs">{t("premium_sub")}</div></div>
        <span className="bg-white/25 rounded-full px-3 py-1 text-xs font-bold text-white">{t("subscribe")}</span>
      </div>
      <div>
        <h2 className="text-lg font-bold mb-3">{t("popular_courses")}</h2>
        <div className="flex gap-3 overflow-x-auto no-sb -mx-1 px-1">
          {(data?.courses || []).map((c) => (
            <div key={c.id} className="min-w-[150px] w-[150px] glass rounded-2xl overflow-hidden" data-testid={`course-${c.id}`}>
              <img src={c.img} alt={c.title} className="w-full h-24 object-cover" />
              <div className="p-3"><div className="text-sm font-semibold leading-tight">{c.title}</div><div className="text-[11px] text-white/50 mt-1">{c.lessons} {t("lessons")}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-lg font-bold mb-3">{t("quizzes_title")}</h2>
        <div className="grid grid-cols-2 gap-3">
          {(data?.quizzes || []).map((q) => (
            <div key={q.id} className="relative rounded-2xl overflow-hidden h-28" data-testid={`quiz-${q.id}`}>
              <img src={q.img} alt={q.title} className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0b0718] via-[#0b0718]/30 to-transparent" />
              <div className="absolute bottom-2 left-3 right-3 text-sm font-semibold">{q.title}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReadingsView({ data }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const sign = user?.zodiac;
  return (
    <div className="p-5 space-y-6">
      <h1 className="font-display text-3xl">{t("nav_readings")}</h1>
      {sign && (
        <div className="glass rounded-2xl p-6 text-center relative overflow-hidden" data-testid="horoscope-card">
          <Starfield count={30} />
          <div className="text-5xl">{SIGN_GLYPH[sign] || "✦"}</div>
          <div className="font-display text-2xl mt-2">{sign}</div>
          <div className="text-white/60 text-xs mt-1">{t("your_sign")}</div>
          <p className="text-white/80 text-sm mt-4 font-serif2 text-[16px] leading-relaxed">
            The moon favours quiet courage today. A conversation you've delayed carries the key — speak from the heart and the universe will meet you halfway.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {(data?.courses || []).map((c) => (
          <div key={c.id} className="glass rounded-2xl overflow-hidden">
            <img src={c.img} alt={c.title} className="w-full h-24 object-cover" />
            <div className="p-3 text-sm font-semibold leading-tight">{c.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RewardsView() {
  const { t } = useI18n();
  return (
    <div className="p-5 space-y-6">
      <h1 className="font-display text-3xl">{t("rewards_title")}</h1>
      <p className="text-white/60 text-sm">{t("rewards_sub")}</p>
      <div className="glass rounded-2xl p-6 text-center" data-testid="rewards-card">
        <div className="font-display text-5xl grad-text">120</div>
        <div className="text-white/60 text-sm mt-1">cosmic points</div>
      </div>
      <div className="space-y-3">
        {[["Daily check-in", "+10", true], ["Complete a reading", "+25", false], ["Invite a friend", "+50", false]].map(([label, pts, done], i) => (
          <div key={i} className="glass rounded-2xl p-4 flex items-center justify-between">
            <span className="text-sm">{label}</span>
            <span className={`text-sm font-bold ${done ? "text-emerald-400" : "text-[#e7c46a]"}`}>{done ? "✓" : pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatsView({ advisors }) {
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <div className="p-5 space-y-4">
      <h1 className="font-display text-3xl">{t("nav_chats")}</h1>
      <div className="space-y-2">
        {advisors.map((a) => (
          <button key={a.id} onClick={() => nav(`/app/chat/${a.id}`)} data-testid={`chatlist-${a.id}`}
            className="w-full glass rounded-2xl p-3 flex items-center gap-3 text-left">
            <img src={a.avatar} alt={a.name} className="w-12 h-12 rounded-full object-cover" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{a.name}</div>
              <div className="text-xs text-white/50 truncate">Tap to continue your reading…</div>
            </div>
            {a.online && <span className="text-[10px] text-emerald-400 font-bold">{t("online")}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AppShell() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("guides");
  const [advisors, setAdvisors] = useState([]);
  const [discover, setDiscover] = useState(null);
  const [deferred, setDeferred] = useState(null);

  useEffect(() => { if (!loading && !user) nav("/"); }, [loading, user, nav]);
  useEffect(() => {
    api.get("/content/advisors").then((r) => setAdvisors(r.data));
    api.get("/content/discover").then((r) => setDiscover(r.data));
  }, []);
  useEffect(() => {
    const h = (e) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  const install = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; setDeferred(null); };

  const tabs = [
    ["chats", MessageCircle, t("nav_chats")],
    ["discover", Compass, t("nav_discover")],
    ["guides", Users, t("nav_guides")],
    ["readings", BookOpen, t("nav_readings")],
    ["rewards", Gift, t("nav_rewards")],
  ];

  return (
    <div className="app-frame cosmic-bg min-h-screen relative">
      <Starfield count={40} />
      <div className="relative z-10 pb-24">
        <Header onInstall={install} installable={!!deferred} />
        {tab === "guides" && <GuidesView advisors={advisors} />}
        {tab === "chats" && <ChatsView advisors={advisors} />}
        {tab === "discover" && <DiscoverView data={discover} />}
        {tab === "readings" && <ReadingsView data={discover} />}
        {tab === "rewards" && <RewardsView />}
      </div>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-30 glass border-t border-white/10 flex justify-around px-2 py-2.5" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        {tabs.map(([k, Icon, label]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`nav-${k}`}
            className={`flex flex-col items-center gap-1 px-2 py-1 rounded-xl transition-colors ${tab === k ? "text-[#b79cff]" : "text-white/45"}`}>
            <Icon size={21} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
