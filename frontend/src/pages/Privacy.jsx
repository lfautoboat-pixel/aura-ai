import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Shield } from "lucide-react";
import { Logo } from "../components/Cosmic";

export default function Privacy() {
  const nav = useNavigate();
  return (
    <div className="app-frame cosmic-bg min-h-screen relative">
      <div className="relative z-10 p-5 pb-16">
        <button onClick={() => nav(-1)} className="mb-4" data-testid="privacy-back"><ChevronLeft /></button>
        <Logo size={22} />
        <div className="flex items-center gap-2 mt-6"><Shield className="text-[#b79cff]" /><h1 className="font-display text-2xl">Privacy & Terms</h1></div>
        <p className="text-white/50 text-xs mt-1">GDPR & LGPD compliant · Last updated June 2026</p>

        <div className="mt-6 space-y-5 text-sm text-white/75 leading-relaxed">
          <section>
            <h2 className="font-semibold text-white mb-1">1. Data we collect</h2>
            <p>We collect your email, quiz answers (gender, focus area, birth date used only to compute your zodiac) and chat messages, strictly to personalize your spiritual guidance. We never sell your data.</p>
          </section>
          <section>
            <h2 className="font-semibold text-white mb-1">2. Legal basis (GDPR / LGPD)</h2>
            <p>Processing is based on your explicit consent, given when you continue past onboarding. You may withdraw consent at any time by deleting your account, which erases your personal data.</p>
          </section>
          <section>
            <h2 className="font-semibold text-white mb-1">3. Payments</h2>
            <p>Payments are processed by Stripe. We never store your full card or Pix details on our servers. Only a transaction reference and amount are kept for your purchase history.</p>
          </section>
          <section>
            <h2 className="font-semibold text-white mb-1">4. Your rights</h2>
            <p>You have the right to access, correct, export and delete your personal data. Contact privacy@aura-ai.app to exercise these rights.</p>
          </section>
          <section>
            <h2 className="font-semibold text-white mb-1">5. Entertainment notice</h2>
            <p>Aura AI provides spiritual and astrological guidance for entertainment and self-reflection purposes and is not a substitute for professional medical, legal or financial advice.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
