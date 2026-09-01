// TikTok Ads Pixel — scoped to the domain the first campaign actually runs
// on. The whole ad → quiz → payment → in-app journey stays on this single
// domain (Stripe's redirect uses window.location.origin, confirmed in
// Monetize.jsx), so loading this anywhere else would only dilute the
// campaign's own conversion data with traffic that was never part of it.
const PIXEL_ID = "DAB0GC3C77UC8FLJEVRG";
const ADS_HOSTNAME = "app-auraai.netlify.app";

function isAdsHost() {
  try {
    return window.location.hostname === ADS_HOSTNAME;
  } catch {
    return false;
  }
}

// Verbatim TikTok loader, adapted only to skip the inline ttq.page() call —
// that's issued separately below, after confirming this is the ads domain.
function installLoader() {
  !(function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    var ttq = (w[t] = w[t] || []);
    ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
    ttq.setAndDefer = function (t, e) {
      t[e] = function () {
        t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) {
      for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
      return e;
    };
    ttq.load = function (e, n) {
      var r = "https://analytics.tiktok.com/i18n/pixel/events.js",
        o = n && n.partner;
      (ttq._i = ttq._i || {}), (ttq._i[e] = []), (ttq._i[e]._u = r), (ttq._t = ttq._t || {}), (ttq._t[e] = +new Date()), (ttq._o = ttq._o || {}), (ttq._o[e] = n || {});
      n = document.createElement("script");
      (n.type = "text/javascript"), (n.async = !0), (n.src = r + "?sdkid=" + e + "&lib=" + t);
      e = document.getElementsByTagName("script")[0];
      e.parentNode.insertBefore(n, e);
    };
  })(window, document, "ttq");
}

// Fires once per page load — call from App.js the same way captureReferral() runs.
export function initTikTokPixel() {
  if (!isAdsHost() || window.ttq) return;
  installLoader();
  window.ttq.load(PIXEL_ID);
  window.ttq.page();
}

// Call only once the backend has independently confirmed payment_status ===
// "paid" (see PaymentResult.jsx) — never on page load alone, so a cancelled
// or expired session can't register as a sale.
//
// eventId should be the Stripe session/intent id — the backend's own
// server-side report of this same purchase (_report_tiktok_purchase in
// server.py) uses that exact id too, so TikTok dedupes the browser and
// server events into one conversion instead of double-counting the sale.
export function trackPurchase({ amount, currency, eventId }) {
  if (!isAdsHost() || !window.ttq) return;
  const payload = {};
  if (typeof amount === "number") payload.value = amount / 100;
  if (currency) payload.currency = currency.toUpperCase();
  window.ttq.track("CompletePayment", payload, eventId ? { event_id: eventId } : undefined);
}

// Fires once when the paywall/pricing screen itself is shown — free to
// trigger just by reaching that screen, no payment involved. Lets the
// ViewContent event go "active" in TikTok's campaign setup without needing
// a real transaction.
export function trackViewContent() {
  if (!isAdsHost() || !window.ttq) return;
  window.ttq.track("ViewContent", { content_type: "product" });
}

// Fires when a specific paid plan/pack is selected — the funnel's own
// "adding this to my order" moment, still free (no payment yet).
export function trackAddToCart({ planId, amount, currency } = {}) {
  if (!isAdsHost() || !window.ttq) return;
  const payload = { content_id: planId };
  if (typeof amount === "number") payload.value = amount / 100;
  if (currency) payload.currency = currency.toUpperCase();
  window.ttq.track("AddToCart", payload);
}

// Fires when the checkout modal opens — still free, no payment yet.
export function trackInitiateCheckout({ planId, amount, currency } = {}) {
  if (!isAdsHost() || !window.ttq) return;
  const payload = { content_id: planId };
  if (typeof amount === "number") payload.value = amount / 100;
  if (currency) payload.currency = currency.toUpperCase();
  window.ttq.track("InitiateCheckout", payload);
}
