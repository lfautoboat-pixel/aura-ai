import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Crown, LogOut, Globe, Shield, FileText, Star, Bell, BellOff } from "lucide-react";
import api from "../api";
import { useI18n, LANGS } from "../i18n";
import { useAuth } from "../store";
import { Starfield, SIGN_GLYPH } from "../components/Cosmic";

const LANG_LABEL = { en: "English", es: "Español", pt: "Português", hi: "हिन्दी", de: "Deutsch", fr: "Français", it: "Italiano" };

const pushSupported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

// applicationServerKey must be a Uint8Array, not the raw base64url string.
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function useNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(!!sub))
      .catch(() => {});
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return false;
      const { data } = await api.get("/push/public-key");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });
      await api.post("/push/subscribe", sub.toJSON());
      setEnabled(true);
      return true;
    } catch (e) {
      console.error("Push subscribe failed", e);
      return false;
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post("/push/unsubscribe", sub.toJSON()).catch(() => {});
        await sub.unsubscribe();
      }
      setEnabled(false);
    } finally { setBusy(false); }
  };

  return { supported: pushSupported, enabled, busy, enable, disable };
}

export default function Profile() {
  const nav = useNavigate();
  const { t, lang, setLang, money } = useI18n();
  const { user, loading, logout } = useAuth();
  const [history, setHistory] = useState([]);
  const push = useNotifications();
  const [testSent, setTestSent] = useState(false);

  useEffect(() => { api.get("/payments/history").then((r) => setHistory(r.data.purchases || [])); }, []);
  // `user` starts null while /auth/me is still in flight on a fresh load —
  // redirecting on that alone bounces an already-logged-in visitor who
  // landed here directly (refresh, bookmark, deep link) straight back out,
  // through "/" and its own redirect chain, to /app/guides. Wait for the
  // auth check to actually finish before deciding no one's logged in.
  useEffect(() => { if (!loading && !user) nav("/"); }, [loading, user, nav]);

  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return ""; } };

  const sendTestPush = async () => {
    try {
      await api.post("/push/test");
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (e) { /* subscription may have just expired — user can retry */ }
  };

  return (
    <div className="app-frame cosmic-bg min-h-screen relative">
      <Starfield count={40} />
      <div className="relative z-10 p-5 pb-16">
        <button onClick={() => nav("/app")} data-testid="profile-back" className="mb-4"><ChevronLeft /></button>

        <div className="flex flex-col items-center text-center">
          {user?.picture ? (
            <img src={user.picture} alt="" className="w-20 h-20 rounded-full object-cover" />
          ) : (
            <div className="w-20 h-20 rounded-full grad-btn grid place-items-center text-3xl">{SIGN_GLYPH[user?.zodiac] || "✦"}</div>
          )}
          <h1 className="font-display text-2xl mt-3">{user?.name}</h1>
          <p className="text-white/50 text-sm">{user?.email}</p>
          <div className={`mt-3 rounded-full px-4 py-1.5 text-xs font-bold flex items-center gap-1 ${user?.premium ? "grad-btn text-white" : "glass"}`}>
            <Crown size={13} /> {user?.premium ? t("premium_active") : t("free_plan")}
          </div>
        </div>

        {!user?.premium && (
          <button onClick={() => nav("/app/recharge")} data-testid="profile-upgrade" className="w-full grad-btn text-white font-bold py-3.5 rounded-2xl mt-6">
            {t("subscribe")} — {t("premium_title")}
          </button>
        )}

        {/* Purchase history */}
        <h2 className="font-display text-lg mt-8 mb-3">{t("purchase_history")}</h2>
        <div className="glass rounded-2xl divide-y divide-white/5" data-testid="purchase-history">
          {history.length === 0 && <div className="p-4 text-white/45 text-sm">{t("no_purchases")}</div>}
          {history.map((h, i) => (
            <div key={i} className="p-4 flex items-center justify-between">
              <div><div className="text-sm font-semibold">{h.label}</div><div className="text-[11px] text-white/40">{fmtDate(h.date)}</div></div>
              <div className="font-display">{money(h.amount, h.currency)}</div>
            </div>
          ))}
        </div>

        {/* Language */}
        <h2 className="font-display text-lg mt-8 mb-3 flex items-center gap-2"><Globe size={16} /> {t("language")}</h2>
        <div className="flex flex-wrap gap-2">
          {LANGS.map((l) => (
            <button key={l} onClick={() => setLang(l)} data-testid={`lang-${l}`}
              className={`px-3 py-2 rounded-xl text-sm ${lang === l ? "grad-btn text-white" : "glass"}`}>{LANG_LABEL[l]}</button>
          ))}
        </div>

        {/* Notifications */}
        {push.supported && (
          <div className="mt-8">
            <h2 className="font-display text-lg mb-3 flex items-center gap-2"><Bell size={16} /> {t("notifications")}</h2>
            <div className="glass rounded-2xl p-4 flex items-center justify-between gap-3" data-testid="notifications-card">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{push.enabled ? t("notifications_on") : t("notifications_off")}</div>
                <div className="text-xs text-white/50 mt-0.5">{t("notifications_desc")}</div>
              </div>
              <button
                onClick={() => (push.enabled ? push.disable() : push.enable())}
                disabled={push.busy}
                data-testid="notifications-toggle"
                className={`shrink-0 rounded-full p-2.5 disabled:opacity-40 ${push.enabled ? "grad-btn text-white" : "glass text-white/60"}`}>
                {push.enabled ? <Bell size={16} /> : <BellOff size={16} />}
              </button>
            </div>
            {push.enabled && (
              <button onClick={sendTestPush} data-testid="notifications-test" className="text-xs text-white/50 mt-2 underline">
                {testSent ? t("notifications_test_sent") : t("notifications_test")}
              </button>
            )}
          </div>
        )}

        {/* Legal */}
        <div className="mt-8 space-y-2">
          <button onClick={() => nav("/privacy")} className="w-full glass rounded-2xl p-4 flex items-center gap-3 text-sm"><Shield size={16} className="text-[#b79cff]" /> {t("privacy")}</button>
          <button onClick={() => nav("/privacy")} className="w-full glass rounded-2xl p-4 flex items-center gap-3 text-sm"><FileText size={16} className="text-[#b79cff]" /> {t("terms")}</button>
        </div>

        <button onClick={() => { logout(); nav("/"); }} data-testid="profile-logout" className="w-full mt-6 flex items-center justify-center gap-2 text-rose-300 font-semibold py-3">
          <LogOut size={16} /> {t("logout")}
        </button>
      </div>
    </div>
  );
}
