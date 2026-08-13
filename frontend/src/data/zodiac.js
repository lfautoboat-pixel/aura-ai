// Mirrors the exact cutoff table already used server-side (backend/server.py
// get_zodiac) so the client-side reveal always agrees with any future
// server-side use of the same birth date — one source of truth, ported not
// reinvented (see studio rule 2.8).
const ZODIAC_CUTOFFS = [
  [120, "capricorn"], [218, "aquarius"], [320, "pisces"], [420, "aries"], [521, "taurus"],
  [621, "gemini"], [722, "cancer"], [823, "leo"], [923, "virgo"], [1023, "libra"],
  [1122, "scorpio"], [1222, "sagittarius"], [1231, "capricorn"],
];

export function getZodiacKey(month, day) {
  const md = month * 100 + day;
  for (const [cut, sign] of ZODIAC_CUTOFFS) {
    if (md <= cut) return sign;
  }
  return "capricorn";
}

export function zodiacFromISODate(iso) {
  if (!iso) return null;
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return null;
  return getZodiacKey(m, d);
}
