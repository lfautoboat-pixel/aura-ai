import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Send, Coins, Sparkles, Phone, MessageCircle, Mic } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { useAuth } from "../store";
import { Starfield } from "../components/Cosmic";

const SPEECH_LOCALE = { pt: "pt-BR", es: "es-ES", en: "en-US" };
const SpeechRecognitionAPI = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
const speechSupported = !!SpeechRecognitionAPI && typeof window !== "undefined" && "speechSynthesis" in window;

// Browsers rarely expose a voice.gender — we match on the well-known names of
// the gendered voices each platform actually ships (Windows SAPI, macOS,
// Android/Chrome OS) so the "male" voices list still catches something on
// almost any real device, not just our dev machine.
const FEMALE_VOICE_HINTS = ["female", "zira", "hazel", "susan", "samantha", "karen", "victoria", "moira", "tessa",
  "fiona", "salli", "ivy", "joanna", "kendra", "kimberly", "luciana", "paulina", "helena", "laura", "sabina",
  "monica", "carmen", "amelia", "ines", "catarina", "francisca", "raquel", "marisol", "maria"];
const MALE_VOICE_HINTS = ["male", "david", "mark", "daniel", "diego", "jorge", "alex", "fred", "george", "guy",
  "matthew", "justin", "eric", "ricardo", "juan", "pablo", "carlos", "felipe", "thomas", "james", "miguel", "reed",
  "gordon", "rishi", "aaron"];

function pickVoice(voices, locale, gender) {
  if (!voices.length) return null;
  const base = locale.split("-")[0].toLowerCase();
  const localeMatches = voices.filter((v) => v.lang?.toLowerCase().startsWith(base));
  const pool = localeMatches.length ? localeMatches : voices;
  const hints = gender === "male" ? MALE_VOICE_HINTS : FEMALE_VOICE_HINTS;
  const oppositeHints = gender === "male" ? FEMALE_VOICE_HINTS : MALE_VOICE_HINTS;
  const named = pool.find((v) => hints.some((h) => v.name.toLowerCase().includes(h)));
  if (named) return named;
  // No direct name match for the requested gender (hint list can never be
  // exhaustive across every OS/voice pack) — at least avoid landing on a
  // voice we positively know is the OTHER gender before giving up to pool[0].
  return pool.find((v) => !oppositeHints.some((h) => v.name.toLowerCase().includes(h))) || pool[0];
}

function Bubble({ m, advisor, locked }) {
  const mine = m.role === "user";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className={`flex ${mine ? "justify-end" : "justify-start"} gap-2`}>
      {!mine && <img src={advisor?.avatar} alt="" className="w-8 h-8 rounded-full object-cover self-end" />}
      <motion.div
        animate={locked ? { filter: "blur(6px)", opacity: 0.55 } : { filter: "blur(0px)", opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={`max-w-[76%] px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap select-none ${mine ? "grad-btn text-white rounded-br-md" : "glass rounded-bl-md text-white/95"}`}>
        {m.text}
      </motion.div>
    </motion.div>
  );
}

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const { user, setUser } = useAuth();
  const [advisor, setAdvisor] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [callMode, setCallMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const scroller = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    api.get(`/content/advisors?lang=${lang}`).then((r) => setAdvisor(r.data.find((a) => a.id === id)));
    api.get(`/chat/${id}?lang=${lang}`).then((r) => setMsgs(r.data.messages || []));
    const timer = setTimeout(() => setConnecting(false), 1800);
    return () => clearTimeout(timer);
  }, [id, lang]);

  // Chrome loads the voice list asynchronously — reading getVoices() once on
  // mount often returns an empty array, which is why TTS silently fell back
  // to a single default voice regardless of the advisor's gender.
  useEffect(() => {
    if (!speechSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  useEffect(() => { scroller.current?.scrollTo(0, scroller.current.scrollHeight); }, [msgs, typing]);

  const balance = user?.premium ? "∞" : ((user?.free_messages || 0) > 0 ? `${user.free_messages} ${t("free_left")}` : `${user?.credits || 0} ${t("credits")}`);

  const send = async (spoken) => {
    const text = (spoken ?? input).trim();
    if (!text || typing) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setTyping(true);
    try {
      const { data } = await api.post("/chat/send", { advisor_id: id, message: text, lang, call_mode: callMode });
      setMsgs((m) => [...m, { role: "assistant", text: data.reply }]);
      setUser((u) => ({ ...u, credits: data.credits, free_messages: data.free_messages, premium: data.premium }));
      if (callMode) speak(data.reply);
    } catch (e) {
      if (e?.response?.status === 402) setOutOfCredits(true);
    } finally { setTyping(false); }
  };

  const speak = (text) => {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const locale = SPEECH_LOCALE[lang] || "en-US";
    utter.lang = locale;
    const gender = advisor?.gender === "male" ? "male" : "female";
    const voice = pickVoice(voices, locale, gender);
    if (voice) utter.voice = voice;
    // Guaranteed to shift regardless of whether the OS exposes more than one
    // voice per locale — many Chrome/Android setups only ship a single voice
    // per language, where a named-voice match alone would never differ.
    utter.pitch = gender === "male" ? 0.82 : 1.15;
    utter.rate = 1.0;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  };

  const toggleListening = () => {
    if (!speechSupported || outOfCredits) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    window.speechSynthesis.cancel();
    setSpeaking(false);
    const rec = new SpeechRecognitionAPI();
    rec.lang = SPEECH_LOCALE[lang] || "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript;
      if (transcript) send(transcript);
    };
    recognitionRef.current = rec;
    rec.start();
  };

  const toggleCallMode = () => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    setListening(false);
    setSpeaking(false);
    setCallMode((c) => !c);
  };

  useEffect(() => () => { window.speechSynthesis?.cancel(); recognitionRef.current?.stop(); }, []);

  return (
    <div className="app-frame cosmic-bg min-h-screen flex flex-col relative">
      <Starfield count={30} />
      <div className="relative z-10 flex flex-col h-screen">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <button onClick={() => nav("/app")} data-testid="chat-back"><ChevronLeft /></button>
          <img src={advisor?.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
          <div className="flex-1">
            <div className="font-semibold text-sm">{advisor?.name || "…"}</div>
            <div className="text-[11px] text-emerald-400">{t("online")}</div>
          </div>
          {speechSupported && (
            <button onClick={toggleCallMode} data-testid="call-toggle"
              className={`rounded-full p-2 ${callMode ? "grad-btn text-white" : "glass text-white/70"}`}
              title={callMode ? t("text_mode") : t("call_mode")}>
              {callMode ? <MessageCircle size={16} /> : <Phone size={16} />}
            </button>
          )}
          <button onClick={() => nav("/app/recharge")} data-testid="chat-credits" className="grad-btn rounded-full px-2.5 py-1 text-[11px] font-bold flex items-center gap-1">
            <Coins size={12} /> {user?.premium ? "∞" : ((user?.free_messages || 0) > 0 ? `${user.free_messages} free` : (user?.credits || 0))}
          </button>
        </div>

        {connecting ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="relative w-24 h-24">
              <span className="spin-slow absolute inset-0 rounded-full" style={{ background: "conic-gradient(from 0deg,#8a5cff,#ff8fb1,#e7c46a,#8a5cff)" }} />
              <img src={advisor?.avatar} alt="" className="absolute inset-1.5 w-[calc(100%-0.375rem)] h-[calc(100%-0.375rem)] rounded-full object-cover" />
            </div>
            <p className="text-white/70 text-sm">Connecting you to {advisor?.name}…</p>
          </div>
        ) : callMode ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
            <div className="relative w-40 h-40">
              {(listening || speaking) && (
                <motion.span
                  className={`absolute inset-0 rounded-full ${listening ? "bg-[#8a5cff]/30" : "bg-[#ff8fb1]/30"}`}
                  animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              <img src={advisor?.avatar} alt="" className="absolute inset-4 w-[calc(100%-2rem)] h-[calc(100%-2rem)] rounded-full object-cover" />
            </div>
            <p className="text-white/70 text-sm h-5">
              {listening ? t("call_listening") : speaking ? t("call_speaking") : t("call_tap_to_talk")}
            </p>
            <button onClick={toggleListening} disabled={speaking || outOfCredits} data-testid="call-mic"
              className={`w-20 h-20 rounded-full grid place-items-center transition-transform active:scale-95 disabled:opacity-40 ${listening ? "bg-rose-500" : "grad-btn"}`}>
              <Mic size={28} className="text-white" />
            </button>
            {msgs.length > 0 && (
              <p className="text-white/40 text-xs text-center max-w-xs line-clamp-2">{msgs[msgs.length - 1].text}</p>
            )}
          </div>
        ) : (
          <>
            <div ref={scroller} className="flex-1 overflow-y-auto no-sb px-4 py-4 space-y-3">
              {msgs.length === 0 && (
                <div className="text-center text-white/50 text-sm mt-10 px-6">
                  <Sparkles className="mx-auto mb-2 text-[#b79cff]" />
                  {advisor?.name} is ready. Share what weighs on your heart, and the reading will begin.
                </div>
              )}
              {msgs.map((m, i) => (
                <Bubble key={i} m={m} advisor={advisor} locked={outOfCredits && i === msgs.length - 1} />
              ))}
              {typing && (
                <div className="flex gap-2"><img src={advisor?.avatar} alt="" className="w-8 h-8 rounded-full object-cover self-end" />
                  <div className="glass rounded-2xl rounded-bl-md px-4 py-3 flex gap-1">
                    {[0, 1, 2].map((d) => <span key={d} className="w-1.5 h-1.5 bg-white/70 rounded-full" style={{ animation: `twinkle 1s ${d * 0.2}s infinite` }} />)}
                  </div>
                </div>
              )}
            </div>

            <div className="px-3 py-3 border-t border-white/10 flex items-center gap-2" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
              <input data-testid="chat-input" value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()} placeholder={t("type_msg")} disabled={outOfCredits}
                className="flex-1 glass rounded-full px-4 py-3 text-sm outline-none placeholder:text-white/40 disabled:opacity-40" />
              <button data-testid="chat-send" onClick={() => send()} disabled={typing || outOfCredits} className="grad-btn w-11 h-11 rounded-full grid place-items-center disabled:opacity-50">
                <Send size={18} className="text-white" />
              </button>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {outOfCredits && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[#0b0718]/40 backdrop-blur-md flex items-end justify-center" data-testid="out-of-credits-modal">
            <motion.div initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="w-full max-w-[480px] glass rounded-t-3xl p-6 border-t border-white/10 text-center">
              <div className="w-16 h-16 rounded-full grad-btn grid place-items-center mx-auto floaty"><Coins className="text-white" /></div>
              <h2 className="font-display text-2xl mt-4">{t("out_title")}</h2>
              <p className="text-white/60 text-sm mt-2">{t("out_sub")}</p>
              <button onClick={() => nav("/app/recharge")} className="w-full grad-btn text-white font-bold py-4 rounded-2xl mt-5" data-testid="goto-recharge">{t("recharge")}</button>
              <button onClick={() => setOutOfCredits(false)} className="text-white/50 text-sm mt-3">Later</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
