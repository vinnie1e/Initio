import fs from 'fs';

const content = fs.readFileSync('server.ts', 'utf8');
const lines = content.split('\n');

const cleaned = lines.filter((l, i) => {
  // Check for duplicate genkit imports
  if (l.includes('import { genkit, z } from "genkit";')) {
    return lines.findIndex(x => x.includes('import { genkit, z } from "genkit";')) === i;
  }
  if (l.includes('import { googleAI } from "@genkit-ai/googleai";')) {
    return lines.findIndex(x => x.includes('import { googleAI } from "@genkit-ai/googleai";')) === i;
  }
  if (l.includes('import { z } from \'genkit\';')) {
    return false; // we already have { genkit, z }
  }
  return true;
});

fs.writeFileSync('server.ts', cleaned.join('\n'));
