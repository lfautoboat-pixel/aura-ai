import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Send, Coins, Sparkles } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { useAuth } from "../store";
import { Starfield } from "../components/Cosmic";

function Bubble({ m, advisor }) {
  const mine = m.role === "user";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`flex ${mine ? "justify-end" : "justify-start"} gap-2`}>
      {!mine && <img src={advisor?.avatar} alt="" className="w-8 h-8 rounded-full object-cover self-end" />}
      <div className={`max-w-[76%] px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap ${mine ? "grad-btn text-white rounded-br-md" : "glass rounded-bl-md text-white/95"}`}>
        {m.text}
      </div>
    </motion.div>
  );
}

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t } = useI18n();
  const { user, setUser } = useAuth();
  const [advisor, setAdvisor] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    api.get("/content/advisors").then((r) => setAdvisor(r.data.find((a) => a.id === id)));
    api.get(`/chat/${id}`).then((r) => setMsgs(r.data.messages || []));
    const timer = setTimeout(() => setConnecting(false), 1800);
    return () => clearTimeout(timer);
  }, [id]);

  useEffect(() => { scroller.current?.scrollTo(0, scroller.current.scrollHeight); }, [msgs, typing]);

  const balance = user?.premium ? "∞" : ((user?.free_messages || 0) > 0 ? `${user.free_messages} ${t("free_left")}` : `${user?.credits || 0} ${t("credits")}`);

  const send = async () => {
    const text = input.trim();
    if (!text || typing) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setTyping(true);
    try {
      const { data } = await api.post("/chat/send", { advisor_id: id, message: text });
      setMsgs((m) => [...m, { role: "assistant", text: data.reply }]);
      setUser((u) => ({ ...u, credits: data.credits, free_messages: data.free_messages, premium: data.premium }));
    } catch (e) {
      if (e?.response?.status === 402) setOutOfCredits(true);
    } finally { setTyping(false); }
  };

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
          <button onClick={() => nav("/app/recharge")} data-testid="chat-credits" className="grad-btn rounded-full px-2.5 py-1 text-[11px] font-bold flex items-center gap-1">
            <Coins size={12} /> {user?.premium ? "∞" : (user?.credits || 0)}
          </button>
        </div>

        {connecting ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="relative w-24 h-24">
              <span className="spin-slow absolute inset-0 rounded-full" style={{ background: "conic-gradient(from 0deg,#8a5cff,#ff8fb1,#e7c46a,#8a5cff)" }} />
              <img src={advisor?.avatar} alt="" className="absolute inset-1.5 rounded-full object-cover" />
            </div>
            <p className="text-white/70 text-sm">Connecting you to {advisor?.name}…</p>
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
              {msgs.map((m, i) => <Bubble key={i} m={m} advisor={advisor} />)}
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
                onKeyDown={(e) => e.key === "Enter" && send()} placeholder={t("type_msg")}
                className="flex-1 glass rounded-full px-4 py-3 text-sm outline-none placeholder:text-white/40" />
              <button data-testid="chat-send" onClick={send} disabled={typing} className="grad-btn w-11 h-11 rounded-full grid place-items-center disabled:opacity-50">
                <Send size={18} className="text-white" />
              </button>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {outOfCredits && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-end justify-center" data-testid="out-of-credits-modal">
            <motion.div initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} className="w-full max-w-[480px] cosmic-bg rounded-t-3xl p-6 border-t border-white/10 text-center">
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
