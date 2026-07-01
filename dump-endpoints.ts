import fs from 'fs';

const content = fs.readFileSync('server.ts', 'utf8');
const lines = content.split('\n');
const endpoints = lines.map((l, i) => l.includes('app.post(') ? `${i+1}: ${l.trim()}` : null).filter(Boolean);
console.log(endpoints.join('\n'));
