export type InterviewerTurnType = 'question' | 'follow_up' | 'transition' | 'closing'

export interface InterviewerTurn {
  interviewer_text: string
  turn_type: InterviewerTurnType
  question_type?: 'technical' | 'behavioral' | 'situational' | 'cultural'
  should_continue: boolean
  question_text?: string
}

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
  plan_item_id?: string;
  competency_ids?: string[];
  decision_rationale?: string;
  /** Populated on follow-up question rows only — the failure mode that triggered this follow-up. */
  insufficiency_reason?: AnswerInsufficiencyReason | null;
  created_at: string;
}

export interface InterviewAnswer {
  id: string;
  question_id: string;
  session_id: string;
  answer_text?: string;
  audio_url?: string;
  duration_secs?: number;
  ai_live_note?: LiveAssessmentNote;
  ai_assessment?: AnswerAssessment;
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

export type AuthenticitySignalType = 'genuine' | 'vague' | 'suspicious' | 'inconsistent';
export type DepthSignalType = 'deep' | 'surface' | 'empty';

export interface LiveAssessmentNote {
  question_id: string;
  authenticity_signal: AuthenticitySignalType;
  depth_signal: DepthSignalType;
  red_flags: string[];
  note: string;
  follow_up_prompted: boolean;
  follow_up_question?: string;
  recommended_action?: AnswerAction;
  /** The specific failure mode that triggered follow_up_prompted, if any. */
  insufficiency_reason?: AnswerInsufficiencyReason | null;
  competency_evidence?: CompetencyEvidence[];
  confidence?: number;
}

export type AnswerAction = 'advance' | 'follow_up' | 'revisit_later';

/**
 * Structured failure-mode taxonomy returned by analyzeAnswerInRealtime.
 * Priority (most severe → least): irrelevant > lacks_evidence > lacks_depth > vague
 */
export type AnswerInsufficiencyReason = 'lacks_depth' | 'lacks_evidence' | 'vague' | 'irrelevant';

export interface Competency {
  id: string;
  name: string;
  weight: number;
  description: string;
  expected_evidence: string[];
}

/**
 * A single named tool/technology extracted directly from the Job Description.
 * Used to ground blueprint competencies and question generation in specific tools.
 */
export interface JdTool {
  name: string;
  category: string;
  importance: 'must_have' | 'nice_to_have';
  mentioned_in_resume: boolean;
  /** Exact phrase/sentence from the resume where this tool appears, or null if absent. */
  resume_context: string | null;
}

export interface InterviewPlanItem {
  id: string;
  competency_ids: string[];
  objective: string;
  question_type: 'technical' | 'behavioral' | 'situational' | 'cultural';
  /** Capped at foundation/applied — this is a screening round, not a senior systems design interview. */
  difficulty: 'foundation' | 'applied';
  /** The specific named tool (e.g. "React", "PostgreSQL") this plan item tests. */
  target_tool?: string;
  /** verify_claim: candidate listed this tool on their resume — confirm real usage.
   *  baseline_check: JD-only tool — confirm basic awareness/understanding. */
  verification_mode?: 'verify_claim' | 'baseline_check';
}

export interface InterviewBlueprint {
  session_id: string;
  version: string;
  competencies: Competency[];
  question_plan: InterviewPlanItem[];
  candidate_summary: { strengths: string[]; gaps: string[]; claims_to_validate: string[] };
  constraints: { max_primary_questions: number; max_follow_ups_per_question: number };
  created_at?: string;
  updated_at?: string;
}

export interface CompetencyEvidence {
  competency_id: string;
  rating: 'insufficient' | 'developing' | 'adequate' | 'strong';
  evidence: string;
  missing_evidence?: string;
}

export interface AnswerAssessment {
  question_id: string;
  competency_evidence: CompetencyEvidence[];
  confidence: number;
  recommended_action: AnswerAction;
  follow_up_reason?: string;
  follow_up_question?: string;
  authenticity_signal: AuthenticitySignalType;
  depth_signal: DepthSignalType;
  red_flags: string[];
  note: string;
}

export interface AuthenticitySignal {
  question_id: string;
  signal: AuthenticitySignalType;
  depth: DepthSignalType;
  follow_up_count: number;
}

export interface Scorecard {
  id: string;
  session_id: string;
  technical_score: number;
  communication_score: number;
  problem_solving_score: number;
  cultural_fit_score: number;
  overall_score: number;
  authenticity_score?: number;
  red_flag_count?: number;
  red_flags?: string[];
  resume_vs_reality?: ResumeClaimVerification[];
  live_notes?: LiveAssessmentNote[];
  strengths: string[];
  weaknesses: string[];
  recommendation: Recommendation;
  ai_rationale: string;
  detailed_rationale?: string;
  scoring_model_version: string;
  evaluated_at: string;
  reviewed_by_human: boolean;
  created_at: string;
}

export interface ResumeClaimVerification {
  claim: string;
  status: 'verified' | 'suspicious' | 'unverifiable' | 'contradicted';
  evidence: string;
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
  totalCandidates: number;
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
