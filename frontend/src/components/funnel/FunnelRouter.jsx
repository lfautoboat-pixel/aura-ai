import { useFunnel, STEPS } from "@/state/FunnelContext";
import { Intro } from "./Intro";
import { SocialProof } from "./SocialProof";
import { Question } from "./Question";
import { PreSelfieChoice } from "./PreSelfieChoice";
import { SelfieUpload } from "./SelfieUpload";
import { Processing } from "./Processing";
import { Paywall } from "./Paywall";
import { CheckoutModal } from "./CheckoutModal";
import { Result } from "./Result";

export function FunnelRouter() {
  const { step } = useFunnel();
  return (
    <section className="journey" data-testid="journey-panel">
      {step === STEPS.intro && <Intro />}
      {step === STEPS.social && <SocialProof />}
      {step === STEPS.quiz && <Question />}
      {step === STEPS.preSelfie && <PreSelfieChoice />}
      {step === STEPS.selfie && <SelfieUpload />}
      {step === STEPS.processing && <Processing />}
      {(step === STEPS.paywall || step === STEPS.checkout) && <Paywall />}
      {step === STEPS.checkout && <CheckoutModal />}
      {step === STEPS.result && <Result />}
    </section>
  );
}
