import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, LoaderCircle, Lock, Mail, X } from "lucide-react";
import { GoogleLogin } from "@react-oauth/google";
import { useFunnel, STEPS } from "@/state/FunnelContext";
import { useAuth } from "@/store";
import { useI18n } from "@/i18n";
import { getReferral } from "@/referral";
import { startCheckout, ExpressCheckout } from "@/components/Monetize";
import api from "@/api";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

// Persisted right before the full-page redirect to Stripe so the reading
// (image/answers/readingId) survives the round trip and /payment/success
// can hand the user straight back into the funnel's Result step instead of
// the generic "you're all set" screen used by the rest of the app.
function savePendingReading({ image, answers, readingId, language }) {
  try {
    localStorage.setItem("nebula_pending_reading", JSON.stringify({ image, answers, readingId, language }));
  } catch {
    // localStorage can throw in private-mode/quota-exceeded edge cases —
    // non-fatal, the user just lands on the generic success screen instead.
  }
}

export function CheckoutModal() {
  const { t, step, setStep, selectedPlan, image, answers, readingId, language } = useFunnel();
  const { user, login } = useAuth();
  const { currency } = useI18n();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [authStage, setAuthStage] = useState("choose"); // choose | otp
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [planAmount, setPlanAmount] = useState(null);

  const open = step === STEPS.checkout;

  useEffect(() => {
    if (!open) return;
    api.get(`/billing/packs?currency=${currency}`).then(({ data }) => {
      const plan = (data.sub_plans || []).find((p) => p.item_key === selectedPlan);
      setPlanAmount(plan?.amount ?? null);
    });
  }, [open, currency, selectedPlan]);
  const close = () => setStep(STEPS.paywall);

  const requestOtp = async () => {
    if (!email.includes("@")) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const { data } = await api.post("/auth/request-otp", { email });
      setDevCode(data.dev_code || "");
      setAuthStage("otp");
    } catch {
      setErrorMsg(t.checkout.authError);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true);
    setErrorMsg("");
    try {
      const { data } = await api.post("/auth/verify-otp", { email, code, ref: getReferral() });
      login(data.token, data.user);
    } catch {
      setCode("");
      setErrorMsg(t.checkout.authError);
    } finally {
      setBusy(false);
    }
  };

  const onGoogleSuccess = async (credentialResponse) => {
    setBusy(true);
    setErrorMsg("");
    try {
      const { data } = await api.post("/auth/google", { credential: credentialResponse.credential, ref: getReferral() });
      login(data.token, data.user);
    } catch {
      setErrorMsg(t.checkout.authError);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    savePendingReading({ image, answers, readingId, language });
    setBusy(true);
    await startCheckout(selectedPlan, currency, () => setBusy(false));
  };

  const googleConfigured = !!GOOGLE_CLIENT_ID;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="checkout-backdrop"
          data-testid="checkout-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            className="checkout-modal"
            data-testid="checkout-modal"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="checkout-close" data-testid="checkout-close-button" onClick={close} aria-label={t.checkout.close}>
              <X size={17} />
            </button>

            {!user ? (
              <>
                <p className="eyebrow" data-testid="checkout-eyebrow">{t.paywall.eyebrow}</p>
                <h3 data-testid="checkout-title">{t.checkout.authTitle}</h3>
                <p className="checkout-subtitle" data-testid="checkout-subtitle">{t.checkout.authSubtitle}</p>

                {authStage === "choose" && (
                  <div className="checkout-auth" data-testid="checkout-auth-choose">
                    {googleConfigured ? (
                      <div data-testid="checkout-google-btn" style={{ display: "flex", justifyContent: "center" }}>
                        <GoogleLogin onSuccess={onGoogleSuccess} onError={() => setErrorMsg(t.checkout.authError)} width="300" shape="pill" text="continue_with" />
                      </div>
                    ) : null}
                    <div className="checkout-field">
                      <label htmlFor="checkout-email">{t.checkout.email}</label>
                      <input
                        id="checkout-email"
                        data-testid="checkout-email-input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t.checkout.emailPlaceholder}
                      />
                    </div>
                    <button className="primary-cta wide" data-testid="checkout-email-continue" disabled={busy || !email.includes("@")} onClick={requestOtp}>
                      <Mail size={16} /> {t.checkout.continueEmail}
                    </button>
                  </div>
                )}

                {authStage === "otp" && (
                  <div className="checkout-auth" data-testid="checkout-auth-otp">
                    <p className="checkout-subtitle">{t.checkout.otpSubtitle} <b>{email}</b></p>
                    {devCode && <p className="microcopy">dev code: {devCode}</p>}
                    <input
                      data-testid="checkout-otp-input"
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="••••••"
                      className="checkout-otp-input"
                    />
                    <button className="primary-cta wide" data-testid="checkout-otp-verify" disabled={busy || code.length < 6} onClick={verifyOtp}>
                      {t.checkout.verify}
                    </button>
                  </div>
                )}

                {errorMsg && <p className="checkout-error" data-testid="checkout-error">{errorMsg}</p>}
              </>
            ) : (
              <>
                <p className="eyebrow" data-testid="checkout-eyebrow">{t.paywall.eyebrow}</p>
                <h3 data-testid="checkout-title">{t.checkout.title}</h3>
                <p className="checkout-subtitle" data-testid="checkout-subtitle">{t.checkout.subtitle}</p>

                <div className="checkout-plan-summary" data-testid="checkout-plan-summary">
                  <div className="plan-name">{t.paywall.planNames[selectedPlan]}</div>
                </div>

                <ExpressCheckout itemKey={selectedPlan} currency={currency} amount={planAmount} />

                <button className="primary-cta wide" data-testid="checkout-pay-button" disabled={busy} onClick={pay}>
                  {busy ? <LoaderCircle size={16} className="spinning" /> : <Lock size={15} />}
                  {t.checkout.payWithCard}
                </button>

                <p className="checkout-trust" data-testid="checkout-trust">
                  <Lock size={11} /> {t.checkout.trust}
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
