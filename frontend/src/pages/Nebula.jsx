import { useNavigate } from "react-router-dom";
import { FunnelProvider, useFunnel, STEPS } from "@/state/FunnelContext";
import { TopBar } from "@/components/funnel/TopBar";
import { CookieBanner } from "@/components/funnel/CookieBanner";
import { FunnelRouter } from "@/components/funnel/FunnelRouter";
import { HistoryDrawer } from "@/components/funnel/HistoryDrawer";
import "@/components/funnel/nebula.css";

// New pre-landing funnel (quiz -> selfie/skip -> sketch -> paywall -> checkout
// -> result), now this app's entry route. The previous quiz-driven funnel
// that used to live at "/" is preserved intact at "/legacy" — see App.js.
function Shell() {
  const { t } = useFunnel();
  const nav = useNavigate();
  return (
    <main className="aura-shell" data-testid="soulmate-app">
      <div className="star-field" aria-hidden="true" />
      <TopBar />
      <FunnelRouter />
      {/* Bridge into the full app (advisors/chat/premium) once the reading is unlocked. */}
      <ResultBridge nav={nav} />
      <footer className="footer-note" data-testid="footer-disclaimer">{t.footer}</footer>
      <CookieBanner />
      <HistoryDrawer />
    </main>
  );
}

function ResultBridge({ nav }) {
  const { t, step } = useFunnel();
  if (step !== STEPS.result) return null;
  return (
    <div className="result-bridge" data-testid="result-bridge">
      <button className="primary-cta wide" data-testid="continue-to-app-button" onClick={() => nav("/app/guides")}>
        {t.checkout.continueToApp}
      </button>
    </div>
  );
}

export default function Nebula() {
  return (
    <FunnelProvider>
      <Shell />
    </FunnelProvider>
  );
}
