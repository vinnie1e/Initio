import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';

export const aiGenkit = genkit({ plugins: [googleAI()] });

export const agentFlow = aiGenkit.defineFlow({
  name: 'agentFlow',
  inputSchema: z.object({
    goal: z.string(),
  }),
}, async (input) => {
  const t = aiGenkit.dynamicTool({
    name: 'test',
    description: 'test',
    inputSchema: z.object({ x: z.string() })
  }, async (args) => {
    return { ok: true, arg: args.x, db: input.goal };
  });

  const res = await aiGenkit.generate({
    model: 'googleai/gemini-2.5-flash',
    prompt: 'Use test tool with "world"',
    tools: [t],
    returnToolRequests: true
  });
  return res.message;
});

async function run() {
  const result = await agentFlow({ goal: 'test goal' });
  console.log(JSON.stringify(result, null, 2));
}
run().catch(console.error);
