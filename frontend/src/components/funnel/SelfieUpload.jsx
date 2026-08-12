import { useRef } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ImagePlus, LockKeyhole, Sparkles, X } from "lucide-react";
import { useFunnel, STEPS } from "@/state/FunnelContext";

export function SelfieUpload() {
  const { t, selfie, setSelfie, setStep, error, setError } = useFunnel();
  const fileRef = useRef(null);

  const handlePhoto = (file) => {
    if (!file || !file.type?.startsWith("image/")) return;
    if (selfie?.url) URL.revokeObjectURL(selfie.url);
    setSelfie({ file, url: URL.createObjectURL(file) });
    setError("");
  };

  const clearPhoto = () => {
    if (selfie?.url) URL.revokeObjectURL(selfie.url);
    setSelfie(null);
  };

  return (
    <motion.div className="upload-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="progress-row">
        <button
          className="icon-button"
          data-testid="upload-back-button"
          onClick={() => setStep(STEPS.preSelfie)}
          aria-label={t.quiz.back}
        >
          <ArrowLeft size={17} />
        </button>
        <span data-testid="upload-progress-label">SELFIE</span>
      </div>
      <div className="question-copy">
        <p className="eyebrow">{t.eyebrow}</p>
        <h2 data-testid="selfie-title">{t.selfie.title}</h2>
        <p data-testid="selfie-subtitle">{t.selfie.subtitle}</p>
      </div>
      {selfie ? (
        <div className="photo-preview" data-testid="selfie-preview">
          <img src={selfie.url} alt="Selfie preview" />
          <button
            className="remove-photo"
            data-testid="remove-selfie-button"
            onClick={clearPhoto}
            aria-label={t.selfie.remove}
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          className="dropzone"
          data-testid="selfie-upload-dropzone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handlePhoto(e.dataTransfer.files[0]);
          }}
        >
          <ImagePlus size={27} />
          <strong>{t.selfie.choose}</strong>
          <span>{t.selfie.drop}</span>
          <input
            ref={fileRef}
            data-testid="selfie-file-input"
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => handlePhoto(e.target.files[0])}
          />
        </button>
      )}
      <p className="privacy-note" data-testid="selfie-privacy-note">
        <LockKeyhole size={13} /> {t.selfie.privacy}
      </p>
      {error && (
        <p className="generation-error" data-testid="generation-error">
          {error}
        </p>
      )}
      <button
        className="primary-cta wide"
        data-testid="reveal-sketch-button"
        disabled={!selfie}
        onClick={() => setStep(STEPS.processing)}
      >
        {t.selfie.generate}
        <Sparkles size={16} />
      </button>
      <p className="microcopy" data-testid="consent-copy">
        {t.selfie.consent}
      </p>
    </motion.div>
  );
}
