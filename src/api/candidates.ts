import { api, supabase } from './client'
import type { Candidate, CandidateFormData, DashboardStats, InterviewSession } from '@/types'

export async function fetchCandidates(): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from('candidates_ai_interview')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchCandidate(id: string): Promise<Candidate> {
  return api.get<Candidate>(`/candidates/${id}`)
}

export async function createCandidate(data: CandidateFormData): Promise<Candidate> {
  return api.post<Candidate>('/candidates', {
    name: data.name,
    email: data.email,
    job_description: data.jobDescription,
    resume_text: data.resume,
    metadata: data.metadata
  })
}

export async function deleteCandidate(candidateId: string): Promise<void> {
  // Get all sessions for this candidate to clean up storage first
  const { data: sessions } = await supabase
    .from('interview_sessions_ai_interview')
    .select('id')
    .eq('candidate_id', candidateId)

  const sessionIds = (sessions || []).map(s => s.id)

  if (sessionIds.length > 0) {
    // Get all recording storage paths
    const { data: recordings } = await supabase
      .from('recordings_ai_interview')
      .select('storage_path')
      .in('session_id', sessionIds)

    // Delete storage files
    const paths = (recordings || []).map(r => r.storage_path).filter(Boolean)
    if (paths.length > 0) {
      await supabase.storage.from('recordings').remove(paths)
    }
  }

  // Delete the candidate — CASCADE handles all DB rows
  const { error } = await supabase
    .from('candidates_ai_interview')
    .delete()
    .eq('id', candidateId)

  if (error) throw error
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase
    .from('interview_sessions_ai_interview')
    .select('*, candidates_ai_interview(name, email), scorecards_ai_interview(overall_score, recommendation)')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error

  const { count: totalCandidates } = await supabase
    .from('candidates_ai_interview')
    .select('*', { count: 'exact', head: true })

  const sessions = data as InterviewSession[]
  const unlinkedSessions = sessions.filter(s => !s.candidates_ai_interview)
  if (unlinkedSessions.length > 0) {
    const candidateIds = unlinkedSessions
      .map(s => s.candidate_id)
      .filter((id): id is string => !!id)
    if (candidateIds.length > 0) {
      const { data: candidates } = await supabase
        .from('candidates_ai_interview')
        .select('id, name, email')
        .in('id', candidateIds)
      const candidateById = new Map((candidates || []).map(c => [c.id, c]))
      data.forEach(s => {
        if (!s.candidates_ai_interview && s.candidate_id) {
          s.candidates_ai_interview = candidateById.get(s.candidate_id) || null
        }
      })
    }
  }

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  const invited = sessions.filter(s => s.status === 'invited')
  const started = sessions.filter(s => s.status === 'in_progress')
  const completed = sessions.filter(s => s.status === 'completed')
  const scored = completed.filter(s => s.scorecards_ai_interview?.[0]?.overall_score != null)
  const scores = scored.map(s => s.scorecards_ai_interview![0].overall_score)

  const recBreakdown = { strong_hire: 0, hire: 0, consider: 0, no_go: 0 }
  completed.forEach(s => {
    const rec = s.scorecards_ai_interview?.[0]?.recommendation
    if (rec && rec in recBreakdown) recBreakdown[rec as keyof typeof recBreakdown]++
  })

  return {
    totalCandidates: totalCandidates || 0,
    totalSessions: sessions.length,
    invitedToday: sessions.filter(s => s.status === 'invited' && s.created_at >= todayStart).length,
    startedToday: sessions.filter(s => s.status === 'in_progress' && s.created_at >= todayStart).length,
    pendingInvites: invited.length,
    completedInterviews: completed.length,
    averageScore: scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0,
    recentSessions: data.slice(0, 12),
    scoreDistribution: [
      { range: '0-20', count: scores.filter(s => s < 20).length },
      { range: '21-40', count: scores.filter(s => s >= 20 && s < 40).length },
      { range: '41-60', count: scores.filter(s => s >= 40 && s < 60).length },
      { range: '61-80', count: scores.filter(s => s >= 60 && s < 80).length },
      { range: '81-100', count: scores.filter(s => s >= 80).length }
    ],
    funnelCounts: {
      invited: invited.length,
      started: started.length,
      completed: completed.length,
      scored: scored.length
    },
    recommendationBreakdown: recBreakdown
  }
}
