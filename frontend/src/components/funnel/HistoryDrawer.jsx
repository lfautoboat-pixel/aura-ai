import { AnimatePresence, motion } from "framer-motion";
import { Trash2, X } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function HistoryDrawer() {
  const { t, historyOpen, setHistoryOpen, readings, removeReading, setImage, setStep } = useFunnel();

  const reopen = (reading) => {
    setImage(reading.image);
    setHistoryOpen(false);
    setStep(STEPS.result);
  };

  return (
    <AnimatePresence>
      {historyOpen && (
        <motion.div
          className="history-backdrop"
          data-testid="history-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setHistoryOpen(false)}
        >
          <motion.aside
            className="history-drawer"
            data-testid="history-drawer"
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 420 }}
            transition={{ type: "tween", duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="history-head">
              <h3 data-testid="history-title">{t.history.title}</h3>
              <button
                className="history-close"
                data-testid="history-close-button"
                onClick={() => setHistoryOpen(false)}
                aria-label={t.history.close}
              >
                <X size={17} />
              </button>
            </div>

            {readings.length === 0 && (
              <p className="history-empty" data-testid="history-empty">{t.history.empty}</p>
            )}

            <ul className="history-list" data-testid="history-list">
              {readings.map((reading) => (
                <li key={reading.id} className="history-item" data-testid={`history-item-${reading.id}`}>
                  <img src={reading.image} alt="Saved sketch" onClick={() => reopen(reading)} />
                  <div className="history-body">
                    <span className="history-date">{formatDate(reading.createdAt)}</span>
                    <div className="history-actions">
                      <button
                        className="text-cta"
                        data-testid={`history-reopen-${reading.id}`}
                        onClick={() => reopen(reading)}
                      >
                        {t.history.reopen}
                      </button>
                      <button
                        className="history-remove"
                        data-testid={`history-remove-${reading.id}`}
                        onClick={() => removeReading(reading.id)}
                        aria-label={t.history.remove}
                      >
                        <Trash2 size={13} /> {t.history.remove}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
