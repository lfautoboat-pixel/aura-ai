import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "@/i18n";
import { AuthProvider } from "@/store";
import { Toaster } from "sonner";
import Funnel from "@/pages/Funnel";
import AppShell from "@/pages/AppShell";
import Chat from "@/pages/Chat";
import Paywall from "@/pages/Paywall";
import { PaymentSuccess, PaymentCancel } from "@/pages/PaymentResult";

function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Funnel />} />
            <Route path="/app" element={<AppShell />} />
            <Route path="/app/chat/:id" element={<Chat />} />
            <Route path="/app/recharge" element={<Paywall />} />
            <Route path="/payment/success" element={<PaymentSuccess />} />
            <Route path="/payment/cancel" element={<PaymentCancel />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" theme="dark" />
      </AuthProvider>
    </I18nProvider>
  );
}

export default App;
