import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseAiEvaluationDataset } from '../src/modules/ai/ai-evaluation-dataset';
import { scoreAiEvaluation } from '../src/modules/ai/ai-evaluation';

async function main() {
  const inputPath = path.resolve(
    process.argv[2] ?? 'tests/fixtures/ai-evaluation/synthetic-evaluation.json',
  );
  const input = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  const dataset = parseAiEvaluationDataset(input);
  const report = {
    provenance: dataset.provenance,
    interpretation: 'Synthetic fixture metrics only; these are not OpenAI model measurements.',
    metrics: scoreAiEvaluation(dataset.samples),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Invalid AI evaluation dataset';
  process.stderr.write(`AI_EVALUATION_FAILED ${message}\n`);
  process.exitCode = 1;
});
