import { useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

const DURATION_MS = 2000;

/**
 * A short "reading it live" beat shown after a handful of high-signal
 * questions (see data/insights.js) — never after every question, that's
 * exactly the fatigue the refactor is fixing. Auto-advances on its own;
 * also advances immediately on tap, for anyone who doesn't want to wait.
 */
export function InsightFlash({ text, onDone }) {
  useEffect(() => {
    const id = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <motion.div
      className="insight-flash"
      data-testid="insight-flash"
      onClick={onDone}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <motion.div
        className="insight-flash-icon"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <Sparkles size={22} />
      </motion.div>
      <motion.p
        data-testid="insight-flash-text"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
      >
        {text}
      </motion.p>
    </motion.div>
  );
}
