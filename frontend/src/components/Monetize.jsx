import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Crown, Zap, X, Coins } from "lucide-react";
import { Elements, ExpressCheckoutElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import api from "../api";
import { stripePromise } from "../lib/stripe";
import { useI18n } from "../i18n";

export function useCountdown(seconds = 900) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const id = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);
  const m = String(Math.floor(left / 60)).padStart(2, "0");
  const s = String(left % 60).padStart(2, "0");
  return { label: `${m}:${s}`, left };
}

async function startCheckout(item_key, currency, setBusy) {
  setBusy && setBusy(item_key);
  try {
    const { data } = await api.post("/payments/checkout", {
      item_key, currency, origin_url: window.location.origin,
    });
    window.location.href = data.checkout_url;
  } catch (e) { setBusy && setBusy(""); }
}
export { startCheckout };

/* Apple Pay / Google Pay / Link — one-tap buy for the recommended credit pack.
   Renders nothing if no wallet is available on the device/browser (Stripe's
   own graceful-degradation behavior) or if Stripe isn't configured yet. */
function ExpressButtons({ itemKey, currency }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);

  const onConfirm = async () => {
    try {
      const submit = await elements.submit();
      if (submit.error) return;
      const { data } = await api.post("/payments/create-intent", { item_key: itemKey, currency });
      const { error } = await stripe.confirmPayment({
        elements, clientSecret: data.client_secret,
        confirmParams: { return_url: `${window.location.origin}/payment/success` },
      });
      if (error) toast.error(error.message || "Payment failed");
    } catch {
      toast.error("Could not start express checkout");
    }
  };

  return (
    <div className={ready ? "mb-4" : "h-0 overflow-hidden"}>
      <ExpressCheckoutElement
        onConfirm={onConfirm}
        onReady={({ availablePaymentMethods }) => setReady(!!availablePaymentMethods)}
        options={{ buttonHeight: 48 }}
      />
    </div>
  );
}

export function ExpressCheckout({ itemKey, currency, amount }) {
  if (!stripePromise || !amount) return null;
  return (
    <Elements stripe={stripePromise} options={{ mode: "payment", amount, currency, appearance: { theme: "night" } }}>
      <ExpressButtons itemKey={itemKey} currency={currency} />
    </Elements>
  );
}

/* Elegant bottom sheet used for locked content & strategic premium popups */
export function UnlockSheet({ open, onClose, variant = "unlock" }) {
  const { t, currency } = useI18n();
  const [busy, setBusy] = useState("");
  const { label } = useCountdown(600);
  const isFlash = variant === "flash";
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose} className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end justify-center" data-testid="unlock-sheet">
          <motion.div initial={{ y: 340 }} animate={{ y: 0 }} exit={{ y: 340 }} transition={{ type: "spring", damping: 26 }}
            onClick={(e) => e.stopPropagation()} className="w-full max-w-[480px] cosmic-bg rounded-t-3xl p-6 border-t border-white/10 relative">
            <button onClick={onClose} className="absolute top-4 right-4 text-white/50" data-testid="unlock-close"><X size={20} /></button>
            <div className="w-16 h-16 rounded-full grad-btn grid place-items-center mx-auto floaty">
              {isFlash ? <Zap className="text-white" /> : <Crown className="text-white" />}
            </div>
            <h2 className="font-display text-2xl text-center mt-4">{isFlash ? t("flash_title") : t("unlock_title")}</h2>
            <p className="text-white/60 text-sm text-center mt-2 px-4">{isFlash ? t("flash_sub") : t("unlock_sub")}</p>
            {isFlash && (
              <div className="text-center mt-3 text-[#e7c46a] font-bold text-sm">{t("flash_ends")} <span className="font-display">{label}</span></div>
            )}
            <div className="mt-5 space-y-3">
              {isFlash ? (
                <button data-testid="flash-buy" disabled={!!busy} onClick={() => startCheckout("flash_160", currency, setBusy)}
                  className="w-full grad-btn text-white font-bold py-4 rounded-2xl">{t("flash_cta")}</button>
              ) : (
                <button data-testid="unlock-premium" disabled={!!busy} onClick={() => startCheckout("premium_annual", currency, setBusy)}
                  className="w-full grad-btn text-white font-bold py-4 rounded-2xl">{t("unlock_cta")}</button>
              )}
              <button onClick={onClose} className="w-full text-white/50 text-sm py-2">{t("maybe_later")}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
