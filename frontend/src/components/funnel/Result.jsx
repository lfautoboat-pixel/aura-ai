import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Download, Share2, Sparkles } from "lucide-react";
import { useFunnel } from "@/state/FunnelContext";
import { computeCompatibility } from "@/data/compatibility";

async function buildShareCard(imgSrc, traits, labels, signature) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d");
  // background
  const grad = ctx.createRadialGradient(450, 300, 60, 450, 600, 900);
  grad.addColorStop(0, "#211239");
  grad.addColorStop(1, "#06040a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // portrait
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imgSrc;
  await new Promise((r, e) => {
    img.onload = r;
    img.onerror = e;
  });
  ctx.drawImage(img, 90, 90, 720, 720);
  // signature
  ctx.font = "600 42px 'Playfair Display', serif";
  ctx.fillStyle = "#f5f0ff";
  ctx.textAlign = "center";
  ctx.fillText(signature, 450, 890);
  // traits
  ctx.font = "500 22px 'DM Sans', sans-serif";
  ctx.fillStyle = "#bda3ff";
  Object.entries(traits).forEach(([key, value], i) => {
    const x = 130 + (i % 3) * 250;
    const y = 970 + Math.floor(i / 3) * 60;
    ctx.textAlign = "left";
    ctx.fillText(`✦ ${labels[key]}  ${value}%`, x, y);
  });
  // footer
  ctx.font = "500 18px 'DM Sans', sans-serif";
  ctx.fillStyle = "#736b83";
  ctx.textAlign = "center";
  ctx.fillText("aura · soulmate sketch", 450, 1140);
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function Result() {
  const { t, image, answers, saveReading, reset, language } = useFunnel();
  const compatibility = useMemo(() => computeCompatibility(answers), [answers]);
  const [savedNote, setSavedNote] = useState(false);
  const [shareNote, setShareNote] = useState(false);

  useEffect(() => {
    if (!image) return;
    const entry = saveReading({ image, answers, compatibility, language });
    if (entry) setSavedNote(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const download = () => {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image;
    link.download = "aura-soulmate-sketch.png";
    link.click();
  };

  const share = async () => {
    if (!image) return;
    try {
      const blob = await buildShareCard(image, compatibility, t.result.traits, t.result.signature);
      if (blob && navigator.canShare && navigator.canShare({ files: [new File([blob], "aura.png", { type: "image/png" })] })) {
        const file = new File([blob], "aura-soulmate.png", { type: "image/png" });
        await navigator.share({ files: [file], title: t.result.signature, text: t.result.title });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: t.result.signature, text: t.result.title, url: window.location.href });
        return;
      }
      await navigator.clipboard?.writeText(window.location.href);
      setShareNote(true);
      setTimeout(() => setShareNote(false), 2500);
    } catch {
      // navigator.share() rejects when the user cancels the native share
      // sheet — this is normal behaviour, not an error worth surfacing.
    }
  };

  return (
    <motion.div
      className="result-screen"
      data-testid="result-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <p className="eyebrow" data-testid="result-eyebrow">{t.result.eyebrow}</p>
      <h2 data-testid="result-title">{t.result.title}</h2>
      <p data-testid="result-description">{t.result.subtitle}</p>

      <div className="result-art" data-testid="soulmate-sketch-result">
        <div className="sketch-glow" />
        {image && <img src={image} alt="Generated soulmate sketch" />}
        <div className="result-label">
          <Sparkles size={15} /> {t.result.signature}
        </div>
      </div>

      <div className="result-meta" data-testid="result-insight">
        {t.result.meta.map((label) => (
          <span key={label}>✦ {label}</span>
        ))}
      </div>

      <h3 className="paywall-section" data-testid="compatibility-title">{t.result.compatibilityTitle}</h3>
      <div className="compatibility-grid" data-testid="compatibility-grid">
        {Object.entries(compatibility).map(([key, value]) => (
          <div key={key} className="trait" data-testid={`compat-${key}`}>
            <div className="trait-label">
              <span>{t.result.traits[key]}</span>
              <strong>{value}%</strong>
            </div>
            <div className="trait-track">
              <span style={{ width: `${value}%` }} />
            </div>
          </div>
        ))}
      </div>

      {savedNote && (
        <p className="saved-note" data-testid="saved-note">
          <Sparkles size={12} /> {t.result.savedNote}
        </p>
      )}
      {shareNote && (
        <p className="saved-note" data-testid="share-note">
          <Sparkles size={12} /> {t.result.shareCopied}
        </p>
      )}

      <div className="result-actions" data-testid="result-actions">
        <button className="secondary-cta" data-testid="download-result-button" onClick={download}>
          <Download size={15} /> {t.result.download}
        </button>
        <button className="secondary-cta" data-testid="share-result-button" onClick={share}>
          <Share2 size={15} /> {t.result.share}
        </button>
      </div>

      <button className="text-cta" data-testid="restart-reading-button" onClick={reset}>
        {t.result.again}
        <ArrowRight size={16} />
      </button>
    </motion.div>
  );
}
