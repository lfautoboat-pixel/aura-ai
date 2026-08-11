import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Lock, Sparkles, RotateCcw } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { Starfield } from "../components/Cosmic";
import { UnlockSheet } from "../components/Monetize";

const L = (obj, field, lang) => (lang === "pt" ? obj[`${field}_pt`] || obj[field] : obj[field]);

const step = { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.96 } };

export default function QuizPlay() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const [quiz, setQuiz] = useState(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [step_, setStep] = useState(0);
  const [scores, setScores] = useState({});
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/content/quizzes/${id}`).then((r) => setQuiz(r.data)).catch(() => setQuiz(false));
  }, [id]);

  if (quiz === false) {
    return (
      <div className="app-frame cosmic-bg min-h-screen grid place-items-center text-white/60">
        <button onClick={() => nav(-1)} className="absolute top-5 left-5"><ChevronLeft /></button>
        {t("advisor_not_found")}
      </div>
    );
  }
  if (!quiz) return <div className="app-frame cosmic-bg min-h-screen" />;

  const questions = quiz.questions;
  const isLocked = quiz.locked && !questions;

  const answer = (type) => {
    const next = { ...scores, [type]: (scores[type] || 0) + 1 };
    setScores(next);
    if (step_ + 1 >= questions.length) {
      const winner = Object.entries(next).sort((a, b) => b[1] - a[1])[0][0];
      setResult(quiz.results.find((r) => r.key === winner) || quiz.results[0]);
    } else {
      setStep(step_ + 1);
    }
  };

  const restart = () => { setStep(0); setScores({}); setResult(null); };

  return (
    <div className="app-frame cosmic-bg min-h-screen relative overflow-hidden">
      <Starfield count={30} />
      <div className="relative z-10 pb-16 min-h-screen flex flex-col">
        <div className="p-5 flex items-center justify-between">
          <button onClick={() => nav(-1)} data-testid="quiz-back"><ChevronLeft /></button>
          {questions && !result && (
            <div className="flex-1 mx-4 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full grad-btn rounded-full transition-all duration-300" style={{ width: `${((step_ + 1) / questions.length) * 100}%` }} />
            </div>
          )}
          <span className="w-6" />
        </div>

        {isLocked && (
          <div className="px-5 mt-4 flex-1 flex flex-col">
            <img src={quiz.img} alt="" className="w-full h-44 object-cover rounded-2xl" />
            <h1 className="font-display text-2xl mt-5">{L(quiz, "title", lang)}</h1>
            <p className="text-white/60 text-sm mt-2 leading-relaxed">{L(quiz, "teaser", lang)}</p>
            <button onClick={() => setShowUnlock(true)} data-testid="quiz-unlock"
              className="mt-8 glass rounded-2xl p-6 flex flex-col items-center text-center gap-3 border border-white/10">
              <div className="w-14 h-14 rounded-full grad-btn grid place-items-center"><Lock size={22} className="text-white" /></div>
              <div>
                <div className="font-bold">{t("unlock_title")}</div>
                <div className="text-white/50 text-xs mt-1">{t("unlock_sub")}</div>
              </div>
              <span className="grad-btn text-white text-sm font-bold px-5 py-2.5 rounded-xl mt-1">{t("unlock_cta")}</span>
            </button>
          </div>
        )}

        {questions && !result && (
          <AnimatePresence mode="wait">
            <motion.div key={step_} variants={step} initial="initial" animate="animate" exit="exit"
              transition={{ duration: 0.35 }} className="px-5 mt-8 flex-1">
              <h1 className="font-display text-2xl leading-tight">{L(questions[step_], "q", lang)}</h1>
              <div className="space-y-3 mt-6">
                {questions[step_].options.map((opt, i) => (
                  <button key={i} data-testid={`quiz-opt-${i}`} onClick={() => answer(opt.type)}
                    className="w-full text-left glass rounded-2xl p-4 text-sm font-medium hover:border-[#b79cff]/50 border border-white/5 transition-colors">
                    {L(opt, "label", lang)}
                  </button>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        )}

        {result && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}
            className="px-5 mt-6 flex-1 flex flex-col items-center text-center" data-testid="quiz-result">
            <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", damping: 12, delay: 0.15 }}
              className="w-20 h-20 rounded-full grad-btn grid place-items-center floaty">
              <Sparkles size={30} className="text-white" />
            </motion.div>
            <p className="text-[#b79cff] text-xs font-bold tracking-widest uppercase mt-5">{L(quiz, "title", lang)}</p>
            <h1 className="font-display text-3xl mt-2">{L(result, "title", lang)}</h1>
            <p className="text-white/70 text-sm leading-relaxed mt-4 font-serif2">{L(result, "desc", lang)}</p>
            <button onClick={restart} data-testid="quiz-restart" className="flex items-center gap-2 text-white/40 text-xs font-semibold mt-8">
              <RotateCcw size={13} /> {t("quiz_restart")}
            </button>
          </motion.div>
        )}
      </div>
      <UnlockSheet open={showUnlock} onClose={() => setShowUnlock(false)} />
    </div>
  );
}
