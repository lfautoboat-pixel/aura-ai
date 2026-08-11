import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Compass, Users, BookOpen, Gift, Sparkles, Star, Coins, Crown, Download, LogOut, ChevronDown, ChevronRight, User, Lock } from "lucide-react";
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
          <Coins size={14} /> {user?.premium ? "∞" : ((user?.free_messages || 0) > 0 ? `${user.free_messages} free` : (user?.credits || 0))}
        </button>
        <button data-testid="profile-btn" onClick={() => nav("/app/profile")} className="glass rounded-full p-0.5 shrink-0" title={t("profile")}>
          {user?.picture ? (
            <img src={user.picture} alt="" className="w-7 h-7 rounded-full object-cover" />
          ) : (
            <span className="w-7 h-7 rounded-full grad-btn grid place-items-center"><User size={14} className="text-white" /></span>
          )}
        </button>
        <button data-testid="logout-btn" onClick={logout} className="glass rounded-full p-2"><LogOut size={14} /></button>
      </div>
    </div>
  );
}

const STATUS_DOT = { online: "bg-emerald-400", busy: "bg-amber-400", offline: "bg-white/30" };
const STATUS_TEXT = { online: "text-emerald-400", busy: "text-amber-400", offline: "text-white/40" };

function GuidesView({ advisors }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const [filter, setFilter] = useState("all");

  const specialties = ["all", ...Array.from(new Set(advisors.flatMap((a) => a.specialties || [])))];
  const shown = filter === "all" ? advisors : advisors.filter((a) => (a.specialties || []).includes(filter));

  return (
    <div className="p-5 space-y-4">
      <h1 className="font-display text-3xl">{t("advisors_title")}</h1>
      <p className="text-white/60 text-sm">{t("advisors_sub")}</p>

      <div className="flex gap-2 overflow-x-auto no-sb -mx-1 px-1 pb-1">
        {specialties.map((s) => (
          <button key={s} onClick={() => setFilter(s)} data-testid={`filter-${s}`}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold capitalize transition-colors ${filter === s ? "grad-btn text-white" : "glass text-white/60"}`}>
            {s === "all" ? t("filter_all") : s}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.4 }}
            whileTap={{ scale: 0.985 }}
            className="relative rounded-[22px] p-[1px] overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(183,156,255,0.35), rgba(255,143,177,0.12) 40%, rgba(255,255,255,0.06))" }}
            data-testid={`guide-${a.id}`}>
            <div className="glass rounded-[21px] p-4 flex items-center gap-3">
              <button onClick={() => nav(`/app/advisor/${a.id}`)} className="flex items-center gap-3 flex-1 min-w-0 text-left group" data-testid={`guide-profile-${a.id}`}>
                <div className="relative shrink-0">
                  <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-br from-[#b79cff] via-[#ff8fb1] to-[#e7c46a] opacity-70 blur-[2px]" />
                  <img src={a.avatar} alt={a.name} className="relative w-16 h-16 rounded-2xl object-cover" />
                  <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#0b0718] ${STATUS_DOT[a.status] || STATUS_DOT.offline}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-display font-bold text-[15px] truncate">{a.name}</span>
                  </div>
                  <div className="text-xs text-white/55 truncate mt-0.5">{a.title}</div>
                  <div className="text-xs mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="text-[#e7c46a] font-semibold">★ {a.rating}</span>
                    <span className="text-white/40">{a.reviews} {t("reviews")}</span>
                    <span className={`font-semibold ${STATUS_TEXT[a.status] || STATUS_TEXT.offline}`}>· {t(a.status)}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1.5 text-[11px] text-white/50">
                    <Coins size={11} className="text-[#e7c46a]/70" /> {a.price} {t("credits")} <span className="text-white/25">/ msg</span>
                  </div>
                </div>
                <motion.span className="shrink-0 text-white/20" animate={{ x: [0, 3, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}>
                  <ChevronRight size={16} />
                </motion.span>
              </button>
              <button onClick={() => nav(`/app/chat/${a.id}`)} className="grad-btn text-white text-xs font-bold px-3 py-2.5 rounded-xl whitespace-nowrap shrink-0" data-testid={`chat-btn-${a.id}`}>{t("start_chat")}</button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function InsightCard({ insight, open, onToggle }) {
  const { t } = useI18n();
  return (
    <motion.div layout className="glass rounded-2xl overflow-hidden" data-testid={`insight-${insight.id}`}>
      <button onClick={onToggle} className="w-full flex items-start gap-3 p-4 text-left" data-testid={`insight-toggle-${insight.id}`}>
        <img src={insight.img} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm leading-snug">{insight.title}</div>
          <div className="text-xs text-white/50 mt-1 line-clamp-2">{insight.excerpt}</div>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="shrink-0 mt-1 text-white/40">
          <ChevronDown size={16} />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }} className="overflow-hidden">
            <p className="px-4 pb-4 text-sm text-white/75 leading-relaxed font-serif2">{insight.body}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function InsightsSection({ insights }) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState(null);
  if (!insights?.length) return null;
  return (
    <div>
      <h2 className="text-lg font-bold mb-3">{t("insights_title")}</h2>
      <div className="space-y-3">
        {insights.map((ins) => (
          <InsightCard key={ins.id} insight={ins} open={openId === ins.id}
            onToggle={() => setOpenId((id) => (id === ins.id ? null : ins.id))} />
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
            <motion.button key={c.id} whileTap={{ scale: 0.96 }} onClick={() => nav(`/app/course/${c.id}`)}
              className="min-w-[150px] w-[150px] glass rounded-2xl overflow-hidden text-left relative" data-testid={`course-${c.id}`}>
              <img src={c.img} alt={c.title} className="w-full h-24 object-cover" />
              {c.locked && (
                <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 backdrop-blur-sm grid place-items-center">
                  <Lock size={11} className="text-[#e7c46a]" />
                </span>
              )}
              <div className="p-3"><div className="text-sm font-semibold leading-tight">{c.title}</div><div className="text-[11px] text-white/50 mt-1">{c.lessons} {t("lessons")}</div></div>
            </motion.button>
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-lg font-bold mb-3">{t("quizzes_title")}</h2>
        <div className="grid grid-cols-2 gap-3">
          {(data?.quizzes || []).map((q) => (
            <motion.button key={q.id} whileTap={{ scale: 0.96 }} onClick={() => nav(`/app/quiz/${q.id}`)}
              className="relative rounded-2xl overflow-hidden h-28 text-left" data-testid={`quiz-${q.id}`}>
              <img src={q.img} alt={q.title} className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0b0718] via-[#0b0718]/30 to-transparent" />
              {q.locked && (
                <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 backdrop-blur-sm grid place-items-center">
                  <Lock size={11} className="text-[#e7c46a]" />
                </span>
              )}
              <div className="absolute bottom-2 left-3 right-3 text-sm font-semibold">{q.title}</div>
            </motion.button>
          ))}
        </div>
      </div>
      <InsightsSection insights={data?.insights} />
    </div>
  );
}

function ReadingsView({ data }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
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
            {t("horoscope_daily")}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {(data?.courses || []).map((c) => (
          <motion.button key={c.id} whileTap={{ scale: 0.96 }} onClick={() => nav(`/app/course/${c.id}`)}
            className="glass rounded-2xl overflow-hidden text-left relative">
            <img src={c.img} alt={c.title} className="w-full h-24 object-cover" />
            {c.locked && (
              <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 backdrop-blur-sm grid place-items-center">
                <Lock size={11} className="text-[#e7c46a]" />
              </span>
            )}
            <div className="p-3 text-sm font-semibold leading-tight">{c.title}</div>
          </motion.button>
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
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [threads, setThreads] = useState(null);

  useEffect(() => {
    api.get(`/chats?lang=${lang}`).then((r) => setThreads(r.data)).catch(() => setThreads([]));
  }, [lang]);

  if (threads === null) return <div className="p-5 text-white/40 text-sm">…</div>;

  if (threads.length === 0) {
    return (
      <div className="p-5 space-y-4">
        <h1 className="font-display text-3xl">{t("nav_chats")}</h1>
        <div className="glass rounded-2xl p-6 text-center">
          <p className="text-white/60 text-sm">{t("chats_empty")}</p>
          <button onClick={() => nav("/app/guides")} className="grad-btn text-white text-sm font-bold px-4 py-2.5 rounded-xl mt-4">
            {t("nav_guides")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <h1 className="font-display text-3xl">{t("nav_chats")}</h1>
      <div className="space-y-2">
        {threads.map((a) => (
          <button key={a.id} onClick={() => nav(`/app/chat/${a.id}`)} data-testid={`chatlist-${a.id}`}
            className="w-full glass rounded-2xl p-3 flex items-center gap-3 text-left">
            <img src={a.avatar} alt={a.name} className="w-12 h-12 rounded-full object-cover" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{a.name}</div>
              <div className="text-xs text-white/50 truncate">{a.last_text}</div>
            </div>
            {a.online && <span className="text-[10px] text-emerald-400 font-bold">{t("online")}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

const VALID_TABS = ["chats", "discover", "guides", "readings", "rewards"];

export default function AppShell() {
  const { t, lang } = useI18n();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const { tab: tabParam } = useParams();
  const tab = VALID_TABS.includes(tabParam) ? tabParam : "guides";
  const [advisors, setAdvisors] = useState([]);
  const [discover, setDiscover] = useState(null);
  const [deferred, setDeferred] = useState(null);

  useEffect(() => { if (!loading && !user) nav("/"); }, [loading, user, nav]);
  useEffect(() => {
    api.get(`/content/advisors?lang=${lang}`).then((r) => setAdvisors(r.data));
    api.get(`/content/discover?lang=${lang}`).then((r) => setDiscover(r.data));
  }, [lang]);
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
          <button key={k} onClick={() => nav(`/app/${k}`)} data-testid={`nav-${k}`}
            className={`flex flex-col items-center gap-1 px-2 py-1 rounded-xl transition-colors ${tab === k ? "text-[#b79cff]" : "text-white/45"}`}>
            <Icon size={21} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
