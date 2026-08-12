// Compute a lightweight compatibility signature from the user's answers so the
// result screen can render meaningful traits instead of generic labels.

const QUALITY_MAP = {
  Kind: { warmth: 8, protection: 4 },
  Supportive: { warmth: 6, protection: 5 },
  Honest: { stability: 6, protection: 3 },
  Optimistic: { curiosity: 5, warmth: 4 },
  Loyal: { stability: 8, protection: 4 },
  Caring: { warmth: 7, protection: 5 },
  Confident: { passion: 6, stability: 3 },
  Passionate: { passion: 9 },
  Funny: { curiosity: 6, warmth: 4 },
  Protective: { protection: 9, stability: 3 },
};

const ENERGY_MAP = {
  "Affectionate and loving": { warmth: 8 },
  "Calm and grounded": { stability: 8 },
  "Playful and lighthearted": { curiosity: 7 },
  "Fun and adventurous": { curiosity: 9, passion: 4 },
  "Balanced and supportive": { stability: 6, warmth: 4 },
  "Passionate and inspiring": { passion: 9, curiosity: 3 },
};

const LOVE_LANGUAGE_MAP = {
  "Verbal appreciation": { warmth: 5 },
  Presents: { passion: 3, warmth: 2 },
  "Shared activities": { curiosity: 6 },
  Tactility: { passion: 7 },
  "Helpful gestures": { protection: 6, stability: 3 },
};

function seed(base) {
  return { warmth: base, curiosity: base, protection: base, passion: base, stability: base };
}

function add(target, delta) {
  for (const key of Object.keys(delta)) {
    target[key] = (target[key] || 0) + delta[key];
  }
}

function clamp(v) {
  return Math.max(20, Math.min(98, Math.round(v)));
}

export function computeCompatibility(answers) {
  const scores = seed(45);
  const qualities = Array.isArray(answers.q6) ? answers.q6 : [];
  qualities.forEach((q) => QUALITY_MAP[q] && add(scores, QUALITY_MAP[q]));
  const energies = Array.isArray(answers.q13) ? answers.q13 : [];
  energies.forEach((q) => ENERGY_MAP[q] && add(scores, ENERGY_MAP[q]));
  if (LOVE_LANGUAGE_MAP[answers.q11]) add(scores, LOVE_LANGUAGE_MAP[answers.q11]);
  if (answers.q7 === "Personality matters more") add(scores, { stability: 4, warmth: 3 });
  if (answers.q8 === "Emotions") add(scores, { warmth: 4, passion: 3 });
  if (answers.q8 === "Logic") add(scores, { stability: 5, protection: 2 });
  if (answers.q14 && String(answers.q14).includes("Agree")) add(scores, { curiosity: 4, passion: 2 });
  return {
    warmth: clamp(scores.warmth),
    curiosity: clamp(scores.curiosity),
    protection: clamp(scores.protection),
    passion: clamp(scores.passion),
    stability: clamp(scores.stability),
  };
}
