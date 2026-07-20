import { supabase } from './client'
import type { InterviewQuestion, InterviewAnswer } from '@/types'

export interface TranscriptEntry {
  questionId: string
  question: string
  questionType: string
  answer: string
  orderIndex: number
  createdAt: string
  source?: string
  parentQuestionId?: string | null
  insufficiencyReason?: string | null
}

export async function fetchTranscript(sessionId: string): Promise<TranscriptEntry[]> {
  const [questions, answers] = await Promise.all([
    supabase
      .from('interview_questions_ai_interview')
      .select('*')
      .eq('session_id', sessionId)
      .order('order_index', { ascending: true }),
    supabase
      .from('interview_answers_ai_interview')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
  ])

  if (questions.error) throw questions.error
  if (answers.error) throw answers.error

  const qs = (questions.data || []) as InterviewQuestion[]
  const ans = (answers.data || []) as InterviewAnswer[]

  const answerMap = new Map<string, string>()
  for (const a of ans) {
    if (a.answer_text) answerMap.set(a.question_id, a.answer_text)
  }

  // Planned and dynamically queued questions are not transcript entries until
  // the candidate has actually answered them.
  return qs.filter(q => answerMap.has(q.id)).map((q) => ({
    questionId: q.id,
    question: q.question_text,
    questionType: q.question_type,
    answer: answerMap.get(q.id) || '',
    orderIndex: q.order_index,
    createdAt: q.created_at,
    source: q.source,
    parentQuestionId: q.parent_question_id,
    insufficiencyReason: q.insufficiency_reason
  }))
}
