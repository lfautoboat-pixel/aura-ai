// Maps a handful of high-signal questions to a short "reading in progress"
// flash shown right after the user answers — never all 15, just the ones
// worth reacting to (studio rule: personalization beats, not friction).
// Each entry resolves the {value} that gets interpolated into
// t.insights[<key>] (see nebula-i18n/*.js).
export const INSIGHT_AFTER = {
  q2: "afterPartnerGender",
  q5: "afterBirthDate",
  q6: "afterQualities",
  q9: "afterStruggle",
};

export const INSIGHT_VALUE = {
  afterPartnerGender: (answers) => answers.q2_label,
  afterBirthDate: (answers, zodiacName) => zodiacName,
  afterQualities: (answers) => (Array.isArray(answers.q6) ? answers.q6[0] : null),
  afterStruggle: (answers) => answers.q9,
};
