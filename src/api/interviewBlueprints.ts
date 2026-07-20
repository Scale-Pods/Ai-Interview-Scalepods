import { supabasePublic } from './client'
import type { InterviewBlueprint } from '@/types'

const TABLE = 'interview_blueprints_ai_interview'

export async function fetchInterviewBlueprint(sessionId: string): Promise<InterviewBlueprint | null> {
  const { data, error } = await supabasePublic
    .from(TABLE)
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  return data as InterviewBlueprint | null
}

export async function saveInterviewBlueprint(blueprint: InterviewBlueprint): Promise<InterviewBlueprint> {
  const { data, error } = await supabasePublic
    .from(TABLE)
    .upsert({ ...blueprint, updated_at: new Date().toISOString() }, { onConflict: 'session_id' })
    .select()
    .single()
  if (error) throw error
  return data as InterviewBlueprint
}
