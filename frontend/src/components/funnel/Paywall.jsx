import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Lock, ShieldCheck, Sparkles, Star } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";
import { useI18n } from "@/i18n";
import { isSupportedNebulaLanguage } from "@/nebula-i18n";
import { planIds } from "@/data/plans";
import api from "@/api";
import { trackViewContent, trackAddToCart } from "@/tiktokPixel";

const INITIAL_SECONDS = 9 * 60 + 59;

export function Paywall() {
  const { t, image, setStep, selectedPlan, setSelectedPlan } = useFunnel();
  const { currency: regionCurrency, money } = useI18n();
  // The shared currency detector goes off browser region alone — a visitor
  // whose language isn't one Nebula actually supports already sees English
  // copy (nebula-i18n's fallback), so pricing has to fall back to USD with
  // it. Otherwise a Portuguese-region visitor gets English text next to a
  // Brazilian Real price, which is confusing at the exact moment someone
  // needs to trust the number they're about to pay.
  const currency = isSupportedNebulaLanguage() ? regionCurrency : "usd";
  const planId = selectedPlan;
  const setPlanId = setSelectedPlan;
  const [seconds, setSeconds] = useState(INITIAL_SECONDS);
  // Real, live prices per currency — same catalog the rest of the app's
  // paywall already uses. Never a hardcoded price (rule 2.1).
  const [plans, setPlans] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  // Reaching this screen at all is the "viewing the product" moment —
  // free to fire, no payment involved.
  useEffect(() => { trackViewContent(); }, []);

  useEffect(() => {
    api.get(`/billing/packs?currency=${currency}`).then(({ data }) => {
      const byKey = Object.fromEntries((data.sub_plans || []).map((p) => [p.item_key, p]));
      setPlans(byKey);
    });
  }, [currency]);

  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  const clockText = `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;

  return (
    <motion.div
      className="paywall-screen"
      data-testid="paywall-screen"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="paywall-timer" data-testid="paywall-timer">
        <span className="paywall-timer-label">{t.paywall.timerLabel}</span>
        <span className="paywall-timer-clock" data-testid="paywall-timer-clock">{clockText}</span>
      </div>

      <p className="eyebrow" data-testid="paywall-eyebrow">{t.paywall.eyebrow}</p>
      <h2 data-testid="paywall-title">{t.paywall.title}</h2>
      <p className="paywall-lede" data-testid="paywall-subtitle">{t.paywall.subtitle}</p>

      <div className="paywall-preview" data-testid="paywall-preview">
        <div className="paywall-preview-frame">
          {image && <img src={image} alt="Locked soulmate preview" />}
          <div className="paywall-preview-lock" data-testid="paywall-preview-lock">
            <Lock size={19} />
            <span>{t.paywall.lockedPreviewLabel}</span>
          </div>
        </div>
      </div>

      <div className="paywall-urgency" data-testid="paywall-urgency">
        {t.paywall.urgency.replace("{time}", clockText)}
      </div>

      <h3 className="paywall-section" data-testid="paywall-plans-title">{t.paywall.plansTitle}</h3>
      <div className="paywall-plans">
        {planIds.map((id) => {
          const plan = plans?.[id];
          const active = planId === id;
          const badge = id === "premium_annual" ? t.paywall.bestBadge : plan?.trial ? t.paywall.trialBadge : null;
          return (
            <button
              key={id}
              type="button"
              className={`plan-card ${active ? "active" : ""}`}
              data-testid={`plan-card-${id}`}
              onClick={() => {
                setPlanId(id);
                // Only once per plan actually has a real price loaded —
                // never fire with an undefined amount while packs are
                // still loading.
                if (plan) trackAddToCart({ planId: id, amount: plan.amount, currency });
              }}
              disabled={!plan}
            >
              {badge && <span className="plan-tag" data-testid={`plan-tag-${id}`}>{badge}</span>}
              <div className="plan-body">
                <div className="plan-name">{t.paywall.planNames[id]}</div>
                <div className="plan-prices">
                  <span className="plan-now">{plan ? money(plan.amount, currency) : "…"}</span>
                </div>
                <div className="plan-per">/{plan?.interval === "year" ? "yr" : "wk"}</div>
              </div>
              <span className="plan-radio" aria-hidden="true">
                {active ? <Check size={14} /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <h3 className="paywall-section" data-testid="paywall-benefits-title">{t.paywall.benefitsTitle}</h3>
      <ul className="paywall-benefits" data-testid="paywall-benefits">
        {t.paywall.benefits.map((benefit, index) => (
          <li key={benefit} data-testid={`paywall-benefit-${index}`}>
            <Sparkles size={14} /> {benefit}
          </li>
        ))}
      </ul>

      <div className="paywall-testimonial" data-testid="paywall-testimonial">
        <Star size={13} />
        <p>{t.paywall.testimonial.quote}</p>
        <strong>{t.paywall.testimonial.author}</strong>
      </div>

      <button
        className="primary-cta wide"
        data-testid="paywall-cta-button"
        disabled={!plans}
        onClick={() => setStep(STEPS.checkout)}
      >
        {t.paywall.cta}
      </button>
      <p className="paywall-guarantee" data-testid="paywall-guarantee">
        <ShieldCheck size={13} /> {t.paywall.guarantee}
      </p>
      <p className="microcopy" data-testid="paywall-security">{t.paywall.security}</p>
    </motion.div>
  );
}
