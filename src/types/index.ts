export interface Candidate {
  id: string;
  external_id?: string;
  name: string;
  email: string;
  phone?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface JobDescription {
  id: string;
  candidate_id: string;
  raw_text: string;
  parsed_skills: string[];
  parsed_years_experience?: number;
  parsed_roles: string[];
  created_at: string;
}

export interface Resume {
  id: string;
  candidate_id: string;
  raw_text: string;
  file_url?: string;
  parsed_skills: string[];
  parsed_experience: WorkExperience[];
  parsed_education: Education[];
  created_at: string;
}

export interface WorkExperience {
  title: string;
  company: string;
  duration: string;
  highlights: string[];
}

export interface Education {
  degree: string;
  institution: string;
  year: string;
}

export type SessionStatus = 'pending' | 'invited' | 'in_progress' | 'completed' | 'expired' | 'cancelled' | 'flagged';

export interface InterviewSession {
  id: string;
  candidate_id: string;
  jd_id: string;
  resume_id: string;
  status: SessionStatus;
  invite_link?: string;
  expires_at: string;
  started_at?: string;
  completed_at?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  candidates_ai_interview?: Candidate | null;
  scorecard?: Scorecard;
  scorecards_ai_interview?: Scorecard[];
}

export interface InterviewQuestion {
  id: string;
  session_id: string;
  question_text: string;
  question_type: 'technical' | 'behavioral' | 'situational' | 'cultural';
  source: string;
  order_index: number;
  parent_question_id?: string;
  created_at: string;
}

export interface InterviewAnswer {
  id: string;
  question_id: string;
  session_id: string;
  answer_text?: string;
  audio_url?: string;
  duration_secs?: number;
  created_at: string;
}

export type ProctoringEventType =
  | 'tab_switch' | 'window_blur' | 'browser_resize'
  | 'face_absent' | 'face_multiple' | 'face_mismatch'
  | 'audio_silence' | 'audio_level' | 'copy_paste'
  | 'keyboard_shortcut' | 'fullscreen_exit';

export type ProctoringSeverity = 'info' | 'warning' | 'critical';

export interface ProctoringEvent {
  id: string;
  session_id: string;
  event_type: ProctoringEventType;
  severity: ProctoringSeverity;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export type StreamType = 'camera_video' | 'screen_video' | 'audio_mixed';
export type RecordingStatus = 'processing' | 'ready' | 'archived' | 'failed';

export interface Recording {
  id: string;
  session_id: string;
  stream_type: StreamType;
  status: RecordingStatus;
  storage_path: string;
  duration_secs?: number;
  file_size_bytes?: number;
  mime_type?: string;
  transcoded_paths?: Record<string, string>;
  created_at: string;
}

export type Recommendation = 'strong_hire' | 'hire' | 'consider' | 'no_go';

export interface Scorecard {
  id: string;
  session_id: string;
  technical_score: number;
  communication_score: number;
  problem_solving_score: number;
  cultural_fit_score: number;
  overall_score: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: Recommendation;
  ai_rationale: string;
  scoring_model_version: string;
  evaluated_at: string;
  reviewed_by_human: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_type: 'system' | 'hr_user' | 'candidate' | 'api';
  actor_id?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface ProctoringSummary {
  totalEvents: number;
  criticalEvents: number;
  warningEvents: number;
  tabSwitches: number;
  windowBlurs: number;
  faceAbsences: number;
  faceMultiple: number;
  silentPeriods: number;
  fullscreenExits: number;
  copyPastes: number;
  keyboardShortcuts: number;
}

export interface TimelineEvent {
  id: string;
  type: 'hr_event' | 'interview_event';
  source: string;
  title: string;
  description: string;
  timestamp: string;
  actor: string;
  metadata?: Record<string, unknown>;
}

export interface CandidateFormData {
  name: string;
  email: string;
  jobDescription: string;
  jobDescriptionFile: File | null;
  resume: File | null;
  metadata?: Record<string, unknown>;
}

export interface DashboardStats {
  totalSessions: number;
  invitedToday: number;
  startedToday: number;
  pendingInvites: number;
  completedInterviews: number;
  averageScore: number;
  recentSessions: InterviewSession[];
  scoreDistribution: { range: string; count: number }[];
  funnelCounts: {
    invited: number;
    started: number;
    completed: number;
    scored: number;
  };
  recommendationBreakdown: {
    strong_hire: number;
    hire: number;
    consider: number;
    no_go: number;
  };
}
