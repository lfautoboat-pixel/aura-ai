// Talks to the real backend (merged into backend/server.py's /api/soulmate/*
// routes) through the app's shared axios instance — same baseURL/auth
// interceptor as every other feature, instead of a one-off fetch() call.
import api from "@/api";

export async function generateSoulmateSketch({ selfie, answers, language }) {
  const form = new FormData();
  if (selfie) form.append("selfie", selfie);
  form.append("answers", JSON.stringify(answers));
  form.append("language", language);
  const { data } = await api.post("/soulmate/sketch", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return {
    readingId: data.reading_id,
    image: `data:image/png;base64,${data.image_base64}`,
    status: data.status,
  };
}
