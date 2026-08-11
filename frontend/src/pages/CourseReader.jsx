import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Check, Lock, BookOpen } from "lucide-react";
import api from "../api";
import { useI18n } from "../i18n";
import { Starfield } from "../components/Cosmic";
import { UnlockSheet } from "../components/Monetize";

const L = (obj, field, lang) => (lang === "pt" ? obj[`${field}_pt`] || obj[field] : obj[field]);

export default function CourseReader() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const [course, setCourse] = useState(null);
  const [openLesson, setOpenLesson] = useState(null);
  const [done, setDone] = useState(() => new Set(JSON.parse(localStorage.getItem(`aura_course_${id}`) || "[]")));
  const [showUnlock, setShowUnlock] = useState(false);

  useEffect(() => {
    api.get(`/content/courses/${id}`).then((r) => setCourse(r.data)).catch(() => setCourse(false));
  }, [id]);

  const markDone = (i) => {
    setDone((d) => {
      const next = new Set(d).add(i);
      localStorage.setItem(`aura_course_${id}`, JSON.stringify([...next]));
      return next;
    });
  };

  if (course === false) {
    return (
      <div className="app-frame cosmic-bg min-h-screen grid place-items-center text-white/60">
        <button onClick={() => nav(-1)} className="absolute top-5 left-5"><ChevronLeft /></button>
        {t("advisor_not_found")}
      </div>
    );
  }
  if (!course) return <div className="app-frame cosmic-bg min-h-screen" />;

  const lessons = course.lessons_content;
  const isLocked = course.locked && !lessons;

  return (
    <div className="app-frame cosmic-bg min-h-screen relative">
      <Starfield count={30} />
      <div className="relative z-10 pb-16">
        <div className="p-5 flex items-center justify-between">
          <button onClick={() => nav(-1)} data-testid="course-back"><ChevronLeft /></button>
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="px-5">
          <img src={course.img} alt="" className="w-full h-40 object-cover rounded-2xl" />
          <h1 className="font-display text-2xl mt-4">{L(course, "title", lang)}</h1>
          {isLocked ? (
            <p className="text-white/60 text-sm mt-2 leading-relaxed">{L(course, "teaser", lang)}</p>
          ) : (
            <p className="text-white/50 text-sm mt-1">{course.lessons} {t("lessons")}</p>
          )}
        </motion.div>

        {isLocked ? (
          <div className="px-5 mt-8">
            <button onClick={() => setShowUnlock(true)} data-testid="course-unlock"
              className="w-full glass rounded-2xl p-6 flex flex-col items-center text-center gap-3 border border-white/10">
              <div className="w-14 h-14 rounded-full grad-btn grid place-items-center"><Lock size={22} className="text-white" /></div>
              <div>
                <div className="font-bold">{t("unlock_title")}</div>
                <div className="text-white/50 text-xs mt-1">{t("unlock_sub")}</div>
              </div>
              <span className="grad-btn text-white text-sm font-bold px-5 py-2.5 rounded-xl mt-1">{t("unlock_cta")}</span>
            </button>
          </div>
        ) : (
          <div className="px-5 mt-6 space-y-3">
            {lessons.map((lesson, i) => {
              const open = openLesson === i;
              return (
                <motion.div key={i} layout className="glass rounded-2xl overflow-hidden border border-white/5" data-testid={`lesson-${i}`}>
                  <button onClick={() => setOpenLesson(open ? null : i)} className="w-full flex items-center gap-3 p-4 text-left">
                    <span className={`shrink-0 w-8 h-8 rounded-full grid place-items-center text-xs font-bold ${done.has(i) ? "bg-emerald-500/20 text-emerald-400" : "glass text-white/60"}`}>
                      {done.has(i) ? <Check size={14} /> : i + 1}
                    </span>
                    <span className="flex-1 font-semibold text-sm">{L(lesson, "title", lang)}</span>
                    <BookOpen size={16} className={`shrink-0 text-white/30 transition-transform ${open ? "rotate-12" : ""}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }} className="overflow-hidden">
                        <div className="px-4 pb-5">
                          <p className="text-sm text-white/75 leading-relaxed font-serif2">{L(lesson, "body", lang)}</p>
                          {!done.has(i) && (
                            <button onClick={() => markDone(i)} data-testid={`lesson-done-${i}`}
                              className="mt-4 text-xs font-bold text-[#b79cff] flex items-center gap-1.5">
                              <Check size={14} /> {t("mark_complete")}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
      <UnlockSheet open={showUnlock} onClose={() => setShowUnlock(false)} />
    </div>
  );
}
