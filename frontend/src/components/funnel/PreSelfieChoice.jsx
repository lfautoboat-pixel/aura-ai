import { motion } from "framer-motion";
import { ArrowLeft, Camera, SkipForward } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";
import { questionIds, previousQuestionIndex } from "@/data/quiz";

export function PreSelfieChoice() {
  const { t, setStep, setQuestionIndex, answers } = useFunnel();

  const goBack = () => {
    const prev = previousQuestionIndex(questionIds.length, answers);
    setQuestionIndex(Math.max(prev, 0));
    setStep(STEPS.quiz);
  };

  return (
    <motion.div className="upload-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="progress-row">
        <button className="icon-button" data-testid="pre-selfie-back-button" onClick={goBack} aria-label={t.quiz.back}>
          <ArrowLeft size={17} />
        </button>
        <span data-testid="pre-selfie-progress-label">{t.preSelfie.eyebrow}</span>
      </div>
      <div className="question-copy">
        <p className="eyebrow">{t.eyebrow}</p>
        <h2 data-testid="pre-selfie-title">{t.preSelfie.title}</h2>
        <p data-testid="pre-selfie-subtitle">{t.preSelfie.subtitle}</p>
      </div>
      <div className="branch-options">
        <button className="primary-cta wide" data-testid="pre-selfie-yes-button" onClick={() => setStep(STEPS.selfie)}>
          <Camera size={16} /> {t.preSelfie.yes}
        </button>
        <button className="secondary-cta wide" data-testid="pre-selfie-skip-button" onClick={() => setStep(STEPS.processing)}>
          <SkipForward size={15} /> {t.preSelfie.skip}
        </button>
      </div>
    </motion.div>
  );
}
