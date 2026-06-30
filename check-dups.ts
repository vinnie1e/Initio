import fs from 'fs';
const lines = fs.readFileSync('server.ts', 'utf8').split('\n');
console.log("387:", lines[386]);
console.log("992:", lines[991]);
