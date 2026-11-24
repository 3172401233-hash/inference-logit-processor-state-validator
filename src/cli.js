import { readFile } from 'node:fs/promises';
import { BatchEngine } from './engine.js';

const scenarioPath = process.argv[2];
if (!scenarioPath) {
  console.error('用法: node src/cli.js <scenario.json>');
  process.exit(1);
}

const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
const engine = new BatchEngine({
  vocabSize: scenario.vocabSize ?? 32,
  seed: scenario.seed ?? 42,
});
const report = engine.run(scenario);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
