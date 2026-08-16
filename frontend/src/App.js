import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { I18nProvider } from "@/i18n";
import { AuthProvider } from "@/store";
import { Toaster } from "sonner";
import Funnel from "@/pages/Funnel";
import Nebula from "@/pages/Nebula";
import AppShell from "@/pages/AppShell";
import Chat from "@/pages/Chat";
import AdvisorProfile from "@/pages/AdvisorProfile";
import CourseReader from "@/pages/CourseReader";
import QuizPlay from "@/pages/QuizPlay";
import SoulmateReading from "@/pages/SoulmateReading";
import Paywall from "@/pages/Paywall";
import Profile from "@/pages/Profile";
import Privacy from "@/pages/Privacy";
import { PaymentSuccess, PaymentCancel } from "@/pages/PaymentResult";

// Empty until GOOGLE_CLIENT_ID is set — GoogleLogin renders nothing/disabled without it (see Funnel.jsx).
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

// Same codebase, same backend, deployed as two separate Netlify sites that
// only differ by which funnel greets a first-time visitor at "/" — one site
// is the official bio link (legacy quiz->advisor funnel), the other is the
// ads-only entry (Nebula soulmate-sketch funnel). Both funnels stay reachable
// on every deploy either way, just at different paths, so nothing is ever
// truly "only" on one site.
const ENTRY_FUNNEL = process.env.REACT_APP_ENTRY_FUNNEL || "nebula";

function AppRouter() {
  return (
    <Routes>
      {ENTRY_FUNNEL === "legacy" ? (
        <>
          <Route path="/" element={<Funnel />} />
          <Route path="/soulmate" element={<Nebula />} />
        </>
      ) : (
        <>
          <Route path="/" element={<Nebula />} />
          {/* Previous entry funnel — preserved intact for A/B testing, per rule 2.1
              of the studio manual (never delete a validated flow, just relocate it). */}
          <Route path="/legacy" element={<Funnel />} />
        </>
      )}
      <Route path="/app" element={<Navigate to="/app/guides" replace />} />
      <Route path="/app/chat/:id" element={<Chat />} />
      <Route path="/app/advisor/:id" element={<AdvisorProfile />} />
      <Route path="/app/course/:id" element={<CourseReader />} />
      <Route path="/app/quiz/:id" element={<QuizPlay />} />
      <Route path="/app/soulmate" element={<SoulmateReading />} />
      <Route path="/app/:tab" element={<AppShell />} />
      <Route path="/app/recharge" element={<Paywall />} />
      <Route path="/app/profile" element={<Profile />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/payment/success" element={<PaymentSuccess />} />
      <Route path="/payment/cancel" element={<PaymentCancel />} />
    </Routes>
  );
}

function MaybeGoogleProvider({ children }) {
  // Renders children unwrapped until a real GOOGLE_CLIENT_ID is configured,
  // so the app never depends on Google Sign-In to boot.
  if (!GOOGLE_CLIENT_ID) return children;
  return <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{children}</GoogleOAuthProvider>;
}

function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <MaybeGoogleProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
          <Toaster position="top-center" theme="dark" />
        </MaybeGoogleProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

export default App;
