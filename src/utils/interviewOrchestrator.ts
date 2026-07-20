import type { InterviewBlueprint, InterviewPlanItem, InterviewQuestion, LiveAssessmentNote } from '@/types'

/** Selects the highest-priority plan item with no primary question yet asked. */
export function selectNextPlanItem(
  blueprint: InterviewBlueprint | null,
  questions: InterviewQuestion[],
  notes: LiveAssessmentNote[]
): InterviewPlanItem | null {
  if (!blueprint) return null
  const asked = new Set(questions.map(question => question.plan_item_id).filter(Boolean))
  const unansweredEvidence = new Set(
    notes.flatMap(note => (note.competency_evidence || [])
      .filter(evidence => evidence.rating === 'insufficient' || evidence.rating === 'developing')
      .map(evidence => evidence.competency_id))
  )
  const pending = blueprint.question_plan.filter(item => !asked.has(item.id))
  return pending.sort((a, b) => {
    const aNeedsEvidence = a.competency_ids.some(id => unansweredEvidence.has(id)) ? 1 : 0
    const bNeedsEvidence = b.competency_ids.some(id => unansweredEvidence.has(id)) ? 1 : 0
    return bNeedsEvidence - aNeedsEvidence
  })[0] || null
}

/** A follow-up is allowed only when it resolves a targeted gap and remains within the blueprint limit. */
export function shouldAskFollowUp(
  note: LiveAssessmentNote | null,
  followUpCount: number,
  maxFollowUps: number
): boolean {
  return Boolean(
    note?.recommended_action === 'follow_up' &&
    note.follow_up_question &&
    followUpCount < maxFollowUps
  )
}
