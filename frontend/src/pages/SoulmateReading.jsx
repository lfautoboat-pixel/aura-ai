import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Lock, Sparkles, ImagePlus, SkipForward, LoaderCircle, Download, RotateCcw, Check } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { useAuth } from "../store";
import { Starfield, SIGN_GLYPH } from "../components/Cosmic";
import { UnlockSheet } from "../components/Monetize";
import { generateSoulmateSketch } from "../services/sketchApi";
import {
  questionIds, questionTypes, nextQuestionIndex, previousQuestionIndex,
  totalActiveQuestions, positionOf, normaliseAnswer,
} from "../data/quiz";
import { computeCompatibility } from "../data/compatibility";
import { locales as nebulaLocales } from "../nebula-i18n";

// This app's own languages (i18n.js) are a superset of the funnel's (nebula-i18n) —
// map to the closest match instead of duplicating 15 questions x 5 languages here.
const NEBULA_LANG = { en: "en", es: "es", de: "de", fr: "fr", pt: "en", hi: "en", it: "en" };

function todayISO(yearsAgo) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
}

export default function SoulmateReading() {
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const nt = nebulaLocales[NEBULA_LANG[lang] || "en"];

  const [state, setState] = useState("loading"); // loading | locked | quiz | selfie | processing | result | error
  const [showUnlock, setShowUnlock] = useState(false);
  const [reading, setReading] = useState(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [selfie, setSelfie] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get("/soulmate/reading").then(({ data }) => {
      if (data.locked) return setState("locked");
      if (data.reading) { setReading(data.reading); return setState("result"); }
      setState("quiz");
    }).catch(() => setState("locked"));
  }, []);

  useEffect(() => () => { if (selfie?.url) URL.revokeObjectURL(selfie.url); }, [selfie]);

  const id = questionIds[questionIndex];
  const type = questionTypes[id] || "single";
  const meta = nt.quiz[id];
  const total = totalActiveQuestions(answers);
  const position = positionOf(questionIndex, answers);

  const goTo = (next) => {
    if (next >= questionIds.length) return setState("selfie");
    setQuestionIndex(next);
  };
  const advance = () => goTo(nextQuestionIndex(questionIndex, answers));
  const goBack = () => {
    const prev = previousQuestionIndex(questionIndex, answers);
    if (prev < 0) return nav(-1);
    setQuestionIndex(prev);
  };

  const selectSingle = (option) => {
    const value = id === "q2" ? normaliseAnswer(id, option, meta.options) : option;
    setAnswers((a) => ({ ...a, [id]: value, ...(id === "q2" ? { q2_label: option } : {}) }));
    setTimeout(() => goTo(nextQuestionIndex(questionIndex, { ...answers, [id]: value })), 180);
  };
  const toggleMulti = (option) => {
    setAnswers((a) => {
      const list = Array.isArray(a[id]) ? a[id] : [];
      const has = list.includes(option);
      return { ...a, [id]: has ? list.filter((v) => v !== option) : [...list, option] };
    });
  };
  const selected = answers[id];
  const isSelected = (option) => (type === "multi" ? Array.isArray(selected) && selected.includes(option) : selected === option);
  const canAdvance = type === "multi" ? Array.isArray(selected) && selected.length > 0 : type === "date" ? Boolean(answers.q5) : Boolean(selected);

  const handlePhoto = (file) => {
    if (!file?.type?.startsWith("image/")) return;
    if (selfie?.url) URL.revokeObjectURL(selfie.url);
    setSelfie({ file, url: URL.createObjectURL(file) });
  };

  const generate = async (withSelfie) => {
    setState("processing");
    try {
      const compatibility = computeCompatibility(answers);
      const { image } = await generateSoulmateSketch({
        selfie: withSelfie ? selfie?.file : null,
        answers,
        language: NEBULA_LANG[lang] || "en",
      });
      const { data: saved } = await api.post("/soulmate/reading", {
        answers, compatibility, image_base64: image.replace(/^data:image\/png;base64,/, ""), language: lang,
      });
      setReading(saved);
      setState("result");
    } catch {
      setState("error");
    }
  };

  const restart = () => { setAnswers({}); setQuestionIndex(0); setSelfie(null); setReading(null); setState("quiz"); };

  if (state === "loading") return <div className="app-frame cosmic-bg min-h-screen" />;

  return (
    <div className="app-frame cosmic-bg min-h-screen relative overflow-hidden">
      <Starfield count={30} />
      <div className="relative z-10 pb-16 min-h-screen flex flex-col">
        <div className="p-5 flex items-center justify-between">
          <button onClick={state === "quiz" ? goBack : () => nav(-1)} data-testid="soulmate-back"><ChevronLeft /></button>
          {state === "quiz" && (
            <div className="flex-1 mx-4 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full grad-btn rounded-full transition-all duration-300" style={{ width: `${(position / total) * 100}%` }} />
            </div>
          )}
          <span className="w-6" />
        </div>

        {state === "locked" && (
          <div className="px-5 mt-4 flex-1 flex flex-col">
            <div className="w-full h-44 rounded-2xl grad-btn grid place-items-center"><Sparkles size={40} className="text-white/80" /></div>
            <h1 className="font-display text-2xl mt-5">{t("soulmate_title")}</h1>
            <p className="text-white/60 text-sm mt-2 leading-relaxed">{t("soulmate_teaser")}</p>
            <button onClick={() => setShowUnlock(true)} data-testid="soulmate-unlock"
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

        {state === "quiz" && (
          <AnimatePresence mode="wait">
            <motion.div key={id} initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.3 }} className="px-5 mt-8 flex-1 flex flex-col">
              <h1 className="font-display text-2xl leading-tight">{meta.title}</h1>
              {type === "date" ? (
                <div className="mt-6">
                  <label className="glass rounded-2xl p-4 flex items-center gap-3 border border-white/5">
                    <input type="date" data-testid="soulmate-dob-input" className="bg-transparent flex-1 text-white outline-none"
                      style={{ colorScheme: "dark" }} value={answers.q5 || ""} min={todayISO(100)} max={todayISO(16)}
                      onChange={(e) => setAnswers((a) => ({ ...a, q5: e.target.value }))} />
                  </label>
                </div>
              ) : (
                <div className="space-y-3 mt-6">
                  {meta.options.map((opt) => (
                    <button key={opt} data-testid={`soulmate-opt-${opt}`}
                      onClick={() => (type === "multi" ? toggleMulti(opt) : selectSingle(opt))}
                      className={`w-full text-left rounded-2xl p-4 text-sm font-medium border transition-colors flex items-center justify-between ${isSelected(opt) ? "grad-btn text-white border-transparent" : "glass border-white/5 hover:border-[#b79cff]/50"}`}>
                      {opt} {isSelected(opt) && <Check size={16} />}
                    </button>
                  ))}
                </div>
              )}
              {(type === "multi" || type === "date") && (
                <button onClick={advance} disabled={!canAdvance} data-testid="soulmate-continue"
                  className="grad-btn text-white font-bold py-3.5 rounded-2xl mt-8 disabled:opacity-40">
                  {t("continue") || "Continue"}
                </button>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {state === "selfie" && (
          <div className="px-5 mt-8 flex-1 flex flex-col">
            <h1 className="font-display text-2xl">{nt.preSelfie.title}</h1>
            <p className="text-white/60 text-sm mt-2">{nt.preSelfie.subtitle}</p>
            {selfie ? (
              <div className="relative mt-6 rounded-2xl overflow-hidden">
                <img src={selfie.url} alt="" className="w-full h-64 object-cover" />
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} data-testid="soulmate-selfie-dropzone"
                className="glass rounded-2xl mt-6 h-44 flex flex-col items-center justify-center gap-2 border border-dashed border-white/15">
                <ImagePlus size={26} className="text-white/50" />
                <span className="text-white/60 text-sm">{nt.selfie.choose}</span>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => handlePhoto(e.target.files[0])} />
              </button>
            )}
            <div className="mt-auto space-y-3 pt-8">
              {selfie && (
                <button onClick={() => generate(true)} data-testid="soulmate-reveal-with-selfie" className="w-full grad-btn text-white font-bold py-3.5 rounded-2xl">
                  {nt.selfie.generate}
                </button>
              )}
              <button onClick={() => generate(false)} data-testid="soulmate-skip-selfie" className="w-full glass text-white/70 font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2">
                <SkipForward size={15} /> {nt.preSelfie.skip}
              </button>
            </div>
          </div>
        )}

        {state === "processing" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
            <LoaderCircle size={30} className="text-[#b79cff] animate-spin" />
            <p className="font-display text-xl">{nt.processing.title}</p>
            <p className="text-white/50 text-sm">{nt.processing.caption}</p>
          </div>
        )}

        {state === "error" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
            <p className="text-white/70">{nt.selfie.error}</p>
            <button onClick={restart} className="grad-btn text-white font-bold px-6 py-3 rounded-2xl">{t("soulmate_again")}</button>
          </div>
        )}

        {state === "result" && reading && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="px-5 mt-2 flex-1 flex flex-col items-center text-center">
            <p className="text-[#b79cff] text-xs font-bold tracking-widest uppercase">{t("soulmate_your_reading")}</p>
            <div className="relative w-full max-w-[320px] aspect-[4/5] mt-4 rounded-2xl overflow-hidden border border-white/10">
              <img src={`data:image/png;base64,${reading.image_base64}`} alt="Soulmate sketch" className="w-full h-full object-cover" />
            </div>
            {reading.zodiac && (
              <div className="mt-4 flex items-center gap-2 text-white/70">
                <span className="text-2xl">{SIGN_GLYPH[reading.zodiac] || "✦"}</span>
                <span className="font-display text-lg">{reading.zodiac}</span>
              </div>
            )}
            <h2 className="text-lg font-bold mt-6 mb-3 self-start">{t("soulmate_compat_title")}</h2>
            <div className="w-full space-y-3">
              {Object.entries(reading.compatibility || {}).map(([key, value]) => (
                <div key={key} className="glass rounded-xl p-3 text-left" data-testid={`soulmate-compat-${key}`}>
                  <div className="flex justify-between text-xs mb-1.5"><span className="capitalize text-white/70">{key}</span><strong className="text-[#b79cff]">{value}%</strong></div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${value}%`, background: "linear-gradient(90deg,#7c5cd2,#c4a7ff)" }} /></div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-8 w-full">
              <a href={`data:image/png;base64,${reading.image_base64}`} download="soulmate-sketch.png"
                className="flex-1 glass text-white/80 font-semibold py-3 rounded-2xl flex items-center justify-center gap-2 text-sm">
                <Download size={15} /> {t("download") || "Download"}
              </a>
              <button onClick={restart} data-testid="soulmate-restart" className="flex-1 glass text-white/80 font-semibold py-3 rounded-2xl flex items-center justify-center gap-2 text-sm">
                <RotateCcw size={15} /> {t("soulmate_again")}
              </button>
            </div>
          </motion.div>
        )}
      </div>
      <UnlockSheet open={showUnlock} onClose={() => setShowUnlock(false)} />
    </div>
  );
}
