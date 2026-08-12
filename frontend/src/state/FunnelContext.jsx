import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { detectLanguage, getMessages, locales, languageCodes } from "@/nebula-i18n";
import { useReadings } from "@/hooks/useReadings";
import { useAmbient } from "@/hooks/useAmbient";
import { defaultPlanId } from "@/data/plans";

const FunnelContext = createContext(null);

/**
 * Steps are named strings so the router stays readable and future engineers
 * can add branches without touching numeric indexes.
 *   intro -> social -> quiz(0..14) -> preSelfie -> selfie -> processing
 *   -> paywall -> checkout -> result
 */
export const STEPS = {
  intro: "intro",
  social: "social",
  quiz: "quiz",
  preSelfie: "preSelfie",
  selfie: "selfie",
  processing: "processing",
  paywall: "paywall",
  checkout: "checkout",
  result: "result",
};

export function FunnelProvider({ children }) {
  const [language, setLanguage] = useState(detectLanguage);
  const [step, setStep] = useState(STEPS.intro);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [selfie, setSelfie] = useState(null); // { file, url }
  const [image, setImage] = useState(null);
  const [readingId, setReadingId] = useState(null);
  const [error, setError] = useState("");
  const [subscription, setSubscription] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(defaultPlanId);
  const [cookiesDismissed, setCookiesDismissed] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("aura-cookies") !== null
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const ambient = useAmbient();
  const { readings, save: saveReading, remove: removeReading } = useReadings();

  const t = useMemo(() => getMessages(language), [language]);

  useEffect(() => {
    return () => {
      if (selfie?.url) URL.revokeObjectURL(selfie.url);
    };
  }, [selfie]);

  // Restores the reading after the full-page round trip to Stripe Checkout
  // and back (see CheckoutModal.savePendingReading / PaymentResult.jsx) —
  // a redirect flow reloads the page, so this is the only way the sketch
  // survives to be shown on the Result step instead of being lost.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("revealed") !== "1") return;
    try {
      const raw = localStorage.getItem("nebula_pending_reading");
      if (!raw) return;
      const pending = JSON.parse(raw);
      localStorage.removeItem("nebula_pending_reading");
      if (pending.image) setImage(pending.image);
      if (pending.answers) setAnswers(pending.answers);
      if (pending.readingId) setReadingId(pending.readingId);
      if (pending.language) setLanguage(pending.language);
      setSubscription({ paid: true });
      setStep(STEPS.result);
    } catch {
      // Malformed/missing pending reading — user just sees the normal funnel.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cycleLanguage = () => {
    const codes = languageCodes;
    const next = codes[(codes.indexOf(language) + 1) % codes.length];
    setLanguage(next);
  };

  const acceptCookies = (value) => {
    localStorage.setItem("aura-cookies", value);
    setCookiesDismissed(true);
  };

  const setAnswer = (id, value) => setAnswers((prev) => ({ ...prev, [id]: value }));

  const toggleMulti = (id, value) => {
    setAnswers((prev) => {
      const list = Array.isArray(prev[id]) ? prev[id] : [];
      const has = list.includes(value);
      return { ...prev, [id]: has ? list.filter((v) => v !== value) : [...list, value] };
    });
  };

  const reset = () => {
    if (selfie?.url) URL.revokeObjectURL(selfie.url);
    setStep(STEPS.intro);
    setQuestionIndex(0);
    setAnswers({});
    setSelfie(null);
    setImage(null);
    setReadingId(null);
    setError("");
    setSubscription(null);
    setHistoryOpen(false);
  };

  const value = {
    // static
    locales,
    t,
    language,
    setLanguage,
    cycleLanguage,
    // navigation
    step,
    setStep,
    questionIndex,
    setQuestionIndex,
    // data
    answers,
    setAnswer,
    toggleMulti,
    selfie,
    setSelfie,
    image,
    setImage,
    readingId,
    setReadingId,
    error,
    setError,
    subscription,
    setSubscription,
    selectedPlan,
    setSelectedPlan,
    // features
    saveReading,
    readings,
    removeReading,
    ambient,
    historyOpen,
    setHistoryOpen,
    // cookies
    cookiesDismissed,
    acceptCookies,
    // reset
    reset,
  };

  return <FunnelContext.Provider value={value}>{children}</FunnelContext.Provider>;
}

export function useFunnel() {
  const ctx = useContext(FunnelContext);
  if (!ctx) throw new Error("useFunnel must be used inside FunnelProvider");
  return ctx;
}
