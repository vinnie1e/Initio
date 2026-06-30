import fs from 'fs';

const lines = fs.readFileSync('server.ts', 'utf8').split('\n');

// 1. Setup (lines 0 to 60)
// Need to remove duplicate aiGenkit and imports
const setupLines = lines.slice(0, 61);

// 2. extract-deadlines and copilot-plan (lines 61 to 385)
const part1 = lines.slice(61, 386);

// 3. The REST of the file AFTER the agent loop
const memoryTaskUpdateStart = lines.findIndex(l => l.includes('app.post("/api/memory/task-update"'));
const part2 = lines.slice(memoryTaskUpdateStart);

// Write to clean-server.ts
fs.writeFileSync('clean-server.ts', setupLines.join('\n') + '\n' + part1.join('\n') + '\n\n' + part2.join('\n'));
