import { LockKeyhole, Volume2, VolumeX, History } from "lucide-react";
import { useFunnel } from "@/state/FunnelContext";

export function TopBar() {
  const { t, language, cycleLanguage, ambient, setHistoryOpen, reset } = useFunnel();
  return (
    <header className="topbar" data-testid="topbar">
      <button className="wordmark" data-testid="aura-wordmark-button" onClick={reset}>
        <span>✦</span> aura
      </button>
      <div className="top-actions">
        <span className="secure-note" data-testid="secure-reading-label">
          <LockKeyhole size={13} /> {t.topbar.private}
        </span>
        <button
          className="icon-toggle"
          data-testid="ambient-toggle-button"
          aria-label={ambient.on ? t.ambient.on : t.ambient.off}
          onClick={ambient.toggle}
        >
          {ambient.on ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button
          className="icon-toggle"
          data-testid="history-open-button"
          aria-label={t.result.history}
          onClick={() => setHistoryOpen(true)}
        >
          <History size={15} />
        </button>
        <button className="lang-button" data-testid="language-toggle-button" onClick={cycleLanguage}>
          {language.toUpperCase()}
        </button>
      </div>
    </header>
  );
}
