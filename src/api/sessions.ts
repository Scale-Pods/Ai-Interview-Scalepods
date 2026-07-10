import { supabase, supabasePublic } from './client'
import type { Candidate, InterviewSession, InterviewQuestion } from '@/types'

export async function fetchSessions(): Promise<InterviewSession[]> {
  const { data, error } = await supabase
    .from('interview_sessions_ai_interview')
    .select('*, candidates_ai_interview(*), scorecards_ai_interview(overall_score, recommendation)')
    .order('created_at', { ascending: false })
  if (error) throw error

  const sessions = data as InterviewSession[]
  const unlinkedSessions = sessions.filter(session => !session.candidates_ai_interview)
  if (unlinkedSessions.length === 0) return sessions

  const candidateIds = unlinkedSessions
    .map(session => session.candidate_id)
    .filter((id): id is string => !!id)

  const candidateById = new Map<string, Candidate>()

  if (candidateIds.length > 0) {
    const { data: candidates } = await supabase
      .from('candidates_ai_interview')
      .select('*')
      .in('id', candidateIds)
    for (const c of candidates || []) {
      candidateById.set(c.id, c as Candidate)
    }
  }

  const stillUnlinked = sessions.filter(s => !s.candidates_ai_interview && !(s.candidate_id && candidateById.has(s.candidate_id)))
  if (stillUnlinked.length > 0) {
    const sessionIds = stillUnlinked.map(s => s.id)
    const { data: auditRows } = await supabase
      .from('audit_log_ai_interview')
      .select('resource_id, details')
      .eq('action', 'interview_invite_sent')
      .in('resource_id', sessionIds)

    const emailBySessionId = new Map<string, string>()
    for (const row of auditRows || []) {
      const email = (row.details as { email?: string } | null)?.email
      if (email && row.resource_id) emailBySessionId.set(row.resource_id, email)
    }

    const emails = [...new Set([...emailBySessionId.values()])]
    if (emails.length > 0) {
      const { data: candidatesByEmail } = await supabase
        .from('candidates_ai_interview')
        .select('*')
        .in('email', emails)
      for (const c of candidatesByEmail || []) {
        candidateById.set(c.id, c as Candidate)
      }

      const candidateByEmail = new Map((candidatesByEmail || []).map(c => [c.email, c as Candidate]))

      for (const session of stillUnlinked) {
        if (session.candidates_ai_interview) continue
        const email = emailBySessionId.get(session.id)
        const candidate = email ? candidateByEmail.get(email) : undefined
        if (candidate) session.candidates_ai_interview = candidate
      }
    }
  }

  return sessions
}

export async function fetchSession(id: string): Promise<InterviewSession | null> {
  const { data, error } = await supabasePublic
    .from('interview_sessions_ai_interview')
    .select('*, candidates_ai_interview(*), scorecards_ai_interview(*)')
    .eq('id', id)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function createSession(candidateId: string, hrUserId: string): Promise<InterviewSession> {
  const { data, error } = await supabase
    .from('interview_sessions_ai_interview')
    .insert({
      candidate_id: candidateId,
      status: 'pending',
      created_by: hrUserId,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSessionStatus(id: string, status: InterviewSession['status']): Promise<void> {
  const { error } = await supabase
    .from('interview_sessions_ai_interview')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function updateSessionStatusPublic(id: string, status: InterviewSession['status']): Promise<void> {
  const updates: Partial<InterviewSession> = {
    status,
    updated_at: new Date().toISOString()
  }

  if (status === 'in_progress') updates.started_at = new Date().toISOString()
  if (status === 'completed') updates.completed_at = new Date().toISOString()

  const { error } = await supabasePublic
    .from('interview_sessions_ai_interview')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function fetchQuestions(sessionId: string): Promise<InterviewQuestion[]> {
  const { data, error } = await supabasePublic
    .from('interview_questions_ai_interview')
    .select('*')
    .eq('session_id', sessionId)
    .order('order_index', { ascending: true })
  if (error) throw error
  return data
}
