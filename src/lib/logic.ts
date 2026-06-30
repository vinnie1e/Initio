import { Task, AppState } from "../types";

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
export const now = () => Date.now();
export const hoursTo = (t: number) => (t - now()) / HOUR;

export function score(t: Task) {
  const h = hoursTo(t.due || 0);
  let urgency = h <= 0 ? 100 : Math.min(100, 100 / Math.max(0.4, h / 6));
  const effortH = (t.effortMin || 30) / 60;
  const runway = h / Math.max(0.25, effortH);
  if (runway < 2 && h > 0) urgency = Math.min(100, urgency + (2 - runway) * 22);
  const effort = Math.max(8, 100 - Math.min(95, effortH * 14));
  const consequence = ({ 1: 45, 2: 72, 3: 100 } as any)[t.stakes || 2];
  return Math.round(urgency * 0.5 + effort * 0.18 + consequence * 0.32);
}

export function heurExtract(text: string) {
  const out: any[] = [];
  const lines = text.split(/\n|(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);
  const wd: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  lines.forEach(line => {
    const low = line.toLowerCase();
    let due = now() + 2 * DAY;
    let m;
    if ((m = low.match(/in (\d+) days?/))) due = now() + (+m[1]) * DAY;
    else if (/tomorrow/.test(low)) due = now() + DAY;
    else if (/today|tonight/.test(low)) due = now() + 8 * HOUR;
    else if ((m = low.match(/(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/))) {
      const target = wd[m[1]];
      const d = new Date();
      let add = (target - d.getDay() + 7) % 7;
      if (add === 0) add = 7;
      due = now() + add * DAY;
    }
    const tm = low.match(/(\d{1,2})\s?(am|pm)/);
    if (tm) {
      const d = new Date(due);
      let hr = +tm[1] % 12 + (tm[2] === "pm" ? 12 : 0);
      d.setHours(hr, 0, 0, 0);
      due = d.getTime();
    }
    let title = line.replace(/\b(by|due|in \d+ days?|tomorrow|today|tonight|next|on)\b.*$/i, "")
      .replace(/^\s*(i have (a|an)?|i need to|i've got|i gotta|please|remember to|my|a|an|the)\s+/i, "")
      .replace(/\s+(for|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*$/i, "")
      .replace(/[.,;:]+$/, "").trim() || line.slice(0, 40);
    const stakes = /exam|midterm|final|grant|interview|tax|rent/i.test(low) ? 3 : 2;
    out.push({ title: title.charAt(0).toUpperCase() + title.slice(1), type: "one-off", due, effortMin: /essay|report|exam|grant/i.test(low) ? 120 : 15, stakes, why: "", when: "" });
  });
  return out;
}

export function tasksFromGoal(goal: string) {
  const clauses = goal.split(/[,;\n]|\band\b(?=[^,]*\b(by|due|tomorrow|today|tonight|in \d|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)/i)
    .map(s => s && s.trim()).filter(Boolean);
  const out: any[] = [];
  clauses.forEach(c => {
    const verb = /\b(submit|pay|finish|prep|prepare|send|book|call|apply|write|review|file|renew|email|reply|complete|study|read|interview)\b/i.test(c);
    const deadlineNoun = /\b(due|by)\b/i.test(c) || /\b(report|essay|assignment|application|bill|rent|interview|exam|midterm|deadline|meeting|presentation|paper|grant)\b/i.test(c);
    const when = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in \d+ (hours?|days?)|by |next week|this week|eod|noon|\d{1,2}\s?(am|pm))\b/i.test(c);
    if ((verb || deadlineNoun) && when) {
      const extracted = heurExtract(c);
      const t = extracted[0];
      if (t && t.title.length > 2) out.push(t);
    }
  });
  return out;
}

export function busyBlocksFor(db: AppState) {
  const src = [...((db && db.schedule) || []), ...((db && db.calBusy) || [])];
  return src.map((s: any) => {
    const start = Date.parse(s.startISO);
    return { start, end: start + (s.durationMin || 30) * 60e3 };
  }).filter((b: any) => !isNaN(b.start)).sort((a: any, b: any) => a.start - b.start);
}

export function inBusy(ms: number, blocks: any[]) {
  return blocks.some((b: any) => ms >= b.start && ms < b.end);
}

export function latestSafeStart(task: Task, blocks: any[]) {
  if (!task || !task.due) return null;
  const need = (task.effortMin || 30); // minutes of free time required
  const STEP = 60e3; // 1-minute resolution
  let cursor = task.due - STEP; // last full minute before the deadline
  let free = 0;
  const floor = task.due - (need * 60e3 + 14 * DAY);
  while (cursor > floor) {
    if (!inBusy(cursor, blocks)) free += 1;
    if (free >= need) return cursor; // this minute is the latest safe start
    cursor -= STEP;
  }
  return null; // not enough free time exists before the deadline
}

export function resolvedSafeStarts(db: AppState) {
  const actives = (db.tasks || []).filter((t: any) => !t.done && t.due);
  const ordered = [...actives].sort((a: any, b: any) => (score(b) - score(a)) || ((a.due || 0) - (b.due || 0)));
  const blocks = busyBlocksFor(db).slice();
  const out: Record<string, { lss: number | null; conflicted: boolean }> = {};
  for (const t of ordered) {
    const lss = latestSafeStart(t, blocks);
    out[t.id] = { lss, conflicted: false };
    if (lss != null) {
      const before = latestSafeStart(t, busyBlocksFor(db));
      out[t.id].conflicted = (before != null && lss < before - 30e3);
      blocks.push({ start: lss, end: t.due || 0 });
      blocks.sort((a, b) => a.start - b.start);
    }
  }
  return out;
}

export function snapToWorkSlot(ms: number, busyDays: Set<number>) {
  let d = new Date(ms);
  for (let g = 0; g < 90; g++) {
    if (busyDays.has(d.getDay())) {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      continue;
    }
    if (d.getHours() < 9) {
      d.setHours(9, 0, 0, 0);
    } else if (d.getHours() >= 18) {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      continue;
    }
    const m = d.getMinutes();
    if (m > 0 && m <= 30) {
      d.setMinutes(30, 0, 0);
    } else if (m > 30) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    return d.getTime();
  }
  return ms;
}
