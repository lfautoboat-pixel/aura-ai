import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Briefcase, Compass, Sparkles, MoreHorizontal, Moon, Sun, Star, Cloud, Hand, Check, Mail, Apple, ChevronLeft } from "lucide-react";
import { GoogleLogin } from "@react-oauth/google";
import api from "../api";
import { useI18n, dateOrder } from "../i18n";
import { useAuth } from "../store";
import { Logo, Starfield, SIGN_GLYPH } from "../components/Cosmic";

const step = { initial: { opacity: 0, x: 40 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -40 } };

function OptionCard({ icon: Icon, label, active, onClick, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all duration-200 ${active ? "border-transparent text-white grad-btn scale-[1.01]" : "bg-white border-[#eae4ff] text-[#2c2151] hover:border-[#c9baff]"}`}>
      <span className={`grid place-items-center w-11 h-11 rounded-xl ${active ? "bg-white/20" : "bg-[#f2edff]"}`}>
        <Icon size={22} className={active ? "text-white" : "text-[#7c5cff]"} />
      </span>
      <span className="font-semibold text-[15px]">{label}</span>
    </button>
  );
}

export default function Funnel() {
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const dmy = dateOrder(lang) === "dmy";
  const { user, loading, login } = useAuth();
  const [s, setS] = useState(0);
  const [ans, setAns] = useState({});
  const [progress, setProgress] = useState(0);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [advisors, setAdvisors] = useState([]);
  const [sending, setSending] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => { if (user && s === 0) nav("/app"); }, [user, s, nav]);

  const set = (k, v) => setAns((a) => ({ ...a, [k]: v }));
  const next = () => setS((x) => x + 1);
  const back = () => setS((x) => Math.max(0, x - 1));

  // loading animation
  useEffect(() => {
    if (s !== 4) return;
    setProgress(0);
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) { clearInterval(id); setTimeout(() => setS(5), 400); return 100; }
        return p + 2;
      });
    }, 55);
    return () => clearInterval(id);
  }, [s]);

  useEffect(() => { if (s === 8) api.get(`/content/advisors?lang=${lang}`).then((r) => setAdvisors(r.data)); }, [s, lang]);

  const requestOtp = async () => {
    if (!email.includes("@")) return;
    setSending(true);
    setAuthError("");
    try {
      const { data } = await api.post("/auth/request-otp", { email });
      setDevCode(data.dev_code || "");
      setS(7);
    } catch {
      // A failed request must never look identical to "nothing happened" —
      // that read as a broken button in production when this had no catch.
      setAuthError(t("auth_error"));
    } finally { setSending(false); }
  };

  const verify = async () => {
    setSending(true);
    setAuthError("");
    try {
      const { data } = await api.post("/auth/verify-otp", { email, code });
      localStorage.setItem("aura_token", data.token);
      await api.post("/quiz", {
        gender: ans.gender, topic: ans.topic, reading_type: ans.reading,
        birth_month: ans.bm, birth_day: ans.bd, birth_year: ans.by,
      });
      login(data.token, data.user);
      setS(8);
    } catch { setCode(""); setAuthError(t("auth_error")); } finally { setSending(false); }
  };

  const googleConfigured = !!process.env.REACT_APP_GOOGLE_CLIENT_ID;

  const onGoogleSuccess = async (credentialResponse) => {
    setSending(true);
    setAuthError("");
    try {
      const { data } = await api.post("/auth/google", { credential: credentialResponse.credential });
      localStorage.setItem("aura_token", data.token);
      await api.post("/quiz", {
        gender: ans.gender, topic: ans.topic, reading_type: ans.reading,
        birth_month: ans.bm, birth_day: ans.bd, birth_year: ans.by,
      });
      login(data.token, data.user);
      nav("/app");
    } catch {
      setAuthError(t("auth_error"));
    } finally { setSending(false); }
  };

  const months = ["01","02","03","04","05","06","07","08","09","10","11","12"];
  const years = Array.from({ length: 70 }, (_, i) => 2010 - i);
  const showBack = s > 0 && s !== 4 && s < 8;

  // Returning customer check is async (/api/auth/me) — without this guard,
  // a logged-in visitor would see the quiz intro flash for a frame or two
  // before the redirect above fires. Same background, zero content, until
  // we actually know whether to show the funnel or bounce to /app.
  if (s === 0 && (loading || user)) {
    return <div className="app-frame funnel-bg min-h-screen" />;
  }

  return (
    <div className="app-frame funnel-bg min-h-screen flex flex-col">
      {/* free banner */}
      {s < 5 && (
        <div className="grad-btn text-white text-center text-[13px] font-bold py-2 tracking-wide" data-testid="free-banner">
          ✦ {t("free_banner")}
        </div>
      )}
      <div className="flex items-center justify-between px-5 pt-4">
        {showBack ? (
          <button onClick={back} data-testid="funnel-back" className="text-[#7c5cff]"><ChevronLeft /></button>
        ) : <span className="w-6" />}
        <Logo light size={22} />
        <span className="w-6" />
      </div>

      {/* progress bar */}
      {s < 4 && (
        <div className="px-5 mt-4">
          <div className="h-1.5 bg-[#eae4ff] rounded-full overflow-hidden">
            <div className="h-full grad-btn rounded-full transition-all duration-300" style={{ width: `${((s + 1) / 4) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="flex-1 px-5 pt-6 pb-8">
        <AnimatePresence mode="wait">
          {s === 0 && (
            <motion.div key="g" variants={step} initial="initial" animate="animate" exit="exit" className="space-y-6">
              <h1 className="font-display text-3xl text-[#241b45] leading-tight">{t("q_gender")}</h1>
              <div className="space-y-3">
                <OptionCard testid="opt-female" icon={Moon} label={t("female")} active={ans.gender === "female"} onClick={() => { set("gender", "female"); setTimeout(next, 180); }} />
                <OptionCard testid="opt-male" icon={Sun} label={t("male")} active={ans.gender === "male"} onClick={() => { set("gender", "male"); setTimeout(next, 180); }} />
                <OptionCard testid="opt-other" icon={Star} label={t("other")} active={ans.gender === "other"} onClick={() => { set("gender", "other"); setTimeout(next, 180); }} />
              </div>
            </motion.div>
          )}

          {s === 1 && (
            <motion.div key="topic" variants={step} initial="initial" animate="animate" exit="exit" className="space-y-6">
              <h1 className="font-display text-3xl text-[#241b45] leading-tight">{t("q_topic")}</h1>
              <div className="space-y-3">
                {[["love", Heart, t("topic_love")], ["career", Briefcase, t("topic_career")], ["destiny", Compass, t("topic_destiny")], ["spirit", Sparkles, t("topic_spirit")], ["other", MoreHorizontal, t("topic_other")]].map(([k, I, l]) => (
                  <OptionCard key={k} testid={`topic-${k}`} icon={I} label={l} active={ans.topic === k} onClick={() => { set("topic", k); setTimeout(next, 180); }} />
                ))}
              </div>
            </motion.div>
          )}

          {s === 2 && (
            <motion.div key="read" variants={step} initial="initial" animate="animate" exit="exit" className="space-y-6">
              <h1 className="font-display text-3xl text-[#241b45] leading-tight">{t("q_reading")}</h1>
              <div className="grid grid-cols-2 gap-3">
                {[["love", Heart, t("r_love")], ["tarot", Sparkles, t("r_tarot")], ["numo", Star, t("r_numo")], ["astro", Moon, t("r_astro")], ["fortune", Compass, t("r_fortune")], ["dream", Cloud, t("r_dream")]].map(([k, I, l]) => (
                  <button key={k} data-testid={`reading-${k}`} onClick={() => { set("reading", k); setTimeout(next, 180); }}
                    className={`flex flex-col items-center gap-2 p-5 rounded-2xl border transition-all ${ans.reading === k ? "grad-btn text-white border-transparent" : "bg-white border-[#eae4ff] text-[#2c2151]"}`}>
                    <I size={26} className={ans.reading === k ? "text-white" : "text-[#7c5cff]"} />
                    <span className="text-[13px] font-semibold text-center leading-tight">{l}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {s === 3 && (
            <motion.div key="dob" variants={step} initial="initial" animate="animate" exit="exit" className="space-y-6">
              <h1 className="font-display text-3xl text-[#241b45] leading-tight">{t("q_dob")}</h1>
              <p className="text-[#6a5f8c]">{t("q_dob_sub")}</p>
              <div className="grid grid-cols-3 gap-3">
                {(() => {
                  const monthSelect = (
                    <select key="m" data-testid="dob-month" className="p-3 rounded-xl border border-[#eae4ff] bg-white text-[#2c2151]" value={ans.bm || ""} onChange={(e) => set("bm", +e.target.value)}>
                      <option value="">{t("month")}</option>
                      {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                  );
                  const daySelect = (
                    <select key="d" data-testid="dob-day" className="p-3 rounded-xl border border-[#eae4ff] bg-white text-[#2c2151]" value={ans.bd || ""} onChange={(e) => set("bd", +e.target.value)}>
                      <option value="">{t("day")}</option>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  );
                  const yearSelect = (
                    <select key="y" data-testid="dob-year" className="p-3 rounded-xl border border-[#eae4ff] bg-white text-[#2c2151]" value={ans.by || ""} onChange={(e) => set("by", +e.target.value)}>
                      <option value="">{t("year")}</option>
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  );
                  return dmy ? [daySelect, monthSelect, yearSelect] : [monthSelect, daySelect, yearSelect];
                })()}
              </div>
              <button data-testid="dob-continue" disabled={!ans.bm || !ans.bd || !ans.by} onClick={next}
                className="w-full grad-btn text-white font-bold py-4 rounded-2xl disabled:opacity-40">{t("continue")}</button>
            </motion.div>
          )}

          {s === 4 && (
            <motion.div key="load" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center pt-16 text-center">
              <div className="relative w-40 h-40">
                <svg className="w-40 h-40 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="44" fill="none" stroke="#eae4ff" strokeWidth="7" />
                  <circle cx="50" cy="50" r="44" fill="none" stroke="url(#g)" strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={276} strokeDashoffset={276 - (276 * progress) / 100} />
                  <defs><linearGradient id="g"><stop offset="0%" stopColor="#8a5cff" /><stop offset="100%" stopColor="#ff8fb1" /></linearGradient></defs>
                </svg>
                <div className="absolute inset-0 grid place-items-center">
                  <span className="font-display text-4xl text-[#241b45]">{progress}%</span>
                </div>
              </div>
              <h2 className="font-display text-2xl text-[#241b45] mt-8">{t("loading_title")}</h2>
              <p className="text-[#6a5f8c] mt-2">{t("loading_sub")}</p>
            </motion.div>
          )}

          {s === 5 && (
            <motion.div key="offer" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center text-center pt-8">
              <div className="w-24 h-24 rounded-full grad-btn grid place-items-center floaty">
                <Sparkles size={42} className="text-white" />
              </div>
              <h1 className="font-display text-3xl text-[#241b45] mt-6">{t("offer_title")}</h1>
              <p className="text-[#6a5f8c] mt-3 px-4">{t("offer_sub")}</p>
              <div className="glass-light rounded-2xl p-5 mt-6 w-full">
                <div className="text-[#7c5cff] font-bold text-lg">✦ {t("free_banner")}</div>
                <div className="text-[#6a5f8c] text-sm mt-1">{t("no_card")}</div>
              </div>
              <button data-testid="offer-redeem" onClick={() => setS(6)} className="w-full grad-btn text-white font-bold py-4 rounded-2xl mt-6">{t("redeem")}</button>
            </motion.div>
          )}

          {s === 6 && (
            <motion.div key="profile" variants={step} initial="initial" animate="animate" exit="exit" className="space-y-5 pt-4">
              <h1 className="font-display text-3xl text-[#241b45] leading-tight">{t("profile_title")}</h1>
              <p className="text-[#6a5f8c]">{t("profile_sub")}</p>
              {googleConfigured ? (
                <div data-testid="google-btn" className="w-full [&>div]:!w-full flex justify-center rounded-2xl overflow-hidden">
                  <GoogleLogin onSuccess={onGoogleSuccess} onError={() => {}} width="320" shape="pill" text="continue_with" />
                </div>
              ) : (
                <button data-testid="google-btn" disabled title="Login com Google em configuração"
                  className="w-full flex items-center justify-center gap-3 bg-white border border-[#eae4ff] font-semibold py-3.5 rounded-2xl text-[#2c2151]/40 cursor-not-allowed">
                  <img alt="" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" className="opacity-40" /> {t("google_btn")}
                </button>
              )}
              <button data-testid="apple-btn" disabled title="Apple Sign-In em breve"
                className="w-full flex items-center justify-center gap-3 bg-[#111]/40 text-white/40 font-semibold py-3.5 rounded-2xl cursor-not-allowed">
                <Apple size={18} /> {t("apple_btn")}
              </button>
              <div className="flex items-center gap-3 text-[#b3a9cc] text-xs"><div className="flex-1 h-px bg-[#eae4ff]" />or<div className="flex-1 h-px bg-[#eae4ff]" /></div>
              <input data-testid="email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("email_ph")}
                className="w-full p-4 rounded-2xl border border-[#eae4ff] bg-white text-[#2c2151]" />
              <button data-testid="email-continue" disabled={sending || !email.includes("@")} onClick={requestOtp}
                className="w-full grad-btn text-white font-bold py-4 rounded-2xl disabled:opacity-40 flex items-center justify-center gap-2">
                <Mail size={18} /> {sending ? "…" : t("email_btn")}
              </button>
              {authError && <p data-testid="auth-error" className="text-rose-500 text-sm text-center font-semibold">{authError}</p>}
              <p className="text-[#9a90bd] text-[11px] text-center leading-relaxed">{t("consent_text")}</p>
            </motion.div>
          )}

          {s === 7 && (
            <motion.div key="otp" variants={step} initial="initial" animate="animate" exit="exit" className="space-y-5 pt-6 text-center">
              <h1 className="font-display text-3xl text-[#241b45]">{t("otp_title")}</h1>
              <p className="text-[#6a5f8c]">{t("otp_sub")} <b>{email}</b></p>
              {devCode && <p className="text-xs text-[#7c5cff]">dev code: {devCode}</p>}
              <input data-testid="otp-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full text-center tracking-[0.6em] font-display text-3xl p-4 rounded-2xl border border-[#eae4ff] bg-white text-[#241b45]" placeholder="••••••" />
              <button data-testid="otp-verify" disabled={sending || code.length < 6} onClick={verify}
                className="w-full grad-btn text-white font-bold py-4 rounded-2xl disabled:opacity-40">{sending ? "…" : t("verify")}</button>
              {authError && <p data-testid="auth-error" className="text-rose-500 text-sm text-center font-semibold">{authError}</p>}
            </motion.div>
          )}

          {s === 8 && (
            <motion.div key="adv" variants={step} initial="initial" animate="animate" exit="exit" className="space-y-4">
              <h1 className="font-display text-3xl text-[#241b45]">{t("advisors_title")}</h1>
              <p className="text-[#6a5f8c]">{t("advisors_sub")}</p>
              <div className="space-y-3">
                {advisors.map((a) => (
                  <div key={a.id} className="bg-white border border-[#eae4ff] rounded-2xl p-4 flex items-center gap-3" data-testid={`funnel-advisor-${a.id}`}>
                    <img src={a.avatar} alt={a.name} className="w-14 h-14 rounded-full object-cover" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[#241b45]">{a.name}</div>
                      <div className="text-xs text-[#6a5f8c] truncate">{a.title}</div>
                      <div className="text-xs text-[#7c5cff] mt-0.5">★ {a.rating} · {a.reviews} {t("reviews")}</div>
                    </div>
                    <button onClick={() => nav(`/app/chat/${a.id}`)} className="grad-btn text-white text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap">{t("start_chat")}</button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
