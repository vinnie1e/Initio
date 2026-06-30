import React, { useState } from "react";
import { PlayerStats, Badge } from "../types";
import { Flame, Award, Shield, Compass, Sparkles, ChevronRight, Gift } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface PlayerCardProps {
  stats: PlayerStats;
  onSpinReward: () => void;
  rewardClaimed: string | null;
  setRewardClaimed: (val: string | null) => void;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({
  stats,
  onSpinReward,
  rewardClaimed,
  setRewardClaimed,
}) => {
  const [spinning, setSpinning] = useState(false);

  const handleRewardWheel = () => {
    if (spinning) return;
    setSpinning(true);
    // Mimic slot machine feel
    setTimeout(() => {
      onSpinReward();
      setSpinning(false);
    }, 1200);
  };

  const xpPercentage = Math.min(100, (stats.xp / stats.nextLevelXp) * 100);

  return (
    <div className="p-5 rounded-2xl bg-white/5 border border-white/10 shadow-lg relative overflow-hidden backdrop-blur-md">
      {/* Background soft glowing lights */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/10 rounded-full blur-2xl" />
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-violet-500/10 rounded-full blur-2xl" />

      <div className="relative z-10">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-white/50 font-mono">OPERATIVE IDENTITY</div>
            <h3 className="text-xl font-bold flex items-center gap-2 text-white">
              Level {stats.level} <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-mono">RANK A</span>
            </h3>
          </div>

          {/* Dynamic Streak Flame */}
          <div className="flex items-center gap-2">
            <AnimatePresence mode="wait">
              {stats.isDebtMode ? (
                <motion.div
                  key="debt"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="flex items-center gap-1.5 px-3 py-1 bg-cyan-950/40 border border-cyan-500/30 rounded-xl text-cyan-300 text-sm font-mono"
                >
                  <Shield className="w-4 h-4 text-cyan-400 animate-pulse" />
                  <span>STREAK DEBT</span>
                </motion.div>
              ) : (
                <motion.div
                  key="flame"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/15 border border-amber-500/30 rounded-xl text-amber-400 text-sm font-mono font-bold"
                >
                  <Flame className="w-4 h-4 fill-amber-500 text-amber-500 animate-bounce" />
                  <span>{stats.streak}d STREAK</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* XP Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-white/60 mb-1 font-mono">
            <span>XP PROGRESS</span>
            <span>{stats.xp} / {stats.nextLevelXp} XP</span>
          </div>
          <div className="w-full bg-white/10 h-3 rounded-full overflow-hidden p-0.5 border border-white/5">
            <motion.div
              className="bg-gradient-to-r from-violet-500 to-teal-400 h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${xpPercentage}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Milestone Badges list */}
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="text-xs uppercase tracking-widest text-white/50 font-mono mb-2">EARNED SHIELDS & BADGES</div>
          <div className="grid grid-cols-4 gap-2">
            {stats.badges.map((badge) => {
              const unlocked = !!badge.unlockedAt;
              return (
                <div
                  key={badge.id}
                  title={`${badge.title}: ${badge.description}`}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all duration-300 ${
                    unlocked
                      ? "bg-violet-950/25 border-violet-500/30 text-violet-300 shadow-md shadow-violet-500/5"
                      : "bg-white/5 border-white/10 text-white/30"
                  }`}
                >
                  <Award className={`w-5 h-5 mb-1 ${unlocked ? "text-teal-400" : "text-white/20"}`} />
                  <span className="text-[10px] font-medium tracking-tight text-center truncate w-full">
                    {badge.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Variable Rewards Box - Slot Machine feel */}
        <div className="mt-5 bg-gradient-to-br from-violet-950/40 to-teal-950/30 border border-white/10 rounded-xl p-3">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-xs font-bold text-teal-300 font-mono flex items-center gap-1.5 uppercase">
                <Sparkles className="w-3.5 h-3.5" /> Variable Reward Dispenser
              </h4>
              <p className="text-[11px] text-white/60 leading-relaxed mt-1">
                Completed tasks unlock surprise Momentum Chests for rare XP spikes.
              </p>
            </div>
            <button
              onClick={handleRewardWheel}
              disabled={spinning}
              className={`p-2 rounded-lg bg-teal-500 text-slate-950 text-xs font-mono font-bold hover:bg-teal-400 transition flex items-center gap-1 disabled:opacity-50 ${
                spinning ? "animate-pulse" : ""
              }`}
            >
              <Gift className="w-3.5 h-3.5" /> SPIN
            </button>
          </div>

          <AnimatePresence mode="wait">
            {spinning && (
              <motion.div
                key="spinning"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="mt-3 text-center py-2 bg-slate-900/60 rounded-lg text-xs font-mono text-amber-400 tracking-wider animate-pulse flex items-center justify-center gap-1.5"
              >
                <Gift className="w-3.5 h-3.5 animate-spin text-amber-400" /> SELECTING YOUR MOMENTUM REWARD...
              </motion.div>
            )}

            {!spinning && rewardClaimed && (
              <motion.div
                key="reward"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="mt-3 p-2 bg-teal-950/50 border border-teal-500/30 rounded-lg text-xs flex items-center justify-between text-teal-200 font-mono"
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  {rewardClaimed}
                </span>
                <button
                  onClick={() => setRewardClaimed(null)}
                  className="text-[10px] uppercase font-bold text-white/50 hover:text-white"
                >
                  DISMISS
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
