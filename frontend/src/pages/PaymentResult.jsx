import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import api from "../api";
import { useAuth } from "../store";
import { Starfield } from "../components/Cosmic";
import { trackPurchase } from "../tiktokPixel";

// Matches the routing choice in App.js: on the "legacy" entry deploy, Nebula
// lives at /soulmate instead of /, so the post-payment redirect back into it
// has to agree with wherever this deploy actually mounted it.
const NEBULA_PATH = (process.env.REACT_APP_ENTRY_FUNNEL || "nebula") === "legacy" ? "/soulmate" : "/";

export function PaymentSuccess() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [status, setStatus] = useState("checking");
  const sid = params.get("session_id");

  useEffect(() => {
    if (!sid) { setStatus("error"); return; }
    let tries = 0;
    const poll = async () => {
      tries += 1;
      try {
        const { data } = await api.get(`/payments/status/${sid}`);
        if (data.payment_status === "paid") {
          // Fires only here — after the backend has independently checked
          // Stripe itself, not just because this URL was visited. A
          // cancelled/expired session, or someone guessing a URL, never
          // reaches this branch.
          trackPurchase({ amount: data.amount, currency: data.currency });
          await refresh();
          // Nebula funnel checkout (see CheckoutModal.jsx) stashes the reading
          // before redirecting here — send those users back into the funnel's
          // own Result step instead of the generic "you're all set" screen.
          if (localStorage.getItem("nebula_pending_reading")) {
            nav(`${NEBULA_PATH}?revealed=1`, { replace: true });
            return;
          }
          setStatus("paid");
          return;
        }
        if (["expired", "failed"].includes(data.payment_status) || tries > 8) { setStatus("error"); return; }
      } catch { if (tries > 8) { setStatus("error"); return; } }
      setTimeout(poll, 1800);
    };
    poll();
  }, [sid, refresh, nav]);

  return (
    <div className="app-frame cosmic-bg min-h-screen relative grid place-items-center">
      <Starfield count={40} />
      <div className="relative z-10 text-center px-8">
        {status === "checking" && (<><Loader2 className="mx-auto animate-spin text-[#b79cff]" size={48} /><p className="mt-4 text-white/70">Confirming your payment…</p></>)}
        {status === "paid" && (<>
          <CheckCircle2 className="mx-auto text-emerald-400 floaty" size={64} />
          <h1 className="font-display text-3xl mt-4">You're all set</h1>
          <p className="text-white/60 mt-2">Your cosmic balance has been recharged.</p>
          <button onClick={() => nav("/app")} className="grad-btn text-white font-bold px-8 py-3 rounded-2xl mt-6" data-testid="success-continue">Continue</button>
        </>)}
        {status === "error" && (<>
          <XCircle className="mx-auto text-rose-400" size={56} />
          <p className="mt-4 text-white/70">We couldn't confirm this payment.</p>
          <button onClick={() => nav("/app/recharge")} className="glass px-6 py-3 rounded-2xl mt-5">Try again</button>
        </>)}
      </div>
    </div>
  );
}

export function PaymentCancel() {
  const nav = useNavigate();
  return (
    <div className="app-frame cosmic-bg min-h-screen relative grid place-items-center">
      <Starfield count={30} />
      <div className="relative z-10 text-center px-8">
        <XCircle className="mx-auto text-white/50" size={56} />
        <h1 className="font-display text-2xl mt-4">Payment cancelled</h1>
        <button onClick={() => nav("/app/recharge")} className="grad-btn text-white font-bold px-8 py-3 rounded-2xl mt-6">Back to plans</button>
      </div>
    </div>
  );
}
