// Central quiz schema. Each question references a translation key on the locale (t.quiz[id]).
// `skipIf(answers)` returns true to skip the question, enabling conditional branching that
// mirrors AppNebula's non-linear funnel.

export const questionIds = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12", "q13", "q14", "q15"];

export const questionTypes = {
  q5: "date",
  q6: "multi",
  q12: "multi",
  q13: "multi",
  q14: "scale",
};

// Purely visual — how each question's options are rendered. Never changes
// order, branching or scoring (data/compatibility.js), only presentation,
// so the funnel's validated conversion skeleton stays untouched.
export const LAYOUTS = {
  q1: "list", q2: "list", q3: "grid-icon", q4: "grid-icon", q5: "date",
  q6: "chips", q7: "list", q8: "list", q9: "grid-icon", q10: "grid-icon",
  q11: "list", q12: "chips", q13: "chips", q14: "scale", q15: "list",
};

// Branching rules — if answers exclude a question, we skip it dynamically.
export const branching = {
  q4: (answers) => answers.q2 === "no_pref",
};

// Answer normalisation: map i18n option strings back to a language-agnostic key
// (only needed for questions used by branching rules).
export function normaliseAnswer(id, value, options) {
  if (id === "q2") {
    const idx = options.indexOf(value);
    return ["female", "male", "no_pref"][idx] ?? value;
  }
  return value;
}

export function nextQuestionIndex(current, answers) {
  for (let i = current + 1; i < questionIds.length; i++) {
    const id = questionIds[i];
    const skip = branching[id];
    if (skip && skip(answers)) continue;
    return i;
  }
  return questionIds.length; // past last question
}

export function previousQuestionIndex(current, answers) {
  for (let i = current - 1; i >= 0; i--) {
    const id = questionIds[i];
    const skip = branching[id];
    if (skip && skip(answers)) continue;
    return i;
  }
  return -1;
}

export function totalActiveQuestions(answers) {
  return questionIds.filter((id) => !(branching[id] && branching[id](answers))).length;
}

export function positionOf(current, answers) {
  let position = 0;
  for (let i = 0; i <= current; i++) {
    const id = questionIds[i];
    if (branching[id] && branching[id](answers)) continue;
    position += 1;
  }
  return position;
}
