import React, { useState, useEffect } from "react";
import { CoPilotProposal, Task, CalendarEvent } from "../types";
import { Sparkles, Terminal, Check, X, ShieldAlert, Cpu, RefreshCw, Calendar, Bell } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface CoPilotPanelProps {
  onApplyProposal: (proposal: CoPilotProposal) => void;
  calendarState: CalendarEvent[];
  tasksState: Task[];
}

export const CoPilotPanel: React.FC<CoPilotPanelProps> = ({
  onApplyProposal,
  calendarState,
  tasksState,
}) => {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [traceSteps, setTraceSteps] = useState<string[]>([]);
  const [currentTraceIndex, setCurrentTraceIndex] = useState(0);
  const [proposal, setProposal] = useState<CoPilotProposal | null>(null);
  
  // Approvals state
  const [approvedTasks, setApprovedTasks] = useState<boolean[]>([]);
  const [approvedBlocks, setApprovedBlocks] = useState<boolean[]>([]);
  const [approvedReminders, setApprovedReminders] = useState<boolean[]>([]);

  const handleSynthesize = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setProposal(null);
    setTraceSteps([]);
    setCurrentTraceIndex(0);

    // Initial dummy quick steps for immersive startup loop
    const initialSteps = [
      "Booting Autonomous Agent Core...",
      "Syncing with active calendar & tasks registry...",
      "Analyzing available high-energy focus slots...",
    ];
    setTraceSteps(initialSteps);

    try {
      const response = await fetch("/api/gemini/copilot-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekPrompt: prompt,
          calendarState,
          tasksState,
        }),
      });
      const data = await response.json();
      
      if (data.error) throw new Error(data.error);

      // Merge trace steps
      const fullSteps = [...initialSteps, ...(data.traceSteps || [])];
      setTraceSteps(fullSteps);
      setProposal(data);

      // Initialize approvals
      setApprovedTasks(new Array(data.tasksToCreate?.length || 0).fill(true));
      setApprovedBlocks(new Array(data.scheduleBlocks?.length || 0).fill(true));
      setApprovedReminders(new Array(data.suggestedReminders?.length || 0).fill(true));

    } catch (err) {
      console.error(err);
      setTraceSteps(prev => [...prev, "ERROR: Connection interrupted. Falling back to local solver."]);
    } finally {
      setLoading(false);
    }
  };

  // Animate the trace step-by-step
  useEffect(() => {
    if (traceSteps.length > 0 && currentTraceIndex < traceSteps.length - 1) {
      const interval = setTimeout(() => {
        setCurrentTraceIndex(prev => prev + 1);
      }, 900);
      return () => clearTimeout(interval);
    }
  }, [traceSteps, currentTraceIndex]);

  const handleApply = () => {
    if (!proposal) return;
    
    // Filter approved items
    const filteredProposal: CoPilotProposal = {
      traceSteps: proposal.traceSteps,
      tasksToCreate: proposal.tasksToCreate.filter((_, i) => approvedTasks[i]),
      scheduleBlocks: proposal.scheduleBlocks.filter((_, i) => approvedBlocks[i]),
      suggestedReminders: proposal.suggestedReminders.filter((_, i) => approvedReminders[i]),
      coPilotBriefing: proposal.coPilotBriefing
    };

    onApplyProposal(filteredProposal);
    setProposal(null);
    setPrompt("");
    setTraceSteps([]);
  };

  return (
    <div className="p-5 rounded-2xl bg-slate-900/40 border border-white/10 shadow-xl backdrop-blur-md">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
          <Cpu className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-white text-lg flex items-center gap-2">
            Autonomous Executive Co-pilot
          </h3>
          <p className="text-xs text-white/50">Describe your week; the agent acts, schedules, & suggests motivation.</p>
        </div>
      </div>

      <div className="space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., 'I have a huge Bio midterm on Wednesday morning and want to block out 3 hours of focused studying on Monday. Also remind me to drink water.'"
          rows={3}
          className="w-full bg-slate-950/60 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-white/30 focus:outline-none focus:border-teal-500/50 resize-none transition"
        />

        <div className="flex justify-end">
          <button
            onClick={handleSynthesize}
            disabled={loading || !prompt.trim()}
            className="px-4 py-2 bg-gradient-to-r from-teal-500 to-violet-500 text-slate-950 rounded-xl text-xs font-bold font-mono hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-teal-500/10"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {loading ? "SYNTHESIZING..." : "AUTONOMOUS PLAN"}
          </button>
        </div>
      </div>

      {/* Trace Log and Proposals */}
      <AnimatePresence>
        {traceSteps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 border-t border-white/10 pt-4 overflow-hidden"
          >
            <div className="flex items-center gap-1.5 text-xs text-white/50 font-mono mb-2">
              <Terminal className="w-3.5 h-3.5 text-teal-400" />
              <span>CO-PILOT EXECUTION TRACE</span>
            </div>

            <div className="bg-black/40 border border-white/5 rounded-xl p-3 font-mono text-[11px] leading-relaxed max-h-44 overflow-y-auto space-y-1.5">
              {traceSteps.slice(0, currentTraceIndex + 1).map((step, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-teal-300">
                  <span className="text-teal-500 select-none">&gt;</span>
                  <span>{step}</span>
                </div>
              ))}
              {loading && (
                <div className="text-white/40 text-[10px] animate-pulse">Running planning heuristics...</div>
              )}
            </div>
          </motion.div>
        )}

        {/* Human in the loop confirmation */}
        {proposal && currentTraceIndex >= traceSteps.length - 1 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mt-4 border border-violet-500/30 bg-violet-950/15 rounded-xl p-4"
          >
            <h4 className="text-xs uppercase tracking-widest text-violet-400 font-mono font-bold mb-3 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-violet-400 animate-pulse" /> Human-in-the-Loop Approval Required
            </h4>

            {/* Coach Voice Briefing */}
            <div className="mb-4 bg-violet-950/35 p-3 rounded-lg border border-violet-500/10">
              <div className="text-[10px] uppercase font-mono text-violet-300 tracking-wider">CO-PILOT COACH INSTRUCTIONS:</div>
              <p className="text-xs text-white/80 italic mt-1 leading-relaxed">"{proposal.coPilotBriefing}"</p>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {/* Proposed Tasks */}
              {proposal.tasksToCreate.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase font-mono text-white/50 mb-1.5 flex items-center gap-1">
                    <Check className="w-3 h-3 text-teal-400" /> Tasks to create:
                  </div>
                  <div className="space-y-1">
                    {proposal.tasksToCreate.map((t, idx) => (
                      <div key={idx} className="flex items-start justify-between bg-slate-950/40 p-2 rounded-lg border border-white/5">
                        <div>
                          <div className="text-xs font-bold text-white">{t.title}</div>
                          <div className="text-[10px] text-white/50 flex items-center gap-2 mt-0.5 font-mono">
                            <span>U: {t.urgency}</span>
                            <span>E: {t.effort}</span>
                            <span>C: {t.consequence}</span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={approvedTasks[idx]}
                          onChange={(e) => {
                            const copy = [...approvedTasks];
                            copy[idx] = e.target.checked;
                            setApprovedTasks(copy);
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-teal-500 focus:ring-teal-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Proposed Calendar Blocks */}
              {proposal.scheduleBlocks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase font-mono text-white/50 mb-1.5 flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-violet-400" /> Proposed Work Blocks:
                  </div>
                  <div className="space-y-1">
                    {proposal.scheduleBlocks.map((b, idx) => (
                      <div key={idx} className="flex items-start justify-between bg-slate-950/40 p-2 rounded-lg border border-white/5">
                        <div>
                          <div className="text-xs font-bold text-white">{b.title}</div>
                          <div className="text-[10px] text-violet-300 flex items-center gap-2 mt-0.5 font-mono">
                            <span>{new Date(b.startTime).toLocaleString()} ({b.durationMinutes}m)</span>
                            <span className="uppercase text-[9px] bg-violet-500/20 text-violet-200 px-1 rounded">
                              {b.energyLevelRequired} energy
                            </span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={approvedBlocks[idx]}
                          onChange={(e) => {
                            const copy = [...approvedBlocks];
                            copy[idx] = e.target.checked;
                            setApprovedBlocks(copy);
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-teal-500 focus:ring-teal-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Proposed Reminders */}
              {proposal.suggestedReminders.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase font-mono text-white/50 mb-1.5 flex items-center gap-1">
                    <Bell className="w-3 h-3 text-yellow-400" /> Proposed Reminders:
                  </div>
                  <div className="space-y-1">
                    {proposal.suggestedReminders.map((r, idx) => (
                      <div key={idx} className="flex items-start justify-between bg-slate-950/40 p-2 rounded-lg border border-white/5">
                        <div>
                          <div className="text-xs font-bold text-white">{r.title}</div>
                          <div className="text-[10px] text-yellow-300 mt-0.5 font-mono">
                            Trigger: {r.triggerContext}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={approvedReminders[idx]}
                          onChange={(e) => {
                            const copy = [...approvedReminders];
                            copy[idx] = e.target.checked;
                            setApprovedReminders(copy);
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-teal-500 focus:ring-teal-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Approve / Deny Actions */}
            <div className="flex gap-2 mt-4 border-t border-white/10 pt-3 justify-end">
              <button
                onClick={() => setProposal(null)}
                className="px-3 py-1.5 border border-white/15 hover:bg-white/5 text-white/80 rounded-xl text-xs font-bold font-mono transition"
              >
                ABORT
              </button>
              <button
                onClick={handleApply}
                className="px-4 py-1.5 bg-violet-500 hover:bg-violet-400 text-white rounded-xl text-xs font-bold font-mono transition flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" /> CONFIRM & APPLY
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
