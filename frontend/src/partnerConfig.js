// Single source of truth for the link every partner sends to their own
// audience. Always the OFFICIAL bio-link site (legacy quiz->advisor funnel,
// the one meant for organic/social reach) — never the ads-only
// app-auraai.netlify.app entry, which is reserved for paid traffic. Update
// this one constant if the official domain ever changes.
export const PARTNER_SITE_URL = "https://aura-guidance.netlify.app";

export function referralLink(code) {
  return `${PARTNER_SITE_URL}/?ref=${encodeURIComponent(code)}`;
}
