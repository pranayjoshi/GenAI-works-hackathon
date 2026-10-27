/** Recompute scores for a saved backtest file from its per-test results (no model calls). Usage: npx tsx scripts/rescore-backtest.ts <file.json> */
import fs from 'node:fs';
import { summarize } from '../src/backtest/run.js';

const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const s = summarize(j.tests);
j.scores = s.scores;
j.mcnemar = s.mcnemar;
fs.writeFileSync(file, JSON.stringify(j, null, 2));
console.log(JSON.stringify({ scores: s.scores, mcnemar: s.mcnemar }, null, 1));
process.exit(0);
