import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { score, latestSafeStart, inBusy, resolvedSafeStarts, snapToWorkSlot, HOUR, DAY, heurExtract } from "./logic";

describe("core logic", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T10:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("a task with a tight deadline scores above a loose one", () => {
    const tightTask = { id: "1", title: "Tight", due: Date.now() + 2 * HOUR, effortMin: 30, stakes: 2 };
    const looseTask = { id: "2", title: "Loose", due: Date.now() + 48 * HOUR, effortMin: 30, stakes: 2 };
    
    expect(score(tightTask)).toBeGreaterThan(score(looseTask));
  });

  it("latestSafeStart respects effort and calendar", () => {
    // deadline is 12:00, effort is 60 min.
    // calendar is busy from 10:30 to 11:30.
    const due = Date.now() + 2 * HOUR;
    const task = { id: "1", title: "Task", due, effortMin: 60, stakes: 2 };
    
    const busyBlocks = [
      { start: Date.now() + 30 * 60e3, end: Date.now() + 90 * 60e3 } 
    ];
    // free: 10:00 to 10:30 (30 mins)
    // free: 11:30 to 12:00 (30 mins)
    // To get 60 mins of free time, we must start at 10:00!
    // Wait, the logic counts minutes backwards. 
    // From 12:00 to 11:30 is 30 mins free.
    // 11:30 to 10:30 is busy.
    // 10:30 to 10:00 is 30 mins free. 
    // Need 60 mins total, so latest safe start is 10:00.
    
    const lss = latestSafeStart(task, busyBlocks);
    expect(lss).toBe(Date.now());
  });

  it("a scheduled block never overlaps a busy block in resolvedSafeStarts", () => {
    const db: any = {
      schedule: [{ startISO: new Date(Date.now() + 60 * 60e3).toISOString(), durationMin: 60 }], // 11:00 to 12:00
      tasks: [
        { id: "t1", title: "Task 1", due: Date.now() + 4 * HOUR, effortMin: 120, done: false }, // due at 14:00, needs 2h
      ]
    };
    
    const resolved = resolvedSafeStarts(db);
    // Task needs 2h. Deadline 14:00.
    // 12:00 to 14:00 is 2h free. So LSS should be 12:00.
    expect(resolved.t1.lss).toBe(Date.now() + 2 * HOUR);
  });

  it("snapToWorkSlot rolls correctly to next day", () => {
    const time = new Date("2026-06-30T19:00:00Z").getTime(); // after 18:00
    const busyDays = new Set<number>(); // none
    const snapped = snapToWorkSlot(time, busyDays);
    
    const snappedDate = new Date(snapped);
    expect(snappedDate.getUTCDate()).toBe(1); // rolled to next day (July 1st)
    expect(snappedDate.getUTCHours()).toBe(9); // at 9 AM
  });
  
  it("recurring tasks (day parsing) roll correctly in heurExtract", () => {
    // 2026-06-30 is a Tuesday.
    // "due Tuesday" should roll to next Tuesday, meaning 7 days later.
    const extracted = heurExtract("finish project by Tuesday");
    const diffDays = Math.round((extracted[0].due - Date.now()) / DAY);
    expect(diffDays).toBe(7);
  });
});
