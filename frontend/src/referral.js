import api from "@/api";

const KEY = "aura_ref";

// First-touch attribution: capture ?ref= exactly once, on whichever page a
// visitor lands on first (bio link, ad, direct share of /app/soulmate,
// anything) — a later visit without the param, or with a different one,
// must never overwrite an existing credited partner.
export function captureReferral() {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref && !localStorage.getItem(KEY)) {
      localStorage.setItem(KEY, ref);
      api.post("/partners/track", { code: ref }).catch(() => {});
    }
  } catch {
    // localStorage can throw in private-browsing/blocked-storage contexts —
    // losing attribution silently beats crashing the funnel over it.
  }
}

export function getReferral() {
  try {
    return localStorage.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
}
