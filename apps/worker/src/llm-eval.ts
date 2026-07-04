// T-050: CLI evaluasi provider LLM (DeepSeek vs GLM) terhadap 20 golden prompt.
// Jalankan: pnpm --filter @digimaestro/worker eval:llm
// Butuh env: DEEPSEEK_API_KEY dan/atau GLM_API_KEY (lihat decision.md §5).
// Harga token per 1M adalah APPROKSIMASI — verifikasi ke pricing provider terbaru sebelum putus.

import {
  runLlmEvaluation,
  summarizeLlmEvaluationRun,
  type LlmEvaluationProviderFactory,
} from '@digimaestro/core';
import { createDeepSeekJsonAdapter, createGlmJsonAdapter } from '@digimaestro/adapters';

async function main(): Promise<void> {
  const providers: LlmEvaluationProviderFactory[] = [];

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && deepseekKey.length > 0) {
    providers.push({
      name: 'deepseek',
      createPort: (logger) =>
        createDeepSeekJsonAdapter({
          apiKey: deepseekKey,
          model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
          usageLogger: logger,
          inputTokenCostPer1M: 0.27,
          outputTokenCostPer1M: 1.1,
        }),
    });
  }

  const glmKey = process.env.GLM_API_KEY;
  if (glmKey && glmKey.length > 0) {
    providers.push({
      name: 'glm',
      createPort: (logger) =>
        createGlmJsonAdapter({
          apiKey: glmKey,
          model: process.env.GLM_MODEL ?? 'glm-4.5',
          usageLogger: logger,
          inputTokenCostPer1M: 0.5,
          outputTokenCostPer1M: 1.5,
        }),
    });
  }

  if (providers.length === 0) {
    console.error('Tidak ada provider terkonfigurasi. Set DEEPSEEK_API_KEY dan/atau GLM_API_KEY.');
    process.exitCode = 1;
    return;
  }

  console.log(`Menjalankan evaluasi dengan ${providers.length} provider: ${providers.map((p) => p.name).join(', ')} ...`);
  const run = await runLlmEvaluation(providers);
  const report = summarizeLlmEvaluationRun(run);

  console.log('\n=== Ringkasan Provider ===');
  for (const score of report.scores) {
    console.log(
      `${score.provider.padEnd(12)} pass=${(score.passRate * 100).toFixed(0)}%  ` +
        `quality=${score.averageQuality.toFixed(2)}  cost=$${score.totalCostUsd.toFixed(4)}  ` +
        `latency=${score.averageLatencyMs.toFixed(0)}ms  score=${score.score.toFixed(3)}`,
    );
  }
  console.log(`\nRekomendasi default: ${report.recommendedProvider || '(belum ada data)'}`);

  if (run.failures.length > 0) {
    console.log(`\n${run.failures.length} kegagalan:`);
    for (const failure of run.failures) {
      console.log(`  [${failure.provider}] ${failure.promptId}: ${failure.error}`);
    }
  }
}

void main();
