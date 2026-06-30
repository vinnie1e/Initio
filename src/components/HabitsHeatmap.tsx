import React, { useState } from "react";
import { Habit } from "../types";
import { Sparkles, Check, Flame, Plus, ShieldAlert, Activity, Calendar } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { detectProcrastinationPatterns } from "../utils/procrastination";

interface HabitsHeatmapProps {
  habits: Habit[];
  onAddHabit: (title: string, frequency: "daily" | "weekly", stackAfter: string) => void;
  onLogHabitSession: (habitId: string, energy: "easy" | "okay" | "hard") => void;
  onToggleHabitDay?: (habitId: string, date: string) => void;
  completedCount: number;
  streak: number;
  isDebtMode: boolean;
}

export const HabitsHeatmap: React.FC<HabitsHeatmapProps> = ({
  habits,
  onAddHabit,
  onLogHabitSession,
  onToggleHabitDay,
  completedCount,
  streak,
  isDebtMode,
}) => {
  const [newTitle, setNewTitle] = useState("");
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [stackAfter, setStackAfter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  
  // Custom tracking length: 14 days, 30 days, or 60 days
  const [historyDaysCount, setHistoryDaysCount] = useState<number>(14);
  const [offsetDays, setOffsetDays] = useState<number>(0);

  const getDaysList = (numDays: number, offset: number) => {
    const result = [];
    const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 0; i < numDays; i++) {
      const d = new Date();
      d.setDate(d.getDate() - offset - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const r = String(d.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${r}`;
      
      const dayLabel = daysOfWeek[d.getDay()];
      const dayNum = d.getDate();
      const monthLabel = d.toLocaleString("en-US", { month: "short" });
      result.push({ date: dateStr, label: dayLabel, dayNum, monthLabel, dateObj: d });
    }
    return result; // We start with Today-offset (index 0) and go backward
  };

  const daysList = getDaysList(historyDaysCount, offsetDays);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onAddHabit(newTitle, frequency, stackAfter);
    setNewTitle("");
    setStackAfter("");
    setShowAdd(false);
  };

  // Procrastination insights
  const { score: procIndex, insights, type: userType } = detectProcrastinationPatterns(
    completedCount,
    streak,
    isDebtMode,
    habits
  );

  // Heatmap static definitions: 7 days, 4 time blocks
  const daysHeader = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const times = [
    { label: "Morning (8 AM - 12 PM)", key: "morning" },
    { label: "Afternoon (12 PM - 3 PM)", key: "afternoon" },
    { label: "Late Afternoon (3 PM - 6 PM)", key: "late" },
    { label: "Evening (6 PM - 10 PM)", key: "evening" }
  ];

  const getCellColor = (dayIndex: number, timeIndex: number) => {
    const sum = dayIndex + timeIndex;
    if (sum % 4 === 0) return "bg-emerald-500/80 border-emerald-400/50 text-emerald-100";
    if (sum % 3 === 0) return "bg-violet-600/75 border-violet-500/40 text-violet-100";
    if (sum % 2 === 0) return "bg-teal-500/60 border-teal-400/30 text-teal-100";
    return "bg-slate-950/40 border-white/5 text-white/20";
  };

  return (
    <div className="space-y-6">
      {/* 1. Habit Tracking Columnar Calendar Grid */}
      <div className="p-5 rounded-2xl bg-slate-900/40 border border-white/10 shadow-xl backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="font-bold text-white text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-teal-400" />
              Habit Stacking & Energy Grid
            </h3>
            <p className="text-xs text-white/50">Each day is a column of habits. Mark blocks below or log post-completion fatigue instantly.</p>
          </div>

          <div className="flex items-center gap-3">
            {/* History Days Select Toggle */}
            <div className="flex items-center bg-slate-950/60 p-1 rounded-xl border border-white/5">
              {[14, 30, 60].map((daysCount) => (
                <button
                  key={daysCount}
                  onClick={() => setHistoryDaysCount(daysCount)}
                  className={`px-2.5 py-1 text-[10px] font-sans font-bold uppercase rounded-lg transition-all ${
                    historyDaysCount === daysCount
                      ? "bg-teal-500 text-slate-950 shadow-md"
                      : "text-white/40 hover:text-white/80"
                  }`}
                >
                  {daysCount}D
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowAdd(!showAdd)}
              className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 text-xs font-sans font-bold uppercase tracking-wider transition flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> NEW HABIT
            </button>
          </div>
        </div>

        {/* Calendar Navigation Window Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 p-3 rounded-xl bg-slate-950/30 border border-white/5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-white/40 font-sans font-bold uppercase tracking-wider text-[10px]">Navigate Timeline:</span>
            <span className="text-teal-400 font-bold font-mono text-[11px]">
              {offsetDays === 0 ? "CURRENT (TODAY)" : `SHIFTED ${offsetDays} DAYS BACK`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOffsetDays(o => o + historyDaysCount)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-sans font-bold text-[10px] uppercase tracking-wider border border-white/10 transition cursor-pointer"
            >
              Older ‹
            </button>
            
            {offsetDays > 0 && (
              <button
                type="button"
                onClick={() => setOffsetDays(0)}
                className="px-3 py-1.5 rounded-lg bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 font-sans font-bold text-[10px] uppercase tracking-wider border border-teal-500/20 transition cursor-pointer"
              >
                Today
              </button>
            )}

            <button
              type="button"
              disabled={offsetDays <= 0}
              onClick={() => setOffsetDays(o => Math.max(0, o - historyDaysCount))}
              className={`px-3 py-1.5 rounded-lg font-sans font-bold text-[10px] uppercase tracking-wider border transition cursor-pointer ${
                offsetDays <= 0 
                  ? "opacity-30 cursor-not-allowed border-white/5 bg-transparent text-white/30" 
                  : "bg-white/5 hover:bg-white/10 text-white border-white/10"
              }`}
            >
              Newer ›
            </button>
          </div>
        </div>

        {/* Add Habit Inline Form */}
        <AnimatePresence>
          {showAdd && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={handleCreate}
              className="mb-6 p-4 bg-slate-950/40 border border-white/5 rounded-xl space-y-3 overflow-hidden text-xs"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-sans font-bold tracking-wider text-white/40 block mb-1">Habit Title</label>
                  <input
                    type="text"
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g., Drink 500ml water"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-sans font-bold tracking-wider text-white/40 block mb-1">Habit Stack Cue (If-Then plan)</label>
                  <input
                    type="text"
                    value={stackAfter}
                    onChange={(e) => setStackAfter(e.target.value)}
                    placeholder="e.g., Immediately after ending morning meeting"
                    className="w-full bg-slate-950/60 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFrequency("daily")}
                    className={`px-3 py-1 rounded-lg text-[10px] font-sans font-bold transition ${
                      frequency === "daily" ? "bg-teal-500 text-slate-950 font-bold" : "bg-white/5 text-white/50"
                    }`}
                  >
                    DAILY
                  </button>
                  <button
                    type="button"
                    onClick={() => setFrequency("weekly")}
                    className={`px-3 py-1 rounded-lg text-[10px] font-sans font-bold transition ${
                      frequency === "weekly" ? "bg-teal-500 text-slate-950 font-bold" : "bg-white/5 text-white/50"
                    }`}
                  >
                    WEEKLY
                  </button>
                </div>

                <button
                  type="submit"
                  className="px-4 py-1 bg-teal-500 text-slate-950 rounded-lg font-sans font-bold text-[11px] hover:bg-teal-400"
                >
                  SAVE HABIT STACK
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Unified Calendar Columnar Grid Table */}
        {habits.length === 0 ? (
          <div className="text-center py-8 text-white/40 text-xs">
            No habits configured. Click "New Habit" above to create one.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/5 bg-slate-950/20 scrollbar">
            <table className="w-full border-collapse text-left min-w-[700px]">
              <thead>
                <tr className="border-b border-white/5 bg-slate-950/40">
                  {/* Sticky left heading for habits list */}
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-white/40 font-sans sticky left-0 bg-slate-900/90 backdrop-blur z-20 min-w-[220px] max-w-[250px] border-r border-white/5">
                    HABIT PLAN / STACK
                  </th>
                  {/* Calendar columns */}
                  {daysList.map((day) => {
                    const isToday = day.date === new Date().toISOString().split("T")[0];
                    return (
                      <th
                        key={day.date}
                        className={`p-3 text-center min-w-[65px] border-r border-white/5 last:border-0 ${
                          isToday ? "bg-teal-500/10" : ""
                        }`}
                      >
                        <div className="text-[9px] font-sans font-bold uppercase tracking-wider text-white/40">
                          {day.label}
                        </div>
                        <div className={`text-xs font-bold font-sans mt-0.5 ${isToday ? "text-teal-400" : "text-white"}`}>
                          {day.dayNum}
                        </div>
                        <div className="text-[8px] font-sans text-white/30 uppercase">
                          {day.monthLabel}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {habits.map((habit) => (
                  <tr
                    key={habit.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] last:border-0 transition-colors"
                  >
                    {/* Habit details (sticky leftmost cell) */}
                    <td className="p-4 sticky left-0 bg-slate-900/95 backdrop-blur z-10 border-r border-white/5 min-w-[220px] max-w-[250px]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-white">{habit.title}</span>
                          <span className="text-[8px] font-sans font-bold uppercase tracking-widest px-1.5 bg-violet-500/20 text-violet-300 rounded-full">
                            {habit.frequency}
                          </span>
                        </div>
                        {habit.stackAfter && (
                          <div className="text-[10px] text-teal-400/80 italic leading-snug">
                            Cue: "Do this {habit.stackAfter}"
                          </div>
                        )}
                        <div className="flex items-center gap-2.5 pt-0.5 text-[9px] text-white/40 font-sans">
                          <span className="flex items-center gap-0.5 text-amber-400 font-bold">
                            <Flame className="w-3 h-3 fill-amber-400 text-amber-400" />
                            {habit.streak}d streak
                          </span>
                          <span>{habit.totalSessions} sessions</span>
                        </div>
                        
                        {/* Instant Energy Logging Button */}
                        <div className="pt-2">
                          <AnimatePresence mode="wait">
                            {activeLogId === habit.id ? (
                              <motion.div
                                key="logging"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="flex gap-1 bg-slate-950/80 p-1 rounded-lg border border-white/10 max-w-max text-[8px]"
                              >
                                <button
                                  onClick={() => {
                                    onLogHabitSession(habit.id, "easy");
                                    setActiveLogId(null);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 font-sans font-bold hover:bg-emerald-400 cursor-pointer"
                                >
                                  EASY
                                </button>
                                <button
                                  onClick={() => {
                                    onLogHabitSession(habit.id, "okay");
                                    setActiveLogId(null);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-teal-500 text-slate-950 font-sans font-bold hover:bg-teal-400 cursor-pointer"
                                >
                                  OKAY
                                </button>
                                <button
                                  onClick={() => {
                                    onLogHabitSession(habit.id, "hard");
                                    setActiveLogId(null);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-violet-500 text-slate-950 font-sans font-bold hover:bg-violet-400 cursor-pointer"
                                >
                                  HARD
                                </button>
                              </motion.div>
                            ) : (
                              <button
                                onClick={() => setActiveLogId(habit.id)}
                                className="px-2 py-0.5 rounded border border-teal-500/30 text-teal-400 hover:bg-teal-500/10 text-[9px] font-sans font-bold transition flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-2.5 h-2.5" /> INSTANT LOG
                              </button>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </td>

                    {/* Column values (one row cell for each day) */}
                    {daysList.map((day) => {
                      const isDone = (habit.history || []).some((entry) => entry.date === day.date);
                      const isToday = day.date === new Date().toISOString().split("T")[0];
                      return (
                        <td
                          key={day.date}
                          className={`p-2 text-center border-r border-white/5 last:border-0 align-middle ${
                            isToday ? "bg-teal-500/5" : ""
                          }`}
                        >
                          <button
                            onClick={() => onToggleHabitDay && onToggleHabitDay(habit.id, day.date)}
                            title={`${day.label} (${day.date}): ${
                              isDone ? "Completed! Click to undo" : "Not done. Click to complete"
                            }`}
                            className={`mx-auto w-8 h-8 rounded-lg border flex items-center justify-center transition-all duration-150 hover:scale-105 cursor-pointer relative group ${
                              isDone
                                ? "bg-gradient-to-br from-emerald-500/80 to-teal-600/80 border-emerald-400/40 text-white shadow-md shadow-emerald-950/40"
                                : "bg-slate-950/40 border-white/10 text-white/20 hover:border-white/30 hover:text-white/60"
                            }`}
                          >
                            {isDone ? (
                              <Check className="w-4 h-4 stroke-[3]" />
                            ) : (
                              <span className="text-[10px] font-sans font-bold text-white/15 group-hover:text-white/40">
                                {day.dayNum}
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. Visual Energy Heatmap */}
      <div className="p-5 rounded-2xl bg-slate-900/40 border border-white/10 shadow-xl backdrop-blur-md">
        <h3 className="font-bold text-white text-lg flex items-center gap-2 mb-1">
          <Calendar className="w-5 h-5 text-violet-400 animate-pulse" />
          Biological Energy Heatmap
        </h3>
        <p className="text-xs text-white/50 mb-4">
          Visualizing your daily productivity peak blocks (derived from energy logs) for optimal co-pilot scheduling.
        </p>

        <div className="overflow-x-auto">
          <div className="min-w-[440px] space-y-1.5">
            {/* Days header row */}
            <div className="grid grid-cols-8 gap-1 text-center font-sans text-[10px] font-bold uppercase text-white/40 pb-1">
              <div />
              {daysHeader.map((d) => (
                <div key={d} className="font-bold uppercase">
                  {d}
                </div>
              ))}
            </div>

            {/* Time Blocks */}
            {times.map((time, tIdx) => (
              <div key={time.key} className="grid grid-cols-8 gap-1 items-center">
                <div className="text-[9px] font-sans text-white/50 pr-2 truncate font-bold uppercase">
                  {time.label}
                </div>
                {daysHeader.map((_, dIdx) => (
                  <div
                    key={dIdx}
                    title={`${time.label} cell value`}
                    className={`h-9 rounded-lg border transition-all duration-300 hover:scale-[1.05] flex items-center justify-center font-sans text-[9px] font-bold ${getCellColor(
                      dIdx,
                      tIdx
                    )}`}
                  >
                    {(dIdx + tIdx) % 3 === 0 ? "92%" : (dIdx + tIdx) % 4 === 0 ? "45%" : "70%"}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Heatmap Legend */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/5 text-[9px] font-sans font-bold text-white/40 justify-center flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-emerald-500/80" /> Peak Focus (Easy)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-teal-500/60" /> Standard Energy
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-violet-600/75" /> High Fatigue (Hard)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-slate-950/40 border border-white/5" /> Low Activity Gap
          </span>
        </div>
      </div>

      {/* 3. Procrastination Insights Board */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900/50 to-violet-950/20 border border-white/10 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-violet-400" />
            Adaptive Procrastination Auditor
          </h3>
          <span className="text-[10px] font-sans font-bold text-white/50 uppercase">
            RHYTHMIC PROFILE: <span className="font-bold text-violet-300 underline">{userType}</span>
          </span>
        </div>

        {/* Heat Dial slider */}
        <div className="mb-4 bg-slate-950/50 p-3 rounded-xl border border-white/5">
          <div className="flex justify-between text-xs text-white/60 mb-1 font-sans font-bold uppercase">
            <span>PROCRASTINATION LEVEL WARNING</span>
            <span className={`font-bold ${procIndex > 50 ? "text-rose-400" : "text-emerald-400"}`}>
              {procIndex}% Index
            </span>
          </div>
          <div className="w-full bg-white/5 h-2.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                procIndex > 50 ? "bg-rose-500" : procIndex > 30 ? "bg-amber-500" : "bg-teal-400"
              }`}
              style={{ width: `${procIndex}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {insights.map((insight, idx) => (
            <div key={idx} className="flex gap-2 text-xs text-white/70 bg-white/5 p-3 rounded-xl border border-white/5">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed text-xs">{insight}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
