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

export function getMessages(code) {
  return locales[code] || locales.en;
}
