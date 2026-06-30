export interface Task {
  id: string;
  title: string;
  type?: "one-off" | "habit";
  due?: number; // timestamp
  effortMin?: number;
  stakes?: number; // 1 | 2 | 3
  why?: string;
  when?: string;
  goal?: string; // name of associated goal/habit
  done?: boolean | "missed";
  completedAt?: number | string;
  alertLeadMin?: number;
  alertHoldSec?: number;
  firstStep?: {
    kind: string;
    body: string;
  };

  // older/legacy fields for backward compatibility
  urgency?: number; // 1-5
  effort?: number; // 1-5 (energy required)
  consequence?: number; // 1-5
  deadline?: string; // YYYY-MM-DDTHH:mm
  durationMinutes?: number; // For scheduling and latest-alert calculation
  completed?: boolean;
  paceEscalated?: boolean;
  microStep?: string;
  checklist?: string[];
  starterTemplate?: string;
  mvpScope?: string;
  speedSteps?: string[];
  crisisMotivation?: string;
  lockStaySeconds?: number; // Configurable duration the alert blocker must stay on screen
  isHabit?: boolean;
}

export interface Win {
  id: string;
  title: string;
  at: number;
  text: string;
  badge: "early" | "ontime" | "habit" | "missed";
}

export interface Streak {
  count: number;
  debt: number;
  locked: number;
  lastDay: string;
}

export interface Goal {
  xp: number;
  level: number;
  sessions: number;
}

export interface EnergyLog {
  at: number;
  effort: number; // 1 | 2 | 3
  task: string;
}

export interface ScheduleBlock {
  title: string;
  startISO: string;
  durationMin: number;
}

export interface Reminder {
  title: string;
  atISO: string;
  message: string;
}

export interface Settings {
  tone: string;
  weekStart: number;
}

export interface AppState {
  tasks: Task[];
  wins: Win[];
  streak: Streak;
  goals: Record<string, Goal>;
  energy: EnergyLog[];
  settings: Settings;
  xpGlobal: number;
  schedule: ScheduleBlock[];
  reminders: Reminder[];
  calBusy?: any[];
  story?: any;
  storyGenre?: string;
  habits?: Habit[];
}

export type ThemeType = "story" | "editorial" | "drive";

export type NudgeStyle = "supportive" | "analytical" | "aggressive";

export interface CustomStyle {
  accent: string;
  density: "comfortable" | "compact";
  corners: "theme" | "sharp" | "soft" | "round";
}

// Legacy definitions for modular file backward compatibility
export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string; // YYYY-MM-DDTHH:mm
  endTime: string; // YYYY-MM-DDTHH:mm
  isBlocker: boolean; // If true, blocks scheduling
  taskId?: string; // Optional reference to associated task
}

export interface Habit {
  id: string;
  title: string;
  frequency: "daily" | "weekly";
  streak: number;
  totalSessions: number;
  lastCompleted?: string;
  stackAfter?: string; // "Do X after Y" event name
  history: Array<{
    date: string;
    energyLevel: "easy" | "okay" | "hard";
  }>;
}

export interface PlayerStats {
  level: number;
  xp: number;
  nextLevelXp: number;
  streak: number;
  isDebtMode: boolean; // Has missed a deadline, streak is frozen/chained
  completedCount: number;
  badges: Badge[];
}

export interface Badge {
  id: string;
  title: string;
  description: string;
  iconName: string;
  unlockedAt?: string;
}

export interface CoPilotProposal {
  traceSteps: string[];
  tasksToCreate: Array<{
    title: string;
    urgency: number;
    effort: number;
    consequence: number;
    suggestedWhy: string;
  }>;
  scheduleBlocks: Array<{
    title: string;
    startTime: string;
    durationMinutes: number;
    energyLevelRequired: string;
  }>;
  suggestedReminders: Array<{
    title: string;
    triggerContext: string;
  }>;
  coPilotBriefing: string;
}
