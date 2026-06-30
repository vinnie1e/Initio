import fs from 'fs';
const lines = fs.readFileSync('clean-server.ts', 'utf8').split('\n');

// Remove duplicate aiGenkit lines
const cleanedLines = lines.filter(l => !l.includes('aiGenkit = genkit('));

const memoryTaskUpdateStart = cleanedLines.findIndex(l => l.includes('app.post("/api/memory/task-update"'));

const agentCode = `
const inMemoryMemory: Record<
  string,
  { profile: any; episodes: any[]; fcmToken?: string }
> = {};

import { z } from 'genkit';

export const agentFlow = aiGenkit.defineFlow({
  name: "agentFlow",
  inputSchema: z.object({
    goal: z.string(),
    db: z.any(),
    uid: z.string(),
    googleToken: z.string().optional(),
    userProfile: z.any(),
    recentEpisodes: z.any()
  })
}, async (input) => {
  const { goal, db, uid, googleToken, userProfile, recentEpisodes } = input;
  const client = getGeminiClient();

  const originalSchedule = [...(db?.schedule || []), ...(db?.calBusy || [])];
  const currentDb = {
    tasks: db?.tasks ? [...db.tasks] : [],
    schedule: originalSchedule,
    reminders: db?.reminders ? [...db.reminders] : [],
  };

  const trace: any[] = [];
  const actions: any[] = [];
  let firstStepText = "";
  let firstStepTitle = "";
  let clarificationNeeded: any = null;

  const travelBlocks = (db?.calBusy || []).filter((b: any) => b.location === "Transit");
  travelBlocks.forEach((tb: any) => {
    trace.push({
      role: "observe",
      text: \`\${tb.durationMin}-min drive between your \${tb.fromTitle || "event"} and \${tb.toTitle || "event"} — protected that gap.\`
    });
  });

  trace.push({
    role: "thought",
    text: \`Autonomous co-pilot activated. Analyzing goal: "\${goal}". Booting function-calling loop.\`,
  });

  const checkCalendarTool = aiGenkit.dynamicTool({
    name: "check_calendar",
    description: "Check the calendar/schedule for occupied blocks and active events in a given date/time range.",
    inputSchema: z.object({
      fromISO: z.string().describe("ISO 8601 start date-time string (e.g., '2026-06-30T10:00:00Z')."),
      toISO: z.string().describe("ISO 8601 end date-time string (e.g., '2026-07-07T10:00:00Z').")
    })
  }, async (args) => {
    const { fromISO, toISO } = args;
    const fromMs = new Date(fromISO).getTime();
    const toMs = new Date(toISO).getTime();
    const activeBlocks = currentDb.schedule.filter((b: any) => {
      const t = new Date(b.startISO || b.startTime).getTime();
      return t >= fromMs && t <= toMs;
    });
    return {
      success: true,
      blocksCount: activeBlocks.length,
      blocks: activeBlocks.map((b: any) => ({
        title: b.title,
        startISO: b.startISO || b.startTime,
        durationMin: b.durationMin || b.durationMinutes,
      })),
      _observeText: \`checked calendar range · \${activeBlocks.length} focus block(s) found\`
    };
  });

  const createTaskTool = aiGenkit.dynamicTool({
    name: "create_task",
    description: "Create a new high-priority or one-off task with a title, due date, effort in minutes, and urgency stakes.",
    inputSchema: z.object({
      title: z.string(),
      dueISO: z.string(),
      effortMin: z.number(),
      stakes: z.number()
    })
  }, async (args) => {
    const { title, dueISO, effortMin, stakes } = args;
    const task = {
      id: \`task_\${Date.now()}_\${Math.random().toString(36).substr(2, 5)}\`,
      title,
      type: "one-off" as const,
      due: new Date(dueISO).getTime(),
      effortMin: Number(effortMin) || 30,
      stakes: Number(stakes) || 2,
      why: \`Autonomous Motivation: Master the path forward for \${title}.\`,
      done: false,
      when: "",
    };
    currentDb.tasks.push(task);
    actions.push({ type: "create_task", task });
    return {
      success: true,
      taskCreated: { title, dueISO, effortMin, stakes },
      _observeText: \`created · "\${title}"\`
    };
  });

  const prioritizeTool = aiGenkit.dynamicTool({
    name: "prioritize",
    description: "Sort and prioritize active tasks based on impact, consequence stakes, and urgency.",
    inputSchema: z.object({})
  }, async () => {
    const working = currentDb.tasks.filter((t: any) => !t.done);
    const score = (t: any) => (t.stakes || 2) * (t.urgency || 3);
    const sorted = [...working].sort((a, b) => score(b) - score(a));
    const observeText = sorted.slice(0, 4).map((t: any, i: number) => \`\${i + 1}. \${t.title}\`).join(" · ") || "nothing to rank";
    return {
      success: true,
      prioritizedTasks: sorted.map((t: any) => ({
        title: t.title,
        stakes: t.stakes,
        score: score(t),
      })),
      _observeText: observeText
    };
  });

  const scheduleBlockTool = aiGenkit.dynamicTool({
    name: "schedule_block",
    description: "Book/schedule a focus time block on the calendar for a specific task.",
    inputSchema: z.object({
      title: z.string(),
      startISO: z.string(),
      durationMin: z.number()
    })
  }, async (args) => {
    const { title, startISO, durationMin } = args;
    const block = {
      title,
      startISO,
      durationMin: Number(durationMin) || 60,
    };
    currentDb.schedule.push(block);
    actions.push({
      type: "schedule",
      title,
      startISO,
      durationMin: Number(durationMin) || 60,
    });
    return {
      success: true,
      scheduledBlock: block,
      _observeText: \`booked · \${title} · \${new Date(startISO).toLocaleString()}\`
    };
  });

  const draftFirstStepTool = aiGenkit.dynamicTool({
    name: "draft_first_step",
    description: "Draft an immediate momentum micro-step and initial outline for the highest-priority task. Can create real Gmail drafts or Google Docs.",
    inputSchema: z.object({
      title: z.string(),
      taskType: z.string(),
      content: z.string()
    })
  }, async (args) => {
    const { title, taskType, content } = args;
    firstStepTitle = title;
    let actionText = \`Microscope 2-minute step: Open workspace/editor and create a new blank checklist for \${title}. Immediate items: 1. Setup workspace. 2. Write down 3 quick bullet points.\`;
    let actionObserveText = \`micro-step drafted for "\${title}"\`;
    
    if (googleToken && (taskType === "email" || taskType === "document")) {
      try {
        if (taskType === "email") {
          const message = \`To: \\r\\nSubject: \${title}\\r\\n\\r\\n\${content}\`;
          const encodedMessage = Buffer.from(message).toString("base64").replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
          const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
            method: "POST",
            headers: { Authorization: "Bearer " + googleToken, "Content-Type": "application/json" },
            body: JSON.stringify({ message: { raw: encodedMessage } })
          });
          if (r.ok) {
            actionText = \`Your first step is already a Gmail draft waiting in your account.\`;
            actionObserveText = actionText;
          }
        } else if (taskType === "document") {
          const r1 = await fetch("https://docs.googleapis.com/v1/documents", {
            method: "POST",
            headers: { Authorization: "Bearer " + googleToken, "Content-Type": "application/json" },
            body: JSON.stringify({ title })
          });
          if (r1.ok) {
            const docData = await r1.json();
            const docId = docData.documentId;
            const r2 = await fetch(\`https://docs.googleapis.com/v1/documents/\${docId}:batchUpdate\`, {
              method: "POST",
              headers: { Authorization: "Bearer " + googleToken, "Content-Type": "application/json" },
              body: JSON.stringify({
                requests: [{ insertText: { location: { index: 1 }, text: content + "\\n" } }]
              })
            });
            if (r2.ok) {
              actionText = \`Created a Google Doc for you seeded with an outline: https://docs.google.com/document/d/\${docId}/edit\`;
              actionObserveText = actionText;
            }
          }
        }
      } catch (e) {
        console.warn("Workspace API error:", e);
      }
    }

    firstStepText = actionText;
    return {
      success: true,
      draftedFirstStep: {
        microStep: actionText,
        checklist: ["Setup draft", "Jot down 3 thoughts", "Spend 5 minutes planning"],
      },
      _observeText: actionObserveText
    };
  });

  const setReminderTool = aiGenkit.dynamicTool({
    name: "set_reminder",
    description: "Set a reminder alert to notify the user before a deadline or a scheduled focus block.",
    inputSchema: z.object({
      title: z.string(),
      atISO: z.string()
    })
  }, async (args) => {
    const { title, atISO } = args;
    actions.push({
      type: "reminder",
      title,
      atISO,
      message: \`Time for: \${title}\`,
    });
    return {
      success: true,
      reminderSet: { title, atISO },
      _observeText: \`reminder set for "\${title}" at \${new Date(atISO).toLocaleTimeString()}\`
    };
  });

  const askClarificationTool = aiGenkit.dynamicTool({
    name: "ask_clarification",
    description: "Ask the user a clarifying question when the goal or constraints are ambiguous and materially change the plan (missing deadline, unclear which task, unknown hours). Pauses the loop.",
    inputSchema: z.object({
      question: z.string(),
      options: z.array(z.string())
    })
  }, async (args) => {
    const { question, options } = args;
    clarificationNeeded = { question, options };
    trace.push({ role: "clarify", question, options });
    throw new Error("CLARIFICATION_NEEDED");
  });

  const researchFactTool = aiGenkit.dynamicTool({
    name: "research_fact",
    description: "Look up a real-world fact, deadline, or requirement (e.g. tax deadlines, passport renewal rules) using Google Search to accurately set up tasks.",
    inputSchema: z.object({ query: z.string() })
  }, async (args) => {
    const { query } = args;
    try {
      const searchResponse = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: query,
        config: { tools: [{ googleSearch: {} }] },
      });
      const text = searchResponse.text;
      const chunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks;
      let observeText = text || "No information found.";
      const sources = chunks?.map((c: any) => c.web?.title || c.web?.uri).filter(Boolean);
      if (sources && sources.length > 0) {
        observeText += \`\\n(Sources: \${sources.join(", ")})\`;
      }
      return { fact: observeText, _observeText: observeText };
    } catch (e: any) {
      return { error: e.message, _observeText: \`Search failed: \${e.message}\` };
    }
  });

  const allTools = [
    checkCalendarTool, createTaskTool, prioritizeTool, scheduleBlockTool,
    draftFirstStepTool, setReminderTool, askClarificationTool, researchFactTool
  ];

  const messages: any[] = [
    {
      role: "user",
      content: [
        {
          text: \`You are an Autonomous Executive Function Co-pilot. The user has a goal: "\${goal}".
Current date/time is \${new Date().toISOString()}.

User Profile (Memory):
\${JSON.stringify(userProfile, null, 2)}

Recent Episodes (Past interactions):
\${JSON.stringify(recentEpisodes, null, 2)}

Your job is to plan and schedule the necessary actions to accomplish the goal by calling the available tools.
If the goal is ambiguous in a way that materially changes the plan (missing deadline, unclear which of two tasks "the report" refers to, no sense of available hours), you MUST call ask_clarification to emit a special clarify trace step INSTEAD of guessing, and pause the loop.
Please run a multi-turn planning loop. Use tools to check the calendar, research facts (such as real-world deadlines or requirements), create tasks, prioritize them, schedule blocks of time for them, draft first steps, and set reminders as needed.
Important: Personalize your planning using the user's profile and historical behavior (e.g. if they tend to underestimate effort, pad the schedule).
When you are fully finished with all planning, explain the plan to the user in a brief summary.
Surface one personalized line in your final summary citing what you learned from their profile (e.g. "I noticed you historically underestimate writing tasks by ~40%, so I padded this block").\`
        }
      ]
    }
  ];

  let criticRun = false;

  for (let i = 0; i < 8; i++) {
    const res = await aiGenkit.generate({
      model: 'googleai/gemini-2.5-flash',
      messages,
      tools: allTools,
      returnToolRequests: true
    });

    const msg = res.message;
    if (!msg) break;
    messages.push(msg as any);

    const textParts = msg.content.filter((c: any) => c.text).map((c: any) => c.text).join("\\n");
    if (textParts && textParts.trim()) {
      trace.push({ role: "thought", text: textParts });
    }

    const toolRequests = msg.content.filter((c: any) => c.toolRequest).map((c: any) => c.toolRequest);
    if (toolRequests.length === 0) {
      if (!criticRun) {
        criticRun = true;
        const proposedSchedule = actions.filter((a: any) => a.type === "schedule");
        if (proposedSchedule.length > 0) {
          const critiqueRes = await aiGenkit.generate({
            model: 'googleai/gemini-2.5-flash',
            prompt: \`You are an executive schedule critic.
Evaluate the following proposed schedule against the user's existing calendar.
Rules:
1. No proposed block overlaps a real busy event in the existing calendar.
2. Every task is scheduled to start before its latestSafeStart (based on due date and effort).
3. No day is overloaded beyond 4 deep-work hours (240 minutes) across both existing and proposed blocks.

Existing Calendar: \${JSON.stringify(originalSchedule)}
Proposed Blocks: \${JSON.stringify(proposedSchedule)}
Tasks: \${JSON.stringify(currentDb.tasks)}

If the proposed schedule violates ANY of the rules, respond with exactly "VIOLATION:" followed by a brief, clear explanation of the issue.
If it perfectly passes all rules, respond with exactly "PASS".\`
          });
          const critiqueText = critiqueRes.text;
          if (critiqueText.includes("VIOLATION:")) {
            const issue = critiqueText.replace("VIOLATION:", "").trim();
            trace.push({ role: "thought", text: \`Critic flagged: \${issue}\` });
            messages.push({
              role: "user",
              content: [{ text: \`CRITIC FEEDBACK: The draft plan violates scheduling rules:\\n\${issue}\\n\\nPlease correct the plan using the available tools (e.g., reschedule blocks) and finish.\` }]
            });
            continue;
          }
        }
      }
      break;
    }

    const toolResponsesContent = [];
    for (const req of toolRequests) {
      trace.push({ role: "tool", tool: req.name, args: req.input, text: \`Calling tool: \${req.name} with inputs \${JSON.stringify(req.input)}\` });
      
      let output: any = {};
      try {
        if (req.name === "check_calendar") output = await checkCalendarTool(req.input);
        else if (req.name === "create_task") output = await createTaskTool(req.input);
        else if (req.name === "prioritize") output = await prioritizeTool(req.input);
        else if (req.name === "schedule_block") output = await scheduleBlockTool(req.input);
        else if (req.name === "draft_first_step") output = await draftFirstStepTool(req.input);
        else if (req.name === "set_reminder") output = await setReminderTool(req.input);
        else if (req.name === "ask_clarification") output = await askClarificationTool(req.input);
        else if (req.name === "research_fact") output = await researchFactTool(req.input);
      } catch (e: any) {
        if (e.message === "CLARIFICATION_NEEDED") {
          // handled
        } else {
          output = { error: String(e) };
        }
      }
      
      const obsText = output._observeText || JSON.stringify(output);
      delete output._observeText;
      
      if (!clarificationNeeded) {
        trace.push({ role: "observe", tool: req.name, text: obsText });
      }
      
      toolResponsesContent.push({
        toolResponse: { name: req.name, ref: req.ref, output }
      });
    }

    messages.push({ role: "tool", content: toolResponsesContent });
    if (clarificationNeeded) break;
  }

  let finalSummary = "";
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === "model") {
    finalSummary = lastMsg.content.filter((c: any) => c.text).map((c: any) => c.text).join("\\n");
  }

  return {
    trace,
    actions,
    summary: clarificationNeeded ? "" : finalSummary,
    clarificationNeeded,
    firstStepText,
    firstStepTitle
  };
});

app.post("/api/agent", async (req, res) => {
  const { goal, db, uid = "default-user", googleToken } = req.body;
  if (!goal) return res.status(400).json({ error: "Goal is required" });
  if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: "No GEMINI_API_KEY found" });

  try {
    let userProfile = { preferredWorkHours: "Standard business hours", effortEstimation: "No data yet", slipDays: "No data yet", adjustments: [] };
    let recentEpisodes: any[] = [];
    if (dbFirestore) {
      try {
        const profileDoc = await dbFirestore.collection("users").doc(uid).collection("profile").doc("main").get();
        if (profileDoc.exists) userProfile = { ...userProfile, ...profileDoc.data() };
        const episodesSnap = await dbFirestore.collection("users").doc(uid).collection("episodes").orderBy("timestamp", "desc").limit(5).get();
        episodesSnap.forEach((doc) => recentEpisodes.push(doc.data()));
      } catch (e) { console.warn("Firestore read failed", e); }
    } else {
      const mem = inMemoryMemory[uid] || { profile: {}, episodes: [] };
      userProfile = { ...userProfile, ...mem.profile };
      recentEpisodes = mem.episodes.slice(0, 5);
    }

    const result = await agentFlow({
      goal, db, uid, googleToken, userProfile, recentEpisodes
    });

    if (result.clarificationNeeded) {
      return res.json({ trace: result.trace, actions: [], promptClarification: result.clarificationNeeded });
    }

    return res.json({
      trace: result.trace,
      actions: result.actions,
      summary: result.summary,
      firstStepText: result.firstStepText,
      firstStepTitle: result.firstStepTitle
    });
  } catch (err: any) {
    console.error("Agent Loop Error:", err);
    return res.status(500).json({ error: "Agent loop failed", details: err.message });
  }
});
`;

cleanedLines.splice(memoryTaskUpdateStart, 0, agentCode);

// Inject aiGenkit definition
const dotenvLine = cleanedLines.findIndex(l => l.includes("dotenv.config()"));
cleanedLines.splice(dotenvLine + 1, 0, '\nexport const aiGenkit = genkit({ plugins: [googleAI()] });\n');

fs.writeFileSync('server.ts', cleanedLines.join('\n'));
