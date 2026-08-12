import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";
import {
  questionIds,
  questionTypes,
  nextQuestionIndex,
  previousQuestionIndex,
  totalActiveQuestions,
  positionOf,
  normaliseAnswer,
} from "@/data/quiz";

export function Question() {
  const { t, answers, setAnswer, toggleMulti, questionIndex, setQuestionIndex, setStep } = useFunnel();
  const id = questionIds[questionIndex];
  const type = questionTypes[id] || "single";
  const meta = t.quiz[id];
  const total = totalActiveQuestions(answers);
  const position = positionOf(questionIndex, answers);
  const selected = answers[id];
  const canAdvance = type === "multi" ? Array.isArray(selected) && selected.length > 0 : Boolean(selected);

  const advance = () => {
    const next = nextQuestionIndex(questionIndex, answers);
    if (next >= questionIds.length) {
      setStep(STEPS.preSelfie);
      return;
    }
    setQuestionIndex(next);
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
    } else {
      const value = id === "q2" ? normaliseAnswer(id, option, meta.options) : option;
      setAnswer(id, value);
      if (id === "q2") setAnswer("q2_label", option);
    }
  };

  const isSelected = (option) => {
    if (type === "multi") return Array.isArray(selected) && selected.includes(option);
    if (id === "q2") return answers.q2_label === option;
    return selected === option;
  };

  return (
    <motion.div
      className="question-screen"
      key={id}
      initial={{ opacity: 0, x: 22 }}
      animate={{ opacity: 1, x: 0 }}
    >
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
      <div className="question-copy">
        <p className="eyebrow">{t.quiz.category}</p>
        <h2 data-testid={`question-${id}-title`}>{meta.title}</h2>
        <p data-testid={`question-${id}-subtitle`}>
          {type === "multi" ? t.quiz.multiHint : t.quiz.singleHint}
        </p>
      </div>
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
      <button className="text-cta" data-testid="quiz-continue-button" disabled={!canAdvance} onClick={advance}>
        {t.quiz.continue}
        <ArrowRight size={16} />
      </button>
    </motion.div>
  );
}
