// T-050: pure domain helper untuk membandingkan provider LLM dari golden prompt.
// Tidak memanggil jaringan dan tidak tahu vendor SDK; input berasal dari runner/eval terpisah.

export interface LlmPromptEvaluation {
  readonly promptId: string;
  readonly provider: string;
  readonly passed: boolean;
  readonly qualityScore: number;
  readonly latencyMs: number;
  readonly estimatedCostUsd: number;
}

export interface LlmProviderScore {
  readonly provider: string;
  readonly promptCount: number;
  readonly passRate: number;
  readonly averageQuality: number;
  readonly averageLatencyMs: number;
  readonly totalCostUsd: number;
  readonly score: number;
}

export interface LlmProviderRecommendation {
  readonly recommendedProvider: string;
  readonly scores: readonly LlmProviderScore[];
}

export interface LlmProviderEvaluationWeights {
  readonly quality: number;
  readonly passRate: number;
  readonly cost: number;
  readonly latency: number;
}

const DEFAULT_WEIGHTS: LlmProviderEvaluationWeights = {
  quality: 0.45,
  passRate: 0.35,
  cost: 0.15,
  latency: 0.05,
};

export function recommendLlmProvider(
  evaluations: readonly LlmPromptEvaluation[],
  weights: LlmProviderEvaluationWeights = DEFAULT_WEIGHTS,
): LlmProviderRecommendation {
  const groups = groupByProvider(evaluations);
  const rawScores = Array.from(groups.entries()).map(([provider, rows]) =>
    summarizeProvider(provider, rows),
  );
  const maxCost = Math.max(...rawScores.map((row) => row.totalCostUsd), 0);
  const maxLatency = Math.max(...rawScores.map((row) => row.averageLatencyMs), 0);
  const scores = rawScores
    .map((row) => ({
      ...row,
      score: providerScore(row, weights, maxCost, maxLatency),
    }))
    .sort((a, b) => b.score - a.score || a.totalCostUsd - b.totalCostUsd || a.provider.localeCompare(b.provider));

  return {
    recommendedProvider: scores[0]?.provider ?? '',
    scores,
  };
}

function groupByProvider(
  evaluations: readonly LlmPromptEvaluation[],
): Map<string, LlmPromptEvaluation[]> {
  const groups = new Map<string, LlmPromptEvaluation[]>();
  for (const item of evaluations) {
    const list = groups.get(item.provider) ?? [];
    list.push(item);
    groups.set(item.provider, list);
  }
  return groups;
}

function summarizeProvider(
  provider: string,
  evaluations: readonly LlmPromptEvaluation[],
): Omit<LlmProviderScore, 'score'> {
  const promptCount = evaluations.length;
  const passCount = evaluations.filter((item) => item.passed).length;
  return {
    provider,
    promptCount,
    passRate: promptCount === 0 ? 0 : passCount / promptCount,
    averageQuality: average(evaluations.map((item) => clamp01(item.qualityScore))),
    averageLatencyMs: average(evaluations.map((item) => item.latencyMs)),
    totalCostUsd: evaluations.reduce((sum, item) => sum + item.estimatedCostUsd, 0),
  };
}

function providerScore(
  row: Omit<LlmProviderScore, 'score'>,
  weights: LlmProviderEvaluationWeights,
  maxCost: number,
  maxLatency: number,
): number {
  const costScore = maxCost === 0 ? 1 : 1 - row.totalCostUsd / maxCost;
  const latencyScore = maxLatency === 0 ? 1 : 1 - row.averageLatencyMs / maxLatency;
  return (
    row.averageQuality * weights.quality +
    row.passRate * weights.passRate +
    costScore * weights.cost +
    latencyScore * weights.latency
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
