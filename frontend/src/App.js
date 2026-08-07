import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { I18nProvider } from "@/i18n";
import { AuthProvider } from "@/store";
import { Toaster } from "sonner";
import Funnel from "@/pages/Funnel";
import AppShell from "@/pages/AppShell";
import Chat from "@/pages/Chat";
import AdvisorProfile from "@/pages/AdvisorProfile";
import Paywall from "@/pages/Paywall";
import Profile from "@/pages/Profile";
import Privacy from "@/pages/Privacy";
import { PaymentSuccess, PaymentCancel } from "@/pages/PaymentResult";

// Empty until GOOGLE_CLIENT_ID is set — GoogleLogin renders nothing/disabled without it (see Funnel.jsx).
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Funnel />} />
      <Route path="/app" element={<Navigate to="/app/guides" replace />} />
      <Route path="/app/chat/:id" element={<Chat />} />
      <Route path="/app/advisor/:id" element={<AdvisorProfile />} />
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
