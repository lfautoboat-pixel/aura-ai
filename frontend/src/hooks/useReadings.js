import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "aura-readings";
const MAX_ENTRIES = 6;

/**
 * useReadings — local-only UI cache of the last generated sketches.
 * Stores non-sensitive data ONLY: the base64 PNG returned by the sketch endpoint
 * (user-generated content), timestamp and answers snapshot. No tokens, no PII,
 * no session data. Safe to keep in localStorage; entries are capped at MAX_ENTRIES.
 */

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function write(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
}

export function useReadings() {
  const [readings, setReadings] = useState(read);

  useEffect(() => {
    const listener = () => setReadings(read());
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, []);

  const save = useCallback((reading) => {
    const entry = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
      createdAt: new Date().toISOString(),
      ...reading,
    };
    const next = [entry, ...read()].slice(0, MAX_ENTRIES);
    write(next);
    setReadings(next);
    return entry;
  }, []);

  const remove = useCallback((id) => {
    const next = read().filter((r) => r.id !== id);
    write(next);
    setReadings(next);
  }, []);

  return { readings, save, remove };
}
