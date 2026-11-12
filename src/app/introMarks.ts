/**
 * src/app/introMarks.ts
 * Gestión de marcas de inicio y fin de intro por serie en CineCast.
 * Persiste en localStorage de la PC bajo la clave 'cinecast_intro_marks_v1'.
 */

export interface IntroTiming {
  start: number;
  end: number;
}

const STORAGE_KEY = 'cinecast_intro_marks_v1';

export function getAllIntroMarks(): Record<string, IntroTiming> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveAllIntroMarks(marks: Record<string, IntroTiming>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch (_) {}
}

export function getIntroMarks(seriesId: string | number | null | undefined): IntroTiming | null {
  if (!seriesId) return null;
  const key = String(seriesId);
  const marks = getAllIntroMarks();
  const entry = marks[key];
  if (entry && Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end > entry.start) {
    return entry;
  }
  return null;
}

export function setIntroStart(seriesId: string | number | null | undefined, startTime: number): void {
  if (!seriesId || !Number.isFinite(startTime) || startTime < 0) return;
  const key = String(seriesId);
  const marks = getAllIntroMarks();
  const existing = marks[key] || { start: 0, end: 0 };
  const rounded = Math.round(startTime * 10) / 10;
  marks[key] = {
    start: rounded,
    end: existing.end > rounded ? existing.end : rounded + 85,
  };
  saveAllIntroMarks(marks);
}

export function setIntroEnd(seriesId: string | number | null | undefined, endTime: number): void {
  if (!seriesId || !Number.isFinite(endTime) || endTime < 0) return;
  const key = String(seriesId);
  const marks = getAllIntroMarks();
  const existing = marks[key] || { start: 0, end: 0 };
  const rounded = Math.round(endTime * 10) / 10;
  marks[key] = {
    start: existing.start < rounded ? existing.start : Math.max(0, rounded - 85),
    end: rounded,
  };
  saveAllIntroMarks(marks);
}

export function clearIntroMarks(seriesId: string | number | null | undefined): void {
  if (!seriesId) return;
  const key = String(seriesId);
  const marks = getAllIntroMarks();
  delete marks[key];
  saveAllIntroMarks(marks);
}

