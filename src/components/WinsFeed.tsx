import React, { useState } from "react";
import { Task } from "../types";
import { Trophy, ShieldAlert, Sparkles, Send, BrainCircuit, Lightbulb, RefreshCw, Shield } from "lucide-react";
import { motion } from "motion/react";

interface WinsFeedProps {
  completedTasks: Task[];
  onAddReflection: (slip: string, save: string) => void;
  reflections: Array<{ date: string; slip: string; save: string }>;
}

export const WinsFeed: React.FC<WinsFeedProps> = ({
  completedTasks,
  onAddReflection,
  reflections,
}) => {
  const [slipInput, setSlipInput] = useState("");
  const [saveInput, setSaveInput] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);

  const handleSubmitReflection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!slipInput.trim() || !saveInput.trim()) return;
    onAddReflection(slipInput, saveInput);
    setSlipInput("");
    setSaveInput("");
  };

  const generateAIReflection = async () => {
    setLoadingAI(true);
    try {
      // Direct client or mock call for quick reflections based on task status
      const response = await fetch("/api/gemini/suggest-motivation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "weekly reflection slip and save analysis",
          nudgeStyle: "analytical"
        }),
      });
      const data = await response.json();
      setSlipInput("Almost slipped on: Procrastinating on difficult, high-consequence assignments until the final hour.");
      setSaveInput(`Saved by: ${data.motivation || "Engaging Bento Mode study bursts and using Pavlovian focus triggers."}`);
    } catch (err) {
      setSlipInput("Almost slipped on: Letting evening fatigue disrupt my habit stack schedule.");
      setSaveInput("Saved by: Using the 11:50 PM Hard alert lock and reducing MVP scope to a 5-minute ritual.");
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Dynamic Wins Feed */}
      <div className="p-5 rounded-2xl bg-slate-900/40 border border-white/10 shadow-xl backdrop-blur-md">
        <h3 className="font-bold text-white text-lg flex items-center gap-2 mb-1">
          <Trophy className="w-5 h-5 text-amber-400" />
          The Payoff & Wins Feed
        </h3>
        <p className="text-xs text-white/50 mb-4">
          Proof of your follow-through. Each finish logs a concrete gain matching your identity goals.
        </p>

        {completedTasks.length === 0 ? (
          <div className="text-center py-8 text-xs text-white/30 border border-dashed border-white/10 rounded-xl">
            No gains logged yet. Finish a task or habit to record your first Win!
          </div>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {completedTasks.map((task) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-3 bg-gradient-to-r from-teal-950/20 to-slate-950/40 border border-teal-500/20 rounded-xl flex items-start gap-3"
              >
                <div className="p-2 bg-teal-500/10 rounded-lg text-teal-400 font-bold text-xs select-none mt-0.5">
                  WIN
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-white">{task.title}</h4>
                  <p className="text-[11px] text-teal-300 leading-relaxed font-medium flex items-center gap-1">
                    <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" /> <span className="text-white/60">Payoff Statement:</span> "You unlocked full relief and kept your streak alive. You successfully honored your why: <span className="underline italic text-teal-200">{task.why || "To strive for continuous excellence"}</span>."
                  </p>
                  <div className="text-[9px] text-white/40 font-mono">
                    Completed on: {task.completedAt ? new Date(task.completedAt).toLocaleDateString() : new Date().toLocaleDateString()}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Weekly reflection section */}
      <div className="p-5 rounded-2xl bg-slate-900/40 border border-white/10 shadow-xl backdrop-blur-md">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-white text-lg flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-violet-400" />
              Weekly Reflection Analysis
            </h3>
            <p className="text-xs text-white/50">Identify structural blockers. What almost slipped, and what saved it?</p>
          </div>
          <button
            onClick={generateAIReflection}
            disabled={loadingAI}
            className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-mono transition flex items-center gap-1"
            title="Generate AI Weekly Summary"
          >
            {loadingAI ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3.5 h-3.5" />}
            AI ASSIST
          </button>
        </div>

        <form onSubmit={handleSubmitReflection} className="space-y-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-mono text-white/40 block mb-1">What almost slipped?</label>
              <input
                type="text"
                value={slipInput}
                onChange={(e) => setSlipInput(e.target.value)}
                placeholder="e.g., Preparing for Chemistry midterm"
                className="w-full bg-slate-950/60 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-mono text-white/40 block mb-1">What saved it?</label>
              <input
                type="text"
                value={saveInput}
                onChange={(e) => setSaveInput(e.target.value)}
                placeholder="e.g., Rescue mode minimum-viable outline"
                className="w-full bg-slate-950/60 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!slipInput.trim() || !saveInput.trim()}
              className="px-3.5 py-1.5 bg-violet-500 hover:bg-violet-400 text-white rounded-xl text-xs font-bold font-mono transition flex items-center gap-1 disabled:opacity-50"
            >
              <Send className="w-3 h-3" /> LOG REFLECTION
            </button>
          </div>
        </form>

        {/* Reflection history log */}
        {reflections.length > 0 && (
          <div className="border-t border-white/10 pt-3 space-y-2">
            <div className="text-[10px] uppercase font-mono text-white/40 mb-1">Historical Log</div>
            {reflections.map((r, i) => (
              <div key={i} className="p-2.5 bg-slate-950/40 border border-white/5 rounded-xl text-xs space-y-1">
                <div className="flex justify-between text-[9px] text-white/40 font-mono">
                  <span>WEEKLY RECONCILIATION</span>
                  <span>{r.date}</span>
                </div>
                <div className="text-rose-300 flex items-center gap-1.5">
                  <span className="font-bold text-rose-400 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> Slip:</span> {r.slip}
                </div>
                <div className="text-teal-300 flex items-center gap-1.5">
                  <span className="font-bold text-teal-400 flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-teal-400" /> Save:</span> {r.save}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
