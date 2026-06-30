import React, { useState, useEffect, useRef } from "react";
import { Task, AppState, FocusLogItem } from "../types";

interface FocusTabProps {
  db: AppState;
  patch: (fn: (d: AppState) => void) => void;
  flash: (msg: string, kind?: string) => void;
  isMobile: boolean;
  activeTasks: Task[];
  onComplete: (t: Task) => void;
  selectedTaskId?: string;
  setSelectedTaskId?: (id: string) => void;
}

function MIcon({ name, s = 16, fill = 0, weight = 300, style }: any) {
  return (
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: s,
        verticalAlign: "-3px",
        fontVariationSettings: `'FILL' ${fill}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
        ...style
      }}
    >
      {name}
    </span>
  );
}

export default function FocusTab({ db, patch, flash, isMobile, activeTasks, onComplete, selectedTaskId: propsSelectedTaskId, setSelectedTaskId: propsSetSelectedTaskId }: FocusTabProps) {
  const focusLog = db.focusLog || [];
  const activeTasksToChoose = activeTasks.filter(t => !t.done);

  // Focus Timer States
  const [timeLeft, setTimeLeft] = useState(1500); // Default: 25m
  const [duration, setDuration] = useState(1500);
  const [isRunning, setIsRunning] = useState(false);
  
  const [localSelectedTaskId, setLocalSelectedTaskId] = useState<string>("general");
  const selectedTaskId = propsSelectedTaskId !== undefined ? propsSelectedTaskId : localSelectedTaskId;
  const setSelectedTaskId = propsSetSelectedTaskId !== undefined ? propsSetSelectedTaskId : setLocalSelectedTaskId;

  const [ambientSound, setAmbientSound] = useState<"none" | "white" | "rain">("none");
  const [hoveredCell, setHoveredCell] = useState<{ dateStr: string; minutes: number; count: number } | null>(null);

  // Manual Log States
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualTitle, setManualTitle] = useState("");

  // Refs for Synthesizers
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseSourceRef = useRef<AudioNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const secondsTimerRef = useRef<any>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      stopAmbientSound();
      if (secondsTimerRef.current) clearInterval(secondsTimerRef.current);
    };
  }, []);

  // Timer logic
  useEffect(() => {
    if (isRunning) {
      secondsTimerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            handleTimerComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (secondsTimerRef.current) {
        clearInterval(secondsTimerRef.current);
        secondsTimerRef.current = null;
      }
    }
    return () => {
      if (secondsTimerRef.current) clearInterval(secondsTimerRef.current);
    };
  }, [isRunning]);

  // Sync ambient sound to timer state
  useEffect(() => {
    if (!isRunning && ambientSound !== "none") {
      stopAmbientSound();
    } else if (isRunning && ambientSound !== "none") {
      startAmbientSound(ambientSound);
    }
  }, [isRunning, ambientSound]);

  // Synthesize ambient focus noise safely
  const startAmbientSound = (type: "white" | "rain") => {
    try {
      stopAmbientSound();
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const bufferSize = 2 * ctx.sampleRate;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      // Generate Pink/Brownish Focus noise
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        // Low pass filter for brownian focus noise
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5; // Gain compensation
      }

      const noiseNode = ctx.createBufferSource();
      noiseNode.buffer = noiseBuffer;
      noiseNode.loop = true;

      // Filter Node for warmer feel (muffles frequencies)
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = type === "rain" ? 450 : 800; // Rain is more muffled/deeper

      const gain = ctx.createGain();
      gain.gain.value = type === "rain" ? 0.35 : 0.25;

      noiseNode.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noiseNode.start(0);

      noiseSourceRef.current = noiseNode;
      filterNodeRef.current = filter;
      gainNodeRef.current = gain;
    } catch (e) {
      console.warn("Failed to start browser-native audio ambient focus synth:", e);
    }
  };

  const stopAmbientSound = () => {
    try {
      if (noiseSourceRef.current) {
        (noiseSourceRef.current as any).stop();
        noiseSourceRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    } catch (e) {}
  };

  const playChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.18); // G5
      osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.4); // C6

      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

      osc.start();
      osc.stop(ctx.currentTime + 1.8);
    } catch (e) {}
  };

  const handleTimerComplete = () => {
    setIsRunning(false);
    playChime();
    stopAmbientSound();

    const mins = Math.ceil(duration / 60);
    let title = "General Focus";
    const selectedTask = activeTasksToChoose.find(t => t.id === selectedTaskId);
    if (selectedTask) {
      title = selectedTask.title;
      // Also offer to mark the task completed if they focused on a specific task
      onComplete(selectedTask);
    }

    logFocus(mins, title);
    setTimeLeft(duration); // Reset
  };

  const logFocus = (minutes: number, title: string) => {
    if (minutes <= 0 || isNaN(minutes)) return;
    const session: FocusLogItem = {
      id: "focus_" + Date.now(),
      at: Date.now(),
      minutes,
      taskTitle: title || "General Focus"
    };

    patch(d => {
      d.focusLog = d.focusLog || [];
      d.focusLog.unshift(session);

      // Award XP
      const xpReward = Math.round(minutes * 0.8);
      const goalName = "Focus Mastery";
      const g = d.goals[goalName] || (d.goals[goalName] = { xp: 0, level: 1, sessions: 0 });
      const before = g.level;
      g.xp += xpReward;
      g.sessions += 1;
      
      // Calculate level from XP
      const levelFromXp = (xp: number) => Math.max(1, Math.floor(Math.sqrt(xp / 12)) + 1);
      g.level = levelFromXp(g.xp);
      d.xpGlobal += xpReward;

      d.wins.unshift({
        id: "w_focus_" + Date.now(),
        title: `Focused on: ${title || "General Focus"}`,
        at: Date.now(),
        text: `Logged a ${minutes}m focus session! (+${xpReward} XP)`,
        badge: "habit"
      });
    });

    flash(`Focused ${minutes}m! (+${Math.round(minutes * 0.8)} XP on Focus Mastery)`, "good");
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const mins = parseInt(manualMinutes);
    if (!mins || mins <= 0 || isNaN(mins)) {
      flash("Enter a valid amount of minutes.", "warn");
      return;
    }
    logFocus(mins, manualTitle.trim() || "Offline Focus");
    setManualMinutes("");
    setManualTitle("");
  };

  const deleteFocusLog = (id: string) => {
    const item = focusLog.find(x => x.id === id);
    if (!item) return;
    patch(d => {
      d.focusLog = (d.focusLog || []).filter(x => x.id !== id);
    });
    flash(`Deleted focus session: "${item.taskTitle}"`, "warn");
  };

  // Grid Data calculation for contribution map
  const getGridData = () => {
    const columns = 18; // 18 weeks contribution map
    const cellsPerCol = 7; // Sunday - Saturday
    const totalDays = columns * cellsPerCol;
    
    const today = new Date();
    const startDate = new Date(today);
    // Align starting date to 17 weeks ago Sunday
    startDate.setDate(today.getDate() - (17 * 7 + today.getDay()));
    startDate.setHours(0, 0, 0, 0);

    const data: { date: Date; dateStr: string; minutes: number; count: number }[] = [];
    
    // Fill days
    for (let i = 0; i < totalDays; i++) {
      const current = new Date(startDate);
      current.setDate(startDate.getDate() + i);
      const dateStr = current.toDateString();

      // Find sessions on this exact day
      const daySessions = focusLog.filter(item => {
        return new Date(item.at).toDateString() === dateStr;
      });

      const minutes = daySessions.reduce((acc, x) => acc + x.minutes, 0);
      data.push({
        date: current,
        dateStr: current.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        minutes,
        count: daySessions.length
      });
    }

    // Split into weeks (columns)
    const grid: typeof data[] = [];
    for (let c = 0; c < columns; c++) {
      grid.push(data.slice(c * 7, (c + 1) * 7));
    }
    return grid;
  };

  const grid = getGridData();

  // Color mappings based on focused minutes
  const getCellColor = (minutes: number) => {
    if (minutes === 0) return "rgba(255, 255, 255, 0.04)";
    if (minutes <= 15) return "color-mix(in srgb, var(--flow) 22%, transparent)";
    if (minutes <= 30) return "color-mix(in srgb, var(--flow) 48%, transparent)";
    if (minutes <= 50) return "color-mix(in srgb, var(--flow) 74%, transparent)";
    return "var(--flow)"; // Full bright theme accent
  };

  // Statistics calculation
  const totalMins = focusLog.reduce((acc, x) => acc + x.minutes, 0);
  const totalHours = (totalMins / 60).toFixed(1);
  const totalSessions = focusLog.length;
  
  // Daily Average based on active focus days in last 3 months
  const activeDaysCount = new Set(focusLog.map(x => new Date(x.at).toDateString())).size;
  const avgSession = totalSessions > 0 ? Math.round(totalMins / totalSessions) : 0;

  // Streak calculations
  const calculateStreak = () => {
    if (focusLog.length === 0) return 0;
    const sortedDates = [...new Set(focusLog.map(x => new Date(x.at).toDateString()))]
      .map(d => new Date(d))
      .sort((a, b) => b.getTime() - a.getTime()); // Newest first

    let streak = 0;
    let checkDate = new Date();
    checkDate.setHours(0,0,0,0);

    // If no focus today and no focus yesterday, streak is broken
    const todayStr = checkDate.toDateString();
    const yesterday = new Date(checkDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    const hasToday = sortedDates.some(d => d.toDateString() === todayStr);
    const hasYesterday = sortedDates.some(d => d.toDateString() === yesterdayStr);

    if (!hasToday && !hasYesterday) return 0;

    let current = hasToday ? checkDate : yesterday;
    while (true) {
      const currentStr = current.toDateString();
      const match = sortedDates.some(d => d.toDateString() === currentStr);
      if (match) {
        streak++;
        current.setDate(current.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  };

  const focusStreak = calculateStreak();

  // Time Formatter
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const progressPercent = duration > 0 ? (timeLeft / duration) : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.5fr 1fr", gap: 18 }} className="rise">
      {/* LEFT COLUMN: TIMER & CONTROLLER */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--flow)", display: "flex" }}><MIcon name="hourglass_empty" s={20} /></span>
              <h2 className="display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Deep Focus Chamber</h2>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { label: "5m", sec: 300 },
                { label: "15m", sec: 900 },
                { label: "25m", sec: 1500 },
                { label: "50m", sec: 3000 }
              ].map(p => (
                <button
                  key={p.label}
                  onClick={() => {
                    setIsRunning(false);
                    setTimeLeft(p.sec);
                    setDuration(p.sec);
                    stopAmbientSound();
                  }}
                  className="tap focusable"
                  style={{
                    padding: "3px 9px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 11,
                    fontWeight: 600,
                    border: "1px solid " + (duration === p.sec ? "var(--flow)" : "var(--line)"),
                    background: duration === p.sec ? "color-mix(in srgb, var(--flow) 12%, transparent)" : "transparent",
                    color: duration === p.sec ? "var(--flow)" : "var(--muted-2)",
                    cursor: "pointer"
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* TIMER HUD ELEMENT */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", background: "var(--surface-2)", borderRadius: "var(--radius)", border: "1px solid var(--line)", position: "relative", overflow: "hidden" }}>
            
            {/* Ambient Sound Selector */}
            <div style={{ position: "absolute", top: 12, right: 12, display: "flex", alignItems: "center", gap: 6, zIndex: 10 }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--muted-2)", display: isMobile ? "none" : "block" }}>noise generator:</span>
              <select
                value={ambientSound}
                onChange={(e) => setAmbientSound(e.target.value as any)}
                className="tap"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "4px 8px",
                  background: "var(--surface)",
                  color: "var(--text)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  outline: "none",
                  cursor: "pointer"
                }}
              >
                <option value="none">🔇 Quiet</option>
                <option value="white">🌌 Pink Noise</option>
                <option value="rain">🌧️ Rain Shower</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* Dynamic countdown text */}
              <div style={{ fontSize: 56, fontWeight: 700, fontFamily: "var(--font-mono)", color: timeLeft === 0 ? "var(--good)" : "var(--text)", letterSpacing: -2, marginBottom: 8, lineHeight: 1 }}>
                {formatTime(timeLeft)}
              </div>
              
              {/* Task Title Selector or Text */}
              <div style={{ minHeight: 24, marginBottom: 20, textAlign: "center", maxWidth: "90%" }}>
                {isRunning ? (
                  <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>
                    Focusing on: <strong style={{ color: "var(--text)" }}>{activeTasksToChoose.find(t => t.id === selectedTaskId)?.title || "General Focus"}</strong>
                  </span>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontSize: 11.5, color: "var(--muted-2)" }}>target:</span>
                    <select
                      value={selectedTaskId}
                      onChange={(e) => setSelectedTaskId(e.target.value)}
                      className="tap"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        padding: "4px 10px",
                        background: "var(--surface)",
                        color: "var(--text)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--radius-sm)",
                        maxWidth: 240,
                        outline: "none",
                        cursor: "pointer"
                      }}
                    >
                      <option value="general">🌌 General/Personal Focus</option>
                      {activeTasksToChoose.map(t => (
                        <option key={t.id} value={t.id}>🎯 {t.title}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Minimalist Progress Pill */}
              <div style={{ width: 280, maxWidth: "100%", height: 6, background: "var(--line)", borderRadius: 99, overflow: "hidden", marginBottom: 24 }}>
                <div style={{ height: "100%", width: `${progressPercent * 100}%`, background: timeLeft === 0 ? "var(--good)" : "var(--flow)", borderRadius: 99, transition: "width 0.4s cubic-bezier(0.1, 0.8, 0.2, 1)" }} />
              </div>

              {/* Large CTA Controller Buttons */}
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => setIsRunning(!isRunning)}
                  className="tap focusable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 22px",
                    borderRadius: 30,
                    fontSize: 13.5,
                    fontWeight: 700,
                    background: isRunning ? "var(--surface)" : "var(--flow)",
                    color: isRunning ? "var(--text)" : "var(--on-accent)",
                    border: isRunning ? "1px solid var(--line)" : "none",
                    cursor: "pointer"
                  }}
                >
                  <MIcon name={isRunning ? "pause" : "play_arrow"} s={16} fill={isRunning ? 0 : 1} style={{ color: isRunning ? "var(--text)" : "var(--on-accent)" }} />
                  {isRunning ? "Pause Session" : "Initiate Focus"}
                </button>
                <button
                  onClick={() => {
                    setIsRunning(false);
                    setTimeLeft(duration);
                    stopAmbientSound();
                  }}
                  className="tap focusable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 18px",
                    borderRadius: 30,
                    fontSize: 13,
                    fontWeight: 600,
                    background: "transparent",
                    color: "var(--muted)",
                    border: "1px solid var(--line)",
                    cursor: "pointer"
                  }}
                >
                  <MIcon name="replay" s={15} />
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CONTRIBUTION MAP: ACTIVITY MAP */}
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--flow)", display: "flex" }}><MIcon name="grid_on" s={19} /></span>
              <h2 className="display" style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Focus Contribution Grid</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="mono text-[10px] text-var(--muted-2)">Less</span>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: getCellColor(0) }} />
              <span style={{ width: 9, height: 9, borderRadius: 2, background: getCellColor(5) }} />
              <span style={{ width: 9, height: 9, borderRadius: 2, background: getCellColor(20) }} />
              <span style={{ width: 9, height: 9, borderRadius: 2, background: getCellColor(45) }} />
              <span style={{ width: 9, height: 9, borderRadius: 2, background: getCellColor(60) }} />
              <span className="mono text-[10px] text-var(--muted-2) ml-1">More</span>
            </div>
          </div>

          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
            Your daily focused workflow represented as a heat map. Hover or click cells to view historical focus intervals.
          </p>

          {/* GRID SCROLLBOX CONTAINER */}
          <div style={{ overflowX: "auto", paddingBottom: 6 }} className="scrollbar">
            <div style={{ display: "flex", gap: 3, minWidth: 320 }}>
              {/* Days label row */}
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: 81, paddingRight: 6, fontSize: 9, color: "var(--muted-2)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
                <span>Su</span>
                <span>Tu</span>
                <span>Th</span>
                <span>Sa</span>
              </div>

              {/* Columns representing weeks */}
              {grid.map((week, wIdx) => (
                <div key={wIdx} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {week.map((day, dIdx) => (
                    <div
                      key={dIdx}
                      onMouseEnter={() => setHoveredCell({ dateStr: day.dateStr, minutes: day.minutes, count: day.count })}
                      onMouseLeave={() => setHoveredCell(null)}
                      onClick={() => setHoveredCell({ dateStr: day.dateStr, minutes: day.minutes, count: day.count })}
                      className="tap"
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 2,
                        background: getCellColor(day.minutes),
                        cursor: "pointer",
                        transform: "scale(1)",
                        boxShadow: "none"
                      }}
                      title={`${day.dateStr}: ${day.minutes}m focused (${day.count} session${day.count !== 1 ? "s" : ""})`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* DYNAMIC TOOLTIP FOOTER */}
          <div style={{ minHeight: 26, background: "var(--surface-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", padding: "4px 10px", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {hoveredCell ? (
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                <MIcon name="calendar_today" s={13} style={{ color: "var(--flow)" }} />
                <strong>{hoveredCell.dateStr}</strong>: {hoveredCell.minutes} mins focused ({hoveredCell.count} session{hoveredCell.count !== 1 ? "s" : ""})
              </span>
            ) : (
              <span className="mono" style={{ fontSize: 10.5, color: "var(--muted-2)", fontStyle: "italic" }}>
                Hover/touch cells to view specific dates
              </span>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: STATS, MANUAL INPUT & HISTORIC LOG */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        
        {/* STATS HIGHLIGHT */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Performance metrics</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: "var(--surface-2)", padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
              <div className="eyebrow" style={{ fontSize: 9 }}>Total hours</div>
              <div className="display" style={{ fontSize: 24, fontWeight: 700, color: "var(--flow)", marginTop: 4 }}>{totalHours}h</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>{totalMins} mins</div>
            </div>
            <div style={{ background: "var(--surface-2)", padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
              <div className="eyebrow" style={{ fontSize: 9 }}>Focus Streak</div>
              <div className="display" style={{ fontSize: 24, fontWeight: 700, color: "var(--gold)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                {focusStreak} <span style={{ fontSize: 14 }}>days</span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>consistently active</div>
            </div>
            <div style={{ background: "var(--surface-2)", padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
              <div className="eyebrow" style={{ fontSize: 9 }}>avg length</div>
              <div className="display" style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginTop: 4 }}>{avgSession}m</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>per completed session</div>
            </div>
            <div style={{ background: "var(--surface-2)", padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
              <div className="eyebrow" style={{ fontSize: 9 }}>Sessions</div>
              <div className="display" style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginTop: 4 }}>{totalSessions}</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>deep focus intervals</div>
            </div>
          </div>
        </div>

        {/* MANUAL FOCUS LOG FORM */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Log offline focus</div>
          <form onSubmit={handleManualSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                placeholder="Mins"
                required
                min="1"
                max="480"
                value={manualMinutes}
                onChange={e => setManualMinutes(e.target.value)}
                style={{
                  width: 76,
                  padding: "6px 10px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text)",
                  outline: "none",
                  fontSize: 13
                }}
              />
              <input
                type="text"
                placeholder="What did you focus on?"
                value={manualTitle}
                onChange={e => setManualTitle(e.target.value)}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text)",
                  outline: "none",
                  fontSize: 13
                }}
              />
            </div>
            <button
              type="submit"
              className="tap focusable"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                fontSize: 12,
                fontWeight: 700,
                background: "color-mix(in srgb, var(--flow) 15%, transparent)",
                color: "var(--flow)",
                border: "1px solid color-mix(in srgb, var(--flow) 30%, transparent)",
                cursor: "pointer",
                textAlign: "center"
              }}
            >
              + Log Focused Minutes
            </button>
          </form>
        </div>

        {/* HISTORY LIST */}
        <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", maxHeight: 310 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Recent focus intervals</div>
          <div className="scrollbar" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
            {focusLog.map((log) => (
              <div
                key={log.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  background: "var(--surface-2)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--line)",
                  gap: 8
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, paddingRight: 6 }}>{log.taskTitle}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--flow)", fontWeight: 700, flexShrink: 0 }}>+{log.minutes}m</span>
                  </div>
                  <div className="mono" style={{ fontSize: 9.5, color: "var(--muted-2)" }}>
                    {new Date(log.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {new Date(log.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
                <button
                  onClick={() => deleteFocusLog(log.id)}
                  className="tap focusable"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--bad)",
                    padding: "4px 6px",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="Delete log"
                >
                  <MIcon name="delete" s={14} />
                </button>
              </div>
            ))}
            {focusLog.length === 0 && (
              <div style={{ textAlign: "center", padding: "30px 0", color: "var(--muted-2)", fontStyle: "italic", fontSize: 13 }}>
                No focus sessions logged yet
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
