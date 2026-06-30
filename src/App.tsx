import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Task, AppState, Win, Streak, Goal, EnergyLog, ScheduleBlock, Reminder, ThemeType, CustomStyle } from "./types";
import { HOUR, DAY, now, hoursTo, score, heurExtract, tasksFromGoal, busyBlocksFor, inBusy, latestSafeStart, resolvedSafeStarts, snapToWorkSlot } from "./lib/logic";
import { HabitsHeatmap } from "./components/HabitsHeatmap";
import FocusTab from "./components/FocusTab";
import { motion, AnimatePresence } from "motion/react";
import { applyM3PaletteToStyle, getM3Palette } from "./lib/m3Color";


function fmtDue(t: number) {
  const h = hoursTo(t);
  if (h < 0) return "overdue";
  if (h < 1) return Math.max(1, Math.round(h * 60)) + "m left";
  if (h < 24) return Math.round(h) + "h left";
  return Math.round(h / 24) + "d left";
}

function clockLabel(t: number) {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function reason(t: Task) {
  const h = hoursTo(t.due || 0);
  const effortH = (t.effortMin || 30) / 60;
  const runway = h / Math.max(0.25, effortH);
  if (h <= 0) return "Overdue — close it or run Rescue.";
  if (runway < 2 && h > 0) return "Behind pace — not much runway left for the effort.";
  if ((t.effortMin || 30) <= 10 && h < 48) return "Cheap win — clears in minutes, real cost if it slips.";
  if ((t.stakes || 2) === 3 && h < 72) return "High stakes and the clock is moving.";
  if (h < 6) return "Due very soon.";
  return "On track — keep the runway.";
}

function firstStep(t: Task) {
  const title = t.title.toLowerCase();
  if (/email|reply|respond|message|mail/.test(title)) {
    return { kind: "Draft reply", body: `Hi [name],\n\nThanks for reaching out about ${t.title.replace(/reply to|email|respond to/gi, "").trim() || "this"}. Quick note: [your point].\n\n[one specific next step]\n\nBest,\n[you]` };
  }
  if (/report|essay|write|draft|article|doc|proposal/.test(title)) {
    return { kind: "Outline", body: `1. Opening — the one thing this needs to land\n2. Point A — strongest evidence\n3. Point B — supporting\n4. Counter / risk — name it, answer it\n5. Close — the ask or takeaway` };
  }
  if (/bill|pay|invoice|rent|fee/.test(title)) {
    return { kind: "Checklist", body: `• Open the payment portal\n• Confirm amount + due date\n• Pay, screenshot confirmation\n• File the receipt` };
  }
  if (/apply|application|job|resume|cv/.test(title)) {
    return { kind: "Checklist", body: `• Tailor one line of the intro to this role\n• Paste resume, fix the top 3 bullets\n• Attach + submit\n• Log it in your tracker` };
  }
  if (/call|phone|ring|book|schedule/.test(title)) {
    return { kind: "Script", body: `Opening: "Hi, I'm calling about ___."\nGoal of the call: ___\nIf voicemail: name, number, one-line reason.` };
  }
  return { kind: "First move", body: `Smallest possible start: spend 5 minutes only on "${t.title}". Open the file/tab, write one sentence or do one click. Momentum follows motion.` };
}

function rescuePlan(t: Task) {
  const title = t.title.toLowerCase();
  if (/report|essay|write|draft|proposal/.test(title)) {
    return `MVP Scope:
Write a single tight page instead of a full document.

Speed Steps:
• Write a 3-sentence introduction.
• Present your single strongest point with one piece of evidence.
• Conclude with a 2-sentence closing statement.
• Submit immediately without any further editing.

Crisis Motivation:
Done is better than perfect. On-time-and-partial protects your streak!`;
  }
  if (/email|reply|respond/.test(title)) {
    return `MVP Scope:
Send a 3-line rapid reply.

Speed Steps:
• Acknowledge receipt of the message.
• Provide your single most critical answer or update.
• Promise a comprehensive followup by a specific date.
• Hit send right now.

Crisis Motivation:
A short reply on time beats a perfect one that is late. Protect your momentum!`;
  }
  return `MVP Scope:
Execute only the single most essential task requirement.

Speed Steps:
• Identify the single true prerequisite for the task to count as done.
• Spend exactly 5 to 10 minutes focused solely on that step.
• Mark as complete and submit immediately.
• Make a quick note of anything postponed for later.

Crisis Motivation:
Strip the noise. On-time-and-partial keeps your streak alive!`;
}

function gainStatement(t: Task, ctx: any) {
  const early = (t.completedAt as number) < (t.due || 0);
  const lead = early ? Math.round(((t.due || 0) - (t.completedAt as number)) / HOUR) : 0;
  const why = t.why ? ` It mattered because you said: “${t.why}”.` : "";
  if (t.type === "habit") {
    return `${t.title} — done${early ? ` (${lead}h early)` : ""}. That's session #${ctx.habitCount} this run.${why} Consistency is the whole game.`;
  }
  const avoided = (t.due || 0) > 0 && early ? ` You beat the deadline by ${lead}h and kept your record intact.` : "";
  return `${t.title} — submitted.${avoided}${why} That's ${ctx.weekDone} done this week. You close the loop.`;
}

function energyInsight(logs: EnergyLog[]) {
  if (logs.length < 4) return null;
  const buckets: Record<string, number[]> = { morning: [], afternoon: [], evening: [] };
  logs.forEach(l => {
    const h = new Date(l.at).getHours();
    const b = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    buckets[b].push(l.effort);
  });
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const scored = Object.entries(buckets).map(([k, v]) => ({ k, n: v.length, a: avg(v) })).filter(x => x.a !== null) as any[];
  if (scored.length < 2) return null;
  scored.sort((a, b) => a.a - b.a);
  const easy = scored[0], hard = scored[scored.length - 1];
  if (hard.a - easy.a < 0.4) return null;
  return `Your tasks rate easiest in the ${easy.k} and hardest in the ${hard.k}. Try scheduling heavy ones in the ${easy.k}.`;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mixHex(c1: string, c2: string, t: number): string {
  try {
    const p = (h: string) => {
      h = h.replace("#", "");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const [r1, g1, b1] = p(c1), [r2, g2, b2] = p(c2);
    const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
    return "#" + h(lerp(r1, r2, t)) + h(lerp(g1, g2, t)) + h(lerp(b1, b2, t));
  } catch (e) { return c1; }
}

function localStory(goal: string, tasks: string[], genre: string = "Fantasy") {
  const titlesByGenre: Record<string, string[]> = {
    "Fantasy": ["The Day’s Reckoning", "Quest for the Summit", "The Hours Ahead", "Trials of the Sun", "The Long Climb Home"],
    "Sci-Fi": ["System Hack Sequence", "Mainframe Ascension", "The Quantum Horizon", "Trials of the Grid", "The Long Hyperjump Home"],
    "Noir": ["The Midnight Casebook", "Clues in the Rain", "The Shadowy Informant", "Interrogation Under Light", "Case Closed at Dawn"],
    "Cozy": ["A Warm Morning Brew", "Garden Weeding Quest", "Baking the Daily Loaf", "Gathering Wildflowers", "Warm Hearth Gathering"],
    "Pop-Culture": ["The Hero’s Journey", "Multiverse Crisis Sync", "Epic Quest of Champions", "The Legendary Artifact Hunt", "Level Up Achievement"]
  };
  const beatsByGenre: Record<string, Array<(t: string) => string>> = {
    "Fantasy": [
      (t: string) => `First you face “${t}” — the gate that guards everything beyond it.`,
      (t: string) => `“${t}” waits in the mist; clear it and the path widens.`,
      (t: string) => `The trial of “${t}” tests your resolve — strike while the will burns hot.`,
      (t: string) => `“${t}” is a river to cross; one focused push and you stand on the far bank.`,
      (t: string) => `Conquer “${t}” and the whole day tilts in your favour.`,
      (t: string) => `“${t}” is the quiet boss of the afternoon — meet it before it grows.`,
    ],
    "Sci-Fi": [
      (t: string) => `Initiate “${t}” — bypass the peripheral security firewall.`,
      (t: string) => `The code block for “${t}” is compiling; run optimization protocols.`,
      (t: string) => `Patch “${t}” into the core database before the subnet resets.`,
      (t: string) => `Synchronizing “${t}” with the uplink terminal — maintain signal strength.`,
      (t: string) => `Execute “${t}” script to finalize the system restoration.`,
      (t: string) => `“${t}” is a background daemon script — analyze logs before it blocks the queue.`,
    ],
    "Noir": [
      (t: string) => `Open the file on “${t}” — this lead is too hot to ignore.`,
      (t: string) => `Tracking down “${t}” through the wet pavement of third street.`,
      (t: string) => `Sifting through the details of “${t}” under a flickering desk lamp.`,
      (t: string) => `Shaking down the suspects for “${t}” before the chief calls time.`,
      (t: string) => `Put “${t}” to bed and the case starts looking solvable.`,
      (t: string) => `“${t}” is a loose end that could blow the whole investigation open.`,
    ],
    "Cozy": [
      (t: string) => `Stir the cauldron for “${t}” while the morning sun warms the cottage.`,
      (t: string) => `Plucking the weeds of “${t}” to make space for fresh sweetberries.`,
      (t: string) => `Kneading “${t}” with care; let it rise beside the open window.`,
      (t: string) => `Delivering “${t}” to the friendly town blacksmith down the lane.`,
      (t: string) => `Tuck “${t}” onto the pantry shelf with a satisfied smile.`,
      (t: string) => `“${t}” is a gentle task best shared with a warm cup of chamomile tea.`,
    ],
    "Pop-Culture": [
      (t: string) => `Equip your gear for “${t}” — time to start the main quest.`,
      (t: string) => `Defeating the mini-boss of “${t}” to unlock the next region of the map.`,
      (t: string) => `Acquiring the rare loot from “${t}” — your stats are rapidly increasing.`,
      (t: string) => `Solving the ancient puzzle of “${t}” to reveal the secret path.`,
      (t: string) => `Forming a guild party to tackle “${t}” before the timer runs out.`,
      (t: string) => `Unlocking the legendary achievement: completed “${t}” with flying colors!`,
    ]
  };

  let gStyle = genre || "Fantasy";
  if (goal) {
    const low = goal.toLowerCase();
    if (/\b(hogwarts|potter|jedi|vader|skywalker|star\s*wars|avengers|marvel|spiderman|ironman|gotham|batman|zelda|hyrule|link|pokemon|pikachu|frodo|gandalf|ring|mordor|hobbit|matrix|neo|dune|arrakis|anime|goku|naruto|one\s*piece|pop|hero|gaming|game|movie|series|fandom|cosplay)\b/.test(low)) {
      gStyle = "Pop-Culture";
    } else if (/\b(space|star|cyber|robot|ai|hack|system|code|laser|subnet|terminal|digital|data|tech|synth|ship|spacecraft|grid|quantum|mainframe)\b/.test(low)) {
      gStyle = "Sci-Fi";
    } else if (/\b(mystery|detective|rain|case|clue|crime|shadow|midnight|noir|interrogate|chief|lamp|pavement|investigat|informant|police|alley)\b/.test(low)) {
      gStyle = "Noir";
    } else if (/\b(cozy|bake|garden|flower|coffee|tea|hearth|village|cabin|cottage|pie|bread|simple|quiet|brew|chamomile|forest|wood)\b/.test(low)) {
      gStyle = "Cozy";
    } else if (/\b(quest|sword|magic|dragon|wizard|castle|dungeon|trial|reckon|summit|mountain|kingdom|spell|elixir)\b/.test(low)) {
      gStyle = "Fantasy";
    }
  }

  const matchedKey = resolveStoryGenre(gStyle);
  const genreTitles = titlesByGenre[matchedKey] || titlesByGenre["Fantasy"];
  const genreBeats = beatsByGenre[matchedKey] || beatsByGenre["Fantasy"];
  const introsByGenre: Record<string, string> = {
    "Fantasy": `Every ordinary day is a quest in disguise. ${goal ? `“${goal}” is your summit` : "Your summit waits at dusk"} — and these are the trials between you and it.`,
    "Sci-Fi": `Your mechanical augmentation suite has registered a daily protocol array. ${goal ? `“${goal}” is the mainframe uplink` : "Your core synchronizer is online"} — initiate sequence.`,
    "Noir": `The rain hasn't stopped, and the desk is piled high. ${goal ? `“${goal}” is the main case` : "The big mystery is waiting to be solved"} — time to hit the pavement.`,
    "Cozy": `A brand new day begins in the quiet valley village. ${goal ? `“${goal}” is your grand festival prep` : "A peaceful, productive day lies ahead"} — let's enjoy the simple chores.`,
    "Pop-Culture": `The universe calls upon its legendary hero. ${goal ? `“${goal}” is your ultimate final boss fight` : "An epic saga awaits your command"} — grab your controller, wand, or lightsaber and prepare to level up.`
  };

  const introText = introsByGenre[matchedKey] || introsByGenre["Fantasy"];

  return {
    title: genreTitles[Math.floor(Math.random() * genreTitles.length)],
    intro: introText + ` Move through them, and the story bends toward you.`,
    chapters: (tasks || []).slice(0, 8).map((t: string, i: number) => ({ task: t, line: genreBeats[i % genreBeats.length](t) })),
    woven: Date.now(),
    genre: gStyle
  };
}

async function aiStory(goal: string, tasks: string[], genre: string = "Fantasy") {
  const r = await AI.call("story", { goal, tasks, genre });
  if (r && Array.isArray(r.chapters) && r.chapters.length) return { ...r, woven: Date.now(), genre: r.genre || genre };
  return localStory(goal, tasks, genre);
}

function resolveStoryGenre(genre: string) {
  if (!genre) return "Fantasy";
  const low = genre.toLowerCase();
  if (/\b(hogwarts|potter|jedi|vader|skywalker|star\s*wars|avengers|marvel|spiderman|ironman|gotham|batman|zelda|hyrule|link|pokemon|pikachu|frodo|gandalf|ring|mordor|hobbit|matrix|neo|dune|arrakis|anime|goku|naruto|one\s*piece|pop|hero|gaming|game|movie|series|fandom|cosplay)\b/.test(low)) {
    return "Pop-Culture";
  }
  if (/\b(space|star|cyber|robot|ai|hack|system|code|laser|subnet|terminal|digital|data|tech|synth|ship|spacecraft|grid|quantum|mainframe|sci-fi|future|neon)\b/.test(low)) {
    return "Sci-Fi";
  }
  if (/\b(mystery|detective|rain|case|clue|crime|shadow|midnight|noir|interrogate|chief|lamp|pavement|investigat|informant|police|alley)\b/.test(low)) {
    return "Noir";
  }
  if (/\b(cozy|bake|garden|flower|coffee|tea|hearth|village|cabin|cottage|pie|bread|simple|quiet|brew|chamomile|forest|wood)\b/.test(low)) {
    return "Cozy";
  }
  return "Fantasy";
}

function StoryBackgroundGraphics({ genre }: { genre: string }) {
  const resolvedGenre = resolveStoryGenre(genre);
  if (resolvedGenre === "Fantasy") {
    return (
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: -1, overflow: "hidden" }}>
        <div style={{
          position: "absolute",
          width: "300px",
          height: "300px",
          top: "10%",
          left: "5%",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(183,139,255,0.12) 0%, transparent 70%)",
          filter: "blur(40px)",
          animation: "floatSlow 12s ease-in-out infinite alternate"
        }} />
        <div style={{
          position: "absolute",
          width: "350px",
          height: "350px",
          bottom: "15%",
          right: "5%",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,180,84,0.08) 0%, transparent 70%)",
          filter: "blur(40px)",
          animation: "floatSlow 18s ease-in-out infinite alternate-reverse"
        }} />
        <svg style={{ position: "absolute", width: "100%", height: "100%", opacity: 0.3 }}>
          <circle cx="15%" cy="20%" r="1" fill="#fff" />
          <circle cx="85%" cy="15%" r="1.5" fill="#fff" />
          <circle cx="75%" cy="30%" r="1" fill="#fff" />
          <circle cx="25%" cy="65%" r="2" fill="#fff" />
          <circle cx="90%" cy="75%" r="1.2" fill="#fff" />
          <circle cx="10%" cy="80%" r="1.5" fill="#fff" />
          <path d="M 150 200 L 190 250 L 250 240 L 220 300" fill="none" stroke="rgba(255,180,84,0.15)" strokeWidth="1" strokeDasharray="3 3" />
          <path d="M 1000 120 L 1080 180 L 1120 150" fill="none" stroke="rgba(183,139,255,0.15)" strokeWidth="1" strokeDasharray="3 3" />
        </svg>
        <style>{`
          @keyframes floatSlow {
            0% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-15px) rotate(3deg); }
            100% { transform: translateY(0px) rotate(0deg); }
          }
        `}</style>
      </div>
    );
  }
  if (resolvedGenre === "Sci-Fi") {
    return (
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: -1, overflow: "hidden" }}>
        <div style={{
          position: "absolute",
          width: "450px",
          height: "450px",
          top: "15%",
          right: "2%",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,198,255,0.09) 0%, transparent 70%)",
          filter: "blur(50px)",
          animation: "floatSlow 14s ease-in-out infinite alternate"
        }} />
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "200px",
          backgroundImage: "linear-gradient(to top, rgba(124,198,255,0.06) 1px, transparent 1px), linear-gradient(to right, rgba(124,198,255,0.04) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          transform: "perspective(300px) rotateX(60deg)",
          transformOrigin: "bottom",
          maskImage: "linear-gradient(to top, rgba(0,0,0,1) 20%, rgba(0,0,0,0) 80%)",
          WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,1) 20%, rgba(0,0,0,0) 80%)"
        }} />
        <div style={{ position: "absolute", top: 40, left: 24, bottom: 40, width: 1, background: "linear-gradient(to bottom, transparent, rgba(124,198,255,0.15) 10%, rgba(124,198,255,0.15) 90%, transparent)", opacity: 0.4 }} />
        <div style={{ position: "absolute", top: 40, right: 24, bottom: 40, width: 1, background: "linear-gradient(to bottom, transparent, rgba(124,198,255,0.15) 10%, rgba(124,198,255,0.15) 90%, transparent)", opacity: 0.4 }} />
        <div style={{ position: "absolute", top: 40, left: 14, fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--flow)", opacity: 0.2, transform: "rotate(90deg)", transformOrigin: "top left" }}>SYSTEM STATUS: SCANNING</div>
        <div style={{ position: "absolute", bottom: 40, right: 14, fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--flow)", opacity: 0.2, transform: "rotate(-90deg)", transformOrigin: "bottom right" }}>SECTOR 04 - GRID SYNC</div>
        <style>{`
          @keyframes floatSlow {
            0% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-15px) rotate(3deg); }
            100% { transform: translateY(0px) rotate(0deg); }
          }
        `}</style>
      </div>
    );
  }
  if (resolvedGenre === "Noir") {
    return (
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: -1, overflow: "hidden" }}>
        <div style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 100%)",
          backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.1), rgba(0,0,0,0.1) 30px, transparent 30px, transparent 60px)",
          opacity: 0.6
        }} />
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 2px, transparent 2px)",
          backgroundSize: "3px 40px",
          animation: "rainEffect 0.8s linear infinite"
        }} />
        <div style={{
          position: "absolute",
          width: "500px",
          height: "500px",
          top: "-100px",
          left: "-100px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,210,122,0.09) 0%, transparent 60%)",
          filter: "blur(60px)",
          transform: "rotate(15deg)"
        }} />
        <style>{`
          @keyframes rainEffect {
            0% { background-position: 0px 0px; }
            100% { background-position: 15px 400px; }
          }
        `}</style>
      </div>
    );
  }
  if (resolvedGenre === "Cozy") {
    return (
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: -1, overflow: "hidden" }}>
        <div style={{
          position: "absolute",
          width: "500px",
          height: "400px",
          bottom: "-50px",
          left: "50%",
          transform: "translateX(-50%)",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,180,84,0.12) 0%, transparent 80%)",
          filter: "blur(55px)",
          animation: "pulseSlow 8s ease-in-out infinite alternate"
        }} />
        <div style={{ position: "absolute", inset: 0 }}>
          {[...Array(8)].map((_, i) => {
            const startLeft = 15 + i * 10 + Math.random() * 5;
            const delay = i * 1.5;
            const size = 3 + Math.random() * 4;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  bottom: -10,
                  left: `${startLeft}%`,
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  background: "var(--gold)",
                  boxShadow: "0 0 8px var(--gold)",
                  opacity: 0.5,
                  animation: `floatUp ${8 + Math.random() * 4}s linear infinite`,
                  animationDelay: `${delay}s`
                }}
              />
            );
          })}
        </div>
        <style>{`
          @keyframes floatUp {
            0% { transform: translateY(0) scale(1) rotate(0deg); opacity: 0; }
            10% { opacity: 0.5; }
            90% { opacity: 0.3; }
            100% { transform: translateY(-105vh) scale(0.4) translateX(20px); opacity: 0; }
          }
          @keyframes pulseSlow {
            0% { transform: translateX(-50%) scale(1); opacity: 0.7; }
            100% { transform: translateX(-50%) scale(1.15); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }
  return null;
}

function safeStartStatus(task: Task, db: AppState) {
  const lss = latestSafeStart(task, busyBlocksFor(db));
  if (lss == null) return { state: "impossible" as const, lss: null, minsToLss: null };
  const mins = (lss - now()) / 60e3;
  let state: "ok" | "blown" | "fullscreen" | "banner" = "ok";
  if (mins <= 0) state = "blown";
  else if (mins <= 2) state = "fullscreen";
  else if (mins <= (task.alertLeadMin || 10)) state = "banner";
  return { state, lss, minsToLss: mins };
}

function safeStartStatusResolved(task: Task, resolved: any) {
  const r = resolved[task.id];
  if (!r || r.lss == null) return { state: "impossible" as const, lss: null, minsToLss: null, conflicted: false };
  const mins = (r.lss - now()) / 60e3;
  let state: "ok" | "blown" | "fullscreen" | "banner" = "ok";
  if (mins <= 0) state = "blown";
  else if (mins <= 2) state = "fullscreen";
  else if (mins <= (task.alertLeadMin || 10)) state = "banner";
  return { state, lss: r.lss, minsToLss: mins, conflicted: r.conflicted };
}

function playRitualCue() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const t = ac.currentTime;
    [[523.25, 0], [783.99, .12]].forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(.18, t + d + .02);
      g.gain.exponentialRampToValueAtTime(.001, t + d + .5);
      o.connect(g).connect(ac.destination);
      o.start(t + d);
      o.stop(t + d + .55);
    });
    setTimeout(() => ac.close && ac.close(), 900);
  } catch (e) {}
}

function anonId() {
  try {
    let id = localStorage.getItem("momentum:anon");
    if (!id) {
      id = "anon_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("momentum:anon", id);
    }
    return id;
  } catch (e) {
    return "anon_session";
  }
}

const Store = (() => {
  const mem: Record<string, any> = {};
  const hasWS = typeof window !== "undefined" && (window as any).storage && (window as any).storage.get;
  const hasLS = (() => { try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return true; } catch (e) { return false; } })();
  let uid: string | null = null;
  return {
    setUser(u: string) { uid = u; },
    getUid() { return uid || "default-user"; },
    async get(k: string) {
      if (uid) {
        try {
          const r = await fetch(`/api/state/${uid}/${encodeURIComponent(k)}`);
          if (r.ok) {
            const d = await r.json();
            if (d.ok) {
              const v = JSON.parse(d.value);
              if (hasLS) localStorage.setItem(k, d.value);
              return v;
            }
          }
        } catch (e) {}
      }
      try {
        if (hasWS) {
          const r = await (window as any).storage.get(k);
          return r ? JSON.parse(r.value) : null;
        }
        if (hasLS) {
          const v = localStorage.getItem(k);
          return v ? JSON.parse(v) : null;
        }
      } catch (e) {}
      return mem[k] ?? null;
    },
    async set(k: string, v: any) {
      const s = JSON.stringify(v);
      if (uid) {
        fetch(`/api/state/${uid}/${encodeURIComponent(k)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: s })
        }).catch(() => {});
      }
      try {
        if (hasWS) {
          await (window as any).storage.set(k, s);
          return;
        }
        if (hasLS) {
          localStorage.setItem(k, s);
          return;
        }
      } catch (e) {}
      mem[k] = v;
    }
  };
})();

const Auth = {
  user: null as any,
  ready: false,
  enabled: false,
  _fb: null as any,
  async init() {
    try {
      const r = await fetch("/api/config");
      const cfg = await r.json();
      if (!cfg.firebase) {
        this.ready = true;
        return this;
      }
      this.enabled = true;
      await new Promise<void>((res) => {
        const s = document.createElement("script");
        s.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js";
        s.onload = () => res();
        document.head.appendChild(s);
      });
      await new Promise<void>((res) => {
        const s = document.createElement("script");
        s.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js";
        s.onload = () => res();
        document.head.appendChild(s);
      });
      await new Promise<void>((res) => {
        const s = document.createElement("script");
        s.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js";
        s.onload = () => res();
        document.head.appendChild(s);
      });
      const fb = (window as any).firebase;
      fb.initializeApp(cfg.firebase);
      this._fb = fb;
      fb.auth().onAuthStateChanged(async (u: any) => {
        this.user = u;
        const targetUid = u ? u.uid : Store.getUid();
        try {
          const messaging = fb.messaging();
          const token = await messaging.getToken({ vapidKey: cfg.vapidKey });
          if (token) {
            (window as any).__fcmRegistered = true;
            await fetch("/api/memory/fcm-token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uid: targetUid, token })
            });
          }
        } catch (e) {
          console.warn("FCM token registration failed:", e);
        }
      });
      this.ready = true;
    } catch (e) {
      this.ready = true;
    }
    return this;
  },
  async signIn() {
    if (!this._fb) return;
    const p = new this._fb.auth.GoogleAuthProvider();
    try { await this._fb.auth().signInWithPopup(p); } catch (e) {}
  },
  async signOut() {
    if (this._fb) {
      try { await this._fb.auth().signOut(); } catch (e) {}
    }
  }
};

const GCal = {
  enabled: false,
  connected: false,
  token: null as string | null,
  clientId: null as string | null,
  _tc: null as any,
  scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/tasks.readonly",
  async init(clientId: string | null) {
    if (!clientId) return this;
    this.clientId = clientId;
    this.enabled = true;
    await new Promise<void>((res) => {
      if ((window as any).google && (window as any).google.accounts) return res();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => res();
      s.onerror = () => res();
      document.head.appendChild(s);
    });
    return this;
  },
  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!(window as any).google || !(window as any).google.accounts) {
        resolve(false);
        return;
      }
      this._tc = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: this.scope,
        callback: (resp: any) => {
          if (resp && resp.access_token) {
            this.token = resp.access_token;
            this.connected = true;
            resolve(true);
          } else {
            resolve(false);
          }
        }
      });
      this._tc.requestAccessToken();
    });
  },
  async freeBusy(timeMinISO: string, timeMaxISO: string): Promise<any[]> {
    if (!this.token) return [];
    try {
      const u = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      u.searchParams.append("timeMin", timeMinISO);
      u.searchParams.append("timeMax", timeMaxISO);
      u.searchParams.append("singleEvents", "true");
      u.searchParams.append("orderBy", "startTime");

      const r = await fetch(u.toString(), {
        headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" }
      });
      if (!r.ok) return [];
      const d = await r.json();
      return (d.items || []).filter((i: any) => i.start && (i.start.dateTime || i.start.date)).map((i: any) => {
        const start = i.start.dateTime || i.start.date;
        const end = i.end.dateTime || i.end.date;
        return {
          title: i.summary || "Busy · Google Calendar",
          startISO: start,
          durationMin: Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 60e3)),
          location: i.location || null
        };
      });
    } catch (e) {
      return [];
    }
  },
  async insertEvent({ summary, startISO, endISO }: { summary: string; startISO: string; endISO: string }): Promise<string | null> {
    if (!this.token) return null;
    try {
      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
        body: JSON.stringify({ summary, start: { dateTime: startISO }, end: { dateTime: endISO } })
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d.id || null;
    } catch (e) {
      return null;
    }
  },
  async getTaskLists(): Promise<any[]> {
    if (!this.token) return [];
    try {
      const r = await fetch("https://tasks.googleapis.com/tasks/v1/users/@default/lists", {
        headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" }
      });
      if (!r.ok) return [];
      const d = await r.json();
      return d.items || [];
    } catch (e) {
      return [];
    }
  },
  async getTasks(listId: string = "@default"): Promise<any[]> {
    if (!this.token) return [];
    try {
      const r = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
        headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" }
      });
      if (!r.ok) return [];
      const d = await r.json();
      return d.items || [];
    } catch (e) {
      return [];
    }
  },
  async createGoogleTask(title: string, notes?: string, dueISO?: string, listId: string = "@default"): Promise<any> {
    if (!this.token) return null;
    try {
      const body: any = { title };
      if (notes) body.notes = notes;
      if (dueISO) body.due = dueISO;
      const r = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
        method: "POST",
        headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  },
  async completeGoogleTask(taskId: string, listId: string = "@default"): Promise<boolean> {
    if (!this.token) return false;
    try {
      const r = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
        method: "POST",
        headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" }
      });
      if (r.status === 204 || r.ok) return true;
      // If POST /complete is not found/deprecated, try patching status
      const r2 = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" })
      });
      return r2.ok;
    } catch (e) {
      return false;
    }
  },
  async deleteGoogleTask(taskId: string, listId: string = "@default"): Promise<boolean> {
    if (!this.token) return false;
    try {
      const r = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + this.token }
      });
      return r.status === 204 || r.ok;
    } catch (e) {
      return false;
    }
  }
};

const AI = {
  async call(task: string, payload: any): Promise<any> {
    try {
      if (task === "first_step") {
        const res = await fetch("/api/gemini/generate-first-step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: payload.title, why: payload.why || "" })
        });
        if (res.ok) {
          const d = await res.json();
          const body = `Micro-step (under 2m):\n• ${d.microStep}\n\nMomentum checklist:\n${d.checklist.map((c: string) => `• ${c}`).join("\n")}\n\nStarter template:\n${d.starterTemplate}`;
          return { kind: "Immediate start plan", body };
        }
      } else if (task === "rescue") {
        const res = await fetch("/api/gemini/rescue-mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: payload.title, why: payload.why || "" })
        });
        if (res.ok) {
          const d = await res.json();
          const plan = `MVP Scope:\n${d.mvpScope}\n\nSpeed Steps:\n${d.speedSteps.map((s: string) => `• ${s}`).join("\n")}\n\nCrisis Motivation:\n${d.crisisMotivation}`;
          return { plan };
        }
      } else if (task === "extract") {
        const res = await fetch("/api/gemini/extract-deadlines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: payload.text })
        });
        if (res.ok) {
          const d = await res.json();
          return d.tasks.map((t: any) => {
            let dueTime = Date.parse(t.deadline);
            if (isNaN(dueTime)) dueTime = Date.now() + 2 * 24 * 3600 * 1000;
            return {
              title: t.title,
              type: "one-off" as const,
              due: dueTime,
              effortMin: t.effort * 30 || 30,
              stakes: t.consequence || 2,
              why: t.suggestedWhy || "",
              when: t.bufferSuggestion || ""
            };
          });
        }
      } else if (task === "story") {
        const res = await fetch("/api/gemini/generate-story", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal: payload.goal, tasks: payload.tasks, genre: payload.genre })
        });
        if (res.ok) {
          return await res.json();
        }
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  }
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function busyDaysFromGoal(goal: string) {
  const low = goal.toLowerCase();
  const set = new Set<number>();
  ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].forEach((d, i) => {
    const re = new RegExp("(travel|traveling|flight|busy|away|conference|booked|off|ooo|out of office|meeting)[^.,]{0,28}" + d + "|" + d + "[^.,]{0,28}(travel|traveling|flight|busy|away|conference|booked|off|meeting)", "i");
    if (re.test(low)) set.add(i);
  });
  return set;
}

function localAgent(goal: string, db: AppState) {
  const trace: any[] = [];
  const actions: any[] = [];
  const T = (role: "thought" | "tool" | "observe" | "final", o: any) => trace.push({ role, ...o });
  T("thought", { text: `Breaking down: “${goal.slice(0, 140)}…”. checking schedule and constraints.` });

  const busyDays = busyDaysFromGoal(goal);
  const from = new Date().toISOString(), to = new Date(now() + 7 * DAY).toISOString();
  T("tool", { tool: "check_calendar", args: { fromISO: from, toISO: to } });
  const blockedLabel = busyDays.size ? [...busyDays].map(i => DOW[i]).join(", ") : "none flagged";
  T("observe", { tool: "check_calendar", text: `blocked days: ${blockedLabel} · ${(db.schedule || []).length} active block(s)` });

  const fresh = tasksFromGoal(goal);
  if (fresh.length) {
    fresh.forEach(t => {
      T("tool", { tool: "create_task", args: { title: t.title, dueISO: new Date(t.due).toISOString(), effortMin: t.effortMin, stakes: t.stakes } });
      T("observe", { tool: "create_task", text: `created · "${t.title}"` });
      actions.push({ type: "create_task", task: t });
    });
  } else {
    T("thought", { text: `Planning with existing ${db.tasks.filter(x => !x.done).length} tasks on radar.` });
  }

  const working = [...fresh, ...db.tasks.filter(x => !x.done)].sort((a, b) => score(b) - score(a));
  T("tool", { tool: "prioritize", args: {} });
  T("observe", { tool: "prioritize", text: working.slice(0, 4).map((t, i) => `${i + 1}. ${t.title} (${score(t)})`).join(" · ") || "nothing to rank" });

  let cursor = snapToWorkSlot(now() + HOUR, busyDays);
  const planned: any[] = [];
  working.slice(0, 3).forEach(t => {
    const dur = Math.min(120, Math.max(20, t.effortMin || 30));
    const start = snapToWorkSlot(cursor, busyDays);
    T("tool", { tool: "schedule_block", args: { title: t.title, startISO: new Date(start).toISOString(), durationMin: dur } });
    T("observe", { tool: "schedule_block", text: `booked · ${t.title} · ${clockLabel(start)}` });
    actions.push({ type: "schedule", title: t.title, startISO: new Date(start).toISOString(), durationMin: dur });
    planned.push({ title: t.title, start, dur });
    cursor = start + dur * 60e3 + 30 * 60e3;
  });

  let firstStepText = "";
  if (working[0]) {
    const fs = firstStep(working[0]);
    T("tool", { tool: "draft_first_step", args: { title: working[0].title } });
    T("observe", { tool: "draft_first_step", text: `${fs.kind} drafted` });
    firstStepText = fs.body;
  }

  const urgent = [...working].sort((a, b) => (a.due || 0) - (b.due || 0))[0];
  if (urgent) {
    const at = Math.max(now() + HOUR, (urgent.due || 0) - 2 * HOUR);
    T("tool", { tool: "set_reminder", args: { title: urgent.title, atISO: new Date(at).toISOString() } });
    T("observe", { tool: "set_reminder", text: `reminder set` });
    actions.push({ type: "reminder", title: urgent.title, atISO: new Date(at).toISOString(), message: `Time for: ${urgent.title}` });
  }

  const summary = `Plan ready. ${fresh.length ? `Added ${fresh.length} task(s). ` : ""}Scheduled ${planned.length} work block(s).`;
  T("final", { text: summary, firstStep: firstStepText, firstStepTitle: working[0] ? working[0].title : "" });
  return { trace, actions, summary };
}

async function runAgent(goal: string, db: AppState) {
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal,
        db,
        uid: Store.getUid(),
        googleToken: GCal.token
      })
    });
    if (res.ok) {
      const d = await res.json();
      if (d && d.trace && d.actions) {
        return {
          trace: d.trace,
          actions: d.actions,
          summary: d.summary || "Plan created.",
          source: "gemini" as const
        };
      }
    }
  } catch (e) {
    console.error("runAgent server error:", e);
  }
  return { ...localAgent(goal, db), source: "local" as const };
}

const THEMES = [
  { id: "story", name: "Story", sub: "interactive quest", sw: ["#ffb454", "#b78bff", "#7cc6ff"] },
  { id: "editorial", name: "Monopo", sub: "saigon · orb", sw: ["#ffac2e", "#a0e0ab", "#a52d25"] },
  { id: "drive", name: "Drive", sub: "cream · voltage", sw: ["#006eff", "#fff8f1", "#e2e8f0"] }
] as const;

function ThemeSwitcher({ theme, setTheme, open, setOpen }: any) {
  const cur = THEMES.find(t => t.id === theme) || THEMES[0];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o: any) => !o)} className="tap focusable"
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12.5, fontWeight: 600 }}>
        <span style={{ display: "flex", gap: 3 }}>
          {cur.sw.map((c, i) => <span key={i} style={{ width: 9, height: 9, borderRadius: 99, background: c }} />)}
        </span>
        {cur.name} <span style={{ color: "var(--muted-2)", fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div className="card scrollbar" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 41, width: 230, padding: 7, boxShadow: "0 16px 50px rgba(0,0,0,.4)", overflowY: "auto", maxHeight: 300 }}>
            <div className="eyebrow" style={{ padding: "7px 9px 9px" }}>Theme</div>
            {THEMES.map(t => (
              <button key={t.id} onClick={() => { setTheme(t.id); setOpen(false); }} className="tap focusable"
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 9px", borderRadius: "var(--radius-sm)", border: "1px solid " + (theme === t.id ? "var(--ember)" : "transparent"), background: theme === t.id ? "color-mix(in srgb, var(--ember) 10%, transparent)" : "transparent", color: "var(--text)", textAlign: "left", marginBottom: 2 }}>
                <span style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                  {t.sw.map((c, i) => <span key={i} style={{ width: 11, height: 11, borderRadius: 99, background: c }} />)}
                </span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 9, color: "var(--muted-2)", fontFamily: "var(--font-sans)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.sub}</div>
                </span>
                {theme === t.id && <span style={{ color: "var(--ember)", fontSize: 13 }}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ACCENTS = ["#ff7a45", "#e8633e", "#f43f5e", "#fb923c", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899"];

function shade(hex: string, pct: number): string {
  try {
    const h = hex.replace("#", "");
    const n = parseInt(h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * 255)));
    r = f(r); g = f(g); b = f(b);
    return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    return hex;
  }
}

const ORB_PALETTES = [
  { id: "saigon", name: "Saigon", sw: ["#ffac2e", "#a0e0ab", "#a52d25"] },
  { id: "aurora", name: "Aurora", sw: ["#5eead4", "#60a5fa", "#a78bfa"] },
  { id: "ember", name: "Ember", sw: ["#ff7a45", "#ffd166", "#f43f5e"] },
  { id: "jade", name: "Jade", sw: ["#34d399", "#bef264", "#2dd4bf"] },
  { id: "plum", name: "Plum", sw: ["#a78bfa", "#ec4899", "#6366f1"] },
  { id: "rose", name: "Rose", sw: ["#fb7185", "#fdba74", "#d946a0"] },
  { id: "mono", name: "Mono", sw: ["#d2d2dc", "#9696a2", "#60606c"] }
];

function CustomizePanel({ custom, setCustom, open, setOpen, theme, mode, setMode, orbPalette, setOrbPalette, db, patch }: any) {
  const isMonopo = theme === "editorial";
  const hasModes = theme === "editorial" || theme === "drive";
  const modeLabel = theme === "drive" ? "Drive surface" : "Monopo surface";

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o: any) => !o)} className="tap focusable" title="Customize UI"
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12.5, fontWeight: 600 }}>
        <span>Customize</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div className="card scrollbar" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 41, width: 264, maxHeight: "76vh", overflowY: "auto", padding: 16, boxShadow: "0 16px 50px rgba(0,0,0,.4)" }}>
            {hasModes && (
              <>
                <div className="eyebrow" style={{ marginBottom: 8 }}>{modeLabel}</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                  {[["light", "Light"], ["dark", "Dark"], ["neutral", "Neutral"]].map(([v, l]) => (
                    <button key={v} onClick={() => setMode(v)} className="tap focusable"
                      style={{ flex: 1, padding: "7px 6px", borderRadius: "var(--radius-sm)", fontSize: 11.5, fontWeight: 600, border: "1px solid " + (mode === v ? "var(--ember)" : "var(--line)"), background: mode === v ? "color-mix(in srgb, var(--ember) 12%, transparent)" : "transparent", color: "var(--text)" }}>{l}</button>
                  ))}
                </div>
              </>
            )}
            {isMonopo && (
              <>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Monopo orb gradient</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                  {ORB_PALETTES.map(p => (
                    <button key={p.id} onClick={() => setOrbPalette(p.id)} className="tap focusable" title={p.name}
                      style={{ width: 38, height: 38, borderRadius: "50%", cursor: "pointer", border: orbPalette === p.id ? "2px solid var(--text)" : "2px solid transparent", background: `radial-gradient(circle at 32% 30%, ${p.sw[0]}, transparent 60%), radial-gradient(circle at 70% 35%, ${p.sw[1]}, transparent 60%), radial-gradient(circle at 55% 75%, ${p.sw[2]}, transparent 65%), #15151a` }} />
                  ))}
                </div>
              </>
            )}
            <div className="eyebrow" style={{ marginBottom: 10 }}>Accent color</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
              {ACCENTS.map(c => (
                <button key={c} onClick={() => setCustom((s: any) => ({ ...s, accent: c }))} className="tap focusable"
                  style={{ width: 24, height: 24, borderRadius: 99, background: c, border: custom.accent === c ? "2px solid var(--text)" : "2px solid transparent", boxShadow: custom.accent === c ? "0 0 0 2px var(--card-bg)" : "none" }} />
              ))}
              <button onClick={() => setCustom((s: any) => ({ ...s, accent: "" }))} className="tap focusable" title="Theme default"
                style={{ width: 24, height: 24, borderRadius: 99, background: "var(--card-bg)", border: "2px dashed var(--muted-2)", fontSize: 10, color: "var(--muted-2)", display: "flex", alignItems: "center", justifyValue: "center", justifyContent: "center" }}><MIcon name="refresh" s={12} weight={400} /></button>
            </div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Density</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {[["comfortable", "Comfortable"], ["compact", "Compact"]].map(([v, l]) => (
                <button key={v} onClick={() => setCustom((s: any) => ({ ...s, density: v }))} className="tap focusable"
                  style={{ flex: 1, padding: "7px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 600, border: "1px solid " + (custom.density === v ? "var(--ember)" : "var(--line)"), background: custom.density === v ? "color-mix(in srgb, var(--ember) 12%, transparent)" : "transparent", color: "var(--text)" }}>{l}</button>
              ))}
            </div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Corners</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
              {[["theme", "Theme"], ["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]].map(([v, l]) => (
                <button key={v} onClick={() => setCustom((s: any) => ({ ...s, corners: v }))} className="tap focusable"
                  style={{ flex: 1, padding: "7px 6px", borderRadius: "var(--radius-sm)", fontSize: 11.5, fontWeight: 600, border: "1px solid " + (custom.corners === v ? "var(--ember)" : "var(--line)"), background: custom.corners === v ? "color-mix(in srgb, var(--ember) 12%, transparent)" : "transparent", color: "var(--text)" }}>{l}</button>
              ))}
            </div>
            
            {db && patch && (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Story Mode Setting</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>Enable Story Mode</span>
                  <input
                    type="checkbox"
                    checked={!db?.settings?.storyModeDisabled}
                    onChange={e => {
                      const enabled = e.target.checked;
                      patch((d: any) => {
                        if (!d.settings) d.settings = {};
                        d.settings.storyModeDisabled = !enabled;
                      });
                    }}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function emptyDb() {
  const t = now();
  return {
    tasks: [], wins: [],
    streak: { count: 0, debt: 0, locked: 0, lastDay: new Date(t - DAY).toDateString() },
    goals: {}, energy: [],
    settings: { tone: "coach", weekStart: t - 3 * DAY },
    xpGlobal: 0, schedule: [], reminders: [], storyGenre: "Fantasy", habits: [],
    focusLog: []
  };
}

function seed() {
  const t = now();
  return {
    tasks: [
      { id: "t1", title: "Reply to landlord about lease", type: "one-off" as const, due: t + 5 * HOUR, effortMin: 5, stakes: 3, why: "Renewing on time keeps my rent locked at this rate.", when: "Today, after lunch", done: false },
      { id: "t2", title: "Submit history essay", type: "one-off" as const, due: t + 30 * HOUR, effortMin: 180, stakes: 3, why: "I want to keep the scholarship — this grade matters.", when: "Tonight 7–9pm", done: false },
      { id: "t3", title: "Pay electricity bill", type: "one-off" as const, due: t + 22 * HOUR, effortMin: 5, stakes: 2, why: "", when: "", done: false },
      { id: "t4", title: "Gym session", type: "habit" as const, due: t + 9 * HOUR, effortMin: 60, stakes: 1, why: "Stronger by summer. Future me is counting on this.", when: "7am", done: false, goal: "Stronger by summer" },
      { id: "t5", title: "Apply to one job", type: "habit" as const, due: t + 11 * HOUR, effortMin: 25, stakes: 2, why: "I want out of a job that drains me.", when: "After morning coffee", done: false, goal: "Get a new job" }
    ],
    wins: [
      { id: "w1", title: "Sent project update", at: t - 26 * HOUR, text: "Sent project update — 3h early. Kept your on-time record. 4 done this week.", badge: "early" as const },
      { id: "w2", title: "Gym session", at: t - 20 * HOUR, text: "Gym session #8 this run. You're on pace.", badge: "habit" as const }
    ],
    streak: { count: 12, debt: 0, locked: 0, lastDay: new Date(t - DAY).toDateString() },
    goals: {
      "Stronger by summer": { xp: 320, level: 4, sessions: 32 },
      "Get a new job": { xp: 140, level: 2, sessions: 14 }
    },
    energy: [
      { at: t - 2 * DAY + 9 * HOUR, effort: 1, task: "Gym session" },
      { at: t - 2 * DAY + 22 * HOUR, effort: 3, task: "Apply to one job" },
      { at: t - DAY + 8 * HOUR, effort: 1, task: "Gym session" },
      { at: t - DAY + 21 * HOUR, effort: 3, task: "Apply to one job" },
      { at: t - DAY + 20 * HOUR, effort: 2, task: "Read 10 pages" }
    ],
    settings: { tone: "coach", weekStart: t - 3 * DAY },
    xpGlobal: 460,
    schedule: [],
    reminders: [],
    storyGenre: "Fantasy",
    habits: [
      {
        id: "h1",
        title: "Morning meditation & focus breath",
        frequency: "daily" as const,
        streak: 5,
        totalSessions: 12,
        stackAfter: "pouring my first cup of coffee",
        history: [
          { date: new Date(t - DAY).toISOString().split("T")[0], energyLevel: "easy" as const },
          { date: new Date(t - 2 * DAY).toISOString().split("T")[0], energyLevel: "okay" as const }
        ]
      },
      {
        id: "h2",
        title: "Evening project code commit",
        frequency: "daily" as const,
        streak: 8,
        totalSessions: 24,
        stackAfter: "closing my last browser tab",
        history: [
          { date: new Date(t - DAY).toISOString().split("T")[0], energyLevel: "hard" as const },
          { date: new Date(t - 2 * DAY).toISOString().split("T")[0], energyLevel: "okay" as const }
        ]
      }
    ],
    focusLog: [
      { id: "f1", at: t - 2 * HOUR, minutes: 25, taskTitle: "Submit history essay" },
      { id: "f2", at: t - 24 * HOUR, minutes: 50, taskTitle: "Submit history essay" },
      { id: "f3", at: t - 48 * HOUR, minutes: 15, taskTitle: "Morning meditation & focus breath" },
      { id: "f4", at: t - 3 * DAY, minutes: 30, taskTitle: "Reply to landlord about lease" }
    ]
  };
}

function SystemStatusBadge({ db, gcalConnected, gtasksConnected }: { db: AppState | null, gcalConnected: boolean, gtasksConnected: boolean }) {
  const [config, setConfig] = useState<any>(null);
  
  const [fcmRegistered, setFcmRegistered] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then(data => setConfig(data))
      .catch(() => {});
      
    const iv = setInterval(() => {
      if ((window as any).__fcmRegistered !== fcmRegistered) {
        setFcmRegistered(!!(window as any).__fcmRegistered);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [fcmRegistered]);

  const gcalLive = gcalConnected;
  const gtasksLive = gtasksConnected;
  const fcmLive = fcmRegistered;
  const fbLive = config?.firebase ? true : false;
  const geminiLive = config?.gemini ? true : false;
  const crLive = config?.cloudRun ? true : false;

  const Dot = ({ on, label }: { on: boolean, label: string }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8, opacity: on ? 1 : 0.6 }}>
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: on ? "var(--accent)" : "var(--muted-2)", boxShadow: on ? "0 0 6px var(--accent)" : "none" }}></span>
      <span style={{ color: on ? "var(--text)" : "var(--muted-2)" }}>{label}</span>
    </span>
  );

  return (
    <span className="mono" style={{ fontSize: 11, textAlign: "right", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
      <Dot on={geminiLive} label="Gemini" />
      <Dot on={fbLive} label="Firestore" />
      <Dot on={crLive} label="Cloud Run" />
      <Dot on={gcalLive} label="Calendar" />
      <Dot on={gtasksLive} label="Tasks" />
      <Dot on={fcmLive} label="FCM" />
    </span>
  );
}

function OnboardingTour({ onComplete, isMobile }: { onComplete: (seedDemo: boolean) => void; isMobile: boolean }) {
  const [step, setStep] = useState(0);

  // Step 1: Quest/Story State
  const [s1Done, setS1Done] = useState(false);
  
  // Step 2: Co-pilot State
  const [s2Typing, setS2Typing] = useState(false);
  const [s2Messages, setS2Messages] = useState<Array<{ sender: "user" | "bot"; text: string }>>([
    { sender: "user", text: "I have 3 essays to write and need a focused weekly schedule." }
  ]);

  const triggerS2Simulation = () => {
    if (s2Typing) return;
    setS2Typing(true);
    setS2Messages([
      { sender: "user", text: "I have 3 essays to write and need a focused weekly schedule." }
    ]);
    
    const stream = [
      { sender: "bot" as const, text: "Analyzing your available blocks on Google Calendar... 🔍" },
      { sender: "bot" as const, text: "Drafting strategy: We'll schedule three 90-minute Deep Work blocks." },
      { sender: "bot" as const, text: "Created 3 items in your Task List with incremental milestones! 🚀" }
    ];

    let current = 0;
    const interval = setInterval(() => {
      if (current < stream.length) {
        setS2Messages(prev => [...prev, stream[current]]);
        current++;
      } else {
        clearInterval(interval);
        setS2Typing(false);
      }
    }, 1200);
  };

  // Step 3: Momentum State
  const [s3Momentum, setS3Momentum] = useState(65);

  // Step 4: Energy State
  const [s4Energy, setS4Energy] = useState<"low" | "medium" | "high">("medium");

  // Step 5: Theme State
  const [s5Theme, setS5Theme] = useState<"story" | "editorial" | "drive">("story");

  const steps = [
    {
      id: "intro",
      eyebrow: "01 / 06 • Introduction",
      title: "Welcome to Initio",
      description: "Initio is your premium cognitive mission control designed to overcome procrastination, gamify consistent habits, and align your daily execution with your biological clock. Welcome to a calmer, more creative way to work.",
      bullets: [
        { icon: "rocket_launch", text: "Interactive systems built around clarity and flow" },
        { icon: "schedule", text: "Timeboxed calendar blocks designed to protect your peace of mind" },
        { icon: "interests", text: "Beautiful, responsive themes that transform your digital environment" }
      ]
    },
    {
      id: "story",
      eyebrow: "02 / 06 • Interactive Story Mode",
      title: "Epic AI Story Quests",
      description: "Experience your productivity as an unfolding journey. Story Mode translates your daily to-do items into an interactive fantasy, sci-fi, noir, or cozy quest narrative. Complete tasks to advance chapters and weave your tale.",
      bullets: [
        { icon: "star", text: "Choose your favorite atmosphere (Fantasy, Sci-Fi, Noir, Cozy)" },
        { icon: "book_4_spark", text: "Let the narrator weave daily tasks into tailored story beats" },
        { icon: "palette", text: "Immersive animated backdrop scenery that responds to your style" }
      ]
    },
    {
      id: "copilot",
      eyebrow: "03 / 06 • Autonomous Agent",
      title: "Your Intelligent Co-pilot",
      description: "Overcome choice paralysis and procrastination. The AI Co-pilot analyzes your workloads, syncs with Google Calendar, organizes sub-tasks, and formulates high-focus anti-procrastination plans with actionable steps.",
      bullets: [
        { icon: "psychology", text: "Conversational co-pilot to plan, split, or schedule tasks" },
        { icon: "calendar_today", text: "Smart background syncing to avoid scheduling conflicts" },
        { icon: "bolt", text: "Procrastination rescue protocols for when you need a push" }
      ]
    },
    {
      id: "momentum",
      eyebrow: "04 / 06 • Initio & Urgency",
      title: "Dynamic Initio Engine",
      description: "Initio calculates a real-time health score of your daily productivity based on task urgency, efforts, and streaks. Keep your momentum score high to maintain your ultimate productive state.",
      bullets: [
        { icon: "speed", text: "Real-time consistency level mapping" },
        { icon: "center_focus_strong", text: "Auto-prompts highlighting the single most urgent task next" },
        { icon: "stars", text: "Earn XP, unlock level-up badges, and log historic wins" }
      ]
    },
    {
      id: "energy",
      eyebrow: "05 / 06 • Mindful Energy Sync",
      title: "Log & Match Your Energy",
      description: "Work with your biological clock, not against it. Log your current physical or mental energy to instantly filter your backlog, matching your focus levels with suitable tasks to prevent burnout.",
      bullets: [
        { icon: "battery_charging_full", text: "High-energy tasks for peak focus hours" },
        { icon: "local_cafe", text: "Low-energy quick wins when you need a breather" },
        { icon: "hourglass_empty", text: "Avoid burnout by matching task effort to your stamina" }
      ]
    },
    {
      id: "themes",
      eyebrow: "06 / 06 • Adaptive Visual Design",
      title: "Premium Design Paradigms",
      description: "Change your scenery to match your vibe. Rotate through three distinct, beautifully-crafted visual systems—the gamified Story layout, minimal Monopo, or high-octane Drive surface.",
      bullets: [
        { icon: "auto_awesome", text: "Story Mode: Gamified atmospheric quest board" },
        { icon: "article", text: "Monopo: Pristine, spacing-focused editorial system" },
        { icon: "bolt", text: "Drive Mode: Bright, technical, high-voltage look" }
      ]
    }
  ];

  const next = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "#08070c",
      backgroundImage: "radial-gradient(circle at 10% 20%, rgba(93, 58, 230, 0.1) 0%, transparent 40%), radial-gradient(circle at 90% 80%, rgba(244, 180, 26, 0.08) 0%, transparent 40%)",
      color: "#f8f9fa",
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: isMobile ? "20px 16px" : "32px 48px",
      overflowY: "auto",
      fontFamily: "var(--font-sans)"
    }}>
      {/* Top Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--violet)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(124, 77, 255, 0.4)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#fff" }}>explore</span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", color: "#fff" }}>INITIO <span style={{ color: "var(--violet)", fontSize: 11, verticalAlign: "super" }}>PRO</span></span>
        </div>
        <button 
          onClick={() => onComplete(true)} 
          className="tap focusable"
          style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.15)", padding: "7px 14px", borderRadius: 20, background: "transparent" }}>
          Skip Tour
        </button>
      </div>

      {/* Main Container */}
      <div style={{
        maxWidth: 1100,
        width: "100%",
        margin: "auto",
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1.1fr 0.9fr",
        gap: isMobile ? 32 : 64,
        alignItems: "center",
        padding: isMobile ? "20px 0" : "40px 0"
      }}>
        {/* Left: Info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ 
            fontSize: 11, 
            fontWeight: 600, 
            textTransform: "uppercase", 
            letterSpacing: "0.22em", 
            color: step === 0 || step === 1 ? "var(--gold)" : "var(--violet)",
            textShadow: step === 0 || step === 1 ? "0 0 8px rgba(255,180,84,0.3)" : "none"
          }}>
            {steps[step].eyebrow}
          </div>
          <h1 className="display" style={{ fontSize: isMobile ? 32 : 44, fontWeight: 700, letterSpacing: "-0.02em", color: "#fff", lineHeight: 1.15 }}>
            {steps[step].title}
          </h1>
          <p style={{ fontSize: isMobile ? 14.5 : 16.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, margin: "4px 0" }}>
            {steps[step].description}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 10 }}>
            {steps[step].bullets.map((b, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "start" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--violet)", marginTop: 2 }}>{b.icon}</span>
                <span style={{ fontSize: isMobile ? 13.5 : 14.5, color: "rgba(255,255,255,0.85)" }}>{b.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Interactive Live Sandbox Mockup */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{
            width: "100%",
            maxWidth: 420,
            aspectRatio: "1.15",
            background: "rgba(18, 16, 26, 0.75)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            borderRadius: 24,
            padding: 24,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            position: "relative",
            overflow: "hidden"
          }}>
            {/* Window controls */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f56" }} />
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ffbd2e" }} />
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#27c93f" }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)", marginLeft: 8 }}>Interactive Preview</span>
            </div>

            {/* Render Preview Content Based on current step */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              {step === 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center" }} className="rise">
                  <div style={{ 
                    width: 64, 
                    height: 64, 
                    borderRadius: "50%", 
                    background: "rgba(124,77,255,0.12)", 
                    border: "1px solid rgba(124,77,255,0.25)",
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    boxShadow: "0 0 24px rgba(124,77,255,0.15)",
                    marginBottom: 8
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 32, color: "var(--violet)" }}>explore</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Ready for Departure?</h3>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.5, maxWidth: 300, margin: "0 auto" }}>
                      You are about to enter a workspace that transforms routine into adventure. Tap continue to tour your new tools.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <div className="pill" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", padding: "4px 10px", borderRadius: 12, fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
                      ✨ v1.0 Live
                    </div>
                    <div className="pill" style={{ background: "rgba(124,77,255,0.1)", border: "1px solid rgba(124,77,255,0.2)", padding: "4px 10px", borderRadius: 12, fontSize: 11, color: "var(--violet)" }}>
                      🚀 AI Co-pilot
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }} className="rise">
                  <div style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)", borderRadius: 12, padding: "12px 14px" }}>
                    <div className="eyebrow" style={{ color: "var(--gold)", fontSize: 9, marginBottom: 4 }}>ACT I • THE COLD RISE</div>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 6 }}>The Mystic Library Quest</h3>
                    <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.4 }}>
                      {s1Done 
                        ? "The runes on the stone table begin to glow brightly. You have unlocked the doorway to the grand catalog." 
                        : "You stand before the high vault. Complete your daily studies to decode the hidden message."}
                    </p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button 
                      onClick={() => setS1Done(!s1Done)}
                      style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        gap: 10, 
                        width: "100%", 
                        padding: "10px 12px", 
                        borderRadius: 8, 
                        background: s1Done ? "rgba(76,175,80,0.12)" : "rgba(255,255,255,0.04)", 
                        border: "1px solid " + (s1Done ? "rgba(76,175,80,0.3)" : "rgba(255,255,255,0.08)"),
                        color: s1Done ? "#a5d6a7" : "#fff",
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        {s1Done ? "check_box" : "check_box_outline_blank"}
                      </span>
                      <span style={{ fontSize: 13, textDecoration: s1Done ? "line-through" : "none", flex: 1 }}>Read the daily study scrolls</span>
                      {s1Done && <span style={{ fontSize: 10, background: "rgba(76,175,80,0.2)", padding: "2px 6px", borderRadius: 4, color: "#fff" }}>+15 XP</span>}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, textAlign: "center", color: "var(--muted-2)" }}>
                    💡 Click the task above to test story progress!
                  </div>
                </div>
              )}

              {step === 2 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }} className="rise">
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 150, paddingRight: 4 }}>
                    {s2Messages.map((m, i) => (
                      <div key={i} style={{ 
                        alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                        background: m.sender === "user" ? "var(--violet)" : "rgba(255,255,255,0.06)",
                        padding: "8px 12px",
                        borderRadius: 12,
                        maxWidth: "85%",
                        fontSize: 12.5,
                        color: "#fff",
                        border: m.sender === "bot" ? "1px solid rgba(255,255,255,0.06)" : "none"
                      }}>
                        {m.text}
                      </div>
                    ))}
                    {s2Typing && (
                      <div style={{ alignSelf: "flex-start", background: "rgba(255,255,255,0.03)", padding: "8px 12px", borderRadius: 12, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                        Co-pilot is writing...
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={triggerS2Simulation}
                    disabled={s2Typing}
                    style={{ 
                      width: "100%", 
                      padding: "10px", 
                      borderRadius: 8, 
                      background: s2Typing ? "rgba(255,255,255,0.08)" : "color-mix(in srgb, var(--violet) 80%, white)", 
                      color: "#fff", 
                      fontWeight: 600, 
                      fontSize: 12.5,
                      border: "none",
                      cursor: s2Typing ? "not-allowed" : "pointer"
                    }}
                  >
                    {s2Typing ? "AI Agent Thinking..." : "🤖 Ask Co-pilot to Plan Workspace"}
                  </button>
                </div>
              )}

              {step === 3 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }} className="rise">
                  {/* Circular Gauge */}
                  <div style={{ position: "relative", width: 90, height: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg style={{ transform: "rotate(-90deg)", width: 90, height: 90 }}>
                      <circle cx="45" cy="45" r="38" stroke="rgba(255,255,255,0.06)" strokeWidth="6" fill="transparent" />
                      <circle cx="45" cy="45" r="38" stroke="var(--gold)" strokeWidth="6" fill="transparent" 
                        strokeDasharray={2 * Math.PI * 38}
                        strokeDashoffset={2 * Math.PI * 38 * (1 - s3Momentum / 100)}
                        strokeLinecap="round"
                        style={{ transition: "stroke-dashoffset 0.6s ease-in-out" }}
                      />
                    </svg>
                    <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{s3Momentum}%</span>
                      <span style={{ fontSize: 8, color: "var(--gold)", fontWeight: 600, letterSpacing: 0.5 }}>FLOW</span>
                    </div>
                  </div>

                  <div style={{ width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>UPCOMING WORK</span>
                      <span style={{ fontSize: 10, color: "var(--gold)" }}>⭐ Streak x4</span>
                    </div>
                    <button 
                      onClick={() => {
                        if (s3Momentum < 100) {
                          setS3Momentum(prev => Math.min(100, prev + 15));
                        } else {
                          setS3Momentum(65);
                        }
                      }}
                      style={{ 
                        width: "100%", 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "space-between",
                        padding: "10px 12px", 
                        borderRadius: 8, 
                        background: "rgba(255,255,255,0.04)", 
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#fff",
                        cursor: "pointer",
                        textAlign: "left"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--gold)" }}>local_fire_department</span>
                        <span style={{ fontSize: 12.5 }}>Complete 'History Research Outline'</span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600 }}>+20 XP</span>
                    </button>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }} className="rise">
                  {/* Energy Log buttons */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["low", "medium", "high"] as const).map(lev => {
                      const active = s4Energy === lev;
                      const colors = {
                        low: { bg: "rgba(33,150,243,0.15)", border: "rgba(33,150,243,0.4)", text: "#90caf9", icon: "battery_2_bar" },
                        medium: { bg: "rgba(255,152,0,0.15)", border: "rgba(255,152,0,0.4)", text: "#ffe082", icon: "battery_5_bar" },
                        high: { bg: "rgba(76,175,80,0.15)", border: "rgba(76,175,80,0.4)", text: "#a5d6a7", icon: "battery_charging_full" }
                      }[lev];
                      return (
                        <button
                          key={lev}
                          onClick={() => setS4Energy(lev)}
                          style={{
                            flex: 1,
                            padding: "8px 4px",
                            borderRadius: 8,
                            background: active ? colors.bg : "rgba(255,255,255,0.02)",
                            border: "1px solid " + (active ? colors.border : "rgba(255,255,255,0.06)"),
                            color: active ? colors.text : "rgba(255,255,255,0.4)",
                            fontSize: 11.5,
                            fontWeight: 600,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 4,
                            cursor: "pointer"
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{colors.icon}</span>
                          <span style={{ textTransform: "capitalize" }}>{lev}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Suggestion list */}
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", marginBottom: 8, fontWeight: 500 }}>RECOMMENDED FOR YOUR ENERGY:</div>
                    
                    {s4Energy === "low" && (
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }} className="fade-in">
                        <span className="material-symbols-outlined" style={{ color: "#2196f3", fontSize: 18 }}>coffee</span>
                        <div>
                          <div style={{ fontSize: 12.5, color: "#fff", fontWeight: 500 }}>Inbox Sweep & Clean</div>
                          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>15 mins • Light Effort</div>
                        </div>
                      </div>
                    )}
                    {s4Energy === "medium" && (
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }} className="fade-in">
                        <span className="material-symbols-outlined" style={{ color: "#ff9800", fontSize: 18 }}>schedule</span>
                        <div>
                          <div style={{ fontSize: 12.5, color: "#fff", fontWeight: 500 }}>Answer pending feedback emails</div>
                          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>30 mins • Moderate Effort</div>
                        </div>
                      </div>
                    )}
                    {s4Energy === "high" && (
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }} className="fade-in">
                        <span className="material-symbols-outlined" style={{ color: "#4caf50", fontSize: 18 }}>psychology</span>
                        <div>
                          <div style={{ fontSize: 12.5, color: "#fff", fontWeight: 500 }}>Draft Complex Server Architecture</div>
                          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>120 mins • High Cognitive Demand</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }} className="rise">
                  {/* Theme toggles */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["story", "editorial", "drive"] as const).map(t => {
                      const active = s5Theme === t;
                      return (
                        <button
                          key={t}
                          onClick={() => setS5Theme(t)}
                          style={{
                            flex: 1,
                            padding: "6px 4px",
                            borderRadius: 6,
                            background: active ? "var(--violet)" : "rgba(255,255,255,0.03)",
                            border: "1px solid " + (active ? "rgba(124, 77, 255, 0.5)" : "rgba(255,255,255,0.06)"),
                            color: active ? "#fff" : "rgba(255,255,255,0.5)",
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "capitalize",
                            cursor: "pointer"
                          }}
                        >
                          {t === "editorial" ? "Monopo" : t}
                        </button>
                      );
                    })}
                  </div>

                  {/* Morphing preview card */}
                  <div style={{ 
                    borderRadius: 12, 
                    padding: 14, 
                    transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                    background: s5Theme === "story" ? "#0f0e15" : s5Theme === "editorial" ? "#fbf9f4" : "#e0e6ed",
                    border: "1px solid " + (s5Theme === "story" ? "rgba(255,180,84,0.15)" : s5Theme === "editorial" ? "#e5dec9" : "#006eff33"),
                    color: s5Theme === "story" ? "#f8f9fa" : s5Theme === "editorial" ? "#1e1e1a" : "#0f172a"
                  }}>
                    <div style={{ 
                      fontSize: 9, 
                      fontWeight: 600, 
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: s5Theme === "story" ? "var(--gold)" : s5Theme === "editorial" ? "#a52d25" : "#006eff",
                      marginBottom: 4
                    }}>
                      {s5Theme === "story" ? "STORY MODE" : s5Theme === "editorial" ? "MONOPO EDITORIAL" : "DRIVE SURFACE"}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Focus Command Center</div>
                    <div style={{ fontSize: 11.5, opacity: 0.75, lineHeight: 1.4 }}>
                      {s5Theme === "story" && "A dark, atmospheric, immersive layout to spark imagination."}
                      {s5Theme === "editorial" && "A clean, bright, content-first canvas tailored for quiet clarity."}
                      {s5Theme === "drive" && "High-voltage, snappy performance tracking and speed."}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Pagination helper */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>CLICK ELEMENTS IN PREVIEW TO INTERACT</span>
              <span className="material-symbols-outlined animate-pulse" style={{ fontSize: 14, color: "var(--violet)" }}>ads_click</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer / Controls */}
      <div style={{
        maxWidth: 1100,
        width: "100%",
        margin: "0 auto",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        paddingTop: isMobile ? 16 : 24,
        flexDirection: isMobile ? "column" : "row",
        gap: isMobile ? 16 : 0
      }}>
        {/* Step indicator */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: step === i ? "var(--violet)" : "rgba(255,255,255,0.18)",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "all 0.2s"
              }}
              title={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 12, width: isMobile ? "100%" : "auto" }}>
          {step > 0 && (
            <button
              onClick={prevStep}
              className="tap focusable"
              style={{
                flex: isMobile ? 1 : undefined,
                padding: "10px 20px",
                borderRadius: 24,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "transparent",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13.5
              }}
            >
              Back
            </button>
          )}

          {step < steps.length - 1 ? (
            <button
              onClick={next}
              className="tap focusable"
              style={{
                flex: isMobile ? 1 : undefined,
                padding: "10px 24px",
                borderRadius: 24,
                border: "none",
                background: "var(--violet)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13.5,
                boxShadow: "0 4px 16px rgba(124, 77, 255, 0.3)"
              }}
            >
              Continue
            </button>
          ) : (
            <div style={{ display: "flex", gap: 10, width: "100%", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                onClick={() => onComplete(false)}
                className="tap focusable"
                style={{
                  padding: "11px 20px",
                  borderRadius: 24,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13.5
                }}
              >
                Start Empty (Fresh)
              </button>
              <button
                onClick={() => onComplete(true)}
                className="tap focusable"
                style={{
                  padding: "11px 24px",
                  borderRadius: 24,
                  border: "none",
                  background: "var(--violet)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13.5,
                  boxShadow: "0 4px 20px rgba(124, 77, 255, 0.45)"
                }}
              >
                Seed Demo & Launch 🚀
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [db, setDb] = useState<AppState | null>(null);
  const [tab, setTab] = useState<string>("mission");
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [activeFocusTaskId, setActiveFocusTaskId] = useState<string>("general");
  const [rescueTask, setRescueTask] = useState<Task | null>(null);
  const [completing, setCompleting] = useState<any>(null);
  const [energyFor, setEnergyFor] = useState<Task | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind?: string } | null>(null);
  const [ritual, setRitual] = useState(false);
  const [theme, setTheme] = useState<ThemeType>("story");
  const [themeOpen, setThemeOpen] = useState(false);
  const [authState, setAuthState] = useState({ ready: false, enabled: false, user: null as any });
  const [custom, setCustom] = useState<CustomStyle>({ accent: "", density: "comfortable", corners: "theme" });
  const [customOpen, setCustomOpen] = useState(false);
  const [mode, setMode] = useState<"dark" | "light" | "neutral">("dark");
  const [orbPalette, setOrbPalette] = useState("saigon");

  const [deviceMode, setDeviceMode] = useState<"auto" | "desktop" | "tablet" | "mobile">("auto");
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);

  const [gcal, setGcal] = useState({ enabled: false, connected: false });
  const [gtasks, setGtasks] = useState<{ list: any[]; loading: boolean; connected: boolean }>({ list: [], loading: false, connected: false });
  const [safeAlert, setSafeAlert] = useState<any>(null); // {taskId,task,level,minsToLss,shownAt}
  const [weaving, setWeaving] = useState(false);
  const [autoRunQuery, setAutoRunQuery] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const rescuedRef = useRef<Set<string>>(new Set());
  const snoozeRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const currentMode = deviceMode === "auto" 
    ? (windowWidth < 768 ? "mobile" : windowWidth < 1100 ? "tablet" : "desktop")
    : deviceMode;

  const isMobile = currentMode === "mobile";
  const isTablet = currentMode === "tablet";

  useEffect(() => {
    (async () => {
      await Auth.init();
      const uid = Auth.user ? Auth.user.uid : anonId();
      Store.setUser(uid);
      setAuthState({ ready: true, enabled: Auth.enabled, user: Auth.user });
      try {
        const cfg = await (await fetch("/api/config")).json();
        await GCal.init(cfg.googleClientId);
        setGcal({ enabled: GCal.enabled, connected: false });
      } catch (e) {}
      const saved = await Store.get("momentum:v1");
      const didOnboard = await Store.get("momentum:onboarded");
      
      if (!saved && !didOnboard) {
        setDb(emptyDb());
        setShowOnboarding(true);
      } else {
        setDb(saved || seed());
      }
      
      const th = await Store.get("momentum:theme"); if (th) setTheme(th);
      const cu = await Store.get("momentum:custom"); if (cu) setCustom(cu);
      const md = await Store.get("momentum:mode"); if (md) setMode(md);
      const ob = await Store.get("momentum:orb"); if (ob) setOrbPalette(ob);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    Store.set("momentum:theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.storyGenre = db?.storyGenre || "Fantasy";
  }, [db?.storyGenre]);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    Store.set("momentum:mode", mode);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.orb = orbPalette;
    Store.set("momentum:orb", orbPalette);
  }, [orbPalette]);

  useEffect(() => {
    const root = document.documentElement.style;
    
    // Determine whether light or dark mode is active
    const isDark = (theme === "story" && mode !== "light") ||
                   (theme === "editorial" && mode !== "light" && mode !== "neutral") ||
                   (theme === "drive" && mode === "dark");

    // Dynamic color: derive the entire palette at runtime using the HCT / Material color-utilities algorithm
    const themeSeed = theme === "editorial" ? "#ffac2e" : (theme === "drive" ? "#006eff" : "#ffb454");
    const seedColor = custom.accent || themeSeed;

    applyM3PaletteToStyle(seedColor, isDark);

    // Dynamic Drive car vector SVG mapping to primary/secondary colors from the dynamic scheme
    const colors = getM3Palette(seedColor, isDark);
    const pColor = colors.primary;
    const scColor = colors.secondaryContainer;
    const rawSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 340 150'> <g opacity='0.5' stroke='${pColor}' stroke-width='4' stroke-linecap='round'> <line x1='2' y1='66' x2='40' y2='66'/> <line x1='8' y1='80' x2='34' y2='80'/> </g> <ellipse cx='180' cy='126' rx='128' ry='9' fill='#000000' opacity='0.12'/> <path d='M40,96 C42,78 78,74 104,72 L132,54 C152,42 198,42 220,54 L250,72 C282,76 312,82 314,96 L314,104 C314,110 308,114 300,114 L54,114 C44,114 38,108 40,96 Z' fill='${pColor}'/> <path d='M132,56 C152,46 196,46 216,56 L238,72 L132,72 Z' fill='${scColor}'/> <path d='M160,44 L206,44 L216,56 L160,56 Z' fill='#16181d' opacity='0.9'/> <rect x='150' y='42' width='6' height='14' rx='2' fill='#16181d' opacity='0.9'/> <circle cx='96' cy='114' r='23' fill='#111111'/> <circle cx='96' cy='114' r='9' fill='#e6eefc'/> <circle cx='258' cy='114' r='23' fill='#111111'/> <circle cx='258' cy='114' r='9' fill='#e6eefc'/> <circle cx='309' cy='92' r='4' fill='#ffffff'/> </svg>`;
    const dataUri = `url("data:image/svg+xml,${encodeURIComponent(rawSvg)}")`;
    root.setProperty("--drive-hero-car-bg", dataUri);

    document.documentElement.dataset.density = custom.density || "comfortable";
    if (custom.corners && custom.corners !== "theme") {
      const map = { sharp: { r: "4px", rs: "3px" }, soft: { r: "14px", rs: "9px" }, round: { r: "28px", rs: "18px" } };
      const m = map[custom.corners];
      if (m) { root.setProperty("--radius", m.r); root.setProperty("--radius-sm", m.rs); }
    } else {
      root.removeProperty("--radius");
      root.removeProperty("--radius-sm");
    }
    Store.set("momentum:custom", custom);
  }, [custom, theme, mode]);

  useEffect(() => {
    if (!db) return;
    const tick = () => {
      const actives = db.tasks.filter(t => !t.done);
      const resolved = resolvedSafeStarts(db);
      let pick: any = null;
      for (const t of actives) {
        const st = safeStartStatusResolved(t, resolved);
        const snoozedUntil = snoozeRef.current[t.id] || 0;
        if (st.state === "blown") {
          if (!rescuedRef.current.has(t.id)) {
            rescuedRef.current.add(t.id);
            setRescueTask(t);
            flash("Safe start passed — switching to Rescue Mode.", "warn");
          }
          continue;
        }
        if (Date.now() < snoozedUntil) continue;
        if (st.state === "fullscreen" || st.state === "banner") {
          if (!pick || (st.minsToLss !== null && pick.minsToLss !== null && st.minsToLss < pick.minsToLss)) {
            pick = { task: t, ...st };
          }
        }
      }
      setSafeAlert((prev: any) => {
        if (!pick) return null;
        const same = prev && prev.taskId === pick.task.id;
        const escalatedByTime = same && (Date.now() - prev.shownAt > 20000); // ignored ~20s → full screen
        const level = (pick.state === "fullscreen" || escalatedByTime) ? "fullscreen" : "banner";
        return {
          taskId: pick.task.id,
          task: pick.task,
          level,
          minsToLss: pick.minsToLss,
          lss: pick.lss,
          conflicted: pick.conflicted,
          shownAt: same ? prev.shownAt : Date.now()
        };
      });
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [db]);

  const dismissAlert = (mins = 3) => {
    if (safeAlert) {
      snoozeRef.current[safeAlert.taskId] = Date.now() + mins * 60e3;
    }
    setSafeAlert(null);
  };

  async function syncGoogleTasks() {
    if (!GCal.token) return;
    setGtasks(g => ({ ...g, loading: true, connected: true }));
    try {
      const taskLists = await GCal.getTaskLists();
      let allTasks: any[] = [];
      if (taskLists && taskLists.length > 0) {
        const defaultList = taskLists[0];
        const rawTasks = await GCal.getTasks(defaultList.id);
        allTasks = (rawTasks || []).filter((t: any) => t.status !== "completed").map((t: any) => ({
          id: t.id,
          title: t.title,
          notes: t.notes || "",
          due: t.due ? Date.parse(t.due) : null,
          listId: defaultList.id,
          listTitle: defaultList.title
        }));
      }
      setGtasks({ list: allTasks, loading: false, connected: true });
    } catch (e) {
      setGtasks(g => ({ ...g, loading: false }));
    }
  }

  async function importGoogleTask(gt: any) {
    const taskTitle = gt.title;
    if (!taskTitle) return;
    
    if (db?.tasks.some(t => t.googleTaskId === gt.id)) {
      flash(`"${taskTitle}" is already imported.`, "warn");
      return;
    }
    
    const newTask: Task = {
      id: "t" + now(),
      title: taskTitle,
      type: "one-off",
      due: gt.due || (now() + 24 * 3600 * 1000),
      why: gt.notes || "Imported from Google Tasks.",
      stakes: 2,
      done: false,
      googleTaskId: gt.id,
      googleTaskListId: gt.listId
    };
    
    patch(d => {
      d.tasks.unshift(newTask);
    });
    
    setGtasks(prev => ({
      ...prev,
      list: prev.list.filter(item => item.id !== gt.id)
    }));
    
    flash(`Imported "${taskTitle}" from Google Tasks.`, "good");
  }

  async function connectCalendar() {
    const ok = await GCal.connect();
    if (!ok) {
      flash("Calendar and Tasks connection cancelled.", "warn");
      return;
    }
    setGcal(g => ({ ...g, connected: true }));
    const busy = await GCal.freeBusy(new Date().toISOString(), new Date(now() + 7 * DAY).toISOString());
    let enrichedBusy = busy;
    try {
      const tbRes = await fetch("/api/gemini/travel-gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: busy })
      });
      if (tbRes.ok) {
        enrichedBusy = (await tbRes.json()).blocks || busy;
      }
    } catch(e) {}
    
    patch(d => { d.calBusy = enrichedBusy; });
    await syncGoogleTasks();
    flash(`Google Calendar & Tasks synced successfully.`, "good");
  }

  useEffect(() => {
    if (theme !== "scroll") return;
    const io = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) e.target.classList.add("reveal-in"); }), { threshold: .12 });
    const t = setTimeout(() => document.querySelectorAll(".card").forEach(c => io.observe(c)), 60);
    return () => { clearTimeout(t); io.disconnect(); };
  }, [theme, tab]);

  useEffect(() => { if (db) Store.set("momentum:v1", db); }, [db]);

  const flash = (msg: string, kind?: string) => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const patch = useCallback((fn: (d: AppState) => void) => setDb(d => {
    if (!d) return d;
    const nd = structuredClone(d);
    fn(nd);
    return nd;
  }), []);

  if (!db) return <div style={{ padding: 40 }} className="mono">booting mission control…</div>;

  if (showOnboarding) {
    return (
      <OnboardingTour 
        isMobile={isMobile}
        onComplete={(seedDemo) => {
          Store.set("momentum:onboarded", true);
          setShowOnboarding(false);
          if (seedDemo) {
            setDb(seed());
            setAutoRunQuery("I want to get a head start on my essays and keep my gym streak alive. Build my plan.");
            setTab("copilot");
            flash("Demo data seeded! Check out the AI Co-pilot running.", "good");
          } else {
            setDb(emptyDb());
            flash("Fresh workspace ready.", "good");
          }
        }}
      />
    );
  }

  const activeTasks = db.tasks.filter(t => !t.done).sort((a, b) => score(b) - score(a));
  const topUrgent = activeTasks[0];

  const momentum = (() => {
    const todays = db.tasks.filter(t => hoursTo(t.due || 0) < 24);
    if (!todays.length) return 100;
    const done = todays.filter(t => t.done).length;
    const atRisk = activeTasks.filter(t => hoursTo(t.due || 0) < 24 && (hoursTo(t.due || 0) / Math.max(.25, (t.effortMin || 30) / 60)) < 2.5).length;
    return Math.max(6, Math.min(100, Math.round(40 + (done / todays.length) * 55 - atRisk * 10 + (db.streak.count > 0 ? 6 : 0))));
  })();

  async function weaveStory(goalText: string, specificGenre?: string) {
    setWeaving(true);
    const targetGenre = specificGenre || db.storyGenre || "Fantasy";
    const titles = [...db.tasks].filter(t => !t.done).sort((a, b) => score(b) - score(a)).map(t => t.title);
    try {
      const s = await aiStory(goalText, titles, targetGenre);
      patch(d => {
        d.story = s;
        d.storyGenre = s?.genre || targetGenre;
      });
      flash(`The narrator has woven your ${s?.genre || targetGenre} quest.`, "good");
    } catch (e) {
      patch(d => {
        d.story = localStory(goalText, titles, targetGenre);
        if (specificGenre) d.storyGenre = specificGenre;
      });
      flash("The narrator is resting (AI quota limit reached). Wove a local offline quest outline!", "info");
    } finally {
      setWeaving(false);
    }
  }

  const storyProgress = (() => {
    const done = db.tasks.filter(t => t.done === true).length;
    const open = db.tasks.filter(t => !t.done).length;
    const base = (done + open) ? done / (done + open) : 0;
    const streakBoost = Math.min(0.2, (db.streak && db.streak.count || 0) / 50);
    return Math.max(0, Math.min(1, base * 0.82 + streakBoost));
  })();

  function startFocus(t: Task) {
    playRitualCue();
    setRitual(true); setTimeout(() => setRitual(false), 900);
    setActiveFocusTaskId(t.id);
    setTab("focus");
  }

  function completeTask(t: Task) {
    if (t.googleTaskId) {
      GCal.completeGoogleTask(t.googleTaskId, t.googleTaskListId || "@default")
        .then(ok => {
          if (ok) flash(`Completed "${t.title}" on Google Tasks!`, "good");
        })
        .catch(e => console.warn("Google Tasks complete error:", e));
    }
    const completedAt = now();
    const filled = { ...t, completedAt };
    const ctx = {
      weekDone: db!.wins.filter(w => w.at > db!.settings.weekStart).length + 1,
      habitCount: (db!.goals[t.goal || ""]?.sessions || 0) + 1,
    };
    const payoff = gainStatement(filled, ctx);
    let streakNote = null, surprise = false, xpGain = 0;
    patch(d => {
      const x = d.tasks.find(z => z.id === t.id); if (x) { x.done = true; x.completedAt = completedAt; }
      const early = completedAt < (t.due || 0);
      const s = d.streak;
      if (s.debt > 0 && early) {
        s.debt -= 1; s.count = s.locked - s.debt; if (s.count < 0) s.count = 0;
        if (s.debt === 0) { s.count = s.locked; s.locked = 0; streakNote = `Streak fully reclaimed — back to ${s.count}.`; }
        else streakNote = `Debt paid down. Streak restoring: ${s.count}/${s.locked}.`;
      } else {
        s.count += 1; streakNote = `Streak ${s.count}.`;
      }
      if (t.type === "habit") {
        const g = d.goals[t.goal || ""] || (d.goals[t.goal || ""] = { xp: 0, level: 1, sessions: 0 });
        xpGain = early ? 15 : 10;
        if (Math.random() < 0.22) { surprise = true; xpGain += 12; }
        const before = g.level; g.xp += xpGain; g.sessions += 1; g.level = levelFromXp(g.xp);
        d.xpGlobal += xpGain;
        if (g.level > before) streakNote = (streakNote || "") + ` Level ${g.level} on “${t.goal}”.`;
      }
      d.wins.unshift({ id: "w" + now(), title: t.title, at: completedAt, text: payoff, badge: t.type === "habit" ? "habit" : (early ? "early" : "ontime") });
    });
    setFocusTask(null);
    setCompleting({ task: filled, payoff, streakNote, surprise, xpGain, isHabit: t.type === "habit" });

    fetch("/api/memory/task-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: Store.getUid(), task: t, status: "completed" })
    }).catch(e => console.warn(e));
  }

  function missTask(t: Task) {
    patch(d => {
      const x = d.tasks.find(z => z.id === t.id); if (x) x.done = "missed";
      const s = d.streak;
      if (s.count > 0) s.locked = Math.max(s.locked, s.count);
      s.debt += 1; s.count = Math.max(0, s.locked - s.debt);
    });
    flash("Streak hit — win it back with any early completion.", "warn");

    fetch("/api/memory/task-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: Store.getUid(), task: t, status: "missed" })
    }).catch(e => console.warn(e));
  }

  async function addTask(t: Omit<Task, "id" | "done">) {
    const taskId = "t" + now();
    let googleTaskId: string | undefined = undefined;
    let googleTaskListId: string | undefined = undefined;
    
    if (GCal.connected && GCal.token) {
      try {
        const dueISO = t.due ? new Date(t.due).toISOString() : undefined;
        const gt = await GCal.createGoogleTask(t.title, t.why, dueISO);
        if (gt && gt.id) {
          googleTaskId = gt.id;
          googleTaskListId = "@default";
          flash(`"${t.title}" saved locally & synced to Google Tasks!`, "good");
        }
      } catch (e) {
        console.warn("Failed to push task to Google Tasks:", e);
      }
    }
    
    patch(d => d.tasks.unshift({ 
      ...t, 
      id: taskId, 
      done: false, 
      googleTaskId, 
      googleTaskListId 
    }));
    
    if (!googleTaskId) {
      flash("On the radar.", "good");
    }
  }

  async function deleteTask(t: Task) {
    if (t.googleTaskId && GCal.connected && GCal.token) {
      try {
        await GCal.deleteGoogleTask(t.googleTaskId, t.googleTaskListId || "@default");
      } catch (e) {
        console.warn("Failed to delete from Google Tasks:", e);
      }
    }
    patch(d => {
      d.tasks = d.tasks.filter(x => x.id !== t.id);
    });
    flash(`Deleted task: "${t.title}"`, "warn");
  }

  function logEnergy(task: Task, effort: number) {
    patch(d => d.energy.unshift({ at: now(), effort, task: task.title }));
    setEnergyFor(null);
    flash("Energy logged.", "good");
  }

  function resetAll() { setDb(seed()); flash("Reset to demo data.", "good"); }
  function clearAll() { setDb(emptyDb()); Store.set("momentum:onboarded", true); flash("Data cleared.", "warn"); }

  function applyAgentActions(actions: any[]) {
    patch(d => {
      d.schedule = d.schedule || []; d.reminders = d.reminders || [];
      actions.forEach(a => {
        if (a.type === "create_task") d.tasks.unshift({ ...a.task, id: "t" + Math.random().toString(36).slice(2), done: false });
        if (a.type === "schedule") d.schedule.unshift({ title: a.title, startISO: a.startISO, durationMin: a.durationMin });
        if (a.type === "reminder") d.reminders.unshift({ title: a.title, atISO: a.atISO, message: a.message });
      });
    });
    
    const reminders = actions.filter(a => a.type === "reminder");
    reminders.forEach(r => {
      fetch("/api/reminders/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: Auth.user ? Auth.user.uid : Store.getUid(), title: r.title, message: r.message, atISO: r.atISO })
      }).catch(e => console.warn("Failed to schedule Cloud Task:", e));
    });

    if (GCal.connected) {
      const blocks = actions.filter(a => a.type === "schedule");
      blocks.forEach(a => {
        const end = new Date(Date.parse(a.startISO) + (a.durationMin || 30) * 60e3).toISOString();
        GCal.insertEvent({ summary: "Momentum · " + a.title, startISO: a.startISO, endISO: end });
      });
      if (blocks.length) {
        flash(`Plan applied — ${blocks.length} block${blocks.length !== 1 ? "s" : ""} written to Google Calendar.`, "good");
      } else {
        flash("Plan applied.", "good");
      }
    } else {
      flash("Plan applied.", "good");
    }
    setTab("mission");
  }

  const tabs = [
    ["mission", "Mission"], ["copilot", "Co-pilot"], ["tasks", "Tasks"], ["focus", "Focus Chamber"], ["habits", "Habits & XP"],
    ["energy", "Energy"], ["wins", "Wins"], ["add", "Add"]
  ] as const;

  return (
    <>
      {theme === "story" && <StoryBackgroundGraphics genre={db?.storyGenre || "Fantasy"} />}
      <div className="wrap" style={{ padding: isMobile ? "10px" : "24px 20px 90px", maxWidth: "1200px", margin: "0 auto", transition: "all 0.3s ease" }}>
        {/* Top-left Sign-in utility option */}
        {authState && authState.enabled && (
          <div style={{
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "center",
            marginBottom: 14,
            paddingLeft: isMobile ? 4 : 0
          }}>
            <button 
              onClick={() => authState.user ? Auth.signOut() : Auth.signIn()} 
              className="tap focusable pill"
              style={{ 
                background: "color-mix(in srgb, var(--flow) 12%, transparent)", 
                color: "var(--flow)", 
                border: "1px solid color-mix(in srgb, var(--flow) 30%, transparent)", 
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "var(--radius-btn)",
                fontSize: 12,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 6
              }}
            >
              {authState.user ? (
                <>
                  <MIcon name="account_circle" s={14} fill={1} /> 
                  <span>{authState.user.displayName?.split(" ")[0] || "Signed in"} · Sign out</span>
                </>
              ) : (
                <>
                  <MIcon name="login" s={14} /> 
                  <span>Sign in</span>
                </>
              )}
            </button>
          </div>
        )}

        <Header momentum={momentum} streak={db.streak} level={levelFromXp(db.xpGlobal)} xp={db.xpGlobal}
          onVoice={() => setTab("mission")} auth={authState} isMobile={isMobile} gcal={gcal} onConnectCal={connectCalendar} />

        {(() => {
          const controls = (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: isMobile ? "center" : "flex-start" }}>
              <ThemeSwitcher theme={theme} setTheme={(id: any) => { setTheme(id); const def = ({ drive: "light", editorial: "dark", story: "dark" } as any)[id]; if (def) setMode(def); }} open={themeOpen} setOpen={setThemeOpen} />
              <CustomizePanel custom={custom} setCustom={setCustom} open={customOpen} setOpen={setCustomOpen} theme={theme} mode={mode} setMode={setMode} orbPalette={orbPalette} setOrbPalette={setOrbPalette} db={db} patch={patch} />
              <button onClick={resetAll} className="tap focusable" title="Seed demo data"
                style={{ padding: "9px 13px", borderRadius: "var(--radius-sm)", fontSize: 12.5, border: "1px solid var(--line)", background: "transparent", color: "var(--muted-2)" }}><MIcon name="refresh" s={13} weight={400} /> Reset</button>
              <button onClick={clearAll} className="tap focusable" title="Clear all data"
                style={{ padding: "9px 13px", borderRadius: "var(--radius-sm)", fontSize: 12.5, border: "1px solid color-mix(in srgb, var(--warn) 30%, transparent)", background: "transparent", color: "var(--warn)" }}><MIcon name="delete" s={13} weight={400} /> Clear</button>
            </div>
          );
          if (theme === "editorial") {
            return (
              <div style={{ margin: isMobile ? "16px 0" : "26px 0 28px" }}>
                <div style={{ display: "flex", justifyValue: "flex-end", justifyContent: isMobile ? "center" : "flex-end", marginBottom: isMobile ? 12 : 22 }}>{controls}</div>
                <div className="orbnav" style={{ justifyContent: isMobile ? "center" : "flex-start" }}>
                  {tabs.map(([k, label], i) => (
                    <button key={k} onClick={() => setTab(k)} className={"orb tap focusable" + (tab === k ? " active" : "")} style={{ minWidth: isMobile ? "80px" : undefined }}>
                      <span className="orb-grad" style={{ animationDelay: (i * -3.4) + "s" }} />
                      <span className="orb-title" style={{ fontSize: isMobile ? 11.5 : undefined }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          if (theme === "drive") {
            return (
              <div style={{ margin: isMobile ? "16px 0" : "24px 0 26px" }}>
                <div style={{ display: "flex", justifyContent: isMobile ? "center" : "flex-end", marginBottom: 8 }}>{controls}</div>
                <div className="rulebar" style={{ justifyContent: isMobile ? "center" : "flex-start" }}>
                  {tabs.map(([k, label]) => (
                    <button key={k} onClick={() => setTab(k)} className={tab === k ? "active" : ""}>{label}</button>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: isMobile ? "16px 0" : "22px 0 20px", alignItems: "center", justifyContent: isMobile ? "center" : "flex-start" }}>
              {tabs.map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className="tap focusable"
                   style={{ padding: isMobile ? "6px 10px" : "9px 15px", borderRadius: "var(--radius-btn)", fontWeight: 600, fontSize: isMobile ? 12 : 13.5, border: "1px solid " + (tab === k ? "var(--ember)" : "var(--line)"), background: tab === k ? "linear-gradient(180deg,color-mix(in srgb, var(--ember) 18%, transparent),color-mix(in srgb, var(--ember) 6%, transparent))" : "transparent", color: tab === k ? "var(--text)" : "var(--muted)" }}>
                  {label}{k === "add" ? "  +" : ""}
                </button>
              ))}
              <div style={{ marginLeft: isMobile ? "0" : "auto", marginTop: isMobile ? 10 : 0, width: isMobile ? "100%" : "auto", display: "flex", justifyContent: "center" }}>{controls}</div>
            </nav>
          );
        })()}

        {tab === "mission" && theme === "story" && !db?.settings?.storyModeDisabled && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }} className="rise">
            <StoryPanel db={db} progress={storyProgress} onWeave={weaveStory} weaving={weaving} patch={patch} custom={custom} setCustom={setCustom} setMode={setMode} flash={flash} />
            <Mission db={db} activeTasks={activeTasks} topUrgent={topUrgent} momentum={momentum} onFocus={startFocus} onRescue={setRescueTask} onComplete={completeTask} onMiss={missTask} onDelete={deleteTask} onLogEnergy={setEnergyFor} patch={patch} isMobile={isMobile} isTablet={isTablet} />
          </div>
        )}
        {tab === "mission" && (theme !== "story" || db?.settings?.storyModeDisabled) && (
          <Mission db={db} activeTasks={activeTasks} topUrgent={topUrgent} momentum={momentum} onFocus={startFocus} onRescue={setRescueTask} onComplete={completeTask} onMiss={missTask} onDelete={deleteTask} onLogEnergy={setEnergyFor} patch={patch} isMobile={isMobile} isTablet={isTablet} />
        )}
        {tab === "copilot" && <AgentView db={db} onApply={applyAgentActions} isMobile={isMobile} autoRunQuery={autoRunQuery} onClearAutoRun={() => setAutoRunQuery("")} />}
        {tab === "tasks" && (
          <TasksView 
            tasks={activeTasks} 
            onFocus={startFocus} 
            onRescue={setRescueTask} 
            onComplete={completeTask} 
            onMiss={missTask} 
            onDelete={deleteTask}
            onLogEnergy={setEnergyFor} 
            isMobile={isMobile}
            gtasks={gtasks}
            onSyncTasks={syncGoogleTasks}
            onImportTask={importGoogleTask}
          />
        )}
        {tab === "focus" && (
          <FocusTab
            db={db}
            patch={patch}
            flash={flash}
            isMobile={isMobile}
            activeTasks={activeTasks}
            onComplete={completeTask}
            selectedTaskId={activeFocusTaskId}
            setSelectedTaskId={setActiveFocusTaskId}
          />
        )}
        {tab === "habits" && <HabitsView db={db} patch={patch} flash={flash} />}
        {tab === "energy" && <EnergyView db={db} />}
        {tab === "wins" && <WinsView db={db} />}
        {tab === "add" && <AddView onAdd={addTask} goals={Object.keys(db.goals)} />}

        {ritual && <RitualBurst />}
        {focusTask && <FocusModal task={focusTask} onClose={() => setFocusTask(null)} onComplete={() => completeTask(focusTask)} onRescue={() => { setRescueTask(focusTask); setFocusTask(null); }} />}
        {rescueTask && <RescueModal task={rescueTask} onClose={() => setRescueTask(null)} onComplete={() => { completeTask(rescueTask); setRescueTask(null); }} />}
        {completing && <PayoffModal data={completing} isHabit={completing.isHabit} onClose={() => { if (completing.isHabit) { setEnergyFor(completing.task); } setCompleting(null); }} />}
        {energyFor && <EnergyModal task={energyFor} onClose={() => setEnergyFor(null)} onLog={logEnergy} />}
        {toast && <Toast {...toast} />}
        {safeAlert && safeAlert.level === "banner" && (
          <SafeStartBanner
            alert={safeAlert}
            onStart={() => { startFocus(safeAlert.task); snoozeRef.current[safeAlert.taskId] = Date.now() + 30 * 60e3; setSafeAlert(null); }}
            onEscalate={() => setSafeAlert((a: any) => a && ({ ...a, level: "fullscreen" as const }))}
            onSnooze={() => dismissAlert(2)}
          />
        )}
        {safeAlert && safeAlert.level === "fullscreen" && (
          <SafeStartAlarm
            alert={safeAlert}
            onStart={() => { startFocus(safeAlert.task); snoozeRef.current[safeAlert.taskId] = Date.now() + 30 * 60e3; setSafeAlert(null); }}
            onComplete={() => { completeTask(safeAlert.task); setSafeAlert(null); }}
            onRescue={() => { setRescueTask(safeAlert.task); setSafeAlert(null); }}
            onSnooze={() => dismissAlert(2)}
          />
        )}

        <footer style={{ marginTop: 60, paddingTop: 20, borderTop: "1px solid var(--line-soft)", display: "flex", justifyValue: "space-between", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted-2)", textAlign: isMobile ? "center" : "left", width: isMobile ? "100%" : "auto" }}>INITIO · mission control for not missing your life</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted-2)", textAlign: isMobile ? "center" : "right", width: isMobile ? "100%" : "auto" }}><SystemStatusBadge db={db} gcalConnected={gcal.connected} gtasksConnected={gtasks.connected} /></span>
        </footer>
      </div>
    </>
  );
}

function Header({ momentum, streak, level, xp, auth, isMobile, gcal, onConnectCal }: any) {
  return (
    <header className="card hero" style={{ 
      padding: isMobile ? "16px 16px" : "22px 24px", 
      display: "grid", 
      gridTemplateColumns: isMobile ? "1fr" : "auto 1fr auto", 
      gap: isMobile ? 16 : 24, 
      alignItems: "center",
      textAlign: isMobile ? "center" : "left",
      minHeight: isMobile ? "auto" : undefined
    }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Dial value={momentum} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: isMobile ? "center" : "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div className="eyebrow">Today's momentum</div>
          {gcal && gcal.enabled && (
            <button onClick={() => gcal.connected ? null : onConnectCal()} className="tap focusable pill"
              style={{ background: "color-mix(in srgb, var(--violet) 12%, transparent)", color: "var(--violet)", border: "1px solid color-mix(in srgb, var(--violet) 30%, transparent)", cursor: gcal.connected ? "default" : "pointer" }}>
              <MIcon name="calendar_month" s={13} /> {gcal.connected ? "Google Workspace synced" : "Connect Google Workspace"}
            </button>
          )}
        </div>
        <h1 className="display" style={{ margin: "4px 0 6px", fontSize: isMobile ? "22px" : "clamp(26px,4vw,40px)", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1 }}>
          {momentum >= 75 ? "You’re ahead of it." : momentum >= 45 ? "Holding the line." : "It’s slipping — act now."}
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, maxWidth: isMobile ? "100%" : 520, marginLeft: isMobile ? "auto" : 0, marginRight: isMobile ? "auto" : 0 }}>
          Momentum blends what’s due, what’s at risk, and what you’ve closed today.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: isMobile ? "row" : "column", gap: 10, alignItems: isMobile ? "center" : "flex-end", justifyContent: isMobile ? "center" : "flex-start", flexWrap: "wrap" }}>
        <Flame count={streak.count} debt={streak.debt} locked={streak.locked} />
        <div className="pill" title="Current Level and XP Progress"
          style={{ 
            background: "color-mix(in srgb, var(--violet) 14%, transparent)", 
            color: "var(--violet)", 
            border: "1px solid color-mix(in srgb, var(--violet) 30%, transparent)", 
            padding: "5px 12px",
            display: "inline-flex",
            alignItems: "center",
            gap: 6
          }}>
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            <MIcon name="military_tech" s={14} fill={1} />
          </span>
          <span className="mono" style={{ fontWeight: 700, fontSize: 14, lineHeight: 1 }}>
            {level}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
            level · {xpInLevel(xp)}/{LEVEL_STEP} xp
          </span>
        </div>
      </div>
    </header>
  );
}

function Dial({ value }: any) {
  const R = 46, C = 2 * Math.PI * R;
  const off = C * (1 - value / 100);
  const col = value >= 75 ? "var(--flow)" : value >= 45 ? "var(--gold)" : "var(--ember)";
  return (
    <div style={{ position: "relative", width: 118, height: 118 }}>
      <svg width="118" height="118" viewBox="0 0 118 118">
        <circle cx="59" cy="59" r={R} fill="none" stroke="var(--line)" strokeWidth="9" />
        <circle cx="59" cy="59" r={R} fill="none" stroke={col} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 59 59)"
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1), stroke .6s" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span className="mono" style={{ fontSize: 30, fontWeight: 700, color: col, lineHeight: 1 }}>{value}</span>
        <span className="eyebrow" style={{ fontSize: 9 }}>/ 100</span>
      </div>
    </div>
  );
}

function Flame({ count, debt, locked }: any) {
  const recovering = debt > 0;
  return (
    <div className="pill" title={recovering ? "Restoring" : `${count}-day streak`}
      style={{ 
        background: recovering ? "color-mix(in srgb, var(--gold) 14%, transparent)" : "color-mix(in srgb, var(--ember) 14%, transparent)", 
        color: recovering ? "var(--gold)" : "var(--ember)", 
        border: "1px solid " + (recovering ? "color-mix(in srgb, var(--gold) 30%, transparent)" : "color-mix(in srgb, var(--ember) 30%, transparent)"), 
        padding: "5px 12px",
        display: "inline-flex",
        alignItems: "center",
        gap: 6
      }}>
      <span style={{ display: "inline-flex", alignItems: "center", animation: "flamePulse 1.8s ease-in-out infinite" }}>
        {recovering ? <IcoRecover s={14} /> : <IcoFlame s={14} />}
      </span>
      <span className="mono" style={{ fontWeight: 700, fontSize: 14, lineHeight: 1 }}>
        {recovering ? <>{count}<span style={{ opacity: .5 }}>/{locked}</span></> : count}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
        {recovering ? "reclaiming" : "day streak"}
      </span>
    </div>
  );
}

function Mission({ db, activeTasks, topUrgent, momentum, onFocus, onRescue, onComplete, onMiss, onDelete, onLogEnergy, patch, isMobile, isTablet }: any) {
  const insight = energyInsight(db.energy);
  const overdue = activeTasks.filter((t: any) => hoursTo(t.due || 0) <= 0);
  const soon = activeTasks.filter((t: any) => hoursTo(t.due || 0) > 0 && hoursTo(t.due || 0) < 24);

  const sidebar = (
    <aside style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%" }}>
      <VoiceCard tasks={activeTasks} />
      {((db.schedule || []).length > 0 || (db.reminders || []).length > 0) && (
        <div className="card" style={{ padding: 16, borderColor: "color-mix(in srgb, var(--violet) 30%, transparent)" }}>
          <div className="eyebrow" style={{ color: "var(--violet)", marginBottom: 10 }}>◆ Co-pilot's plan</div>
          {(db.schedule || []).slice(0, 4).map((s: any, i: number) => (
            <div key={"s" + i} style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between", gap: 8, padding: "5px 0" }}>
              <span style={{ fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}><MIcon name="schedule" s={13} weight={400} /> {s.title}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{clockLabel(Date.parse(s.startISO))}</span>
            </div>
          ))}
          {(db.reminders || []).slice(0, 3).map((r: any, i: number) => (
            <div key={"r" + i} style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between", gap: 8, padding: "5px 0" }}>
              <span style={{ fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}><IcoBell s={11} /> {r.title}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{clockLabel(Date.parse(r.atISO))}</span>
            </div>
          ))}
        </div>
      )}
      <div className="card" style={{ padding: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Right now</div>
        <Stat n={overdue.length} label="overdue" col="var(--bad)" />
        <Stat n={soon.length} label="due within 24h" col="var(--gold)" />
        <Stat n={db.wins.filter((w: any) => w.at > db.settings.weekStart).length} label="wins this week" col="var(--flow)" />
      </div>
      {insight && (
        <div className="card" style={{ padding: 16, borderColor: "color-mix(in srgb, var(--flow) 30%, transparent)" }}>
          <div className="eyebrow" style={{ color: "var(--flow)", marginBottom: 8 }}>Energy pattern</div>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>{insight}</p>
        </div>
      )}
      <WeeklyReflection db={db} />
    </aside>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: (isMobile || isTablet) ? "1fr" : "1.6fr 1fr", gap: 18 }} className="rise">
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        {topUrgent && <UrgentCard task={topUrgent} onFocus={onFocus} onRescue={onRescue} onComplete={onComplete} isMobile={isMobile} />}
        <div className="card" style={{ padding: "4px 4px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyValue: "space-between", justifyContent: "space-between", padding: "14px 16px 8px" }}>
            <div className="eyebrow">Prioritized radar</div>
            {!isMobile && <span className="mono" style={{ fontSize: 11, color: "var(--muted-2)" }}>urgency × effort × stakes</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {activeTasks.map((t: any) => (
              <TaskRow key={t.id} t={t} onFocus={onFocus} onRescue={onRescue} onComplete={onComplete} onMiss={onMiss} onDelete={onDelete} isMobile={isMobile} />
            ))}
            {!activeTasks.length && <Empty msg="Nothing on the radar. Add a task to point the system." />}
          </div>
        </div>
        {(isMobile || isTablet) && sidebar}
      </div>

      {!(isMobile || isTablet) && sidebar}
    </div>
  );
}

function UrgentCard({ task, onFocus, onRescue, onComplete, isMobile }: any) {
  const overdue = hoursTo(task.due || 0) <= 0;
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", borderColor: overdue ? "var(--bad)" : "var(--ember)" }}>
      <div style={{ padding: isMobile ? "14px 16px" : "18px 20px", background: overdue ? "linear-gradient(180deg,color-mix(in srgb, var(--bad) 14%, transparent),transparent)" : "linear-gradient(180deg,color-mix(in srgb, var(--ember) 14%, transparent),transparent)" }}>
        <div style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span className="eyebrow" style={{ color: overdue ? "var(--bad)" : "var(--ember)" }}>▲ Do this next</span>
          <span className="mono pill" style={{ background: "rgba(0,0,0,.25)", color: overdue ? "var(--bad)" : "var(--gold)", fontSize: 11 }}>{fmtDue(task.due)}</span>
        </div>
        <h2 className="display" style={{ margin: "0 0 6px", fontSize: isMobile ? 20 : 24, fontWeight: 700, letterSpacing: "-.01em" }}>{task.title}</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{reason(task)}</p>
        {task.why && (
          <div style={{ marginTop: 12, padding: "10px 13px", borderRadius: 11, background: "color-mix(in srgb, var(--gold) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--gold) 22%, transparent)" }}>
            <span className="eyebrow" style={{ color: "var(--gold)" }}>Your why</span>
            <p style={{ margin: "4px 0 0", fontSize: 13.5, fontStyle: "italic", color: "var(--text)" }}>“{task.why}”</p>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, padding: isMobile ? "0 16px 14px" : "0 20px 18px", flexDirection: isMobile ? "column" : "row" }}>
        <button onClick={() => onFocus(task)} className="tap focusable" style={btnPrimary}><MIcon name="play_arrow" s={15} weight={500} /> Start now</button>
        <div style={{ display: "flex", gap: 10, flex: isMobile ? "none" : 1 }}>
          <button onClick={() => onComplete(task)} className="tap focusable" style={{ ...btnGhost, flex: 1 }}>✓ Done</button>
          {hoursTo(task.due || 0) < 12 && <button onClick={() => onRescue(task)} className="tap focusable" style={{ ...btnGhost, flex: 1, borderColor: "var(--bad)", color: "var(--bad)" }}>Rescue</button>}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ t, onFocus, onRescue, onComplete, onMiss, onDelete, isMobile }: any) {
  const sc = score(t); const col = sc >= 70 ? "var(--ember)" : sc >= 45 ? "var(--gold)" : "var(--flow)";
  return (
    <div style={{ 
      display: "flex", 
      alignItems: isMobile ? "flex-start" : "center", 
      gap: isMobile ? 8 : 12, 
      padding: isMobile ? "12px 10px" : "12px 16px", 
      borderTop: "1px solid var(--line-soft)",
      flexDirection: "row"
    }}>
      <div style={{ width: isMobile ? 32 : 40, textAlign: "center", flexShrink: 0, marginTop: isMobile ? 2 : 0 }}>
        <div className="mono" style={{ fontSize: isMobile ? 14 : 17, fontWeight: 700, color: col, lineHeight: 1 }}>{sc}</div>
        <div className="eyebrow" style={{ fontSize: 7.5 }}>score</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 2 : 8 }}>
          <span style={{ fontWeight: 600, fontSize: isMobile ? 13.5 : 14.5, overflow: "hidden", textOverflow: "ellipsis", display: "block", width: "100%" }}>{t.title}</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {t.type === "habit" && <span className="pill" style={{ background: "color-mix(in srgb, var(--violet) 14%, transparent)", color: "var(--violet)", fontSize: 9, padding: "1px 5px" }}>habit</span>}
            {isMobile && <span className="mono" style={{ fontSize: 10, color: hoursTo(t.due || 0) <= 0 ? "var(--bad)" : "var(--muted)" }}>{fmtDue(t.due)}</span>}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 2 }}>{reason(t)}</div>
      </div>
      {!isMobile && <span className="mono" style={{ fontSize: 11.5, color: hoursTo(t.due || 0) <= 0 ? "var(--bad)" : "var(--muted)", whiteSpace: "nowrap" }}>{fmtDue(t.due)}</span>}
      <div style={{ display: "flex", gap: 4, flexShrink: 0, alignSelf: isMobile ? "flex-start" : "center" }}>
        <button onClick={() => onFocus(t)} className="tap focusable" style={isMobile ? { ...miniBtn, width: 28, height: 26 } : miniBtn} title="Start"><MIcon name="play_arrow" s={14} weight={500} /></button>
        <button onClick={() => onComplete(t)} className="tap focusable" style={isMobile ? { ...miniBtn, width: 28, height: 26 } : miniBtn} title="Done">✓</button>
        {hoursTo(t.due || 0) < 12 && <button onClick={() => onRescue(t)} className="tap focusable" style={isMobile ? { ...miniBtn, width: 28, height: 26, color: "var(--bad)", fontSize: 11 } : { ...miniBtn, color: "var(--bad)" }} title="Rescue">SOS</button>}
        {onDelete && <button onClick={() => onDelete(t)} className="tap focusable" style={isMobile ? { ...miniBtn, width: 28, height: 26, color: "var(--bad)" } : { ...miniBtn, color: "var(--bad)" }} title="Delete"><MIcon name="delete" s={14} /></button>}
      </div>
    </div>
  );
}

function VoiceCard({ tasks }: any) {
  const [listening, setListening] = useState(false);
  const [said, setSaid] = useState("");
  const briefing = () => {
    const top = tasks.slice(0, 3);
    if (!top.length) return "Your radar is clear. Nice work.";
    let s = `You have ${tasks.length} open task(s). Top priority: ${top[0].title}, ${fmtDue(top[0].due)}. ${reason(top[0])}`;
    if (top[1]) s += ` Then ${top[1].title}.`;
    return s;
  };
  const speak = (text: string) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.03;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) {}
  };
  const ask = async () => {
    setListening(true);
    let text = briefing();
    try {
      const res = await fetch("/api/gemini/voice-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks })
      });
      if (res.ok) {
        const d = await res.json();
        if (d.text) text = d.text;
      }
    } catch (e) {}
    setSaid(text);
    speak(text);
    setListening(false);
  };
  return (
    <div className="card" style={{ padding: 16, borderColor: "color-mix(in srgb, var(--flow) 25%, transparent)" }}>
      <div style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between", alignItems: "center" }}>
        <div className="eyebrow" style={{ color: "var(--flow)" }}>Voice check-in</div>
        <span style={{ display: "inline-flex", opacity: listening ? 1 : .55, animation: listening ? "flamePulse 1s infinite" : "none" }}><IcoMic s={16} /></span>
      </div>
      <p style={{ margin: "8px 0 12px", fontSize: 13, color: "var(--muted)" }}>{said || "“What’s urgent today?” — get a spoken, prioritized briefing."}</p>
      <button onClick={ask} className="tap focusable" style={{ ...btnGhost, width: "100%", borderColor: "var(--flow)", color: "var(--flow)" }}>
        {listening ? "Listening…" : <><MIcon name="play_arrow" s={13} weight={500} /> Brief me</>}
      </button>
    </div>
  );
}

function WeeklyReflection({ db }: any) {
  const wins = db.wins.filter((w: any) => w.at > db.settings.weekStart);
  const early = wins.filter((w: any) => w.badge === "early").length;
  const habit = wins.filter((w: any) => w.badge === "habit").length;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>This week, in review</div>
      <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>
        {wins.length ? <>You closed <b>{wins.length}</b> task(s){early ? <>, <b>{early}</b> early</> : ""}{habit ? <>, and kept <b>{habit}</b> habit session(s) alive</> : ""}.</> : "A fresh week."}
      </p>
      {db.streak.count > 0 && <span className="pill" style={{ background: "color-mix(in srgb, var(--ember) 12%, transparent)", color: "var(--ember)", display: "inline-flex", alignItems: "center", gap: 6 }}><IcoFlame s={11} /> {db.streak.count}-day streak protected</span>}
    </div>
  );
}

function TasksView({ tasks, onFocus, onRescue, onComplete, onMiss, onDelete, onLogEnergy, isMobile, gtasks, onSyncTasks, onImportTask }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }} className="rise">
      <div className="card" style={{ padding: isMobile ? "4px 0px 8px" : "4px 4px 8px" }}>
        <div style={{ padding: "16px 18px 8px" }} className="eyebrow">All open tasks · sorted by priority</div>
        {tasks.map((t: any) => <TaskRow key={t.id} t={t} onFocus={onFocus} onRescue={onRescue} onComplete={onComplete} onMiss={onMiss} onDelete={onDelete} isMobile={isMobile} />)}
        {!tasks.length && <Empty msg="No open tasks." />}
      </div>

      {gtasks && gtasks.connected && (
        <div className="card" style={{ padding: isMobile ? "14px 16px" : "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--violet)", display: "flex", alignItems: "center" }}><MIcon name="check_circle" s={18} /></span>
              <h3 className="display" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Google Tasks Inbox</h3>
            </div>
            <button 
              onClick={onSyncTasks} 
              disabled={gtasks.loading}
              className="tap focusable"
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-sm)",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                border: "1px solid var(--line)",
                background: "transparent",
                color: "var(--text)",
                display: "flex",
                alignItems: "center",
                gap: 4
              }}
            >
              <MIcon name="sync" s={12} className={gtasks.loading ? "animate-spin" : ""} />
              {gtasks.loading ? "Syncing..." : "Sync"}
            </button>
          </div>

          <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--muted)" }}>
            These are open tasks pulled from your Google Tasks. Import them into Initio to apply gamification, urgency scheduling, and high-stakes progress tracking.
          </p>

          {gtasks.loading && (
            <div style={{ padding: "20px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              Loading tasks from Google Workspace...
            </div>
          )}

          {!gtasks.loading && !gtasks.list.length && (
            <div style={{ padding: "16px 0", textAlign: "center", color: "var(--muted-2)", fontSize: 12, border: "1px dashed var(--line)", borderRadius: "var(--radius-sm)" }}>
              No tasks found in your Google Tasks account.
            </div>
          )}

          {!gtasks.loading && gtasks.list.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {gtasks.list.map((gt: any) => (
                <div 
                  key={gt.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid var(--line)"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{gt.title}</span>
                    {gt.notes && (
                      <span style={{ fontSize: 11, color: "var(--muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "250px" }}>
                        {gt.notes}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onImportTask(gt)}
                    className="tap focusable"
                    style={{
                      padding: "4px 8px",
                      borderRadius: "var(--radius-sm)",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      background: "var(--violet)",
                      color: "var(--on-accent)",
                      border: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    <MIcon name="download" s={12} />
                    Import
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function calculateStreak(history: Array<{ date: string }>) {
  if (!history || !history.length) return 0;
  const uniqueDates = Array.from(new Set(history.map(h => h.date))).sort().reverse();
  let streak = 0;
  let expected = new Date();
  
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const r = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${r}`;
  };
  
  let currentStr = fmt(expected);
  if (!uniqueDates.includes(currentStr)) {
    expected.setDate(expected.getDate() - 1);
    currentStr = fmt(expected);
    if (!uniqueDates.includes(currentStr)) {
      return 0;
    }
  }
  
  for (let i = 0; i < 365; i++) {
    if (uniqueDates.includes(currentStr)) {
      streak++;
      expected.setDate(expected.getDate() - 1);
      currentStr = fmt(expected);
    } else {
      break;
    }
  }
  return streak;
}

function HabitsView({ db, patch, flash }: any) {
  const goals = Object.entries(db.goals);
  const habits = db.habits || [];

  const handleToggleHabitDay = (habitId: string, dateStr: string) => {
    patch((d: any) => {
      if (!d.habits) d.habits = [];
      const h = d.habits.find((x: any) => x.id === habitId);
      if (h) {
        if (!h.history) h.history = [];
        const exists = h.history.some((x: any) => x.date === dateStr);
        if (exists) {
          h.history = h.history.filter((x: any) => x.date !== dateStr);
          h.totalSessions = Math.max(0, h.totalSessions - 1);
          d.xpGlobal = Math.max(0, d.xpGlobal - 25);
          h.streak = calculateStreak(h.history);
        } else {
          h.history.push({
            date: dateStr,
            energyLevel: "okay"
          });
          h.totalSessions += 1;
          h.lastCompleted = dateStr;
          d.xpGlobal += 25;
          h.streak = calculateStreak(h.history);

          if (!d.energy) d.energy = [];
          d.energy.push({
            at: Date.now(),
            effort: 2,
            task: h.title
          });

          if (h.stackAfter) {
            const matchGoal = Object.keys(d.goals).find(g => 
              g.toLowerCase().includes(h.stackAfter.toLowerCase()) || 
              h.stackAfter.toLowerCase().includes(g.toLowerCase())
            );
            const goalName = matchGoal || h.stackAfter;
            if (!d.goals[goalName]) {
              d.goals[goalName] = { xp: 0, level: 1, sessions: 0 };
            }
            const g = d.goals[goalName];
            g.sessions += 1;
            g.xp += 25;
            if (g.xp >= LEVEL_STEP) {
              g.xp = g.xp % LEVEL_STEP;
              g.level += 1;
            }
          }
        }
      }
    });
    flash("Habit calendar updated!", "good");
  };

  const handleAddHabit = (title: string, frequency: "daily" | "weekly", stackAfter: string) => {
    patch((d: any) => {
      if (!d.habits) d.habits = [];
      d.habits.push({
        id: "h_" + Date.now(),
        title,
        frequency,
        streak: 0,
        totalSessions: 0,
        stackAfter,
        history: []
      });
    });
    flash(`Habit "${title}" created!`, "good");
  };

  const handleLogHabitSession = (habitId: string, energy: "easy" | "okay" | "hard") => {
    patch((d: any) => {
      if (!d.habits) d.habits = [];
      const h = d.habits.find((x: any) => x.id === habitId);
      if (h) {
        h.totalSessions += 1;
        h.streak += 1;
        h.lastCompleted = new Date().toISOString().split("T")[0];
        h.history.push({
          date: new Date().toISOString().split("T")[0],
          energyLevel: energy
        });
        
        // Award XP globally
        const xpReward = energy === "easy" ? 15 : energy === "okay" ? 25 : 40;
        d.xpGlobal += xpReward;

        // Add energy log so the overall biological energy heatmap is dynamic!
        if (!d.energy) d.energy = [];
        d.energy.push({
          at: Date.now(),
          effort: energy === "easy" ? 1 : energy === "okay" ? 2 : 3,
          task: h.title
        });

        // Award XP to corresponding goal
        if (h.stackAfter) {
          const matchGoal = Object.keys(d.goals).find(g => 
            g.toLowerCase().includes(h.stackAfter.toLowerCase()) || 
            h.stackAfter.toLowerCase().includes(g.toLowerCase())
          );
          const goalName = matchGoal || h.stackAfter;
          if (!d.goals[goalName]) {
            d.goals[goalName] = { xp: 0, level: 1, sessions: 0 };
          }
          const g = d.goals[goalName];
          g.sessions += 1;
          g.xp += xpReward;
          if (g.xp >= LEVEL_STEP) {
            g.xp = g.xp % LEVEL_STEP;
            g.level += 1;
          }
        }
      }
    });
    flash(`Habit session logged! +XP awarded.`, "good");
  };

  const completedCount = habits.reduce((acc: number, cur: any) => acc + cur.totalSessions, 0);

  return (
    <div className="rise">
      <div style={{ marginBottom: 24 }}>
        <HabitsHeatmap 
          habits={habits}
          onAddHabit={handleAddHabit}
          onLogHabitSession={handleLogHabitSession}
          onToggleHabitDay={handleToggleHabitDay}
          completedCount={completedCount}
          streak={db.streak.count}
          isDebtMode={db.streak.debt > 0}
        />
      </div>

      <div className="card" style={{ padding: "18px 20px", marginBottom: 18, display: "flex", justifyValue: "space-between", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div className="eyebrow">Player level</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
            <span className="display" style={{ fontSize: 42, fontWeight: 700, color: "var(--violet)", lineHeight: 1 }}>{levelFromXp(db.xpGlobal)}</span>
            <span className="mono" style={{ color: "var(--muted)" }}>{db.xpGlobal} total xp</span>
          </div>
        </div>
        <p style={{ margin: 0, maxWidth: 380, fontSize: 13.5, color: "var(--muted)" }}>
          Chronic tasks earn XP and level up per goal.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
        {goals.map(([name, g]: any) => (
          <div key={name} className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="display" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{name}</h3>
              <span className="pill" style={{ background: "color-mix(in srgb, var(--violet) 14%, transparent)", color: "var(--violet)" }}>Lv. {g.level}</span>
            </div>
            <div style={{ margin: "14px 0 8px", height: 10, borderRadius: 99, background: "var(--line)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: (xpInLevel(g.xp)) + "%", background: "linear-gradient(90deg,var(--violet),var(--flow))", borderRadius: 99, transition: "width 1s cubic-bezier(.2,.8,.2,1)" }} />
            </div>
            <div style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between" }}>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{xpInLevel(g.xp)}/{LEVEL_STEP} to Lv.{g.level + 1}</span>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{g.sessions} sessions</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EnergyView({ db }: any) {
  const insight = energyInsight(db.energy);
  const parts = ["morning", "afternoon", "evening"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cell: Record<string, number[]> = {};
  db.energy.forEach((l: any) => {
    const dt = new Date(l.at);
    const d = dt.getDay();
    const h = dt.getHours();
    const p = h < 12 ? 0 : h < 18 ? 1 : 2;
    const k = d + "-" + p;
    (cell[k] = cell[k] || []).push(l.effort);
  });
  const colFor = (arr: number[]) => {
    if (!arr || !arr.length) return "var(--line-soft)";
    const a = arr.reduce((x, y) => x + y, 0) / arr.length;
    if (a < 1.7) return "color-mix(in srgb, var(--flow) 70%, transparent)";
    if (a < 2.4) return "color-mix(in srgb, var(--gold) 70%, transparent)";
    return "color-mix(in srgb, var(--bad) 75%, transparent)";
  };
  return (
    <div className="rise">
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Energy map</div>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--muted)", maxWidth: 620 }}>
          Every finish logs energy to turn into a picture of when you have energy.
        </p>
        <div style={{ overflowX: "auto" }} className="scrollbar">
          <div style={{ display: "grid", gridTemplateColumns: "70px repeat(7,1fr)", gap: 6, minWidth: 520 }}>
            <div />
            {days.map(d => <div key={d} className="mono" style={{ textAlign: "center", fontSize: 11, color: "var(--muted-2)" }}>{d}</div>)}
            {parts.map((p, pi) => (
              <React.Fragment key={p}>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted-2)", display: "flex", alignItems: "center" }}>{p}</div>
                {days.map((d, di) => {
                  const arr = cell[di + "-" + pi];
                  return (
                    <div key={d + pi} title={arr ? `${arr.length} log(s)` : "no data"}
                      style={{ height: 34, borderRadius: 8, background: colFor(arr), border: "1px solid var(--line-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {arr && <span className="mono" style={{ fontSize: 10, color: "#0c0c12", fontWeight: 700 }}>{arr.length}</span>}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
      {insight && (
        <div className="card" style={{ padding: 18, borderColor: "color-mix(in srgb, var(--flow) 30%, transparent)" }}>
          <div className="eyebrow" style={{ color: "var(--flow)", marginBottom: 8 }}>What the pattern says</div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>{insight}</p>
        </div>
      )}
    </div>
  );
}

function WinsView({ db }: any) {
  const badge = { early: ["◀ early", "var(--flow)"], ontime: ["● on time", "var(--gold)"], habit: ["◆ habit", "var(--violet)"], missed: ["—", "var(--muted-2)"] };
  return (
    <div className="rise">
      <div className="card" style={{ padding: "18px 20px", marginBottom: 16 }}>
        <div className="eyebrow">Wins feed</div>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--muted)", maxWidth: 580 }}>
          Every finish, framed by what it got you.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {db.wins.map((w: any) => {
          const [bl, bc] = (badge as any)[w.badge] || badge.ontime;
          return (
            <div key={w.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 className="display" style={{ margin: 0, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><IcoCheck s={15} /> {w.title}</h3>
                <span className="pill" style={{ color: bc, background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}>{bl}</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>{w.text}</p>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 8 }}>{clockLabel(w.at)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddView({ onAdd, goals }: any) {
  const [mode, setMode] = useState("manual");
  return (
    <div className="rise" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, maxWidth: 720 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[["manual", "Add a task"], ["extract", "Paste text → extract"]].map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} className="tap focusable"
            style={{ padding: "8px 14px", borderRadius: 10, fontWeight: 600, fontSize: 13, border: "1px solid " + (mode === k ? "var(--ember)" : "var(--line)"), background: mode === k ? "color-mix(in srgb, var(--ember) 12%, transparent)" : "transparent", color: mode === k ? "#fff" : "var(--muted)" }}>{l}</button>
        ))}
      </div>
      {mode === "manual" ? <ManualForm onAdd={onAdd} goals={goals} /> : <ExtractForm onAdd={onAdd} />}
    </div>
  );
}

function ManualForm({ onAdd, goals }: any) {
  const getDefaultDateTime = () => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    d.setMinutes(0);
    d.setSeconds(0);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  };

  const [f, setF] = useState({
    title: "",
    type: "one-off" as const,
    dueH: 24,
    dueType: "absolute",
    dueDateTime: getDefaultDateTime(),
    effortMin: 30,
    stakes: 2,
    why: "",
    when: "",
    goal: goals[0] || ""
  });

  const set = (k: string, v: any) => setF(s => ({ ...s, [k]: v }));
  
  const submit = () => {
    if (!f.title.trim()) return;
    const dueTime = f.dueType === "absolute" && f.dueDateTime
      ? new Date(f.dueDateTime).getTime()
      : now() + f.dueH * HOUR;

    onAdd({
      title: f.title.trim(),
      type: f.type,
      due: dueTime,
      effortMin: +f.effortMin,
      stakes: +f.stakes,
      why: f.why.trim(),
      when: f.when.trim(),
      goal: f.type === "habit" ? f.goal : undefined
    });

    setF({
      title: "",
      type: "one-off",
      dueH: 24,
      dueType: "absolute",
      dueDateTime: getDefaultDateTime(),
      effortMin: 30,
      stakes: 2,
      why: "",
      when: "",
      goal: goals[0] || ""
    });
  };

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="What needs doing?">
        <input value={f.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Submit the grant application" style={inp} className="focusable" />
      </Field>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Type">
          <select value={f.type} onChange={e => set("type", e.target.value)} style={inp} className="focusable">
            <option value="one-off">One-off task</option>
            <option value="habit">Habit</option>
          </select>
        </Field>
        <Field label="Stakes (consequence)">
          <select value={f.stakes} onChange={e => set("stakes", e.target.value)} style={inp} className="focusable">
            <option value="1">Low</option>
            <option value="2">Medium</option>
            <option value="3">High</option>
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Deadline Timing">
          <select value={f.dueType} onChange={e => set("dueType", e.target.value)} style={inp} className="focusable">
            <option value="relative">Relative Slider</option>
            <option value="absolute">Date & Time</option>
          </select>
        </Field>
        {f.dueType === "absolute" ? (
          <Field label="Select Date & Time">
            <input 
              type="datetime-local" 
              value={f.dueDateTime} 
              onChange={e => set("dueDateTime", e.target.value)} 
              style={inp} 
              className="focusable" 
            />
          </Field>
        ) : (
          <Field label={`Due in ~${f.dueH}h (${Math.round(f.dueH / 24 * 10) / 10} days)`}>
            <input type="range" min="1" max="168" value={f.dueH} onChange={e => set("dueH", e.target.value)} style={{ width: "100%", marginTop: 10 }} />
          </Field>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
        <Field label={`Effort ~${f.effortMin} min`}>
          <input type="range" min="5" max="240" step="5" value={f.effortMin} onChange={e => set("effortMin", e.target.value)} style={{ width: "100%", marginTop: 10 }} />
        </Field>
      </div>

      {f.type === "habit" && (
        <Field label="Goal it feeds">
          <input value={f.goal} onChange={e => set("goal", e.target.value)} list="goals" placeholder="e.g. Stronger by summer" style={inp} className="focusable" />
          <datalist id="goals">{goals.map((g: string) => <option key={g} value={g} />)}</datalist>
        </Field>
      )}
      <Field label="Why does this matter?">
        <input value={f.why} onChange={e => set("why", e.target.value)} placeholder="e.g. This keeps my scholarship" style={inp} className="focusable" />
      </Field>
      <Field label="When & where will you do it?">
        <input value={f.when} onChange={e => set("when", e.target.value)} placeholder="e.g. Tonight 7pm at desk" style={inp} className="focusable" />
      </Field>
      <button onClick={submit} className="tap focusable" style={{ ...btnPrimary, marginTop: 4 }}>Add to radar</button>
    </div>
  );
}

function ExtractForm({ onAdd }: any) {
  const [text, setText] = useState("Submit report by Friday 5pm.\nMidterm due tomorrow.");
  const [found, setFound] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const extract = async () => {
    setBusy(true);
    let result = await AI.call("extract", { text });
    if (!result) result = heurExtract(text);
    setFound(result || []);
    setBusy(false);
  };
  return (
    <div className="card" style={{ padding: 20 }}>
      <Field label="Paste syllabus, email, or brief">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={6} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} className="focusable scrollbar" />
      </Field>
      <button onClick={extract} disabled={busy} className="tap focusable" style={{ ...btnPrimary, marginTop: 12 }}>
        {busy ? "Reading…" : "Extract deadlines"}
      </button>
      {found.length > 0 && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="eyebrow">Found {found.length}</div>
          {found.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 11, background: "var(--surface-2)", border: "1px solid var(--line)" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 2 }}>{clockLabel(t.due)} · {fmtDue(t.due)}</div>
              </div>
              <button onClick={() => { onAdd(t); setFound(f => f.filter((_, j) => j !== i)); }} className="tap focusable" style={miniBtn}>add ✓</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ children, onClose, accent = "var(--ember)" }: any) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,8,14,.72)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyValue: "center", justifyContent: "center", padding: 18, zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()} className="card scrollbar modal-card" style={{ maxWidth: 460, width: "100%", maxHeight: "88vh", overflowY: "auto", borderColor: accent, animation: "pop .28s cubic-bezier(.2,.9,.3,1.2) both" }}>
        {children}
      </div>
    </div>
  );
}

function FocusModal({ task, onClose, onComplete, onRescue }: any) {
  const fs = task.firstStep;
  const [timeLeft, setTimeLeft] = useState(1500); // 25m
  const [isRunning, setIsRunning] = useState(false);
  const [duration, setDuration] = useState(1500);

  useEffect(() => {
    let timer: any;
    if (isRunning && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(t => t - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      setIsRunning(false);
    }
    return () => clearInterval(timer);
  }, [isRunning, timeLeft]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const pct = duration > 0 ? (timeLeft / duration) : 0;

  return (
    <Shell onClose={onClose} accent="var(--ember)">
      <div style={{ padding: "22px 22px 8px" }}>
        <div style={{ display: "flex", justifyValue: "space-between", justifyContent: "space-between", alignItems: "center" }}>
          <span className="eyebrow" style={{ color: "var(--ember)" }}>● Focus session</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--gold)" }}>{fmtDue(task.due)}</span>
        </div>
        <h2 className="display" style={{ margin: "8px 0 4px", fontSize: 22, fontWeight: 700 }}>{task.title}</h2>
        {task.why && <p style={{ margin: "2px 0 0", fontSize: 14, fontStyle: "italic", color: "var(--gold)" }}>“{task.why}”</p>}
      </div>

      {/* Focus Countdown Timer */}
      <div style={{ padding: "0 22px" }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12 }}>
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
              }}
              className="tap focusable"
              style={{
                padding: "3px 9px",
                borderRadius: "var(--radius-sm)",
                fontSize: 11,
                fontWeight: 600,
                border: "1px solid " + (duration === p.sec ? "var(--ember)" : "var(--line)"),
                background: duration === p.sec ? "color-mix(in srgb, var(--ember) 12%, transparent)" : "transparent",
                color: duration === p.sec ? "var(--ember)" : "var(--muted-2)",
                cursor: "pointer"
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 14px", background: "var(--surface-2)", borderRadius: 14, border: "1px solid var(--line)" }}>
          <div style={{ fontSize: 38, fontWeight: 700, fontFamily: "var(--font-mono)", color: timeLeft === 0 ? "var(--good)" : "var(--text)", letterSpacing: -1, marginBottom: 6 }}>
            {formatTime(timeLeft)}
          </div>
          
          <div style={{ width: "100%", maxWidth: 180, height: 5, background: "var(--line)", borderRadius: 99, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ height: "100%", width: `${pct * 100}%`, background: timeLeft === 0 ? "var(--good)" : "var(--ember)", borderRadius: 99, transition: "width 0.3s linear" }} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setIsRunning(!isRunning)}
              className="tap focusable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 12px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                background: isRunning ? "var(--surface-3)" : "var(--ember)",
                color: isRunning ? "var(--text)" : "#fff",
                border: isRunning ? "1px solid var(--line)" : "none",
                cursor: "pointer"
              }}
            >
              <MIcon name={isRunning ? "pause" : "play_arrow"} s={14} fill={isRunning ? 0 : 1} />
              {isRunning ? "Pause" : "Start"}
            </button>
            <button
              onClick={() => {
                setIsRunning(false);
                setTimeLeft(duration);
              }}
              className="tap focusable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 12px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                background: "transparent",
                color: "var(--muted)",
                border: "1px solid var(--line)",
                cursor: "pointer"
              }}
            >
              <MIcon name="replay" s={14} />
              Reset
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 22px" }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{fs ? fs.kind + " — already started" : "Drafting start…"}</div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "Inter,sans-serif", fontSize: 14, lineHeight: 1.6, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, color: "var(--text)" }}>
          {fs ? fs.body : "…"}
        </pre>
      </div>
      <div style={{ display: "flex", gap: 10, padding: "8px 22px 22px" }}>
        <button onClick={onComplete} className="tap focusable" style={btnPrimary}>✓ Mark done</button>
        {hoursTo(task.due || 0) < 12 && <button onClick={onRescue} className="tap focusable" style={{ ...btnGhost, borderColor: "var(--bad)", color: "var(--bad)" }}>Rescue</button>}
        <button onClick={onClose} className="tap focusable" style={btnGhost}>Later</button>
      </div>
    </Shell>
  );
}

function RescueModal({ task, onClose, onComplete }: any) {
  const [plan, setPlan] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPlan(rescuePlan(task));
    AI.call("rescue", { title: task.title }).then(r => { if (live && r && r.plan) setPlan(r.plan); });
    return () => { live = false; };
  }, [task.id]);
  return (
    <Shell onClose={onClose} accent="var(--bad)">
      <div style={{ padding: "22px" }}>
        <span className="eyebrow" style={{ color: "var(--bad)" }}>Rescue mode</span>
        <h2 className="display" style={{ margin: "8px 0 4px", fontSize: 21, fontWeight: 700 }}>{task.title}</h2>
        <p style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--muted)" }}>Can't finish? Bare minimum count:</p>
        <div style={{ padding: 15, borderRadius: 12, background: "color-mix(in srgb, var(--bad) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--bad) 25%, transparent)", fontSize: 14.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{plan || "Building plan…"}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onComplete} className="tap focusable" aria-label="Mark task as completed using the minimum viable plan" style={{ ...btnPrimary, background: "var(--bad)" }}>✓ Did the minimum</button>
          <button onClick={onClose} className="tap focusable" aria-label="Close rescue plan modal" style={btnGhost}>Close</button>
        </div>
      </div>
    </Shell>
  );
}

function PayoffModal({ data, isHabit, onClose }: any) {
  const { payoff, streakNote, surprise, xpGain } = data;
  return (
    <Shell onClose={onClose} accent="var(--flow)">
      <div style={{ padding: "26px 24px", textAlign: "center" }}>
        <div style={{ animation: "pop .4s both", color: "var(--flow)" }}><IcoCheck s={46} /></div>
        <div className="eyebrow" style={{ color: "var(--flow)", marginTop: 6 }}>What this got you</div>
        <p style={{ margin: "12px 0 0", fontSize: 16, lineHeight: 1.6 }}>{payoff}</p>
        {streakNote && <div className="pill" style={{ marginTop: 16, background: "color-mix(in srgb, var(--ember) 12%, transparent)", color: "var(--ember)", fontSize: 13, padding: "7px 14px" }}><IcoFlame s={12} /> {streakNote}</div>}
        {isHabit && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, justifyValue: "center", justifyContent: "center", flexWrap: "wrap" }}>
            <span className="pill" style={{ background: "color-mix(in srgb, var(--violet) 14%, transparent)", color: "var(--violet)" }}>◆ +{xpGain} XP</span>
            {surprise && <span className="pill" style={{ background: "color-mix(in srgb, var(--gold) 16%, transparent)", color: "var(--gold)" }}>+ Surprise bonus</span>}
          </div>
        )}
        <button onClick={onClose} className="tap focusable" style={{ ...btnPrimary, marginTop: 22, width: "100%", background: "var(--flow)", color: "var(--on-accent)" }}>
          {isHabit ? "Log how it felt →" : "Keep the momentum"}
        </button>
      </div>
    </Shell>
  );
}

function EnergyModal({ task, onClose, onLog }: any) {
  return (
    <Shell onClose={onClose} accent="var(--violet)">
      <div style={{ padding: "24px", textAlign: "center" }}>
        <div className="eyebrow" style={{ color: "var(--violet)" }}>How did that feel?</div>
        <h2 className="display" style={{ margin: "8px 0 4px", fontSize: 19, fontWeight: 600 }}>{task.title}</h2>
        <div style={{ display: "flex", gap: 12, justifyValue: "center", justifyContent: "center", marginTop: 20 }}>
          {[[1, "Easy"], [2, "Okay"], [3, "Hard"]].map(([v, l]: any) => (
            <button key={v} onClick={() => onLog(task, v)} className="tap focusable" style={{ flex: 1, padding: "22px 8px", borderRadius: "var(--radius-field)", border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--text)" }}>
              <div className="display" style={{ fontSize: 22, fontWeight: 600 }}>{l}</div>
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function RitualBurst() {
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyValue: "center", justifyContent: "center", pointerEvents: "none", zIndex: 60 }}>
      <div style={{ width: 120, height: 120, borderRadius: "50%", border: "3px solid var(--ember)", animation: "ritual .85s ease-out both" }} />
    </div>
  );
}

const TOOL_META: Record<string, { label: string; icon: string; col: string; bg: string }> = {
  check_calendar: {
    label: "Checked calendar availability",
    icon: "calendar_month",
    col: "var(--violet)",
    bg: "color-mix(in srgb, var(--violet) 12%, transparent)"
  },
  create_task: {
    label: "Created new task",
    icon: "add_task",
    col: "var(--flow)",
    bg: "color-mix(in srgb, var(--flow) 12%, transparent)"
  },
  prioritize: {
    label: "Prioritized tasks by urgency",
    icon: "low_priority",
    col: "var(--gold)",
    bg: "color-mix(in srgb, var(--gold) 12%, transparent)"
  },
  schedule_block: {
    label: "Scheduled focus block on calendar",
    icon: "alarm",
    col: "var(--flow)",
    bg: "color-mix(in srgb, var(--flow) 12%, transparent)"
  },
  draft_first_step: {
    label: "Drafted micro-step checklist",
    icon: "edit_note",
    col: "var(--ember)",
    bg: "color-mix(in srgb, var(--ember) 12%, transparent)"
  },
  set_reminder: {
    label: "Set smart reminder",
    icon: "notifications_active",
    col: "var(--ember)",
    bg: "color-mix(in srgb, var(--ember) 12%, transparent)"
  },
  ask_clarification: {
    label: "Requested clarification",
    icon: "help_outline",
    col: "var(--violet)",
    bg: "color-mix(in srgb, var(--violet) 12%, transparent)"
  },
  research_fact: {
    label: "Researched necessary facts",
    icon: "find_in_page",
    col: "var(--gold)",
    bg: "color-mix(in srgb, var(--gold) 12%, transparent)"
  }
};

const springTransition = { type: "spring", stiffness: 300, damping: 25 };

function TimelineNode({ tool, args, text, observe }: any) {
  const meta = TOOL_META[tool] || {
    label: `Executed tool: ${tool}`,
    icon: "build",
    col: "var(--muted)",
    bg: "var(--surface-2)"
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springTransition}
      style={{ position: "relative", paddingLeft: 36, paddingBottom: 24 }}
    >
      {/* Vertical Rail Segment */}
      <div 
        style={{ 
          position: "absolute", 
          left: 11, 
          top: 24, 
          bottom: 0, 
          width: 2, 
          background: "linear-gradient(180deg, var(--line) 0%, rgba(255,255,255,0.05) 100%)",
          zIndex: 0 
        }} 
      />

      {/* Node Bullet Icon */}
      <div 
        style={{ 
          position: "absolute", 
          left: 0, 
          top: 0, 
          width: 24, 
          height: 24, 
          borderRadius: "50%", 
          background: "var(--surface)", 
          border: `1.5px solid ${meta.col}`, 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center",
          zIndex: 1,
          boxShadow: `0 0 8px ${meta.col}44`
        }}
      >
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: meta.bg, opacity: 0.15 }} />
        <MIcon name={meta.icon} s={14} style={{ color: meta.col, zIndex: 1 }} />
      </div>

      {/* Node Content */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{meta.label}</span>
          {args && Object.keys(args).length > 0 && (
            <span className="mono" style={{ fontSize: 10, color: "var(--text-secondary)", background: "var(--surface-2)", padding: "2px 6px", borderRadius: 4 }}>
              {JSON.stringify(args).slice(0, 50)}{JSON.stringify(args).length > 50 ? "..." : ""}
            </span>
          )}
        </div>

        {/* Observed Result */}
        {observe && (
          <div 
            style={{ 
              padding: "10px 12px", 
              borderRadius: "var(--radius-sm)", 
              background: "var(--surface-2)", 
              border: "1px solid var(--line)", 
              fontSize: 12.5, 
              color: "var(--text)", 
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              marginTop: 4
            }}
          >
            <div className="eyebrow" style={{ fontSize: 9, marginBottom: 4, color: "var(--muted-2)", fontWeight: 700 }}>Observed result</div>
            {observe}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ThoughtNode({ text }: any) {
  const isCritic = text.toLowerCase().includes("critic flagged:");
  
  if (isCritic) {
    const issue = text.replace(/critic flagged:/i, "").trim();
    return (
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={springTransition}
        style={{ 
          position: "relative", 
          paddingLeft: 36, 
          paddingBottom: 20, 
        }}
      >
        <div 
          style={{ 
            position: "absolute", 
            left: 11, 
            top: 24, 
            bottom: 0, 
            width: 2, 
            borderLeft: "2px dashed var(--line)", 
            zIndex: 0 
          }} 
        />
        
        {/* Node Bullet Icon for Critic */}
        <div 
          style={{ 
            position: "absolute", 
            left: 0, 
            top: 0, 
            width: 24, 
            height: 24, 
            borderRadius: "50%", 
            background: "var(--surface)", 
            border: `1.5px solid var(--bad)`, 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            zIndex: 1,
            boxShadow: "0 0 8px rgba(239, 68, 68, 0.2)"
          }}
        >
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--bad)", opacity: 0.1 }} />
          <MIcon name="warning" s={14} style={{ color: "var(--bad)", zIndex: 1 }} />
        </div>

        <div 
          style={{ 
            padding: "10px 12px", 
            borderRadius: "var(--radius-sm)", 
            background: "color-mix(in srgb, var(--bad) 5%, var(--surface))", 
            border: "1px solid color-mix(in srgb, var(--bad) 30%, transparent)", 
            fontSize: 12.5, 
            color: "var(--text)", 
            lineHeight: 1.5,
          }}
        >
          <div className="eyebrow" style={{ color: "var(--bad)", fontSize: 9, fontWeight: 700, marginBottom: 2 }}>◆ Critic Violation Flagged</div>
          {issue}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.95 }}
      transition={{ duration: 0.3 }}
      style={{ 
        position: "relative", 
        paddingLeft: 36, 
        paddingBottom: 16, 
      }}
    >
      <div 
        style={{ 
          position: "absolute", 
          left: 11, 
          top: 0, 
          bottom: 0, 
          width: 2, 
          borderLeft: "2px dashed var(--line)", 
          zIndex: 0 
        }} 
      />
      
      <div 
        style={{ 
          fontSize: 12, 
          fontStyle: "italic", 
          color: "var(--muted-2)", 
          lineHeight: 1.5,
          padding: "2px 0"
        }}
      >
        ◆ {text}
      </div>
    </motion.div>
  );
}

function ClarifyNode({ question, options, onAnswer }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springTransition}
      style={{ 
        position: "relative", 
        paddingLeft: 36, 
        paddingBottom: 24, 
      }}
    >
      <div 
        style={{ 
          position: "absolute", 
          left: 11, 
          top: 24, 
          bottom: 0, 
          width: 2, 
          background: "var(--line)", 
          zIndex: 0 
        }} 
      />

      <div 
        style={{ 
          position: "absolute", 
          left: 0, 
          top: 0, 
          width: 24, 
          height: 24, 
          borderRadius: "50%", 
          background: "var(--surface)", 
          border: `1.5px solid var(--violet)`, 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--violet)", opacity: 0.1 }} />
        <MIcon name="help" s={14} style={{ color: "var(--violet)", zIndex: 1 }} />
      </div>

      <div 
        style={{ 
          display: "flex", 
          flexDirection: "column", 
          gap: 10,
          padding: "12px 14px",
          background: "color-mix(in srgb, var(--violet) 5%, var(--surface))",
          border: "1px solid color-mix(in srgb, var(--violet) 20%, transparent)",
          borderRadius: "var(--radius-sm)"
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)", fontWeight: 500 }}>{question}</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {options?.map((opt: string, i: number) => (
            <button 
              key={i} 
              onClick={() => onAnswer?.(opt)} 
              className="tap focusable animate-pulse" 
              aria-label={`Select clarification option: ${opt}`}
              style={{ 
                background: "var(--surface)", 
                border: "1px solid var(--line)", 
                borderRadius: 20, 
                fontSize: 12, 
                padding: "6px 14px",
                color: "var(--text)",
                cursor: "pointer",
                fontWeight: 600,
                boxShadow: "var(--shadow-sm)"
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function FallbackNode({ step }: any) {
  return (
    <div style={{ paddingLeft: 36, paddingBottom: 16, position: "relative" }}>
      <div style={{ position: "absolute", left: 11, top: 0, bottom: 0, width: 2, background: "var(--line)" }} />
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
        {step.text || JSON.stringify(step)}
      </div>
    </div>
  );
}

function FinalPlanNode({ result, onApply }: any) {
  if (!result) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={springTransition}
      style={{ 
        position: "relative", 
        paddingLeft: 36, 
        paddingBottom: 8,
      }}
    >
      {/* Target green node indicator */}
      <div 
        style={{ 
          position: "absolute", 
          left: 4, 
          top: 14, 
          width: 14, 
          height: 14, 
          borderRadius: "50%", 
          background: "var(--flow)", 
          border: "2.5px solid var(--surface)",
          zIndex: 1,
          boxShadow: "0 0 10px var(--flow)"
        }}
      />

      <div 
        className="card" 
        style={{ 
          padding: 20, 
          borderColor: "var(--flow)", 
          background: "var(--surface)",
          boxShadow: "0 12px 36px rgba(0, 0, 0, 0.4)",
          borderWidth: 1.5,
          borderRadius: 16
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "color-mix(in srgb, var(--flow) 15%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MIcon name="stars" s={18} style={{ color: "var(--flow)" }} />
          </div>
          <div>
            <div className="eyebrow" style={{ color: "var(--flow)", marginBottom: 0, fontWeight: 700 }}>Plan Ready</div>
            <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0, color: "var(--text)" }}>Autonomous Proposal</h3>
          </div>
        </div>

        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text)" }}>
          {result.summary}
        </p>

        {result.actions?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="eyebrow" style={{ fontSize: 9, marginBottom: 6, color: "var(--muted-2)", fontWeight: 700 }}>Proposed Operations</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {result.actions.map((act: any, idx: number) => {
                let icon = "bolt";
                let text = "";
                if (act.type === "task") {
                  icon = "add_task";
                  text = `Create task: "${act.title}"`;
                } else if (act.type === "schedule") {
                  icon = "calendar_today";
                  text = `Schedule focus block: "${act.title}"`;
                } else if (act.type === "reminder") {
                  icon = "notifications_active";
                  text = `Set reminder for "${act.title}"`;
                }
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text)", background: "var(--surface-2)", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
                    <MIcon name={icon} s={14} style={{ color: "var(--flow)" }} />
                    <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button 
          onClick={() => onApply(result.actions)} 
          className="tap focusable" 
          aria-label="Approve proposed actions and schedule them on calendar"
          style={{ 
            ...btnPrimary, 
            width: "100%", 
            background: "var(--flow)", 
            color: "var(--on-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            border: "none",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)"
          }}
        >
          <MIcon name="check" s={18} />
          Approve plan
        </button>
      </div>
    </motion.div>
  );
}

function AgentView({ db, onApply, isMobile, autoRunQuery, onClearAutoRun }: any) {
  const [goal, setGoal] = useState("Apply to midterm paper due Friday.");
  const [phase, setPhase] = useState("idle");
  const [steps, setSteps] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [src, setSrc] = useState("local");
  const timer = useRef<any>(null);
  const traceEndRef = useRef<HTMLDivElement>(null);

  const run = async (overrideGoal?: string) => {
    const currentGoal = overrideGoal || goal;
    if (!currentGoal.trim()) return;
    setPhase("running"); setSteps([]); setResult(null);
    const r = await runAgent(currentGoal.trim(), db);
    setSrc(r.source);
    let i = 0;
    timer.current = setInterval(() => {
      i++; setSteps(r.trace.slice(0, i));
      if (i >= r.trace.length) { clearInterval(timer.current); setResult(r); setPhase("done"); }
    }, 420);
  };
  
  useEffect(() => () => clearInterval(timer.current), []);

  useEffect(() => {
    if (autoRunQuery && autoRunQuery !== goal) {
      setGoal(autoRunQuery);
      run(autoRunQuery);
      if (onClearAutoRun) onClearAutoRun();
    }
  }, [autoRunQuery]);

  useEffect(() => {
    if (steps.length > 0) {
      traceEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [steps.length]);

  const handleClarification = (answer: string) => {
    const nextGoal = `${goal}\n\n[Clarification provided: ${answer}]`;
    setGoal(nextGoal);
    run(nextGoal);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let file: File | null = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1 || items[i].type === 'application/pdf') {
        file = items[i].getAsFile();
        break;
      }
    }
    if (!file) return;
    e.preventDefault();
    
    setPhase("running"); setSteps([{role: "thought", text: "Analyzing pasted document..."}]); setResult(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const base64 = (ev.target?.result as string).split(',')[1];
        const mimeType = file.type;
        const res = await fetch("/api/gemini/extract-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mimeType })
        });
        const data = await res.json();
        if (data.tasks && data.tasks.length > 0) {
          const tasksList = data.tasks.map((t: any) => `- ${t.title} (Effort: ${t.effortMin}m, Stakes: ${t.stakes}${t.dueISO ? ', Due: ' + t.dueISO : ''})`).join("\n");
          const newGoal = `I pasted a document. Please create and schedule these tasks:\n${tasksList}`;
          setGoal(newGoal);
          run(newGoal);
        } else {
          setPhase("idle"); setSteps([{role: "observe", text: "No tasks found in document."}]);
        }
      } catch (err) {
        setPhase("idle"); setSteps([{role: "observe", text: "Failed to extract tasks."}]);
      }
    };
    reader.readAsDataURL(file);
  };

  // Build the unified responsive timeline list
  const timelineNodes: React.ReactNode[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.role === "tool") {
      const next = steps[i + 1];
      const hasObserve = next && next.role === "observe" && next.tool === s.tool;
      const observeText = hasObserve ? next.text : null;
      timelineNodes.push(
        <TimelineNode 
          key={`tool-${i}`} 
          tool={s.tool} 
          args={s.args} 
          text={s.text}
          observe={observeText} 
        />
      );
      if (hasObserve) {
        i++; // skip next observe since it is paired inside tool node
      }
    } else if (s.role === "thought") {
      timelineNodes.push(<ThoughtNode key={`thought-${i}`} text={s.text} />);
    } else if (s.role === "clarify") {
      timelineNodes.push(<ClarifyNode key={`clarify-${i}`} question={s.question} options={s.options} onAnswer={handleClarification} />);
    } else if (s.role === "observe") {
      timelineNodes.push(<FallbackNode key={`observe-${i}`} step={s} />);
    } else {
      timelineNodes.push(<FallbackNode key={`other-${i}`} step={s} />);
    }
  }

  return (
    <div className="rise" style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="card" style={{ padding: 20, borderColor: "color-mix(in srgb, var(--violet) 30%, transparent)" }}>
          <div className="eyebrow" style={{ color: "var(--violet)" }}>◆ Autonomous co-pilot</div>
          <textarea 
            aria-label="Enter your goal or paste a syllabus document"
            value={goal} 
            onPaste={handlePaste} 
            onChange={e => setGoal(e.target.value)} 
            rows={4} 
            placeholder="What do you want to accomplish? Or paste an image/syllabus..." 
            className="focusable scrollbar" 
            style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} 
          />
          <button 
            onClick={() => run()} 
            disabled={phase === "running"} 
            className="tap focusable" 
            aria-label={phase === "running" ? "Co-pilot is running task planning" : "Run autonomous co-pilot task planning"}
            style={{ ...btnPrimary, marginTop: 12, background: phase === "running" ? "var(--surface-2)" : "linear-gradient(180deg,var(--violet),#8b6ff0)" }}
          >
            {phase === "running" ? "Working…" : "◆ Run co-pilot"}
          </button>
        </div>
      </div>
      
      <div className="card scrollbar" style={{ padding: 0, maxHeight: isMobile ? 360 : 580, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 18px 12px", position: "sticky", top: 0, background: "linear-gradient(180deg,var(--surface) 80%,transparent)", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 10 }}>
          <span className="eyebrow">Agent trace timeline</span>
          <span className="mono pill" style={{ fontSize: 10, background: src === "gemini" ? "color-mix(in srgb, var(--flow) 14%, transparent)" : "color-mix(in srgb, var(--violet) 14%, transparent)", color: src === "gemini" ? "var(--flow)" : "var(--violet)" }}>{src}</span>
        </div>

        <div 
          aria-live="polite" 
          aria-atomic="false" 
          style={{ padding: "4px 18px 18px", flex: 1 }}
        >
          {phase === "idle" && <Empty msg="Run co-pilot to watch planning timeline stream." />}
          
          <div style={{ display: "flex", flexDirection: "column" }}>
            {timelineNodes}
            {phase === "done" && result && (
              <FinalPlanNode result={result} onApply={onApply} />
            )}
          </div>
          <div ref={traceEndRef} />
        </div>
      </div>
    </div>
  );
}

function MIcon({ name, s = 16, fill = 0, weight = 300, style }: any) {
  return <span className="material-symbols-outlined" style={{ fontSize: s, verticalAlign: "-3px", fontVariationSettings: `'FILL' ${fill}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`, ...style }}>{name}</span>;
}
function IcoFlame({ s = 13 }) { return <MIcon name="local_fire_department" s={s} fill={1} weight={400} />; }
function IcoRecover({ s = 13 }) { return <MIcon name="restart_alt" s={s} weight={400} />; }
function IcoBell({ s = 12 }) { return <MIcon name="notifications" s={s} weight={400} />; }
function IcoMic({ s = 15 }) { return <MIcon name="mic" s={s} weight={400} />; }
function IcoCheck({ s = 14 }) { return <MIcon name="check_circle" s={s} fill={1} weight={400} />; }

function Field({ label, children }: any) {
  return <label style={{ display: "block" }}><span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6, fontWeight: 500 }}>{label}</span>{children}</label>;
}
function Stat({ n, label, col }: any) {
  return <div style={{ display: "flex", alignItems: "baseline", gap: 9, padding: "6px 0" }}><span className="mono" style={{ fontSize: 22, fontWeight: 700, color: col, minWidth: 26 }}>{n}</span><span style={{ fontSize: 13.5, color: "var(--muted)" }}>{label}</span></div>;
}
function Empty({ msg }: any) {
  return <div style={{ padding: "34px 18px", textAlign: "center", color: "var(--muted-2)", fontSize: 14 }}>{msg}</div>;
}
function Toast({ msg, kind }: any) {
  const col = kind === "warn" ? "var(--gold)" : kind === "good" ? "var(--flow)" : "var(--ember)";
  return <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 80, padding: "12px 20px", borderRadius: 13, background: "var(--surface)", border: "1px solid " + col, color: "var(--text)", fontSize: 14, fontWeight: 500, boxShadow: "0 10px 40px rgba(0,0,0,.5)", animation: "rise .3s both" }}>{msg}</div>;
}

const LEVEL_STEP = 100;
const levelFromXp = (xp: number) => 1 + Math.floor(xp / LEVEL_STEP);
const xpInLevel = (xp: number) => xp % LEVEL_STEP;

const inp = { width: "100%", padding: "11px 13px", borderRadius: "var(--radius-field)", border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--text)", fontSize: 14.5, outline: "none" };
const btnPrimary = { flex: 1, padding: "12px 16px", borderRadius: "var(--radius-btn)", border: "1.5px solid var(--btn-border)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontWeight: 700, fontSize: 14.5 };
const btnGhost = { padding: "12px 16px", borderRadius: "var(--radius-btn)", border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", fontWeight: 600, fontSize: 14 };
const miniBtn = { width: 34, height: 30, borderRadius: "var(--radius-btn)", border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13 };

function StoryScene({ progress = 0, genre = "Fantasy" }: any) {
  const p = Math.max(0, Math.min(1, progress));
  const W = 640, H = 200;
  const spots = [[52, 150], [104, 160], [150, 150], [206, 164], [262, 152], [318, 162], [372, 150], [430, 160], [486, 152], [540, 162], [590, 152]];
  const grown = Math.round(p * spots.length);
  const trail = "M 10 178 C 120 168, 180 150, 300 156 S 520 150, 630 132";
  const TLEN = 720; // approx path length for dash animation
  const stars = [[40, 30], [90, 52], [150, 26], [230, 44], [300, 22], [380, 40], [470, 30], [540, 52], [600, 28], [120, 70], [420, 64]];
  const starOpacity = Math.max(0, 0.9 - p * 1.1);

  let resolvedGenre = "Fantasy";
  if (genre) {
    const low = genre.toLowerCase();
    if (/\b(space|star|cyber|robot|ai|hack|system|code|laser|subnet|terminal|digital|data|tech|synth|ship|spacecraft|grid|quantum|mainframe|sci-fi|future|neon)\b/.test(low)) {
      resolvedGenre = "Sci-Fi";
    } else if (/\b(mystery|detective|rain|case|clue|crime|shadow|midnight|noir|interrogate|chief|lamp|pavement|investigat|informant|police|alley)\b/.test(low)) {
      resolvedGenre = "Noir";
    } else if (/\b(cozy|bake|garden|flower|coffee|tea|hearth|village|cabin|cottage|pie|bread|simple|quiet|brew|chamomile|forest|wood)\b/.test(low)) {
      resolvedGenre = "Cozy";
    }
  }

  if (resolvedGenre === "Sci-Fi") {
    const sky1 = mixHex("#030314", mixHex("#0d0526", "#04162e", Math.min(1, p * 1.25)), Math.min(1, p));
    const sky2 = mixHex("#0d0526", mixHex("#071f3a", "#022a45", p), Math.min(1, p));
    const coreCol = mixHex("#00f2fe", "#a78bfa", p);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", borderRadius: "var(--radius-sm)" }} preserveAspectRatio="xMidYMid slice" aria-label="Sci-Fi grid journey">
        <defs>
          <linearGradient id="scifi-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sky1} />
            <stop offset="100%" stopColor={sky2} />
          </linearGradient>
          <radialGradient id="ring-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0, 242, 254, 0.6)" />
            <stop offset="60%" stopColor="rgba(167, 139, 250, 0.2)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#scifi-sky)" />
        {/* Tech Grid perspective lines */}
        <path d="M 0 162 L 640 162 M 0 174 L 640 174 M 0 188 L 640 188 M 0 200 L 640 200" stroke="rgba(0, 242, 254, 0.08)" strokeWidth="1" />
        <line x1="320" y1="130" x2="-200" y2="210" stroke="rgba(0, 242, 254, 0.08)" strokeWidth="1" />
        <line x1="320" y1="130" x2="840" y2="210" stroke="rgba(0, 242, 254, 0.08)" strokeWidth="1" />
        <line x1="320" y1="130" x2="320" y2="210" stroke="rgba(0, 242, 254, 0.08)" strokeWidth="1" />
        <line x1="320" y1="130" x2="110" y2="210" stroke="rgba(0, 242, 254, 0.08)" strokeWidth="1" />
        <line x1="320" y1="130" x2="530" y2="210" stroke="rgba(0, 242, 254, 0.08)" strokeWidth="1" />

        {/* Floating cyber stars */}
        {stars.slice(0, 8).map((s, i) => (
          <polygon key={"st" + i} points={`${s[0]},${s[1]-3} ${s[0]+3},${s[1]} ${s[0]},${s[1]+3} ${s[0]-3},${s[1]}`} fill="#00f2fe" opacity={starOpacity * 0.8} />
        ))}

        {/* Giant Ringed Planet */}
        <g transform={`translate(${W * 0.72}, ${lerp(H * 0.6, H * 0.25, p)})`}>
          <ellipse cx="0" cy="0" rx="42" ry="10" fill="none" stroke="rgba(0, 242, 254, 0.4)" strokeWidth="4" transform="rotate(-15)" />
          <circle cx="0" cy="0" r="16" fill="url(#ring-glow)" />
          <circle cx="0" cy="0" r="12" fill={coreCol} />
        </g>

        {/* Futuristic Spire/Skyscrapers */}
        <polygon points="40,160 55,90 70,160" fill="#071226" opacity="0.75" />
        <line x1="55" y1="90" x2="55" y2="40" stroke="#a78bfa" strokeWidth="1.5" opacity="0.6" />
        <polygon points="560,150 575,70 590,150" fill="#071226" opacity="0.75" />

        {/* Cyber laser pathway */}
        <path d={trail} fill="none" stroke="#00f2fe" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={TLEN} strokeDashoffset={(1 - p) * TLEN} opacity="0.9" style={{ filter: "drop-shadow(0px 0px 4px #00f2fe)" }} />

        {/* Floating Data Spheres as flora */}
        {spots.slice(0, grown).map((s, i) => (
          <g key={"ds" + i}>
            <line x1={s[0]} y1={s[1] + 8} x2={s[0]} y2={s[1] - 4} stroke="rgba(167, 139, 250, 0.4)" strokeWidth="1" />
            <circle cx={s[0]} cy={s[1] - 4} r={i % 3 === 0 ? 4 : 2} fill={i % 2 === 0 ? "#00f2fe" : "#a78bfa"} opacity="0.85" />
          </g>
        ))}

        {/* Sci-Fi Traveler hexagon pointer */}
        <polygon points={`${lerp(12, 628, p)},${lerp(176, 134, p)-6} ${lerp(12, 628, p)+5},${lerp(176, 134, p)-2} ${lerp(12, 628, p)+5},${lerp(176, 134, p)+4} ${lerp(12, 628, p)},${lerp(176, 134, p)+8} ${lerp(12, 628, p)-5},${lerp(176, 134, p)+4} ${lerp(12, 628, p)-5},${lerp(176, 134, p)-2}`} fill="#00f2fe" style={{ filter: "drop-shadow(0px 0px 5px #00f2fe)" }} />
        <circle cx={lerp(12, 628, p)} cy={lerp(176, 134, p) + 1} r="9" fill="#00f2fe" opacity="0.25" />
      </svg>
    );
  }

  if (resolvedGenre === "Noir") {
    const sky1 = mixHex("#08080a", mixHex("#16161a", "#222428", Math.min(1, p * 1.25)), Math.min(1, p));
    const sky2 = mixHex("#16161a", mixHex("#2b2c30", "#383a40", p), Math.min(1, p));
    const lampX = 220;
    const lampY = 82;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", borderRadius: "var(--radius-sm)" }} preserveAspectRatio="xMidYMid slice" aria-label="Noir rainy journey">
        <defs>
          <linearGradient id="noir-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sky1} />
            <stop offset="100%" stopColor={sky2} />
          </linearGradient>
          <linearGradient id="lamp-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(242, 204, 143, 0.42)" />
            <stop offset="100%" stopColor="rgba(242, 204, 143, 0.0)" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#noir-sky)" />

        {/* Rain particles */}
        {stars.map((s, i) => (
          <line key={"rn" + i} x1={s[0] * 1.1} y1={s[1] - 10} x2={s[0] * 1.1 - 4} y2={s[1] + 12} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        ))}
        {spots.map((s, i) => (
          <line key={"rn-low" + i} x1={s[0] + 10} y1={s[1] - 40} x2={s[0] + 6} y2={s[1]} stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
        ))}

        {/* High contrast dark building silhouettes */}
        <rect x="20" y="40" width="80" height="120" fill="#08080a" opacity="0.9" />
        <rect x="36" y="55" width="10" height="15" fill={p > 0.4 ? "#f2cc8f" : "#1a1a20"} opacity={p > 0.4 ? 0.35 : 0.8} />
        <rect x="66" y="75" width="10" height="15" fill={p > 0.7 ? "#f2cc8f" : "#1a1a20"} opacity={p > 0.7 ? 0.35 : 0.8} />

        <rect x="490" y="60" width="110" height="100" fill="#08080a" opacity="0.9" />
        <rect x="510" y="75" width="12" height="18" fill="#f2cc8f" opacity="0.25" />

        {/* Cobblestone pathway */}
        <path d={trail} fill="none" stroke="rgba(255, 255, 255, 0.24)" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={TLEN} strokeDashoffset={(1 - p) * TLEN} />

        {/* Atmospheric Street Lamp light cone */}
        <polygon points={`${lampX},${lampY} ${lampX - 55},190 ${lampX + 55},190`} fill="url(#lamp-beam)" style={{ mixBlendMode: "screen" }} />
        {/* Lamp Post details */}
        <line x1={lampX} y1={lampY} x2={lampX} y2="175" stroke="#16161d" strokeWidth="2.5" />
        <path d={`M ${lampX - 6} ${lampY} L ${lampX + 6} ${lampY} L ${lampX + 4} ${lampY - 8} L ${lampX - 4} ${lampY - 8} Z`} fill="#09090b" />
        <circle cx={lampX} cy={lampY - 4} r="4.5" fill="#ffd27a" style={{ filter: "drop-shadow(0px 0px 4px #ffd27a)" }} />

        {/* Puddle ripples as flora */}
        {spots.slice(0, grown).map((s, i) => (
          <ellipse key={"ri" + i} cx={s[0]} cy={s[1] + 6} rx={(i % 3) * 2 + 3} ry={(i % 3) * 0.7 + 1} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="0.8" />
        ))}

        {/* Traveler is a mystery silhouette spotlight */}
        <ellipse cx={lerp(12, 628, p)} cy={lerp(176, 134, p) + 6} rx="12" ry="4" fill="rgba(0,0,0,0.4)" />
        <circle cx={lerp(12, 628, p)} cy={lerp(176, 134, p)} r="5" fill="#f4f1de" style={{ filter: "drop-shadow(0px 0px 4px #fff)" }} />
        <circle cx={lerp(12, 628, p)} cy={lerp(176, 134, p)} r="10" fill="#fff" opacity="0.2" />
      </svg>
    );
  }

  if (resolvedGenre === "Cozy") {
    const sky1 = mixHex("#25130a", mixHex("#412112", "#6e351b", Math.min(1, p * 1.25)), Math.min(1, p));
    const sky2 = mixHex("#412112", mixHex("#824925", "#a36437", p), Math.min(1, p));
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", borderRadius: "var(--radius-sm)" }} preserveAspectRatio="xMidYMid slice" aria-label="Cozy warm journey">
        <defs>
          <linearGradient id="cozy-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sky1} />
            <stop offset="100%" stopColor={sky2} />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#cozy-sky)" />

        {/* Fireflies / Rising embers in the warm night */}
        {stars.map((s, i) => (
          <circle key={"em" + i} cx={s[0]} cy={s[1] - (p * 15) % 30} r={i % 3 ? 1.2 : 2} fill="#ffd166" opacity={0.4 + (i % 5) * 0.12} />
        ))}

        {/* Cozy Log Cabin / Cottage */}
        <g transform="translate(430, 92)" style={{ opacity: 0.95 }}>
          {/* Stone Chimney */}
          <rect x="42" y="6" width="7" height="22" fill="#3a2f28" />
          {/* Smoke puffs rising from chimney */}
          <circle cx="45.5" cy="-2" r="5" fill="#f4f1de" opacity={0.25} />
          <circle cx="49" cy="-10" r="7.5" fill="#f4f1de" opacity={0.18} />
          <circle cx="54" cy="-22" r="10" fill="#f4f1de" opacity={0.1} />

          {/* Cabin Base */}
          <rect x="0" y="24" width="54" height="34" fill="#58311e" rx="3" stroke="#2a150b" strokeWidth="1.5" />
          {/* Roof */}
          <polygon points="-8,24 27,2 62,24" fill="#7f4f24" stroke="#2a150b" strokeWidth="1.5" />
          {/* Log ends stacked on wall */}
          <circle cx="4" cy="30" r="3.5" fill="#a66e4e" stroke="#2a150b" />
          <circle cx="4" cy="38" r="3.5" fill="#a66e4e" stroke="#2a150b" />
          <circle cx="4" cy="46" r="3.5" fill="#a66e4e" stroke="#2a150b" />
          {/* Warm glowing window */}
          <rect x="18" y="32" width="16" height="15" fill="#ffb703" rx="2" style={{ filter: "drop-shadow(0px 0px 5px #ffb703)" }} />
          {/* Window panes cross */}
          <line x1="26" y1="32" x2="26" y2="47" stroke="#2a150b" strokeWidth="1" />
          <line x1="18" y1="39" x2="34" y2="39" stroke="#2a150b" strokeWidth="1" />
        </g>

        {/* Rolling cute hills */}
        <path d={`M0 ${H} L0 152 C 140 125, 280 155, 420 138 S 580 125, ${W} 144 L ${W} ${H} Z`} fill={mixHex("#2b1508", "#6a4b35", p)} opacity="0.65" />
        <path d={`M0 ${H} L0 168 C 120 154, 260 178, 400 162 S 560 156, ${W} 164 L ${W} ${H} Z`} fill={mixHex("#1a0c04", "#4a3525", p)} opacity="0.88" />

        {/* Charming wooden plank footway trail */}
        <path d={trail} fill="none" stroke={mixHex("#58311e", "#f2cc8f", p)} strokeWidth="4.5" strokeLinecap="round"
          strokeDasharray={TLEN} strokeDashoffset={(1 - p) * TLEN} />

        {/* Sweetberry bushes blooming as progress grows */}
        {spots.slice(0, grown).map((s, i) => (
          <g key={"sb" + i}>
            <circle cx={s[0]} cy={s[1] - 4} r={7} fill={mixHex("#3a2215", "#81b29a", p)} />
            <circle cx={s[0] - 2} cy={s[1] - 5} r="2.2" fill={mixHex("#401111", "#e07a5f", p)} />
            <circle cx={s[0] + 3} cy={s[1] - 3} r="1.8" fill={mixHex("#401111", "#e07a5f", p)} />
          </g>
        ))}

        {/* Traveler is a lovely golden spark of warmth */}
        <circle cx={lerp(12, 628, p)} cy={lerp(176, 134, p)} r="5" fill="#f2cc8f" style={{ filter: "drop-shadow(0px 0px 4px #ffd166)" }} />
        <circle cx={lerp(12, 628, p)} cy={lerp(176, 134, p)} r="9" fill="#f2cc8f" opacity="0.35" />
      </svg>
    );
  }

  // Default: Fantasy / Quest theme
  const sky1 = mixHex("#241a4d", mixHex("#5a3a8a", "#9ec3ff", Math.min(1, p * 1.25)), Math.min(1, p));
  const sky2 = mixHex("#3a2a5a", mixHex("#caa3d8", "#e6f3ff", p), Math.min(1, p));
  const sunY = lerp(H * 0.95, H * 0.30, p), sunCol = mixHex("#ff7a59", "#ffe08a", p);
  const sunGlow = mixHex("#ff7a59", "#fff1c0", p);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", borderRadius: "var(--radius-sm)" }} preserveAspectRatio="xMidYMid slice" aria-label="Your journey">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sky1} />
          <stop offset="100%" stopColor={sky2} />
        </linearGradient>
        <radialGradient id="sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={sunGlow} />
          <stop offset="55%" stopColor={sunCol} />
          <stop offset="100%" stopColor={sunCol} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#sky)" />
      {stars.map((s, i) => <circle key={"st" + i} cx={s[0]} cy={s[1]} r={i % 3 ? 1 : 1.6} fill="#fff" opacity={starOpacity * (i % 2 ? 0.7 : 1)} />)}
      <circle cx={W * 0.5} cy={sunY} r="64" fill="url(#sun)" />
      <circle cx={W * 0.5} cy={sunY} r="20" fill={sunGlow} />
      {/* distant hills */}
      <path d={`M0 ${H} L0 150 C 120 120, 240 150, 360 134 S 560 120, ${W} 140 L ${W} ${H} Z`} fill={mixHex("#1c2340", "#7fae8a", p)} opacity="0.55" />
      <path d={`M0 ${H} L0 168 C 140 150, 300 176, 460 160 S ${W} 158, ${W} 166 L ${W} ${H} Z`} fill={mixHex("#141a30", "#5e9472", p)} opacity="0.8" />
      {/* the trail, drawn in proportion to progress */}
      <path d={trail} fill="none" stroke={mixHex("#6b5a8a", "#ffe9b0", p)} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={TLEN} strokeDashoffset={(1 - p) * TLEN} opacity="0.9" />
      {/* flora that blooms with progress */}
      {spots.slice(0, grown).map((s, i) => {
        const big = i % 3 === 0;
        return big
          ? <g key={"tr" + i}>
              <rect x={s[0] - 1.5} y={s[1] - 2} width="3" height="12" fill={mixHex("#2f3a2a", "#6b4a2e", p)} />
              <circle cx={s[0]} cy={s[1] - 6} r="8" fill={mixHex("#3c5a3a", "#7ec98a", p)} />
            </g>
          : <g key={"fl" + i}>
              <line x1={s[0]} y1={s[1] + 8} x2={s[0]} y2={s[1]} stroke={mixHex("#3c5a3a", "#5a8a52", p)} strokeWidth="1.5" />
              <circle cx={s[0]} cy={s[1] - 1} r="3" fill={["#ffd27a", "#ff9ec0", "#b78bff", "#7cc6ff"][i % 4]} />
            </g>;
      })}
      {/* the traveler advances along the trail */}
      <circle cx={lerp(12, 628, p)} cy={lerp(176, 134, p)} r="5" fill="#fff" />
      <circle cx={lerp(12, 628, p)} cy={lerp(176, 134, p)} r="9" fill="#fff" opacity="0.3" />
    </svg>
  );
}

function StoryPanel({ db, progress, onWeave, weaving, patch, custom, setCustom, setMode, flash }: any) {
  const active = [...db.tasks].filter(t => !t.done).sort((a, b) => score(b) - score(a));
  const titles = active.map(t => t.title);
  const goal = Object.keys(db.goals || {})[0] || (active[0] && active[0].title) || "";
  const genre = db.storyGenre || "Fantasy";
  const story = db.story || localStory(goal, titles, genre);
  const [prompt, setPrompt] = useState(goal);
  const doneTitles = new Set(db.tasks.filter((t: any) => t.done === true).map((t: any) => t.title));
  const pct = Math.round(progress * 100);
  const phase = progress < 0.15 ? "before first light" : progress < 0.4 ? "the day is dawning" : progress < 0.7 ? "the sun is climbing" : progress < 1 ? "golden hour" : "summit reached";

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
      <StoryScene progress={progress} genre={genre} />
      <div style={{ padding: "20px 22px" }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Your quest · {phase} · {pct}%</div>

        <h2 className="display" style={{ fontSize: 30, margin: "0 0 8px" }}>{story.title}</h2>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 18px", maxWidth: 640 }}>{story.intro}</p>
        <div className="questline" style={{ marginBottom: 18 }}>
          {(story.chapters || []).map((c: any, i: number) => {
            const done = doneTitles.has(c.task);
            return (
              <div key={i} className={"quest" + (done ? " done" : "")}>
                <span className="node" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", textDecoration: done ? "line-through" : "none", opacity: done ? 0.65 : 1 }}>{c.task}</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)", fontStyle: "italic" }}>{c.line}</div>
                </div>
              </div>
            );
          })}
          {(!story.chapters || !story.chapters.length) && <p style={{ fontSize: 13.5, color: "var(--muted-2)" }}>Add a task or two, then let the narrator weave them into a quest.</p>}
        </div>

        {/* Prompt Input & Trigger */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Type a custom prompt to weave a unique story (e.g. A space station hack, a magical bakery)..."
              style={{ ...inp, flex: 1, minWidth: 200 }} className="focusable" />
            <button onClick={() => onWeave(prompt, prompt)} disabled={weaving} className="tap focusable"
              style={{ ...btnPrimary, flex: "0 0 auto", opacity: weaving ? 0.7 : 1 }}>
              {weaving ? "Weaving…" : (db.story ? "Re-weave the tale" : "Weave my story")}</button>
          </div>
        </div>

        {/* Dynamic Theme Ambience Color Customization */}
        <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 16, marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
            <MIcon name="palette" s={14} /> Customize Background & Accent Colors
          </div>
          
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 16 }}>
            {/* Custom Background Color Picker */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted-2)", fontWeight: 500 }}>Background Color</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ position: "relative", width: 44, height: 34, borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--line)", background: custom.bg || "var(--bg)", display: "inline-block" }}>
                  <input type="color" value={custom.bg || "#0a0e22"} onChange={e => setCustom((s: any) => ({ ...s, bg: e.target.value }))}
                    style={{ position: "absolute", inset: "-4px", width: "130%", height: "150%", border: 0, padding: 0, cursor: "pointer", opacity: 0 }} />
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{custom.bg || "Theme Default"}</span>
              </div>
            </div>

            {/* Custom Accent Color Picker */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted-2)", fontWeight: 500 }}>Accent Color</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ position: "relative", width: 44, height: 34, borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--line)", background: custom.accent || "var(--ember)", display: "inline-block" }}>
                  <input type="color" value={custom.accent || "#ff7a45"} onChange={e => setCustom((s: any) => ({ ...s, accent: e.target.value }))}
                    style={{ position: "absolute", inset: "-4px", width: "130%", height: "150%", border: 0, padding: 0, cursor: "pointer", opacity: 0 }} />
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{custom.accent || "Theme Default"}</span>
              </div>
            </div>

            {/* Mode Switcher */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 100 }}>
              <span style={{ fontSize: 12, color: "var(--muted-2)", fontWeight: 500 }}>Contrast Mode</span>
              <div style={{ display: "flex", gap: 4 }}>
                {["dark", "light"].map(m => (
                  <button key={m} onClick={() => setMode(m)} className="tap focusable"
                    style={{
                      padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: 11.5, fontWeight: 600,
                      border: "1px solid var(--line)",
                      background: document.documentElement.dataset.mode === m ? "color-mix(in srgb, var(--ember) 12%, transparent)" : "transparent",
                      color: "var(--text)"
                    }}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => {
              setCustom((s: any) => ({ ...s, bg: "", accent: "" }));
              if (setMode) setMode("dark");
            }} className="tap focusable"
              style={{ padding: "6px 14px", borderRadius: "var(--radius-btn)", fontSize: 12, fontWeight: 600,
                border: "1px solid var(--line)", background: "transparent", color: "var(--muted)" }}>
              Reset to story atmosphere
            </button>
            <button onClick={() => {
              patch((d: any) => {
                if (!d.settings) d.settings = {};
                d.settings.storyModeDisabled = true;
              });
              if (flash) {
                flash("Story Mode disabled. You can re-enable it in the Customize menu.", "good");
              }
            }} className="tap focusable"
              style={{ padding: "6px 14px", borderRadius: "var(--radius-btn)", fontSize: 12, fontWeight: 600,
                border: "1px solid var(--line)", background: "transparent", color: "var(--warn)" }}>
              Remove Story Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SafeStartBanner({ alert, onStart, onEscalate, onSnooze }: any) {
  const mins = Math.max(0, Math.round(alert.minsToLss));
  const by = clockLabel(alert.lss || alert.task.due);
  useEffect(() => {
    const id = setTimeout(onEscalate, 20000);
    return () => clearTimeout(id);
  }, [onEscalate]);
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 75, padding: "12px 16px",
      background: "#e5443d", color: "#fff", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      borderBottom: "2px solid rgba(255,255,255,.4)", boxShadow: "0 8px 30px rgba(0,0,0,.4)",
      animation: "bannerIn .4s var(--m3-easing-emphasized-decel) both"
    }}>
      <span className="material-symbols-outlined" style={{
        fontSize: 22, animation: "flamePulse 1s infinite",
        fontVariationSettings: "'FILL' 1,'wght' 500,'GRAD' 0,'opsz' 24"
      }}>alarm</span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Last chance to start: {alert.task.title}</div>
        <div style={{ fontSize: 12.5, opacity: .92 }}>Start within <b>{mins} min</b> (by {by}) or you can’t finish before the deadline — your schedule is blocked after that.{alert.conflicted ? " Moved earlier so it won’t collide with a higher-priority task." : ""}</div>
      </div>
      <button onClick={onStart} className="tap" style={{
        padding: "9px 16px", borderRadius: "var(--radius-btn)",
        border: "none", background: "#fff", color: "#e5443d", fontWeight: 700, fontSize: 13.5
      }}>Start now</button>
      <button onClick={onSnooze} className="tap" style={{
        padding: "9px 14px", borderRadius: "var(--radius-btn)",
        border: "1px solid rgba(255,255,255,.6)", background: "transparent", color: "#fff", fontWeight: 600, fontSize: 13
      }}>Snooze 2m</button>
    </div>
  );
}

function SafeStartAlarm({ alert, onStart, onComplete, onRescue, onSnooze }: any) {
  const hold = (alert.task.alertHoldSec ?? 30);
  const [left, setLeft] = useState(hold);     // hold lock countdown
  const [mins, setMins] = useState(Math.max(0, Math.round(alert.minsToLss)));
  useEffect(() => {
    const id = setInterval(() => {
      setLeft(l => Math.max(0, l - 1));
      setMins(Math.max(0, Math.round((alert.lss - now()) / 60e3)));
    }, 1000);
    return () => clearInterval(id);
  }, [alert.lss]);
  const locked = left > 0;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 90, background: "#060606", color: "#fff",
      display: "flex", flexDirection: "column", alignItems: "center", justifyValue: "center", justifyContent: "center",
      padding: 24, textAlign: "center", overflow: "hidden", animation: "pop .3s var(--m3-easing-emphasized-decel) both"
    }}>
      <div style={{
        position: "absolute", width: 520, height: 520, borderRadius: "50%", top: "50%", left: "50%",
        marginLeft: -260, marginTop: -260, zIndex: 0, filter: "blur(8px) saturate(125%)", opacity: .55,
        animation: "orbDrift 18s ease-in-out infinite alternate",
        background: "radial-gradient(circle at 34% 28%, rgba(255,255,255,.4), transparent 40%),radial-gradient(circle at 72% 28%, rgba(255,90,31,.95), transparent 55%),radial-gradient(circle at 28% 72%, rgba(255,172,46,.85), transparent 55%),radial-gradient(circle at 74% 74%, rgba(165,45,37,.9), transparent 55%),radial-gradient(circle at 50% 50%, #241a18, #060606 80%)"
      }} />
      <div style={{ position: "relative", zIndex: 2, maxWidth: 440 }}>
        <span className="material-symbols-outlined" style={{
          fontSize: 46, animation: "flamePulse 1s infinite",
          fontVariationSettings: "'FILL' 1,'wght' 500"
        }}>alarm</span>
        <div className="eyebrow" style={{ color: "rgba(255,255,255,.6)", marginTop: 14 }}>Latest safe start — now or never</div>
        <h2 className="display" style={{ fontSize: 30, fontWeight: 300, letterSpacing: "-.02em", margin: "10px 0 6px" }}>{alert.task.title}</h2>
        <p style={{ fontSize: 15, color: "rgba(255,255,255,.78)", lineHeight: 1.5, margin: "0 0 6px" }}>
          You have <b style={{ color: "#fff" }}>{mins} minute{mins !== 1 ? "s" : ""}</b> to begin. After that your calendar is blocked straight through the deadline — start later and it can’t be finished in time.
        </p>
        {alert.conflicted && <div style={{ fontSize: 12.5, color: "var(--gold)", margin: "0 0 6px" }}>Scheduled ahead of a higher-priority task so the two don’t collide.</div>}
        {alert.task.why && <p style={{ fontStyle: "italic", color: "var(--gold)", fontSize: 14, margin: "0 0 22px" }}>“{alert.task.why}”</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          <button onClick={onStart} className="tap" style={{
            padding: "15px", borderRadius: "var(--radius-btn)", border: "none",
            background: "#fff", color: "#060606", fontWeight: 700, fontSize: 16
          }}>Start now</button>
          <button onClick={onComplete} className="tap" style={{
            padding: "13px", borderRadius: "var(--radius-btn)",
            border: "1px solid rgba(255,255,255,.4)", background: "transparent", color: "#fff", fontWeight: 600, fontSize: 14
          }}>It’s already done</button>
          <button onClick={onSnooze} disabled={locked} className="tap"
            style={{
              padding: "12px", borderRadius: "var(--radius-btn)", border: "1px solid rgba(255,255,255,.18)",
              background: "transparent", color: locked ? "rgba(255,255,255,.4)" : "rgba(255,255,255,.8)",
              fontWeight: 600, fontSize: 13, cursor: locked ? "not-allowed" : "pointer"
            }}>
            {locked ? `Dismiss available in ${left}s` : "Snooze 2 min"}
          </button>
        </div>
        <div style={{ marginTop: 14, fontSize: 11.5, color: "rgba(255,255,255,.45)" }}>
          This alarm is held on screen for {hold}s (your setting). Miss the window and Rescue Mode takes over automatically.
        </div>
      </div>
    </div>
  );
}
