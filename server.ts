import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/googleai";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { CloudTasksClient } from "@google-cloud/tasks";
import dotenv from "dotenv";

dotenv.config();

export const aiGenkit = genkit({ plugins: [googleAI()] });





const tasksClient = new CloudTasksClient();

let dbFirestore: Firestore | null = null;
try {
  let firebaseAdminOptions: any = {};
  let firestoreDatabaseId: string | undefined = undefined;

  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const configText = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(configText);
      if (config.projectId) {
        firebaseAdminOptions.projectId = config.projectId;
      }
      if (config.firestoreDatabaseId) {
        firestoreDatabaseId = config.firestoreDatabaseId;
      }
    }
  } catch (e) {
    console.warn("Could not read firebase-applet-config.json for server admin setup:", e);
  }

  const appInstance = getApps().length === 0
    ? initializeApp(firebaseAdminOptions)
    : getApps()[0];

  dbFirestore = firestoreDatabaseId
    ? getFirestore(appInstance, firestoreDatabaseId)
    : getFirestore(appInstance);
} catch (e) {
  console.warn("Firestore could not be initialized (fallback to in-memory)", e);
}

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini Client safely
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn(
        "GEMINI_API_KEY is not defined in environment variables. Gemini features will run in mock/fallback mode.",
      );
    }
    ai = new GoogleGenAI({
      apiKey: apiKey || "MOCK_KEY",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return ai;
}

// 1. API: Extract deadlines and tasks from raw text (syllabus, email, brief)
app.post("/api/gemini/extract-deadlines", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  try {
    const client = getGeminiClient();
    if (process.env.GEMINI_API_KEY) {
      const prompt = `Analyze the following syllabus, email, or project brief to extract all deadlines, milestones, and tasks. 
For each extracted item, determine:
1. Title of the task/milestone
2. The exact deadline date & time if specified (format: YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD)
3. Urgency score from 1 (low) to 5 (extreme)
4. Estimated effort/energy from 1 (easy) to 5 (hard)
5. Suggested cushion/buffer time (e.g., '1 day earlier', '2 hours earlier') to avoid last-minute rush
6. A proposed "why" or motivation statement tying to academic/professional growth.

Text:
"""
${text}
"""`;

      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    deadline: {
                      type: Type.STRING,
                      description: "YYYY-MM-DDTHH:mm or YYYY-MM-DD",
                    },
                    urgency: { type: Type.INTEGER, description: "1 to 5" },
                    effort: { type: Type.INTEGER, description: "1 to 5" },
                    consequence: {
                      type: Type.INTEGER,
                      description: "Consequence score if missed from 1 to 5",
                    },
                    bufferSuggestion: {
                      type: Type.STRING,
                      description:
                        "Buffer description, e.g., 'Do it 1 day early'",
                    },
                    suggestedWhy: {
                      type: Type.STRING,
                      description: "Identity-reinforcing motivation",
                    },
                  },
                  required: [
                    "title",
                    "deadline",
                    "urgency",
                    "effort",
                    "consequence",
                    "suggestedWhy",
                  ],
                },
              },
            },
            required: ["tasks"],
          },
        },
      });

      const parsedData = JSON.parse(response.text || "{}");
      return res.json(parsedData);
    } else {
      // Fallback
      return res.json({
        tasks: [
          {
            title: "Extracted: Midterm Paper (Draft)",
            deadline: "2026-07-02T23:59",
            urgency: 4,
            effort: 4,
            consequence: 5,
            bufferSuggestion: "Create outline 2 days earlier",
            suggestedWhy:
              "Proves your understanding and lightens finals week load.",
          },
          {
            title: "Extracted: Homework 3",
            deadline: "2026-07-05T18:00",
            urgency: 3,
            effort: 2,
            consequence: 3,
            bufferSuggestion: "Complete 12 hours earlier",
            suggestedWhy: "Strengthens your core problem-solving foundation.",
          },
        ],
        isMock: true,
      });
    }
  } catch (error: any) {
    console.warn(
      "Error extracting deadlines (falling back to default):",
      error.message || error,
    );
    return res.json({
      tasks: [
        {
          title: "Extracted: Midterm Paper (Draft)",
          deadline: "2026-07-02T23:59",
          urgency: 4,
          effort: 4,
          consequence: 5,
          bufferSuggestion: "Create outline 2 days earlier",
          suggestedWhy:
            "Proves your understanding and lightens finals week load.",
        },
        {
          title: "Extracted: Homework 3",
          deadline: "2026-07-05T18:00",
          urgency: 3,
          effort: 2,
          consequence: 3,
          bufferSuggestion: "Complete 12 hours earlier",
          suggestedWhy: "Strengthens your core problem-solving foundation.",
        },
      ],
      isMock: true,
    });
  }
});

// 2. API: Autonomous Co-pilot Plan -> Act -> Observe
app.post("/api/gemini/copilot-plan", async (req, res) => {
  const { weekPrompt, calendarState, tasksState } = req.body;
  if (!weekPrompt) {
    return res.status(400).json({ error: "No prompt provided" });
  }

  try {
    const client = getGeminiClient();
    if (process.env.GEMINI_API_KEY) {
      const prompt = `You are an Autonomous Executive Function Co-pilot. The user has described their week/needs in plain language.
Your job is to run a plan -> act -> observe loop and output a detailed execution trace followed by proposed actionable operations that the user can approve.

Current User Tasks: ${JSON.stringify(tasksState || [])}
Current Calendar Schedule: ${JSON.stringify(calendarState || [])}

User's Input: "${weekPrompt}"

Analyze this context and produce a structured plan. The output schema must contain:
1. "traceSteps": A list of thoughts/tool calls representing your autonomous execution (e.g. "Step 1: Check calendar for exams on Thursday... Step 2: Spot free blocks on Tuesday afternoon...").
2. "tasksToCreate": Tasks that should be added to the database. Each task needs title, urgency, effort, consequence, suggested why.
3. "scheduleBlocks": Proposed calendar time blocks for the tasks. Each needs taskId/title, startTime (YYYY-MM-DDTHH:mm), durationMinutes, and energyLevelRequired ('high' | 'medium' | 'low').
4. "suggestedReminders": Reminders to trigger. Each has eventRef, timingInfo (e.g., 'During 3pm gap after meetings').
5. "coPilotBriefing": A short spoken summary of what you planned and why.

Output as JSON matching the schema precisely.`;

      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              traceSteps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              tasksToCreate: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    urgency: { type: Type.INTEGER },
                    effort: { type: Type.INTEGER },
                    consequence: { type: Type.INTEGER },
                    suggestedWhy: { type: Type.STRING },
                  },
                  required: [
                    "title",
                    "urgency",
                    "effort",
                    "consequence",
                    "suggestedWhy",
                  ],
                },
              },
              scheduleBlocks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    startTime: {
                      type: Type.STRING,
                      description: "YYYY-MM-DDTHH:mm",
                    },
                    durationMinutes: { type: Type.INTEGER },
                    energyLevelRequired: { type: Type.STRING },
                  },
                  required: [
                    "title",
                    "startTime",
                    "durationMinutes",
                    "energyLevelRequired",
                  ],
                },
              },
              suggestedReminders: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    triggerContext: { type: Type.STRING },
                  },
                  required: ["title", "triggerContext"],
                },
              },
              coPilotBriefing: { type: Type.STRING },
            },
            required: [
              "traceSteps",
              "tasksToCreate",
              "scheduleBlocks",
              "suggestedReminders",
              "coPilotBriefing",
            ],
          },
        },
      });

      const parsedData = JSON.parse(response.text || "{}");
      return res.json(parsedData);
    } else {
      // Return a very realistic mock plan that satisfies the trace
      return res.json({
        traceSteps: [
          "Checking calendar for gaps around deadlines...",
          "Found clear 2-hour opening on Monday 2:00 PM (energy level: high).",
          "Calculated priority scores: Consequence × Urgency reveals critical gap in Chemistry preparation.",
          "Synthesizing customized identity-based motivation triggers...",
          "Drafted recommended action items and first steps.",
        ],
        tasksToCreate: [
          {
            title: "Study Chemistry Chapter 5",
            urgency: 4,
            effort: 3,
            consequence: 4,
            suggestedWhy:
              "Ties into your long-term goal of mastering molecular science and acing pre-med.",
          },
        ],
        scheduleBlocks: [
          {
            title: "Study Chemistry Chapter 5",
            startTime: "2026-06-29T14:00",
            durationMinutes: 90,
            energyLevelRequired: "high",
          },
        ],
        suggestedReminders: [
          {
            title: "Chemistry Study Bloc",
            triggerContext:
              "Remind 15 mins before free gap, immediately after lunch",
          },
        ],
        coPilotBriefing:
          "I've structured a clear path. I spotted a high-energy slot on Monday at 2 PM to prepare for Chemistry, which is your most high-consequence subject this week.",
        isMock: true,
      });
    }
  } catch (error: any) {
    console.warn(
      "Co-pilot planning error (falling back to default):",
      error.message || error,
    );
    return res.json({
      traceSteps: [
        "Checking calendar for gaps around deadlines...",
        "Found clear 2-hour opening on Monday 2:00 PM (energy level: high).",
        "Calculated priority scores: Consequence × Urgency reveals critical gap in Chemistry preparation.",
        "Synthesizing customized identity-based motivation triggers...",
        "Drafted recommended action items and first steps.",
      ],
      tasksToCreate: [
        {
          title: "Study Chemistry Chapter 5",
          urgency: 4,
          effort: 3,
          consequence: 4,
          suggestedWhy:
            "Ties into your long-term goal of mastering molecular science and acing pre-med.",
        },
      ],
      scheduleBlocks: [
        {
          title: "Study Chemistry Chapter 5",
          startTime: "2026-06-29T14:00",
          durationMinutes: 90,
          energyLevelRequired: "high",
        },
      ],
      suggestedReminders: [
        {
          title: "Chemistry Study Bloc",
          triggerContext:
            "Remind 15 mins before free gap, immediately after lunch",
        },
      ],
      coPilotBriefing:
        "I've structured a clear path. I spotted a high-energy slot on Monday at 2 PM to prepare for Chemistry, which is your most high-consequence subject this week.",
      isMock: true,
    });
  }
});



const inMemoryMemory: Record<
  string,
  { profile: any; episodes: any[]; fcmToken?: string }
> = {};


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
      text: `${tb.durationMin}-min drive between your ${tb.fromTitle || "event"} and ${tb.toTitle || "event"} — protected that gap.`
    });
  });

  trace.push({
    role: "thought",
    text: `Autonomous co-pilot activated. Analyzing goal: "${goal}". Booting function-calling loop.`,
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
      _observeText: `checked calendar range · ${activeBlocks.length} focus block(s) found`
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
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      title,
      type: "one-off" as const,
      due: new Date(dueISO).getTime(),
      effortMin: Number(effortMin) || 30,
      stakes: Number(stakes) || 2,
      why: `Autonomous Motivation: Master the path forward for ${title}.`,
      done: false,
      when: "",
    };
    currentDb.tasks.push(task);
    actions.push({ type: "create_task", task });
    return {
      success: true,
      taskCreated: { title, dueISO, effortMin, stakes },
      _observeText: `created · "${title}"`
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
    const observeText = sorted.slice(0, 4).map((t: any, i: number) => `${i + 1}. ${t.title}`).join(" · ") || "nothing to rank";
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
      _observeText: `booked · ${title} · ${new Date(startISO).toLocaleString()}`
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
    let actionText = `Microscope 2-minute step: Open workspace/editor and create a new blank checklist for ${title}. Immediate items: 1. Setup workspace. 2. Write down 3 quick bullet points.`;
    let actionObserveText = `micro-step drafted for "${title}"`;
    
    if (googleToken && (taskType === "email" || taskType === "document")) {
      try {
        if (taskType === "email") {
          const message = `To: \r\nSubject: ${title}\r\n\r\n${content}`;
          const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
            method: "POST",
            headers: { Authorization: "Bearer " + googleToken, "Content-Type": "application/json" },
            body: JSON.stringify({ message: { raw: encodedMessage } })
          });
          if (r.ok) {
            actionText = `Your first step is already a Gmail draft waiting in your account.`;
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
            const r2 = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
              method: "POST",
              headers: { Authorization: "Bearer " + googleToken, "Content-Type": "application/json" },
              body: JSON.stringify({
                requests: [{ insertText: { location: { index: 1 }, text: content + "\n" } }]
              })
            });
            if (r2.ok) {
              actionText = `Created a Google Doc for you seeded with an outline: https://docs.google.com/document/d/${docId}/edit`;
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
      message: `Time for: ${title}`,
    });
    return {
      success: true,
      reminderSet: { title, atISO },
      _observeText: `reminder set for "${title}" at ${new Date(atISO).toLocaleTimeString()}`
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
        observeText += `\n(Sources: ${sources.join(", ")})`;
      }
      return { fact: observeText, _observeText: observeText };
    } catch (e: any) {
      return { error: e.message, _observeText: `Search failed: ${e.message}` };
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
          text: `You are an Autonomous Executive Function Co-pilot. The user has a goal: "${goal}".
Current date/time is ${new Date().toISOString()}.

User Profile (Memory):
${JSON.stringify(userProfile, null, 2)}

Recent Episodes (Past interactions):
${JSON.stringify(recentEpisodes, null, 2)}

Your job is to plan and schedule the necessary actions to accomplish the goal by calling the available tools.
If the goal is ambiguous in a way that materially changes the plan (missing deadline, unclear which of two tasks "the report" refers to, no sense of available hours), you MUST call ask_clarification to emit a special clarify trace step INSTEAD of guessing, and pause the loop.
Please run a multi-turn planning loop. Use tools to check the calendar, research facts (such as real-world deadlines or requirements), create tasks, prioritize them, schedule blocks of time for them, draft first steps, and set reminders as needed.
Important: Personalize your planning using the user's profile and historical behavior (e.g. if they tend to underestimate effort, pad the schedule).
When you are fully finished with all planning, explain the plan to the user in a brief summary.
Surface one personalized line in your final summary citing what you learned from their profile (e.g. "I noticed you historically underestimate writing tasks by ~40%, so I padded this block").`
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

    const textParts = msg.content.filter((c: any) => c.text).map((c: any) => c.text).join("\n");
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
            prompt: `You are an executive schedule critic.
Evaluate the following proposed schedule against the user's existing calendar.
Rules:
1. No proposed block overlaps a real busy event in the existing calendar.
2. Every task is scheduled to start before its latestSafeStart (based on due date and effort).
3. No day is overloaded beyond 4 deep-work hours (240 minutes) across both existing and proposed blocks.

Existing Calendar: ${JSON.stringify(originalSchedule)}
Proposed Blocks: ${JSON.stringify(proposedSchedule)}
Tasks: ${JSON.stringify(currentDb.tasks)}

If the proposed schedule violates ANY of the rules, respond with exactly "VIOLATION:" followed by a brief, clear explanation of the issue.
If it perfectly passes all rules, respond with exactly "PASS".`
          });
          const critiqueText = critiqueRes.text;
          if (critiqueText.includes("VIOLATION:")) {
            const issue = critiqueText.replace("VIOLATION:", "").trim();
            trace.push({ role: "thought", text: `Critic flagged: ${issue}` });
            messages.push({
              role: "user",
              content: [{ text: `CRITIC FEEDBACK: The draft plan violates scheduling rules:\n${issue}\n\nPlease correct the plan using the available tools (e.g., reschedule blocks) and finish.` }]
            });
            continue;
          }
        }
      }
      break;
    }

    const toolResponsesContent = [];
    for (const req of toolRequests) {
      trace.push({ role: "tool", tool: req.name, args: req.input, text: `Calling tool: ${req.name} with inputs ${JSON.stringify(req.input)}` });
      
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
    finalSummary = lastMsg.content.filter((c: any) => c.text).map((c: any) => c.text).join("\n");
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
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("PERMISSION_DENIED") || msg.includes("disabled") || msg.includes("not been used") || msg.includes("DATABASE_NOT_FOUND")) {
          console.warn("Firestore API is disabled or not used yet. Auto-downgrading to in-memory mode for this run.", msg);
          dbFirestore = null;
        } else {
          console.warn("Firestore read failed", e);
        }
        const mem = inMemoryMemory[uid] || { profile: {}, episodes: [] };
        userProfile = { ...userProfile, ...mem.profile };
        recentEpisodes = mem.episodes.slice(0, 5);
      }
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

app.post("/api/memory/task-update", async (req, res) => {
  const { uid, task, status } = req.body;
  if (!uid || !task)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    const client = getGeminiClient();

    // fetch current profile
    let currentProfile: any = {};
    if (dbFirestore) {
      try {
        const doc = await dbFirestore
          .collection("users")
          .doc(uid)
          .collection("profile")
          .doc("main")
          .get();
        if (doc.exists) currentProfile = doc.data();
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("PERMISSION_DENIED") || msg.includes("disabled") || msg.includes("not been used") || msg.includes("DATABASE_NOT_FOUND")) {
          console.warn("Firestore is not enabled or permission is denied on profile read. Auto-falling back to in-memory mode.", msg);
          dbFirestore = null;
        } else {
          console.warn("Firestore profile read failed:", e);
        }
        currentProfile = inMemoryMemory[uid]?.profile || {};
      }
    } else {
      currentProfile = inMemoryMemory[uid]?.profile || {};
    }

    const prompt = `You are a learning mechanism for an executive function co-pilot.
The user just ${status === "completed" ? "completed" : "missed"} a task.
Task: ${JSON.stringify(task)}
Current Profile: ${JSON.stringify(currentProfile)}

Provide a small running adjustment to their profile (e.g., noting if they overestimate/underestimate effort, struggle with certain types of tasks, or excel at others) based on this event.
Return a JSON object matching this schema:
{
  "preferredWorkHours": "string",
  "effortEstimation": "string",
  "slipDays": "string",
  "adjustments": ["string"] // Keep the last 5 adjustments
}`;

    if (process.env.GEMINI_API_KEY) {
      const response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const newProfileText =
        response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (newProfileText) {
        const newProfile = JSON.parse(newProfileText);
        if (dbFirestore) {
          try {
            await dbFirestore
              .collection("users")
              .doc(uid)
              .collection("profile")
              .doc("main")
              .set(newProfile, { merge: true });
          } catch (e: any) {
            const msg = e.message || String(e);
            if (msg.includes("PERMISSION_DENIED") || msg.includes("disabled") || msg.includes("not been used") || msg.includes("DATABASE_NOT_FOUND")) {
              console.warn("Firestore is not enabled or permission is denied on profile write. Auto-falling back to in-memory mode.", msg);
              dbFirestore = null;
            } else {
              console.warn("Firestore profile write failed:", e);
            }
            if (!inMemoryMemory[uid])
              inMemoryMemory[uid] = { profile: {}, episodes: [] };
            inMemoryMemory[uid].profile = { ...currentProfile, ...newProfile };
          }
        } else {
          if (!inMemoryMemory[uid])
            inMemoryMemory[uid] = { profile: {}, episodes: [] };
          inMemoryMemory[uid].profile = { ...currentProfile, ...newProfile };
        }
      }
    }
    return res.json({ success: true });
  } catch (e) {
    console.error("Error in task-update:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// 2.7 API: Multimodal task extraction
app.post("/api/gemini/extract-tasks", async (req, res) => {
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ error: "Missing imageBase64 or mimeType" });
  }
  try {
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            data: imageBase64,
            mimeType,
          },
        },
        "Extract all tasks, assignments, or action items from this document. Estimate effort in minutes, and rate stakes from 1 to 3.",
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              dueISO: {
                type: Type.STRING,
                description: "ISO string format for due date, if mentioned",
              },
              effortMin: { type: Type.INTEGER },
              stakes: {
                type: Type.INTEGER,
                description: "1 (low) to 3 (high)",
              },
            },
            required: ["title", "effortMin", "stakes"],
          },
        },
      },
    });

    const tasksText = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (tasksText) {
      const tasks = JSON.parse(tasksText);
      return res.json({ tasks });
    }
    return res.json({ tasks: [] });
  } catch (e: any) {
    console.error("Extraction error:", e);
    return res.status(500).json({ error: e.message || "Extraction failed" });
  }
});

// 3. API: Generate Motivation Tag suggestion
app.post("/api/gemini/suggest-motivation", async (req, res) => {
  const { title, nudgeStyle } = req.body;
  try {
    const client = getGeminiClient();
    const style = nudgeStyle || "balanced"; // aggressive, gentle, analytical, balanced
    const prompt = `Give a single sentence, powerful, psychologically-proven motivational "why" statement for the task: "${title}".
Style: ${style}. 
Keep it brief (max 15 words) and highly personalized, framing it as an identity-based gain (e.g. "Because you are a disciplined builder" or "To prove your resilience on tough tasks"). No quotes, just the clean sentence.`;

    let text =
      "To elevate your personal standards and clear space for peaceful relaxation.";
    if (process.env.GEMINI_API_KEY) {
      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });
      text = response.text?.trim() || text;
    }
    return res.json({ motivation: text });
  } catch (err: any) {
    return res.json({
      motivation:
        "To free your mind from procrastination and protect your future self.",
    });
  }
});

// 4. API: Voice check-in / Prioritized Audio Briefing
app.post("/api/gemini/voice-briefing", async (req, res) => {
  const { tasks, calendar, nudgeStyle } = req.body;
  try {
    const client = getGeminiClient();
    const prompt = `You are a high-performance productivity coach. Analyze these tasks: ${JSON.stringify(tasks || [])} and calendar events: ${JSON.stringify(calendar || [])}.
Generate a spoken briefing (100-150 words) that the user will listen to first thing in the morning.
Tone: ${nudgeStyle || "supportive but highly direct"}.
It must:
1. Address them warmly and dynamically.
2. Outline the absolute highest priority tasks based on Consequence × Urgency.
3. Call out their "why" tags to remind them of their purpose.
4. Highlight critical scheduled blocks and the latest-possible-time alert warning.
Keep it punchy, conversational, and deeply motivating.`;

    let briefingText =
      "Good morning! Let's conquer today. Your primary target is preparing for your upcoming review, which has a massive impact. Your scheduled block is at 2 PM. Remember your 'why': to build a life of complete creative freedom. You've got this.";
    if (process.env.GEMINI_API_KEY) {
      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });
      briefingText = response.text || briefingText;
    }
    return res.json({ text: briefingText });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. API: Auto-draft first step / checklist
app.post("/api/gemini/generate-first-step", async (req, res) => {
  const { title, why } = req.body;
  const fallbackData = {
    microStep:
      "Open your workspace, open the relevant folder, and create a single blank document named 'Draft'",
    checklist: [
      "Write down 3 bullet points of core ideas",
      "Set a timer for 10 minutes of uninterrupted typing",
      "Skim your reference material for exactly 2 minutes",
    ],
    starterTemplate: `# ${title || "Draft"}\n\n- Core objective:\n- Key argument / solution:\n- Initial thoughts:\n  1. [Insert first raw thought here]\n  2. [Insert second idea here]\n\nLet's keep momentum high!`,
  };
  try {
    const client = getGeminiClient();
    const prompt = `For the task "${title}" (Motivation: "${why || "unspecified"}"), generate a low-friction, high-velocity "first-step" checklist and half-written start outline. 
We want to reduce the blank-page effect. Return:
1. A single microscopic first step (taking under 2 minutes, e.g. "Open Google Docs and type the title")
2. A 3-step immediate momentum checklist
3. A half-written starter template (e.g., an outline, introduction hook, or reply shell) to fill in.

Output as JSON matching this schema:
{
  "microStep": "string",
  "checklist": ["string"],
  "starterTemplate": "string"
}`;

    if (process.env.GEMINI_API_KEY) {
      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              microStep: { type: Type.STRING },
              checklist: { type: Type.ARRAY, items: { type: Type.STRING } },
              starterTemplate: { type: Type.STRING },
            },
            required: ["microStep", "checklist", "starterTemplate"],
          },
        },
      });
      const data = JSON.parse(response.text || "{}");
      return res.json(data);
    }
    return res.json(fallbackData);
  } catch (err: any) {
    console.warn(
      "First-step generator error (falling back to default):",
      err.message || err,
    );
    return res.json(fallbackData);
  }
});

// 6. API: Rescue Mode generator
app.post("/api/gemini/rescue-mode", async (req, res) => {
  const { title, why } = req.body;
  const fallbackData = {
    mvpScope:
      "Draft a 3-bullet executive summary and submit it now, saving detailed research for the review session.",
    speedSteps: [
      "Open a notepad, type out the 3 most critical points immediately",
      "Format as clear bullets with zero fluff",
      "Hit submit/send right now without editing",
    ],
    crisisMotivation:
      "Done is better than perfect. A minimum viable version keeps your streak alive, honors your efforts, and completely prevents zero-scores. Ship it now!",
  };
  try {
    const client = getGeminiClient();
    const prompt = `CRITICAL RESCUE MODE: The task "${title}" is about to miss its deadline. Generate a "minimum viable version" of this task that STILL counts and takes under 15 minutes to execute.
Return:
1. "mvpScope": What is the absolute bare minimum that preserves 80% of the value? (e.g., "Submit a 1-page summary instead of a full essay", "Send a 3-bullet point email update")
2. "speedSteps": A rapid, hyper-focused checklist to get it out the door.
3. "crisisMotivation": A comforting but firm motivational nudge to bypass guilt and just ship it.

Output as JSON:
{
  "mvpScope": "string",
  "speedSteps": ["string"],
  "crisisMotivation": "string"
}`;

    if (process.env.GEMINI_API_KEY) {
      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mvpScope: { type: Type.STRING },
              speedSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
              crisisMotivation: { type: Type.STRING },
            },
            required: ["mvpScope", "speedSteps", "crisisMotivation"],
          },
        },
      });
      const data = JSON.parse(response.text || "{}");
      return res.json(data);
    }
    return res.json(fallbackData);
  } catch (err: any) {
    console.warn(
      "Rescue-mode generator error (falling back to default):",
      err.message || err,
    );
    return res.json(fallbackData);
  }
});

// 7. API: Generate story based on genre
app.post("/api/gemini/generate-story", async (req, res) => {
  const { goal, tasks, genre } = req.body;
  const gStyle = genre || "Fantasy";

  const getFallback = () => {
    const titlesByGenre: Record<string, string[]> = {
      Fantasy: [
        "The Day’s Reckoning",
        "Quest for the Summit",
        "The Hours Ahead",
        "Trials of the Sun",
        "The Long Climb Home",
      ],
      "Sci-Fi": [
        "System Hack Sequence",
        "Mainframe Ascension",
        "The Quantum Horizon",
        "Trials of the Grid",
        "The Long Hyperjump Home",
      ],
      Noir: [
        "The Midnight Casebook",
        "Clues in the Rain",
        "The Shadowy Informant",
        "Interrogation Under Light",
        "Case Closed at Dawn",
      ],
      Cozy: [
        "A Warm Morning Brew",
        "Garden Weeding Quest",
        "Baking the Daily Loaf",
        "Gathering Wildflowers",
        "Warm Hearth Gathering",
      ],
    };
    const beatsByGenre: Record<string, Array<(t: string) => string>> = {
      Fantasy: [
        (t: string) =>
          `First you face “${t}” — the gate that guards everything beyond it.`,
        (t: string) =>
          `“${t}” waits in the mist; clear it and the path widens.`,
        (t: string) =>
          `The trial of “${t}” tests your resolve — strike while the will burns hot.`,
        (t: string) =>
          `“${t}” is a river to cross; one focused push and you stand on the far bank.`,
        (t: string) => `Conquer “${t}” and the whole day tilts in your favour.`,
        (t: string) =>
          `“${t}” is the quiet boss of the afternoon — meet it before it grows.`,
      ],
      "Sci-Fi": [
        (t: string) =>
          `Initiate “${t}” — bypass the peripheral security firewall.`,
        (t: string) =>
          `The code block for “${t}” is compiling; run optimization protocols.`,
        (t: string) =>
          `Patch “${t}” into the core database before the subnet resets.`,
        (t: string) =>
          `Synchronizing “${t}” with the uplink terminal — maintain signal strength.`,
        (t: string) =>
          `Execute “${t}” script to finalize the system restoration.`,
        (t: string) =>
          `“${t}” is a background daemon script — analyze logs before it blocks the queue.`,
      ],
      Noir: [
        (t: string) =>
          `Open the file on “${t}” — this lead is too hot to ignore.`,
        (t: string) =>
          `Tracking down “${t}” through the wet pavement of third street.`,
        (t: string) =>
          `Sifting through the details of “${t}” under a flickering desk lamp.`,
        (t: string) =>
          `Shaking down the suspects for “${t}” before the chief calls time.`,
        (t: string) =>
          `Put “${t}” to bed and the case starts looking solvable.`,
        (t: string) =>
          `“${t}” is a loose end that could blow the whole investigation open.`,
      ],
      Cozy: [
        (t: string) =>
          `Stir the cauldron for “${t}” while the morning sun warms the cottage.`,
        (t: string) =>
          `Plucking the weeds of “${t}” to make space for fresh sweetberries.`,
        (t: string) =>
          `Kneading “${t}” with care; let it rise beside the open window.`,
        (t: string) =>
          `Delivering “${t}” to the friendly town blacksmith down the lane.`,
        (t: string) =>
          `Tuck “${t}” onto the pantry shelf with a satisfied smile.`,
        (t: string) =>
          `“${t}” is a gentle task best shared with a warm cup of chamomile tea.`,
      ],
    };

    const genreTitles = titlesByGenre[gStyle] || titlesByGenre["Fantasy"];
    const genreBeats = beatsByGenre[gStyle] || beatsByGenre["Fantasy"];
    const introsByGenre: Record<string, string> = {
      Fantasy: `Every ordinary day is a quest in disguise. ${goal ? `“${goal}” is your summit` : "Your summit waits at dusk"} — and these are the trials between you and it.`,
      "Sci-Fi": `Your mechanical augmentation suite has registered a daily protocol array. ${goal ? `“${goal}” is the mainframe uplink` : "Your core synchronizer is online"} — initiate sequence.`,
      Noir: `The rain hasn't stopped, and the desk is piled high. ${goal ? `“${goal}” is the main case` : "The big mystery is waiting to be solved"} — time to hit the pavement.`,
      Cozy: `A brand new day begins in the quiet valley village. ${goal ? `“${goal}” is your grand festival prep` : "A peaceful, productive day lies ahead"} — let's enjoy the simple chores.`,
    };

    return {
      title: genreTitles[Math.floor(Math.random() * genreTitles.length)],
      intro:
        introsByGenre[gStyle] +
        ` Move through them, and the story bends toward you.`,
      chapters: (tasks || [])
        .slice(0, 8)
        .map((t: string, i: number) => ({
          task: t,
          line: genreBeats[i % genreBeats.length](t),
        })),
      woven: Date.now(),
      genre: gStyle,
    };
  };

  try {
    const client = getGeminiClient();
    if (process.env.GEMINI_API_KEY) {
      const prompt = `You are a professional creative narrator/chronicler.
Generate an interactive story/quest outline based on the user's custom story/theme prompt or focus goal and daily tasks.
User's Story Prompt / Goal: "${goal || "Success"}"
Tasks: ${JSON.stringify(tasks || [])}
Current Preset Genre Suggestion: "${gStyle}"

Create:
1. "title": A matching, highly thematic title for the quest that perfectly fits the user's custom prompt/goal or focus.
2. "intro": A short thematic introduction story paragraph (under 80 words) describing the custom setting and how the goal is the ultimate prize or core objective.
3. "genre": A custom, highly descriptive name of the genre or theme (e.g. "Space Western", "Cyberpunk Heist", "Victorian Mystery", "Cozy Cottage Witch", "Apocalypse Survival", etc.) that matches the user's focus/prompt. Do NOT limit yourself to standard categories — you can name ANY custom genre or subgenre that fits perfectly.
4. "chapters": An array of objects, one for each task in order. Each object must have:
   - "task": The exact original task title
   - "line": A highly atmospheric narrative sentence framing this specific task as a trial, hack, lead, cozy chore, or equivalent matching the custom genre. Include the task title naturally but make the wording deeply stylized to the custom genre.

Output as JSON matching this schema:
{
  "title": "string",
  "intro": "string",
  "genre": "string",
  "chapters": [
    { "task": "string", "line": "string" }
  ]
}
`;

      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              intro: { type: Type.STRING },
              genre: {
                type: Type.STRING,
                description:
                  "A custom, descriptive, creative genre or sub-genre name matching the story (e.g. 'Cyberpunk Noir', 'Elven Tea Shop', 'Steampunk Space Flight')",
              },
              chapters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    task: { type: Type.STRING },
                    line: { type: Type.STRING },
                  },
                  required: ["task", "line"],
                },
              },
            },
            required: ["title", "intro", "genre", "chapters"],
          },
        },
      });

      const parsedData = JSON.parse(response.text || "{}");
      return res.json(parsedData);
    } else {
      return res.json(getFallback());
    }
  } catch (error: any) {
    console.warn(
      "Story generation error (falling back to default):",
      error.message || error,
    );
    return res.json(getFallback());
  }
});

app.post("/api/gemini/travel-gaps", async (req, res) => {
  const { blocks } = req.body;
  if (!blocks || !Array.isArray(blocks)) return res.json({ blocks: [] });

  const mapsKey = process.env.GOOGLE_MAPS_PLATFORM_KEY;
  if (!mapsKey) {
    return res.json({ blocks }); // fallback
  }

  const enriched = [...blocks];
  const sorted = blocks.filter(b => b.startISO).sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));

  const travelBlocks = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const nxt = sorted[i+1];
    
    if (cur.location && nxt.location && cur.location !== nxt.location) {
      try {
        const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
          method: "POST",
          headers: {
            "X-Goog-Api-Key": mapsKey,
            "X-Goog-FieldMask": "routes.duration",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            origin: { address: cur.location },
            destination: { address: nxt.location },
            travelMode: "DRIVING"
          })
        });
        if (r.ok) {
          const data = await r.json();
          const durationStr = data.routes?.[0]?.duration;
          if (durationStr) {
            const seconds = parseInt(durationStr.replace("s", ""), 10);
            const durationMin = Math.ceil(seconds / 60);
            
            // Block is immediately preceding the next event
            const end = new Date(Date.parse(nxt.startISO));
            const start = new Date(end.getTime() - durationMin * 60e3);
            
            travelBlocks.push({
              title: `Travel to ${nxt.title || "next event"}`,
              startISO: start.toISOString(),
              durationMin: durationMin,
              location: "Transit",
              fromTitle: cur.title,
              toTitle: nxt.title
            });
          }
        }
      } catch(e) {
        console.warn("Maps Routes API error:", e);
      }
    }
  }

  return res.json({ blocks: [...enriched, ...travelBlocks] });
});

// Serve config to client
app.get("/api/config", (req, res) => {
  const payload: any = {
    gemini: !!process.env.GEMINI_API_KEY,
    cloudRun: !!process.env.K_SERVICE || true // True if the server is up
  };
  try {
    const fs = require("fs");
    if (
      fs.existsSync(path.join(process.cwd(), "firebase-applet-config.json"))
    ) {
      const fbConfig = JSON.parse(
        fs.readFileSync(
          path.join(process.cwd(), "firebase-applet-config.json"),
          "utf8",
        ),
      );
      payload.firebase = fbConfig;
    }
  } catch (e) {}
  res.json(payload);
});

// Set FCM Token
app.post("/api/memory/fcm-token", async (req, res) => {
  const { uid, token } = req.body;
  if (!uid || !token) return res.status(400).json({ error: "Missing fields" });
  if (dbFirestore) {
    try {
      await dbFirestore
        .collection("users")
        .doc(uid)
        .set({ fcmToken: token }, { merge: true });
    } catch (e: any) {
      const msg = e.message || String(e);
      if (msg.includes("PERMISSION_DENIED") || msg.includes("disabled") || msg.includes("not been used") || msg.includes("DATABASE_NOT_FOUND")) {
        console.warn("Firestore is not enabled or permission is denied on fcm-token. Auto-falling back to in-memory mode.", msg);
        dbFirestore = null;
      } else {
        console.warn("Firestore fcm-token write failed:", e);
      }
      if (!inMemoryMemory[uid])
        inMemoryMemory[uid] = { profile: {}, episodes: [] };
      inMemoryMemory[uid].fcmToken = token;
    }
  } else {
    if (!inMemoryMemory[uid])
      inMemoryMemory[uid] = { profile: {}, episodes: [] };
    inMemoryMemory[uid].fcmToken = token;
  }
  res.json({ success: true });
});

// Schedule Reminder
app.post("/api/reminders/schedule", async (req, res) => {
  const { uid, title, message, atISO } = req.body;
  if (!uid || !title || !atISO)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const targetTimeMs = new Date(atISO).getTime();
    if (isNaN(targetTimeMs)) throw new Error("Invalid atISO date");

    // In a real app we'd construct a Cloud Task with @google-cloud/tasks.
    // We'll try to use the SDK if project ID is available, else mock it in memory for the preview.
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    if (projectId) {
      // Cloud tasks implementation (assume a queue named "reminders" in "us-central1")
      const queuePath = tasksClient.queuePath(
        projectId,
        process.env.GCP_LOCATION || "us-central1",
        process.env.TASK_QUEUE || "reminders",
      );
      const url =
        (process.env.PUBLIC_URL || "https://ai.studio") + "/api/reminders/send";
      const payload = { uid, title, message };

      const task = {
        httpRequest: {
          httpMethod: "POST" as const,
          url,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify(payload)).toString("base64"),
        },
        scheduleTime: { seconds: Math.floor(targetTimeMs / 1000) },
      };
      await tasksClient.createTask({ parent: queuePath, task });
      return res.json({ success: true, method: "cloud-tasks" });
    } else {
      // Fallback: mock setTimeout for the preview environment
      const delay = Math.max(0, targetTimeMs - Date.now());
      setTimeout(async () => {
        try {
          let token = "";
          if (dbFirestore) {
            try {
              const doc = await dbFirestore.collection("users").doc(uid).get();
              if (doc.exists) token = doc.data()?.fcmToken;
            } catch (e: any) {
              const msg = e.message || String(e);
              if (msg.includes("PERMISSION_DENIED") || msg.includes("disabled") || msg.includes("not been used") || msg.includes("DATABASE_NOT_FOUND")) {
                console.warn("Firestore is disabled or permission is denied on timeout read. Auto-falling back to in-memory mode.", msg);
                dbFirestore = null;
              }
              token = inMemoryMemory[uid]?.fcmToken || "";
            }
          } else {
            token = inMemoryMemory[uid]?.fcmToken || "";
          }
          if (token && getApps().length > 0) {
            await getMessaging().send({
              token,
              notification: {
                title: title || "Reminder",
                body: message || "Time for your task.",
              },
            });
          }
        } catch (e) {
          console.warn("Mock task push failed", e);
        }
      }, delay);
      return res.json({ success: true, method: "mock-timeout" });
    }
  } catch (e: any) {
    console.error("Reminder schedule error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// Webhook for Cloud Tasks to trigger FCM
app.post("/api/reminders/send", async (req, res) => {
  const { uid, title, message } = req.body;
  if (!uid || !title) return res.status(400).json({ error: "Missing fields" });

  try {
    let token = "";
    if (dbFirestore) {
      try {
        const doc = await dbFirestore.collection("users").doc(uid).get();
        if (doc.exists) token = doc.data()?.fcmToken;
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("PERMISSION_DENIED") || msg.includes("disabled") || msg.includes("not been used") || msg.includes("DATABASE_NOT_FOUND")) {
          console.warn("Firestore is disabled or permission is denied on webhook read. Auto-falling back to in-memory mode.", msg);
          dbFirestore = null;
        }
        token = inMemoryMemory[uid]?.fcmToken || "";
      }
    } else {
      token = inMemoryMemory[uid]?.fcmToken || "";
    }

    if (!token) return res.status(404).json({ error: "No FCM token for user" });

    if (getApps().length > 0) {
      await getMessaging().send({
        token,
        notification: { title, body: message || "Time for your task." },
      });
      return res.json({ success: true });
    } else {
      return res.status(500).json({ error: "Firebase apps not initialized" });
    }
  } catch (e: any) {
    console.error("FCM send error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// Serve frontend build static files in production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
