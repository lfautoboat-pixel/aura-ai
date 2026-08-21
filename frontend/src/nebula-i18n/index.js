import en from "./en";
import pl from "./pl";
import es from "./es";
import fr from "./fr";
import de from "./de";

export const locales = { en, pl, es, fr, de };
export const languageCodes = Object.keys(locales);

export function detectLanguage() {
  if (typeof navigator === "undefined") return "en";
  const raw = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  const code = raw.slice(0, 2).toLowerCase();
  return locales[code] ? code : "en";
}

// The shared currency detector (i18n.js detectCurrency) reads navigator's
// REGION independently of which language actually got shown here — a
// visitor whose language isn't one of the five above (Portuguese, Italian,
// Dutch, etc.) falls back to English text, but their region can still map
// to a real currency (BRL, EUR...), pairing English copy with a foreign
// price. Call sites use this to force USD instead whenever that fallback
// happened, so the pairing always matches what's actually on screen.
export function isSupportedNebulaLanguage() {
  if (typeof navigator === "undefined") return true;
  const raw = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  const code = raw.slice(0, 2).toLowerCase();
  return !!locales[code];
}

export function getMessages(code) {
  return locales[code] || locales.en;
}
