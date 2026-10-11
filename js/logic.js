/**
 * Pure helpers for diet rules, training merges, stats, and UTF-8 base64.
 * Thresholds match data/diet.json `rules`:
 *   kcal    intake within 95%–105% of target
 *   protein intake >= 95% of target
 *   carbs   intake >= 95% of target
 *   fat     intake <= 105% of target
 * A complete day passes when at least 3 of the 4 macros pass.
 */

export const BODY_PARTS = ['胸', '背', '肩', '二頭', '三頭', '腿', '臀', '腹', '帶氧', '休息'];

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export const MACRO_KEYS = ['kcal', 'protein', 'carbs', 'fat'];

export const MACRO_META = {
  kcal: { label: '熱量', unit: 'kcal' },
  protein: { label: '蛋白質', unit: 'g' },
  carbs: { label: '碳水', unit: 'g' },
  fat: { label: '脂肪', unit: 'g' },
};

const EPS = 1e-6;

export function hkToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function parseDateParts(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return { year, month, day };
}

export function weekdayIndex(dateStr) {
  const { year, month, day } = parseDateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function formatHeading(dateStr) {
  const { year, month, day } = parseDateParts(dateStr);
  const week = WEEKDAYS[weekdayIndex(dateStr)];
  return `${year}年${month}月${day}日（${week}）`;
}

export function formatShortDate(dateStr) {
  const { month, day } = parseDateParts(dateStr);
  return `${month}月${day}日`;
}

export function addDays(dateStr, days) {
  const { year, month, day } = parseDateParts(dateStr);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftMonth(yearMonth, delta) {
  const [year, month] = yearMonth.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthTitle(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return `${year}年${month}月`;
}

/** Sunday-first month grid. Nulls are leading/trailing blanks. */
export function monthCells(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function formatNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const text = n.toFixed(1);
  if (text.endsWith('.0')) return String(Number(text));
  return text;
}

export function macroPasses(key, intake, target) {
  const actual = Number(intake);
  const goal = Number(target);
  if (!MACRO_KEYS.includes(key) || !Number.isFinite(actual) || !Number.isFinite(goal)) return false;
  const low = goal * 0.95 - EPS;
  const high = goal * 1.05 + EPS;
  if (key === 'kcal') return actual >= low && actual <= high;
  if (key === 'protein' || key === 'carbs') return actual >= low;
  if (key === 'fat') return actual <= high;
  return false;
}

export function macroDelta(intake, target) {
  const diff = Number(intake) - Number(target);
  if (!Number.isFinite(diff)) return { kind: 'exact', amount: 0 };
  if (Math.abs(diff) < 0.05) return { kind: 'exact', amount: 0 };
  if (diff > 0) return { kind: 'over', amount: diff };
  return { kind: 'under', amount: -diff };
}

export function deltaText(delta) {
  if (!delta || delta.kind === 'exact') return '剛好';
  if (delta.kind === 'over') return `超 ${formatNum(delta.amount)}`;
  return `差 ${formatNum(delta.amount)}`;
}

export function evaluateDay(day) {
  if (!day) return null;
  const macros = {};
  for (const key of MACRO_KEYS) {
    const intake = Number(day.intake?.[key]);
    const target = Number(day.target?.[key]);
    macros[key] = {
      key,
      intake,
      target,
      pass: macroPasses(key, intake, target),
      delta: macroDelta(intake, target),
    };
  }
  const passed = MACRO_KEYS.filter((key) => macros[key].pass).length;
  let status = 'fail';
  if (!day.complete) status = 'progress';
  else if (passed >= 3) status = 'pass';
  return {
    date: day.date,
    complete: Boolean(day.complete),
    status,
    passed,
    macros,
  };
}

export function statusLabel(status) {
  if (status === 'pass') return '達標';
  if (status === 'fail') return '未達標';
  return '進行中';
}

export function macroBadgeLabel(evaluation, key) {
  if (!evaluation || evaluation.status === 'progress') return '進行中';
  return evaluation.macros[key].pass ? '達標' : '未達標';
}

export function dietDot(day) {
  if (!day) return 'none';
  const evaluation = evaluateDay(day);
  return evaluation.status;
}

export function barPercent(intake, target) {
  const goal = Number(target);
  const actual = Number(intake);
  if (!Number.isFinite(goal) || goal <= 0 || !Number.isFinite(actual)) return 0;
  return Math.max(0, Math.min(100, (actual / goal) * 100));
}

export function normalizeTrainingEntry(entry) {
  const raw = Array.isArray(entry?.parts) ? entry.parts : [];
  const picked = new Set(raw.filter((part) => BODY_PARTS.includes(part)));
  let trained = Boolean(entry?.trained);
  if (picked.has('休息') && picked.size > 1) picked.delete('休息');
  if (picked.has('休息')) trained = false;
  const parts = BODY_PARTS.filter((part) => picked.has(part));
  const out = {
    date: entry.date,
    trained,
    parts,
  };
  const note = String(entry?.note || '').trim();
  if (note) out.note = note;
  return out;
}

export function mergeTrainingDay(data, entry) {
  const normalized = normalizeTrainingEntry(entry);
  const source = data && typeof data === 'object' ? data : {};
  const days = Array.isArray(source.days) ? source.days.map((day) => ({ ...day })) : [];
  const index = days.findIndex((day) => day.date === normalized.date);
  if (index >= 0) {
    const next = {
      ...days[index],
      date: normalized.date,
      trained: normalized.trained,
      parts: normalized.parts,
    };
    if (normalized.note) next.note = normalized.note;
    else delete next.note;
    days[index] = next;
  } else {
    days.push(normalized);
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...source, days };
}

export function formatTrainingDay(day) {
  const parts = JSON.stringify(day.parts || []);
  let line = `    {"date": ${JSON.stringify(day.date)}, "trained": ${day.trained ? 'true' : 'false'}, "parts": ${parts}`;
  if (day.note) line += `, "note": ${JSON.stringify(day.note)}`;
  line += '}';
  return line;
}

/** Compact JSON, same shape the coach already uses, UTF-8 Chinese left as-is. */
export function stringifyTraining(data) {
  const days = (data?.days || []).map(formatTrainingDay);
  return `{\n  "days": [\n${days.join(',\n')}\n  ]\n}\n`;
}

export function trainingContentEqual(a, b) {
  return stringifyTraining(a) === stringifyTraining(b);
}

export function toggleBodyPart(draft, part) {
  const parts = new Set(draft.parts || []);
  if (part === '休息') {
    const onlyRest = parts.size === 1 && parts.has('休息') && !draft.trained;
    if (onlyRest) return { ...draft, parts: [], trained: false };
    return { ...draft, parts: ['休息'], trained: false };
  }
  if (parts.has(part)) parts.delete(part);
  else parts.add(part);
  parts.delete('休息');
  const ordered = BODY_PARTS.filter((item) => parts.has(item));
  const trained = ordered.length > 0 ? true : Boolean(draft.trained);
  return { ...draft, parts: ordered, trained };
}

export function toggleTrained(draft) {
  if (draft.trained) return { ...draft, trained: false, parts: [] };
  const parts = (draft.parts || []).filter((part) => part !== '休息');
  return { ...draft, trained: true, parts };
}

export function dateInRange(date, start, end) {
  return date >= start && date <= end;
}

export function computeWindowStats(dietDays, trainingDays, endDate, windowDays) {
  const start = addDays(endDate, -(windowDays - 1));
  const diet = (dietDays || []).filter((day) => dateInRange(day.date, start, endDate));
  const complete = diet.filter((day) => day.complete);
  const hits = { kcal: 0, protein: 0, carbs: 0, fat: 0, overall: 0 };
  const sumIntake = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const sumTarget = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

  for (const day of complete) {
    const evaluation = evaluateDay(day);
    for (const key of MACRO_KEYS) {
      if (evaluation.macros[key].pass) hits[key] += 1;
      sumIntake[key] += evaluation.macros[key].intake;
      sumTarget[key] += evaluation.macros[key].target;
    }
    if (evaluation.status === 'pass') hits.overall += 1;
  }

  const count = complete.length;
  const avg = (sums) => Object.fromEntries(
    MACRO_KEYS.map((key) => [key, count ? sums[key] / count : null]),
  );

  const logged = (trainingDays || []).filter((day) => dateInRange(day.date, start, endDate));
  const partCounts = {};
  for (const day of logged) {
    for (const part of day.parts || []) {
      partCounts[part] = (partCounts[part] || 0) + 1;
    }
  }

  return {
    start,
    end: endDate,
    windowDays,
    completeCount: count,
    progressCount: diet.filter((day) => !day.complete).length,
    hits,
    avgIntake: avg(sumIntake),
    avgTarget: avg(sumTarget),
    trainingCount: logged.filter((day) => day.trained).length,
    partCounts,
  };
}

export function weightSeries(entries) {
  return (entries || [])
    .filter((entry) => entry?.date && Number.isFinite(Number(entry.weight)))
    .map((entry) => ({ ...entry, weight: Number(entry.weight) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function weightChartModel(entries, width = 320, height = 150) {
  const series = weightSeries(entries);
  const left = 48;
  const right = 36;
  const top = 18;
  const bottom = 28;
  if (!series.length) {
    return { width, height, series, points: [], left, right, top, bottom };
  }
  const weights = series.map((item) => item.weight);
  let min = Math.min(...weights);
  let max = Math.max(...weights);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.35;
  min -= pad;
  max += pad;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const points = series.map((item, index) => {
    const x = series.length === 1
      ? left + innerW / 2
      : left + (index / (series.length - 1)) * innerW;
    const y = top + (1 - (item.weight - min) / (max - min)) * innerH;
    return { ...item, x, y };
  });
  return { width, height, series, points, min, max, left, right, top, bottom };
}

export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function decodeBase64Utf8(b64) {
  const clean = String(b64 || '').replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
