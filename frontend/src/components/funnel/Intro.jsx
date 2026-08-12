import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";

export function Intro() {
  const { t, setStep } = useFunnel();
  return (
    <motion.div className="intro-screen" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <div className="intro-copy">
        <p className="eyebrow" data-testid="intro-eyebrow">{t.eyebrow}</p>
        <h1 data-testid="intro-title">{t.intro.title}</h1>
        <p className="lede" data-testid="intro-subtitle">{t.intro.subtitle}</p>
        <button className="primary-cta" data-testid="start-reading-button" onClick={() => setStep(STEPS.social)}>
          {t.intro.cta}
          <ArrowRight size={17} />
        </button>
        <p className="microcopy" data-testid="intro-disclaimer">{t.intro.perks}</p>
      </div>
      <div className="hero-orbit" data-testid="celestial-hero">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="moon"><Sparkles size={36} /></div>
        <span className="star s1">✦</span>
        <span className="star s2">·</span>
        <span className="star s3">✧</span>
      </div>
    </motion.div>
  );
}
