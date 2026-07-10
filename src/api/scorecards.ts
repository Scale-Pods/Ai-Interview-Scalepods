import { supabase } from './client'
import type { Scorecard } from '@/types'

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
