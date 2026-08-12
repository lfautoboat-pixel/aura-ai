import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";
import { generateSoulmateSketch } from "@/services/sketchApi";

export function Processing() {
  const { t, selfie, answers, language, setImage, setReadingId, setError, setStep } = useFunnel();
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setStageIndex((i) => Math.min(i + 1, t.processing.stages.length - 1)), 1400);
    return () => clearInterval(tick);
  }, [t.processing.stages.length]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const started = Date.now();
        const { image, readingId } = await generateSoulmateSketch({
          selfie: selfie?.file || null,
          answers,
          language,
        });
        // ensure a minimum theatrical delay so the reveal feels intentional
        const wait = Math.max(0, 3200 - (Date.now() - started));
        await new Promise((r) => setTimeout(r, wait));
        if (cancelled) return;
        setImage(image);
        setReadingId(readingId);
        setStep(STEPS.paywall);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || t.selfie.error);
        setStep(selfie ? STEPS.selfie : STEPS.preSelfie);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="processing" data-testid="processing-overlay">
      <div className="processing-ring">
        <LoaderCircle size={29} />
      </div>
      <p data-testid="processing-status">{t.processing.title}</p>
      <span data-testid="processing-caption">{t.processing.stages[stageIndex]}</span>
    </div>
  );
}
