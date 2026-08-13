import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Calendar } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";
import {
  questionIds,
  questionTypes,
  LAYOUTS,
  nextQuestionIndex,
  previousQuestionIndex,
  totalActiveQuestions,
  positionOf,
  normaliseAnswer,
} from "@/data/quiz";
import { getOptionIcon } from "@/data/optionIcons";
import { INSIGHT_AFTER, INSIGHT_VALUE } from "@/data/insights";
import { zodiacFromISODate } from "@/data/zodiac";
import { InsightFlash } from "./InsightFlash";

const step = { initial: { opacity: 0, x: 22 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -14 } };

// "👎 Strongly disagree" -> { glyph: "👎", label: "Strongly disagree" }
function splitGlyph(option) {
  const [glyph, ...rest] = option.split(" ");
  return { glyph, label: rest.join(" ") || option };
}

function todayISO(yearsAgo) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
}

export function Question() {
  const { t, answers, setAnswer, toggleMulti, questionIndex, setQuestionIndex, setStep } = useFunnel();
  const id = questionIds[questionIndex];
  const type = questionTypes[id] || "single";
  const layout = LAYOUTS[id] || "list";
  const meta = t.quiz[id];
  const total = totalActiveQuestions(answers);
  const position = positionOf(questionIndex, answers);
  const selected = answers[id];
  const canAdvance = type === "multi" ? Array.isArray(selected) && selected.length > 0
    : type === "date" ? Boolean(answers.q5)
    : Boolean(selected);

  const [pendingInsight, setPendingInsight] = useState(null);

  const goTo = (next) => {
    if (next >= questionIds.length) {
      setStep(STEPS.preSelfie);
      return;
    }
    setQuestionIndex(next);
  };

  const commitAdvance = (liveAnswers = answers) => {
    goTo(nextQuestionIndex(questionIndex, liveAnswers));
  };

  // Runs right after an answer is committed: shows a short personalised
  // "reading it live" beat for a handful of questions (data/insights.js),
  // then continues — never blocks, never appears after every question.
  // Takes an explicit answers snapshot rather than reading the context
  // value, because single-select calls this from a setTimeout (for the
  // tap-to-advance feel) and by the time it fires, `answers` from this
  // render's closure would be one click stale.
  const advance = (liveAnswers = answers) => {
    const insightKey = INSIGHT_AFTER[id];
    if (insightKey) {
      const zodiacName = id === "q5" ? t.zodiac?.[zodiacFromISODate(liveAnswers.q5)] : null;
      const value = INSIGHT_VALUE[insightKey]?.(liveAnswers, zodiacName);
      if (value) {
        const template = t.insights?.[insightKey];
        const text = template ? template.replace("{value}", value) : null;
        if (text) {
          setPendingInsight({ text, liveAnswers });
          return;
        }
      }
    }
    commitAdvance(liveAnswers);
  };

  const finishInsight = () => {
    const liveAnswers = pendingInsight?.liveAnswers;
    setPendingInsight(null);
    commitAdvance(liveAnswers);
  };

  const goBack = () => {
    const prev = previousQuestionIndex(questionIndex, answers);
    if (prev < 0) {
      setStep(STEPS.social);
      return;
    }
    setQuestionIndex(prev);
  };

  const handleSelect = (option) => {
    if (type === "multi") {
      toggleMulti(id, option);
      return;
    }
    const value = id === "q2" ? normaliseAnswer(id, option, meta.options) : option;
    const liveAnswers = { ...answers, [id]: value, ...(id === "q2" ? { q2_label: option } : {}) };
    setAnswer(id, value);
    if (id === "q2") setAnswer("q2_label", option);
    // Single-select questions commit and move on immediately — the same
    // tap-to-advance feel already proven in the legacy funnel (/legacy),
    // just reused here instead of reinvented.
    setTimeout(() => advance(liveAnswers), 190);
  };

  const isSelected = (option) => {
    if (type === "multi") return Array.isArray(selected) && selected.includes(option);
    if (id === "q2") return answers.q2_label === option;
    return selected === option;
  };

  const scaleNodes = useMemo(
    () => (layout === "scale" ? meta.options.map(splitGlyph) : null),
    [layout, meta]
  );

  if (pendingInsight) {
    return <InsightFlash text={pendingInsight.text} onDone={finishInsight} />;
  }

  return (
    <motion.div className="question-screen" key={id} initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }}>
      <div className="progress-row">
        <button className="icon-button" data-testid="quiz-back-button" onClick={goBack} aria-label={t.quiz.back}>
          <ArrowLeft size={17} />
        </button>
        <span data-testid="quiz-progress-label">
          {String(position).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
      <div className="progress-track">
        <span style={{ width: `${(position / total) * 100}%` }} />
      </div>
      <div className={`question-copy accent-${(position - 1) % 4}`}>
        <p className="eyebrow">{t.quiz.category}</p>
        <h2 data-testid={`question-${id}-title`}>{meta.title}</h2>
        <p data-testid={`question-${id}-subtitle`}>
          {type === "multi" ? t.quiz.multiHint : type === "date" ? t.quiz.dateHint : t.quiz.singleHint}
        </p>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={layout + id} variants={step} initial="initial" animate="animate" exit="exit">
          {layout === "date" && (
            <div className="dob-picker" data-testid="dob-picker">
              <label className="dob-input-wrap">
                <Calendar size={18} />
                <input
                  type="date"
                  data-testid="dob-native-input"
                  value={answers.q5 || ""}
                  min={todayISO(100)}
                  max={todayISO(16)}
                  onChange={(e) => setAnswer("q5", e.target.value)}
                />
              </label>
            </div>
          )}

          {layout === "list" && (
            <div className="option-list">
              {meta.options.map((option) => (
                <button
                  className={`option ${isSelected(option) ? "selected" : ""}`}
                  data-testid={`quiz-option-${id}-${option.toLowerCase().replaceAll(" ", "-")}`}
                  key={option}
                  onClick={() => handleSelect(option)}
                >
                  <span>{option}</span>
                  {isSelected(option) && <Check size={17} />}
                </button>
              ))}
            </div>
          )}

          {layout === "grid-icon" && (
            <div className="option-grid">
              {meta.options.map((option, i) => {
                const Icon = getOptionIcon(id, i);
                return (
                  <button
                    className={`grid-card ${isSelected(option) ? "selected" : ""}`}
                    data-testid={`quiz-option-${id}-${option.toLowerCase().replaceAll(" ", "-")}`}
                    key={option}
                    onClick={() => handleSelect(option)}
                  >
                    <span className="grid-card-icon"><Icon size={20} /></span>
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>
          )}

          {layout === "chips" && (
            <div className="chip-list">
              {meta.options.map((option) => (
                <button
                  className={`chip ${isSelected(option) ? "selected" : ""}`}
                  data-testid={`quiz-option-${id}-${option.toLowerCase().replaceAll(" ", "-")}`}
                  key={option}
                  onClick={() => handleSelect(option)}
                >
                  {isSelected(option) && <Check size={13} />}
                  {option}
                </button>
              ))}
            </div>
          )}

          {layout === "scale" && (
            <div className="scale-block">
              <div className="scale-row">
                {scaleNodes.map(({ glyph, label }, i) => (
                  <button
                    key={label}
                    className={`scale-node ${isSelected(meta.options[i]) ? "selected" : ""}`}
                    data-testid={`quiz-option-${id}-${label.toLowerCase().replaceAll(" ", "-")}`}
                    aria-label={label}
                    onClick={() => handleSelect(meta.options[i])}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
              <div className="scale-track"><span /></div>
              <div className="scale-labels">
                <span>{splitGlyph(meta.options[0]).label}</span>
                <span>{splitGlyph(meta.options[meta.options.length - 1]).label}</span>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {(type === "multi" || type === "date") && (
        <button className="text-cta" data-testid="quiz-continue-button" disabled={!canAdvance} onClick={advance}>
          {t.quiz.continue}
          <ArrowRight size={16} />
        </button>
      )}
    </motion.div>
  );
}
