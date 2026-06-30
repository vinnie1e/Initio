import { Task, CalendarEvent, Habit } from "../types";

/**
 * Calculates a dynamic priority score for a task.
 * Urgency (1-5) * 1.5 + Effort (1-5) * 1.0 + Consequence (1-5) * 2.0 + pacesEscalation
 * PacesEscalation increments based on hours remaining until deadline.
 */
export function calculatePriorityScore(task: Task): { score: number; paceEscalation: number } {
  if (task.completed) return { score: 0, paceEscalation: 0 };

  const base = (task.urgency * 1.5) + (task.effort * 1.0) + (task.consequence * 2.0);
  
  // Calculate hours remaining to deadline
  const now = new Date();
  const deadlineDate = new Date(task.deadline);
  const diffMs = deadlineDate.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  let paceEscalation = 0;
  if (diffHours <= 0) {
    // Past due
    paceEscalation = 15;
  } else if (diffHours <= 3) {
    paceEscalation = 12; // Critical escalation
  } else if (diffHours <= 12) {
    paceEscalation = 8;
  } else if (diffHours <= 24) {
    paceEscalation = 5;
  } else if (diffHours <= 48) {
    paceEscalation = 2;
  }

  return {
    score: Math.round((base + paceEscalation) * 10) / 10,
    paceEscalation,
  };
}

/**
 * Calculates the absolute latest possible start time for a task before its deadline.
 * Handles existing calendar blockers (where isBlocker is true) by stepping backwards from the deadline.
 * Returns the exact latest start timestamp, and whether it is currently in "Hard Alert" danger zone.
 */
export function calculateLatestStartTime(
  task: Task,
  calendarEvents: CalendarEvent[]
): { latestStart: Date; minutesNeeded: number; isBlockedByGaps: boolean } {
  const deadline = new Date(task.deadline);
  const durationMin = task.durationMinutes || 30;
  
  // To find the latest possible start time, we check backwards from the deadline.
  // We need a contiguous free slot of durationMin minutes.
  // Let's sweep back minute by minute or in 5-minute increments starting from the deadline.
  let sweepTime = new Date(deadline.getTime());
  
  // We limit search to up to 48 hours backward from the deadline
  const limitTime = new Date(deadline.getTime() - 48 * 60 * 60 * 1000);
  
  while (sweepTime.getTime() > limitTime.getTime()) {
    const candidateStart = new Date(sweepTime.getTime() - durationMin * 60 * 1000);
    
    // Check if the interval [candidateStart, sweepTime] overlaps with any calendar blocker
    const hasBlocker = calendarEvents.some(event => {
      if (!event.isBlocker) return false;
      const eventStart = new Date(event.startTime).getTime();
      const eventEnd = new Date(event.endTime).getTime();
      
      const oStart = Math.max(candidateStart.getTime(), eventStart);
      const oEnd = Math.min(sweepTime.getTime(), eventEnd);
      return oStart < oEnd; // Overlaps
    });

    if (!hasBlocker) {
      // Found a gap!
      return {
        latestStart: candidateStart,
        minutesNeeded: durationMin,
        isBlockedByGaps: false
      };
    }
    
    // Otherwise, step backward past the blocking event start time to speed up
    // Or just step back by 5 minutes
    sweepTime = new Date(sweepTime.getTime() - 5 * 60 * 1000);
  }

  // Fallback: If absolutely no slot is found, latest start is simply duration before deadline
  return {
    latestStart: new Date(deadline.getTime() - durationMin * 60 * 1000),
    minutesNeeded: durationMin,
    isBlockedByGaps: true
  };
}

/**
 * AI Scheduler Solver: Finds a free, high-energy/low-energy aligned gap in the calendar
 * to place work blocks for uncompleted tasks, avoiding conflicts.
 */
export function solveSchedulingForTask(
  task: Task,
  calendarEvents: CalendarEvent[]
): { startTime: string; endTime: string } | null {
  const now = new Date();
  const deadline = new Date(task.deadline);
  const durationMin = task.durationMinutes || 60;

  // Let's search the next 5 days
  const startSearch = new Date(now.getTime() + 30 * 60 * 1000); // Start 30 mins from now
  const limitSearch = new Date(Math.min(now.getTime() + 5 * 24 * 60 * 60 * 1000, deadline.getTime()));

  // Sweep forward in 15 minute increments
  let currentStart = new Date(startSearch.getTime());
  // Round to nearest 15 mins
  currentStart.setMinutes(Math.ceil(currentStart.getMinutes() / 15) * 15, 0, 0);

  while (currentStart.getTime() + durationMin * 60 * 1000 <= limitSearch.getTime()) {
    const currentEnd = new Date(currentStart.getTime() + durationMin * 60 * 1000);
    const hour = currentStart.getHours();

    // Avoid middle of the night (11 PM - 7 AM) unless requested
    if (hour >= 23 || hour < 7) {
      currentStart = new Date(currentStart.getTime() + 15 * 60 * 1000);
      continue;
    }

    // Match energy profiles roughly:
    // If effort is high, prefer morning (8-12) or late afternoon (15-18).
    // If effort is low, any slot works, but early afternoon slump (12-15) is fine.
    let isPreferredEnergy = true;
    if (task.effort >= 4) {
      // High effort: prefer 8:00 to 12:00 or 15:00 to 20:00
      const inPrimeTime = (hour >= 8 && hour < 12) || (hour >= 15 && hour < 20);
      if (!inPrimeTime) {
        // We'll still accept it as a fallback, but we'll try to find prime first
        isPreferredEnergy = false;
      }
    }

    // Check overlaps
    const overlaps = calendarEvents.some(event => {
      const eStart = new Date(event.startTime).getTime();
      const eEnd = new Date(event.endTime).getTime();
      const oStart = Math.max(currentStart.getTime(), eStart);
      const oEnd = Math.min(currentEnd.getTime(), eEnd);
      return oStart < oEnd;
    });

    if (!overlaps && isPreferredEnergy) {
      return {
        startTime: formatDateToISOStringLocal(currentStart),
        endTime: formatDateToISOStringLocal(currentEnd)
      };
    }

    // Step forward 15 mins
    currentStart = new Date(currentStart.getTime() + 15 * 60 * 1000);
  }

  // If no preferred slot found, try a second pass ignoring energy preference
  currentStart = new Date(startSearch.getTime());
  currentStart.setMinutes(Math.ceil(currentStart.getMinutes() / 15) * 15, 0, 0);

  while (currentStart.getTime() + durationMin * 60 * 1000 <= limitSearch.getTime()) {
    const currentEnd = new Date(currentStart.getTime() + durationMin * 60 * 1000);
    const hour = currentStart.getHours();

    if (hour >= 23 || hour < 7) {
      currentStart = new Date(currentStart.getTime() + 15 * 60 * 1000);
      continue;
    }

    const overlaps = calendarEvents.some(event => {
      const eStart = new Date(event.startTime).getTime();
      const eEnd = new Date(event.endTime).getTime();
      const oStart = Math.max(currentStart.getTime(), eStart);
      const oEnd = Math.min(currentEnd.getTime(), eEnd);
      return oStart < oEnd;
    });

    if (!overlaps) {
      return {
        startTime: formatDateToISOStringLocal(currentStart),
        endTime: formatDateToISOStringLocal(currentEnd)
      };
    }

    currentStart = new Date(currentStart.getTime() + 15 * 60 * 1000);
  }

  return null;
}

/**
 * Converts a Date to YYYY-MM-DDTHH:mm adjusting for timezone offset
 */
export function formatDateToISOStringLocal(date: Date): string {
  const pad = (num: number) => String(num).padStart(2, "0");
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

/**
 * Scans tasks to identify procrastination warnings or schedule locks.
 */
export function detectProcrastinationPatterns(
  completedCount: number,
  streak: number,
  isDebtMode: boolean,
  habits: Habit[]
): { score: number; insights: string[]; type: string } {
  // Simple heuristic pattern detection
  let score = 30; // Procrastination index from 0 to 100
  const insights: string[] = [];
  let type = "Focused Creator";

  if (isDebtMode) {
    score += 40;
    insights.push("Active Debt Mode: A missed deadline triggers completion paralysis. Focus on one early completion to break the cycle.");
    type = "Paralyzed Idealist";
  }

  const hardHabits = habits.filter(h => h.history.some(hi => hi.energyLevel === "hard"));
  if (hardHabits.length > 0) {
    score += 15;
    insights.push(`Heavy Resistance: You rated habits like '${hardHabits[0].title}' as 'Hard' multiple times. Stack them right after high-energy morning calendar events.`);
  }

  if (streak > 5) {
    score -= 15;
    insights.push("Momentum Advantage: Your streak is fueling low-friction start rituals. The Pavlovian tone works because your brain associates it with completion.");
  }

  if (score < 25) {
    type = "Action Machine";
  } else if (score < 50) {
    type = "Balanced Strategist";
  } else if (score < 75) {
    type = "Chafing Procrastinator";
  }

  return {
    score: Math.max(5, Math.min(100, score)),
    insights: insights.length > 0 ? insights : ["Your execution rhythms are steady. No warning patterns detected!"],
    type,
  };
}
