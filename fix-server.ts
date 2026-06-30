import fs from 'fs';

const lines = fs.readFileSync('server.ts', 'utf8').split('\n');
const duplicateStart = lines.findIndex((l, i) => i > 0 && l.startsWith('import express from "express"'));
if (duplicateStart > 0) {
  // We have the original file starting at `duplicateStart`!
  const originalLines = lines.slice(duplicateStart);
  const content = originalLines.join('\n');
  
  // Find agent loop start
  const agentStart = content.indexOf('app.post("/api/agent"');
  
  // Find where agent loop ends. It ends right before app.post("/api/gemini/extract-deadlines")
  const agentEnd = content.indexOf('app.post("/api/gemini/extract-deadlines"');
  
  const originalAgent = content.substring(agentStart, agentEnd);
  
  // The Genkit replacement:
  const newAgent = fs.readFileSync('draft-agent-flow.ts', 'utf8');
  
  const newContent = content.substring(0, agentStart) + '\n\n' + newAgent + '\n\n' + content.substring(agentEnd);
  
  // Also we need to ensure genkit is imported at the top of the file!
  const finalLines = newContent.split('\n');
  finalLines.splice(4, 0, 'import { genkit, z } from "genkit";', 'import { googleAI } from "@genkit-ai/googleai";');
  
  // Insert aiGenkit initialization after dotenv.config()
  const dotenvIdx = finalLines.findIndex(l => l.includes('dotenv.config()'));
  finalLines.splice(dotenvIdx + 1, 0, '\nexport const aiGenkit = genkit({ plugins: [googleAI()] });\n');
  
  fs.writeFileSync('server.ts', finalLines.join('\n'));
  console.log("Restored and replaced!");
} else {
  console.log("Duplicate not found");
}
