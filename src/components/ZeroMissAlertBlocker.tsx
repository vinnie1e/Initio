import React, { useState, useEffect, useRef } from "react";
import { Task } from "../types";
import { AlertOctagon, Timer, Play, ShieldAlert, ArrowRight, Volume2, VolumeX } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { startSiren, stopSiren } from "../utils/audio";

interface ZeroMissAlertBlockerProps {
  activeTask: Task | null;
  onStartTask: (taskId: string) => void;
  onDismiss: () => void;
}

export const ZeroMissAlertBlocker: React.FC<ZeroMissAlertBlockerProps> = ({
  activeTask,
  onStartTask,
  onDismiss,
}) => {
  const [timeLeft, setTimeLeft] = useState(0);
  const [canDismiss, setCanDismiss] = useState(false);
  const [slideVal, setSlideVal] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Initialize Siren and Lock timer
  useEffect(() => {
    if (activeTask) {
      // Start siren alarm sound
      if (!isMuted) {
        startSiren();
      }

      // Initialize staying timer lock based on task's lockStaySeconds
      const staySecs = activeTask.lockStaySeconds || 15;
      setTimeLeft(staySecs);
      setCanDismiss(false);
      setSlideVal(0);

      const timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setCanDismiss(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        clearInterval(timer);
        stopSiren();
      };
    }
  }, [activeTask, isMuted]);

  if (!activeTask) return null;

  const handleMuteToggle = () => {
    if (isMuted) {
      startSiren();
      setIsMuted(false);
    } else {
      stopSiren();
      setIsMuted(true);
    }
  };

  const handleSlideChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setSlideVal(val);
    if (val >= 95) {
      // Trigger Start Task
      stopSiren();
      onStartTask(activeTask.id);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col justify-between p-6 overflow-hidden">
      {/* Background flashing glow */}
      <div className="absolute inset-0 bg-red-950/20 animate-pulse pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-1 bg-red-600 animate-bounce" />

      {/* Header Info */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2 text-rose-500 font-mono text-sm font-bold animate-pulse">
          <AlertOctagon className="w-5 h-5 animate-spin" />
          <span>HARD LOCKOUT: CRITICAL LIMIT BREACH</span>
        </div>

        <button
          onClick={handleMuteToggle}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition flex items-center gap-1.5 text-xs font-mono"
        >
          {isMuted ? <Volume2 className="w-4 h-4 text-teal-400" /> : <VolumeX className="w-4 h-4 text-rose-400 animate-bounce" />}
          {isMuted ? "UNMUTE" : "SILENCE ALARM"}
        </button>
      </div>

      {/* Core Warning Block */}
      <div className="relative z-10 flex-1 flex flex-col justify-center items-center text-center max-w-xl mx-auto space-y-6">
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="p-4 rounded-3xl bg-rose-500/10 border-2 border-rose-500/30 flex flex-col items-center"
        >
          <Timer className="w-14 h-14 text-rose-500 animate-bounce mb-3" />
          <h1 className="text-2xl font-black tracking-tighter text-rose-500 uppercase leading-none md:text-3xl">
            LATEST COMPATIBLE START REACHED
          </h1>
        </motion.div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">{activeTask.title}</h2>
          <p className="text-sm text-rose-300 font-medium leading-relaxed flex items-center justify-center gap-1.5 flex-wrap">
            <AlertOctagon className="w-4 h-4 text-rose-500 shrink-0" /> According to your calendar, this task takes <span className="font-bold underline">{activeTask.durationMinutes} minutes</span> and is due by <span className="font-bold underline">{new Date(activeTask.deadline).toLocaleTimeString()}</span>. 
            Your calendar contains blocks hereafter. If you do not start <span className="text-white font-bold underline animate-pulse">RIGHT NOW</span>, completion is mathematically impossible.
          </p>
        </div>

        {/* Dynamic Timeline Graph */}
        <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 font-mono text-xs space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40 text-left">EXECUTIVE TIMELINE:</div>
          <div className="flex items-center justify-between relative pt-6 pb-2">
            {/* Timeline Bar */}
            <div className="absolute top-2.5 left-0 right-0 h-1.5 bg-rose-600 rounded-full" />
            
            <div className="flex flex-col items-start relative z-10 text-left">
              <span className="w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-black mb-1 animate-ping" />
              <span className="text-[10px] text-rose-400 font-bold">LATEST START</span>
              <span className="text-[9px] text-white/50">{new Date(Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>

            <div className="flex flex-col items-center relative z-10 text-center">
              <span className="w-3.5 h-3.5 bg-amber-500 rounded-full border-2 border-black mb-1" />
              <span className="text-[10px] text-amber-400">BLOCKED PERIOD</span>
              <span className="text-[9px] text-white/50">Next {activeTask.durationMinutes}m</span>
            </div>

            <div className="flex flex-col items-end relative z-10 text-right">
              <span className="w-3.5 h-3.5 bg-teal-500 rounded-full border-2 border-black mb-1" />
              <span className="text-[10px] text-teal-400 font-bold">DEADLINE</span>
              <span className="text-[9px] text-white/50">{new Date(activeTask.deadline).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
          </div>
          <div className="text-[11px] text-teal-300 italic flex items-center justify-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-teal-400 shrink-0" /> Identity Purpose: "{activeTask.why || "To strive for extreme self-discipline and finish heavy goals."}"
          </div>
        </div>

        {/* Lock staying timer */}
        {!canDismiss ? (
          <div className="text-sm font-mono text-white/60 flex items-center gap-2 animate-pulse bg-white/5 px-4 py-2 rounded-xl">
            <AlertOctagon className="w-4 h-4 text-rose-500 shrink-0" /> <span>Emergency screen lock active for:</span>
            <span className="font-bold text-rose-400 text-base">{timeLeft}s</span>
          </div>
        ) : (
          <div className="text-xs text-teal-400 font-mono flex items-center gap-1.5 animate-pulse">
            <ShieldAlert className="w-4 h-4 text-teal-400 shrink-0" /> <span>Lock duration completed. Start option unlocked.</span>
          </div>
        )}
      </div>

      {/* Slide to Start Now Slider */}
      <div className="relative z-10 w-full max-w-md mx-auto space-y-3 pb-4">
        {canDismiss && (
          <button
            onClick={onDismiss}
            className="w-full py-2.5 rounded-xl border border-rose-500/30 text-rose-400 font-bold font-mono text-xs hover:bg-rose-500/10 transition"
          >
            SNOOZE DEADLINE (RISK PENALTY)
          </button>
        )}

        <div
          ref={sliderRef}
          className="relative w-full h-14 bg-white/10 rounded-2xl border border-white/15 overflow-hidden flex items-center justify-between"
        >
          {/* Slide track visual guides */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs font-mono font-bold tracking-widest text-teal-400/60 animate-pulse">
            SLIDE TO COMMENCE FOCUS WORK
          </div>

          <div
            className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-teal-500/20 to-teal-400/40 border-r border-teal-500/50 pointer-events-none transition-all"
            style={{ width: `${slideVal}%` }}
          />

          <input
            type="range"
            min="0"
            max="100"
            value={slideVal}
            onChange={handleSlideChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
          />

          <div
            className="absolute top-1 bottom-1 w-12 rounded-xl bg-teal-400 text-slate-950 flex items-center justify-center transition-all pointer-events-none shadow-lg"
            style={{ left: `calc(${slideVal}% * 0.85 + 4px)` }}
          >
            <Play className="w-5 h-5 fill-slate-950 text-slate-950" />
          </div>
        </div>
      </div>
    </div>
  );
};
