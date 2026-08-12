import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";

export function SocialProof() {
  const { t, setStep, setQuestionIndex } = useFunnel();
  return (
    <motion.div className="question-screen social-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <p className="eyebrow">{t.eyebrow}</p>
      <h2 data-testid="social-title">{t.social.title}</h2>
      <div className="quote-card" data-testid="social-proof-card">
        <p data-testid="social-quote-text">{t.social.quote}</p>
        <strong data-testid="social-author">{t.social.author}</strong>
        <span>{t.social.rating}</span>
      </div>
      <button
        className="primary-cta wide"
        data-testid="social-continue-button"
        onClick={() => {
          setQuestionIndex(0);
          setStep(STEPS.quiz);
        }}
      >
        {t.social.continue}
        <ArrowRight size={16} />
      </button>
    </motion.div>
  );
}
