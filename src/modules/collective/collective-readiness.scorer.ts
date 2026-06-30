export function calculateCollectiveReadinessScore(rules: Array<{ points: number }>): number {
  const score = rules.reduce((sum, rule) => sum + rule.points, 0);
  return Math.max(0, Math.min(100, score));
}
