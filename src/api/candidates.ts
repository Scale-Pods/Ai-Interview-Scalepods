import { supabase } from './client'
import type { Candidate, DashboardStats, InterviewSession, Scorecard } from '@/types'

export async function fetchCandidates(): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from('candidates_ai_interview')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
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

function extractScorecard(session: any): Scorecard | null {
  if (!session) return null
  const sc = session.scorecards_ai_interview || session.scorecard
  if (!sc) return null
  if (Array.isArray(sc)) {
    return sc.length > 0 ? (sc[0] as Scorecard) : null
  }
  return sc as Scorecard
}

function extractCandidate(session: any): Candidate | null {
  if (!session) return null
  const c = session.candidates_ai_interview || session.candidate
  if (!c) return null
  if (Array.isArray(c)) {
    return c.length > 0 ? (c[0] as Candidate) : null
  }
  return c as Candidate
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  try {
    const { data: rawSessions, error } = await supabase
      .from('interview_sessions_ai_interview')
      .select('*, candidates_ai_interview(id, name, email), scorecards_ai_interview(overall_score, recommendation)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.warn('Dashboard stats session query warning:', error)
    }

    const sessions = (rawSessions || []) as any[]

    let totalCandidates = 0
    try {
      const { count } = await supabase
        .from('candidates_ai_interview')
        .select('*', { count: 'exact', head: true })
      totalCandidates = count || 0
    } catch (e) {
      console.warn('Failed to count candidates:', e)
    }

    // Unlinked sessions fallback
    const unlinkedSessions = sessions.filter(s => !extractCandidate(s))
    if (unlinkedSessions.length > 0) {
      const candidateIds = unlinkedSessions
        .map(s => s.candidate_id)
        .filter((id): id is string => !!id)
      if (candidateIds.length > 0) {
        try {
          const { data: candidates } = await supabase
            .from('candidates_ai_interview')
            .select('id, name, email')
            .in('id', candidateIds)
          const candidateById = new Map((candidates || []).map(c => [c.id, c]))
          sessions.forEach(s => {
            if (!extractCandidate(s) && s.candidate_id) {
              s.candidates_ai_interview = candidateById.get(s.candidate_id) || null
            }
          })
        } catch {}
      }
    }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

    const invited = sessions.filter(s => s.status === 'invited')
    const started = sessions.filter(s => s.status === 'in_progress')
    const completed = sessions.filter(s => s.status === 'completed')

    const scoredSessions = sessions.filter(s => {
      const sc = extractScorecard(s)
      return sc && sc.overall_score != null
    })

    const scores = scoredSessions.map(s => {
      const sc = extractScorecard(s)
      return Number(sc?.overall_score || 0)
    })

    const recBreakdown = { strong_hire: 0, hire: 0, consider: 0, no_go: 0 }
    sessions.forEach(s => {
      const sc = extractScorecard(s)
      if (sc?.recommendation) {
        const recKey = sc.recommendation.toLowerCase().replace(/[-\s]/g, '_')
        if (recKey in recBreakdown) {
          recBreakdown[recKey as keyof typeof recBreakdown]++
        }
      }
    })

    const formattedSessions: InterviewSession[] = sessions.map(s => {
      const cand = extractCandidate(s)
      const sc = extractScorecard(s)
      return {
        ...s,
        candidates_ai_interview: cand,
        scorecards_ai_interview: sc ? [sc] : [],
        scorecard: sc || undefined
      }
    })

    return {
      totalCandidates: totalCandidates || sessions.length,
      totalSessions: sessions.length,
      invitedToday: sessions.filter(s => s.status === 'invited' && s.created_at >= todayStart).length,
      startedToday: sessions.filter(s => s.status === 'in_progress' && s.created_at >= todayStart).length,
      pendingInvites: invited.length,
      completedInterviews: completed.length,
      averageScore: scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0,
      recentSessions: formattedSessions.slice(0, 12),
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
        scored: scoredSessions.length
      },
      recommendationBreakdown: recBreakdown
    }
  } catch (err) {
    console.error('Failed to calculate dashboard stats:', err)
    return {
      totalCandidates: 0,
      totalSessions: 0,
      invitedToday: 0,
      startedToday: 0,
      pendingInvites: 0,
      completedInterviews: 0,
      averageScore: 0,
      recentSessions: [],
      scoreDistribution: [
        { range: '0-20', count: [0] },
        { range: '21-40', count: 0 },
        { range: '41-60', count: 0 },
        { range: '61-80', count: 0 },
        { range: '81-100', count: 0 }
      ] as any,
      funnelCounts: { invited: 0, started: 0, completed: 0, scored: 0 },
      recommendationBreakdown: { strong_hire: 0, hire: 0, consider: 0, no_go: 0 }
    }
  }
}
