import React, { useMemo } from "react";

export const Logo = ({ size = 26, light = false }) => (
  <div className="flex items-center gap-2 select-none" data-testid="aura-logo">
    <span className="relative inline-flex items-center justify-center" style={{ width: size + 6, height: size + 6 }}>
      <span className="spin-slow absolute inset-0 rounded-full"
        style={{ background: "conic-gradient(from 0deg,#e7c46a,#ff8fb1,#8a5cff,#e7c46a)", opacity: 0.9 }} />
      <span className="absolute rounded-full"
        style={{ inset: 3, background: light ? "#fff" : "#0b0718" }} />
      <span className="absolute rounded-full floaty"
        style={{ width: size * 0.34, height: size * 0.34, background: "radial-gradient(circle,#fff,#e7c46a)" }} />
    </span>
    <span className="font-display leading-none" style={{ fontSize: size, color: light ? "#241b45" : "#f4f1ff" }}>
      Aura<span className="grad-text"> AI</span>
    </span>
  </div>
);

export const Starfield = ({ count = 60 }) => {
  const stars = useMemo(
    () => Array.from({ length: count }).map(() => ({
      top: Math.random() * 100, left: Math.random() * 100,
      size: Math.random() * 2 + 0.5, delay: Math.random() * 3,
    })), [count]
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {stars.map((s, i) => (
        <span key={i} className="star" style={{
          top: `${s.top}%`, left: `${s.left}%`, width: s.size, height: s.size,
          animationDelay: `${s.delay}s`,
        }} />
      ))}
    </div>
  );
};

export const SIGN_GLYPH = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋", Leo: "♌", Virgo: "♍",
  Libra: "♎", Scorpio: "♏", Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
};
