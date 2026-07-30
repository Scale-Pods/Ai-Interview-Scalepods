import { supabase } from './client'
import type { Scorecard } from '@/types'
import { generateCandidateScorecard } from '@/utils/llm'

export async function fetchScorecard(sessionId: string): Promise<Scorecard | null> {
  const { data, error } = await supabase
    .from('scorecards_ai_interview')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function markScorecardReviewed(id: string): Promise<void> {
  const { error } = await supabase
    .from('scorecards_ai_interview')
    .update({ reviewed_by_human: true })
    .eq('id', id)
  if (error) throw error
}

export async function fetchAllScorecards(): Promise<Scorecard[]> {
  const { data, error } = await supabase
    .from('scorecards_ai_interview')
    .select('*')
    .order('evaluated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function scoreInterviewDirectly(sessionId: string): Promise<Scorecard | null> {
  try {
    const { data: session } = await supabase
      .from('interview_sessions_ai_interview')
      .select('*, resumes_ai_interview(raw_text), job_descriptions_ai_interview(raw_text)')
      .eq('id', sessionId)
      .single()

    if (!session) return null

    const [questionsRes, answersRes, proctoringRes] = await Promise.all([
      supabase.from('interview_questions_ai_interview').select('*').eq('session_id', sessionId).order('order_index', { ascending: true }),
      supabase.from('interview_answers_ai_interview').select('*').eq('session_id', sessionId).order('created_at', { ascending: true }),
      supabase.from('proctoring_events_ai_interview').select('id').eq('session_id', sessionId)
    ])

    const questions = questionsRes.data || []
    const answers = answersRes.data || []
    const proctoringCount = (proctoringRes.data || []).length

    const qMap = new Map(questions.map(q => [q.id, q.question_text]))
    const records = answers.map(a => ({
      question: qMap.get(a.question_id) || 'Interview Question',
      answer: a.answer_text || ''
    }))

    const resumeText = (session.resumes_ai_interview as any)?.raw_text || ''
    const jdText = (session.job_descriptions_ai_interview as any)?.raw_text || ''

    const scorecard = await generateCandidateScorecard(
      sessionId,
      resumeText,
      jdText,
      records,
      proctoringCount
    )

    const { error: upsertError } = await supabase
      .from('scorecards_ai_interview')
      .upsert({
        session_id: sessionId,
        technical_score: scorecard.technical_score,
        communication_score: scorecard.communication_score,
        problem_solving_score: scorecard.problem_solving_score,
        cultural_fit_score: scorecard.cultural_fit_score,
        overall_score: scorecard.overall_score,
        authenticity_score: scorecard.authenticity_score,
        red_flag_count: scorecard.red_flag_count,
        red_flags: scorecard.red_flags,
        resume_vs_reality: scorecard.resume_vs_reality,
        strengths: scorecard.strengths,
        weaknesses: scorecard.weaknesses,
        recommendation: scorecard.recommendation,
        ai_rationale: scorecard.ai_rationale,
        detailed_rationale: scorecard.detailed_rationale,
        scoring_model_version: scorecard.scoring_model_version,
        evaluated_at: scorecard.evaluated_at
      })

    if (!upsertError) {
      await supabase
        .from('interview_sessions_ai_interview')
        .update({ status: 'scored', updated_at: new Date().toISOString() })
        .eq('id', sessionId)
    }

    return scorecard
  } catch (err) {
    console.error('scoreInterviewDirectly failed:', err)
    return null
  }
}
