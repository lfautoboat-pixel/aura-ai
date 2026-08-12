import { useFunnel } from "@/state/FunnelContext";

export function CookieBanner() {
  const { t, cookiesDismissed, acceptCookies } = useFunnel();
  if (cookiesDismissed) return null;
  return (
    <div className="cookie-banner" data-testid="cookie-banner">
      <p data-testid="cookie-copy">{t.cookies.text}</p>
      <button data-testid="cookie-reject-button" onClick={() => acceptCookies("rejected")}>
        {t.cookies.reject}
      </button>
      <button data-testid="cookie-accept-button" onClick={() => acceptCookies("accepted")}>
        {t.cookies.accept}
      </button>
    </div>
  );
}
