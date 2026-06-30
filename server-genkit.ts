import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/googleai";

export const ai = genkit({
  plugins: [googleAI()],
});

export const checkCalendarTool = ai.defineTool({
  name: "check_calendar",
  description: "Check the calendar/schedule for occupied blocks and active events in a given date/time range.",
  inputSchema: z.object({
    fromISO: z.string().describe("ISO 8601 start date-time string (e.g., '2026-06-30T10:00:00Z')."),
    toISO: z.string().describe("ISO 8601 end date-time string (e.g., '2026-07-07T10:00:00Z')."),
  })
}, async (input) => {
  // We'll handle this in the flow or via context if it needs external state.
  return {};
});
