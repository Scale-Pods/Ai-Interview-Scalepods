import type { Recommendation, Scorecard } from '@/types'

export function recommendationColor(rec: Recommendation): string {
  const map: Record<Recommendation, string> = {
    strong_hire: 'var(--color-success)',
    hire: '#22c55e',
    consider: 'var(--color-warning)',
    no_go: 'var(--color-danger)'
  }
  return map[rec]
}

export function recommendationLabel(rec: Recommendation): string {
  const map: Record<Recommendation, string> = {
    strong_hire: 'Strong Hire',
    hire: 'Hire',
    consider: 'Consider',
    no_go: 'No Go'
  }
  return map[rec]
}

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'var(--color-surface-500)'
  if (score >= 80) return 'var(--color-success)'
  if (score >= 60) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

export function scoreLabel(score: number | null | undefined): string {
  if (score == null) return 'Not scored'
  if (score >= 80) return 'Excellent'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Average'
  if (score >= 40) return 'Below Average'
  return 'Poor'
}

export function aggregateScores(scorecards: Scorecard[]): {
  avgTechnical: number
  avgCommunication: number
  avgProblemSolving: number
  avgCulturalFit: number
  avgOverall: number
  count: number
} {
  if (scorecards.length === 0) {
    return { avgTechnical: 0, avgCommunication: 0, avgProblemSolving: 0, avgCulturalFit: 0, avgOverall: 0, count: 0 }
  }
  const sum = (fn: (s: Scorecard) => number | null) =>
    scorecards.reduce((a, s) => a + (fn(s) ?? 0), 0) / scorecards.length

  return {
    avgTechnical: Math.round(sum(s => s.technical_score)),
    avgCommunication: Math.round(sum(s => s.communication_score)),
    avgProblemSolving: Math.round(sum(s => s.problem_solving_score)),
    avgCulturalFit: Math.round(sum(s => s.cultural_fit_score)),
    avgOverall: Math.round(sum(s => s.overall_score)),
    count: scorecards.length
  }
}
