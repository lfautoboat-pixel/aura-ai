import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "aura-ambient";

async function safeClose(ctx) {
  if (!ctx) return;
  try {
    if (ctx.state !== "closed") await ctx.close();
  } catch {
    // Expected during rapid on/off toggles when a deferred close races with
    // another close attempt. AudioContext.close() is idempotent conceptually
    // but throws when called twice, so we swallow the race deliberately.
  }
}

/**
 * useAmbient — mystic drone generated with Web Audio API. Fully self-contained,
 * no external audio file, no dependencies. Handles rapid toggles safely by
 * checking AudioContext.state before calling close().
 */
export function useAmbient() {
  const [on, setOn] = useState(() => localStorage.getItem(STORAGE_KEY) === "on");
  const contextRef = useRef(null);

  useEffect(() => {
    if (!on) return undefined; // cleanup of the previous "on" render will stop audio
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return undefined;

    const ctx = new AC();
    contextRef.current = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 2);
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 780;
    filter.Q.value = 3.5;
    filter.connect(master);

    const oscA = ctx.createOscillator();
    oscA.type = "sine";
    oscA.frequency.value = 110;
    oscA.connect(filter);

    const oscB = ctx.createOscillator();
    oscB.type = "sine";
    oscB.frequency.value = 138.6;
    oscB.connect(filter);

    const oscC = ctx.createOscillator();
    oscC.type = "sine";
    oscC.frequency.value = 220;
    const cGain = ctx.createGain();
    cGain.gain.value = 0.35;
    oscC.connect(cGain);
    cGain.connect(filter);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    oscA.start();
    oscB.start();
    oscC.start();
    lfo.start();

    return () => {
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.4);
      } catch {
        // Ramp scheduling may fail if the context is already closing; the
        // safeClose() below still guarantees cleanup, so we intentionally
        // ignore this error path.
      }
      const target = ctx;
      contextRef.current = null;
      setTimeout(() => {
        safeClose(target);
      }, 450);
    };
  }, [on]);

  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      return next;
    });
  }, []);

  return { on, toggle };
}
