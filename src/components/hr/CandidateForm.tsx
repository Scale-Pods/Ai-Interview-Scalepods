import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus, Upload, FileText, Send, Copy, CheckCircle, ExternalLink,
  File, X, AlertCircle, ChevronRight, Mail, User, Briefcase, Sparkles, Plus, Trash2
} from 'lucide-react'
import toast from 'react-hot-toast'
import { extractTextFromFile } from '@/utils/mediaHelpers'
import { analyzeCandidateFit, generateNextInterviewQuestion } from '@/utils/llm'

type FormStep = 'details' | 'jd' | 'review'

const STEP_CONFIG: { key: FormStep; label: string; icon: typeof User }[] = [
  { key: 'details', label: 'Details', icon: User },
  { key: 'jd', label: 'Job & Resume', icon: Briefcase },
  { key: 'review', label: 'Review', icon: FileText },
]

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

interface CandidateFormData {
  name: string
  email: string
  jobDescription: string
  jobDescriptionFile: File | null
  resume: File | null
}

interface CandidateIntakeResult {
  candidate_id?: string
  jd_id?: string
  resume_id?: string
  name?: string
  email?: string
}

type DraftQuestionType = 'technical' | 'behavioral' | 'situational' | 'cultural'

interface DraftQuestion {
  question_text: string
  question_type: DraftQuestionType
}

interface CandidateFormProps {
  onSuccess?: () => void
}

const QUESTION_TYPE_OPTIONS: DraftQuestionType[] = ['technical', 'behavioral', 'situational', 'cultural']
const TARGET_JOB_QUESTIONS = 10

export function CandidateForm({ onSuccess }: CandidateFormProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CandidateFormData>({
    name: '', email: '', jobDescription: '', jobDescriptionFile: null, resume: null
  })
  const [step, setStep] = useState<FormStep>('details')
  const [submitted, setSubmitted] = useState(false)
  const [candidateInfo, setCandidateInfo] = useState<CandidateIntakeResult | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [resumeText, setResumeText] = useState('')
  const [jdText, setJdText] = useState('')
  const [draftQuestions, setDraftQuestions] = useState<DraftQuestion[]>([])
  const [questionsGenerating, setQuestionsGenerating] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof CandidateFormData, string>>>({})
  const resumeRef = useRef<HTMLInputElement>(null)
  const jdFileRef = useRef<HTMLInputElement>(null)

  const setField = <K extends keyof CandidateFormData>(key: K, value: CandidateFormData[K]) => {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => ({ ...e, [key]: undefined }))
  }

  const validateDetails = () => {
    const e: typeof errors = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!form.email.trim()) e.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateJD = () => {
    const e: typeof errors = {}
    if (!form.jobDescription.trim() && !form.jobDescriptionFile) e.jobDescription = 'Job description or file required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleNext = () => {
    if (step === 'details' && validateDetails()) setStep('jd')
    else if (step === 'jd' && validateJD()) setStep('review')
  }

  const intakeMutation = useMutation({
    mutationFn: async (data: CandidateFormData) => {
      const resumeText = data.resume ? await extractTextFromFile(data.resume) : ''
      const jdText = data.jobDescriptionFile
        ? await extractTextFromFile(data.jobDescriptionFile)
        : data.jobDescription
      const webhookUrl = import.meta.env.VITE_WEBHOOK_CANDIDATE_INTAKE || '/webhook/candidate-intake'
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, email: data.email, jobDescription: jdText, resume: resumeText })
      })
      if (!response.ok) throw new Error('Failed to submit candidate')
      const intake = await response.json() as CandidateIntakeResult
      return { intake, resumeText, jdText }
    },
    onSuccess: async ({ intake, resumeText, jdText }) => {
      setCandidateInfo({
        candidate_id: intake.candidate_id,
        jd_id: intake.jd_id,
        resume_id: intake.resume_id,
        name: intake.name || form.name,
        email: intake.email || form.email
      })
      setResumeText(resumeText)
      setJdText(jdText)
      setSubmitted(true)
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success('Candidate submitted successfully')
      await generateDraftQuestions(resumeText, jdText)
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const generateDraftQuestions = async (resumeRaw: string, jdRaw: string) => {
    setQuestionsGenerating(true)
    try {
      const analysis = await analyzeCandidateFit(resumeRaw, jdRaw)
      const history: Array<{ question: string; answer: string; type: string }> = []
      const generated: DraftQuestion[] = []

      for (let i = 0; i < TARGET_JOB_QUESTIONS; i += 1) {
        const next = await generateNextInterviewQuestion(resumeRaw, jdRaw, history, i, analysis, '', '', '')
        const question = {
          question_text: next.question_text,
          question_type: next.question_type
        }
        generated.push(question)
        history.push({
          question: question.question_text,
          answer: '',
          type: question.question_type
        })
      }

      setDraftQuestions(generated)
      toast.success('Questions ready for review')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to generate questions')
    } finally {
      setQuestionsGenerating(false)
    }
  }

  const setDraftQuestion = <K extends keyof DraftQuestion>(index: number, key: K, value: DraftQuestion[K]) => {
    setDraftQuestions(prev => prev.map((q, i) => i === index ? { ...q, [key]: value } : q))
  }

  const addDraftQuestion = () => {
    setDraftQuestions(prev => [...prev, {
      question_text: '',
      question_type: 'technical'
    }])
  }

  const removeDraftQuestion = (index: number) => {
    setDraftQuestions(prev => prev.filter((_, i) => i !== index))
  }

  const reviewedQuestions = draftQuestions
    .map((q, i) => ({
      question_text: q.question_text.trim(),
      question_type: q.question_type,
      order_index: i + 1,
      source: 'hr_reviewed_llm'
    }))
    .filter(q => q.question_text)

  const canSendInvite = !questionsGenerating && reviewedQuestions.length > 0

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!canSendInvite) throw new Error('Review at least one question before sending the invite')
      const webhookUrl = import.meta.env.VITE_WEBHOOK_SESSION_CREATION || '/webhook/create-session'
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: candidateInfo?.name || form.name,
          email: candidateInfo?.email || form.email,
          candidate_id: candidateInfo?.candidate_id,
          jd_id: candidateInfo?.jd_id,
          resume_id: candidateInfo?.resume_id,
          questions: reviewedQuestions,
          frontendUrl: window.location.origin
        })
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `HTTP ${response.status}`)
      }
      return response.json().catch(() => ({}))
    },
    onSuccess: (data) => {
      const link = data.invite_link || data.link || data.url || ''
      if (link) {
        setInviteLink(link)
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
        toast.success('Invite sent!')
      } else {
        toast.success('Session created! Check Candidates list for the invite link.')
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
        onSuccess?.()
      }
    },
    onError: (err: Error) => toast.error(err.message)
  })

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateDetails() || !validateJD()) return
    intakeMutation.mutate(form)
  }

  const handleCopy = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          {inviteLink ? (
            <CheckCircle size={24} style={{ color: 'var(--green)' }} />
          ) : (
            <UserPlus size={24} style={{ color: 'var(--blue)' }} />
          )}
          <h1 className="text-2xl font-bold">
            {inviteLink ? 'Invite Sent!' : 'Candidate Submitted'}
          </h1>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center gap-3 pb-3" style={{ borderBottom: '1px solid var(--separator)' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: 'var(--blue)', color: 'white' }}>
              {candidateInfo?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-medium">{candidateInfo?.name}</p>
              <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>{candidateInfo?.email}</p>
            </div>
          </div>

          {!inviteLink && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--label-primary)' }}>
                    <Sparkles size={15} style={{ color: 'var(--blue)' }} /> Review Interview Questions
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--label-tertiary)' }}>Edit the AI-generated questions before the invite is sent.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => generateDraftQuestions(resumeText, jdText)}
                    disabled={questionsGenerating || inviteMutation.isPending}
                    className="btn-secondary text-xs"
                  >
                    <Sparkles size={14} /> Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={addDraftQuestion}
                    disabled={questionsGenerating || inviteMutation.isPending}
                    className="btn-secondary text-xs"
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>

              {questionsGenerating ? (
                <div className="flex flex-col items-center gap-3 py-6 rounded-xl" style={{ background: 'var(--fill-quaternary)' }}>
                  <div className="h-6 w-6 rounded-full animate-spin" style={{ border: '2px solid rgba(120,120,128,0.3)', borderTopColor: 'var(--blue)' }} />
                  <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>Generating tailored questions...</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {draftQuestions.map((q, index) => (
                    <div key={index} className="p-3 rounded-xl space-y-2" style={{ background: 'var(--fill-quaternary)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono w-6" style={{ color: 'var(--label-tertiary)' }}>{index + 1}.</span>
                        <select
                          value={q.question_type}
                          onChange={e => setDraftQuestion(index, 'question_type', e.target.value as DraftQuestionType)}
                          className="input-field !py-1.5 !text-xs max-w-36"
                          disabled={inviteMutation.isPending}
                        >
                          {QUESTION_TYPE_OPTIONS.map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeDraftQuestion(index)}
                          disabled={inviteMutation.isPending || draftQuestions.length <= 1}
                          className="ml-auto p-1.5 rounded-lg transition disabled:opacity-40"
                          style={{ color: 'var(--label-tertiary)' }}
                          aria-label="Remove question"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <textarea
                        value={q.question_text}
                        onChange={e => setDraftQuestion(index, 'question_text', e.target.value)}
                        rows={3}
                        className="input-field text-sm resize-y"
                        placeholder="Write the interview question..."
                        disabled={inviteMutation.isPending}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!inviteLink && !inviteMutation.isPending && (
            <button
              onClick={() => inviteMutation.mutate()}
              disabled={!canSendInvite}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={16} /> Send Invite
            </button>
          )}

          {inviteMutation.isPending && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="h-6 w-6 rounded-full animate-spin" style={{ border: '2px solid rgba(120,120,128,0.3)', borderTopColor: 'var(--blue)' }} />
              <div className="space-y-1 text-center">
                <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>Creating interview session...</p>
                <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>Preparing the invite. Questions are generated live in the interview.</p>
              </div>
              <div className="w-full rounded-full h-1.5 mt-2" style={{ background: 'var(--fill-quaternary)' }}>
                <div className="h-full rounded-full animate-pulse" style={{ width: '60%', background: 'var(--blue)' }} />
              </div>
            </div>
          )}

          {inviteLink && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: 'var(--fill-quaternary)' }}>
                <ExternalLink size={16} className="shrink-0" style={{ color: 'var(--label-secondary)' }} />
                <span className="text-sm truncate" style={{ color: 'var(--label-secondary)' }}>{inviteLink}</span>
                <button
                  onClick={handleCopy}
                  className="shrink-0 p-1.5 rounded-lg transition" style={{ background: 'var(--fill-tertiary)' }}
                >
                  <Copy size={14} />
                </button>
              </div>
              {copied && <p className="text-xs text-center" style={{ color: 'var(--blue)' }}>Link copied to clipboard</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSubmitted(false)
                    setForm({ name: '', email: '', jobDescription: '', jobDescriptionFile: null, resume: null })
                    setInviteLink(null)
                    setCandidateInfo(null)
                    setCopied(false)
                    setDraftQuestions([])
                    setResumeText('')
                    setJdText('')
                    setStep('details')
                    onSuccess?.()
                  }}
                  className="btn-primary flex-1"
                >
                  <UserPlus size={16} /> New Request
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <UserPlus size={24} style={{ color: 'var(--blue)' }} />
        <h1 className="text-2xl font-bold">New Interview Request</h1>
      </div>

      <div className="flex items-center gap-1 mb-8">
        {STEP_CONFIG.map((s, i) => {
          const Icon = s.icon
          const isActive = step === s.key
          const isDone = STEP_CONFIG.findIndex(x => x.key === step) > i
          return (
            <div key={s.key} className="flex items-center gap-1 flex-1">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300`}
                  style={{
                    background: isActive ? 'var(--blue)' : isDone ? 'color-mix(in srgb, var(--green) 20%, transparent)' : 'var(--fill-quaternary)',
                    color: isActive ? 'white' : isDone ? 'var(--green)' : 'var(--label-tertiary)',
                    boxShadow: isActive ? 'var(--glass-shadow)' : 'none'
                  }}>
                  {isDone ? <CheckCircle size={14} /> : <Icon size={14} />}
                </div>
                <span className={`text-xs font-medium hidden sm:inline transition-colors`}
                  style={{ color: isActive ? 'var(--label-primary)' : isDone ? 'var(--green)' : 'var(--label-tertiary)' }}>
                  {s.label}
                </span>
              </div>
              {i < STEP_CONFIG.length - 1 && (
                <div className={`flex-1 h-px mx-2 transition-colors`}
                  style={{ background: isDone ? 'color-mix(in srgb, var(--green) 40%, transparent)' : 'var(--separator)' }} />
              )}
            </div>
          )
        })}
      </div>

      <form onSubmit={handleSubmitForm} className="space-y-5 card">
        {step === 'details' && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--label-secondary)' }}>
                <User size={14} style={{ color: 'var(--blue)' }} /> Candidate Name *
              </label>
              <div className="flex items-center gap-2 px-3 input-field" style={errors.name ? { outlineColor: 'var(--red)' } : undefined}>
                <User size={15} className="shrink-0" style={{ color: 'var(--label-tertiary)' }} />
                <input
                  type="text" value={form.name}
                  onChange={e => setField('name', e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-sm py-2"
                  style={{ color: 'var(--label-primary)' }}
                  placeholder="e.g. John Doe"
                />
              </div>
              {errors.name && <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--red)' }}><AlertCircle size={11} />{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--label-secondary)' }}>
                <Mail size={14} style={{ color: 'var(--blue)' }} /> Email Address *
              </label>
              <div className="flex items-center gap-2 px-3 input-field" style={errors.email ? { outlineColor: 'var(--red)' } : undefined}>
                <Mail size={15} className="shrink-0" style={{ color: 'var(--label-tertiary)' }} />
                <input
                  type="email" value={form.email}
                  onChange={e => setField('email', e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-sm py-2"
                  style={{ color: 'var(--label-primary)' }}
                  placeholder="e.g. john@company.com"
                />
              </div>
              {errors.email && <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--red)' }}><AlertCircle size={11} />{errors.email}</p>}
            </div>
          </div>
        )}

        {step === 'jd' && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--label-secondary)' }}>
                <FileText size={14} style={{ color: 'var(--blue)' }} /> Resume
                <span className="font-normal" style={{ color: 'var(--label-tertiary)' }}>(PDF, DOCX, TXT)</span>
              </label>
              {form.resume ? (
                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--fill-quaternary)' }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <File size={20} className="shrink-0" style={{ color: 'var(--blue)' }} />
                    <div className="min-w-0">
                      <p className="text-sm truncate" style={{ color: 'var(--label-primary)' }}>{form.resume.name}</p>
                      <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>{formatFileSize(form.resume.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button" onClick={() => setField('resume', null)}
                    className="p-1.5 rounded-lg transition" style={{ color: 'var(--label-tertiary)' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition bg-surface-800/30 group"
                  style={{ border: '2px dashed var(--separator)', cursor: 'pointer' }}>
                  <Upload size={18} style={{ color: 'var(--label-secondary)' }} />
                  <span className="text-sm" style={{ color: 'var(--label-secondary)' }}>
                    Click to upload resume
                  </span>
                  <input
                    ref={resumeRef}
                    type="file" accept=".pdf,.docx,.txt"
                    className="hidden"
                    onChange={e => setField('resume', e.target.files?.[0] || null)}
                  />
                </label>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--label-secondary)' }}>
                <Briefcase size={14} style={{ color: 'var(--blue)' }} /> Job Description *
              </label>
              <div className="space-y-3">
                <textarea
                  value={form.jobDescription}
                  onChange={e => setField('jobDescription', e.target.value)}
                  rows={7}
                  className="input-field text-xs resize-y"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  placeholder={`Paste the job description here...`}
                />
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--label-tertiary)' }}>
                  <span className="flex-1 h-px" style={{ background: 'var(--separator)' }} />
                  <span>or upload a file</span>
                  <span className="flex-1 h-px" style={{ background: 'var(--separator)' }} />
                </div>
                {form.jobDescriptionFile ? (
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--fill-quaternary)' }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={20} className="shrink-0" style={{ color: 'var(--blue)' }} />
                      <div className="min-w-0">
                        <p className="text-sm truncate" style={{ color: 'var(--label-primary)' }}>{form.jobDescriptionFile.name}</p>
                        <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>{formatFileSize(form.jobDescriptionFile.size)}</p>
                      </div>
                    </div>
                    <button
                      type="button" onClick={() => setField('jobDescriptionFile', null)}
                      className="p-1.5 rounded-lg transition" style={{ color: 'var(--label-tertiary)' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition"
                    style={{ border: '2px dashed var(--separator)', cursor: 'pointer', background: 'rgba(58,58,60,0.3)' }}>
                    <Upload size={18} style={{ color: 'var(--label-secondary)' }} />
                    <span className="text-sm" style={{ color: 'var(--label-secondary)' }}>
                      Upload JD file
                    </span>
                    <input
                      ref={jdFileRef}
                      type="file" accept=".pdf,.docx,.txt"
                      className="hidden"
                      onChange={e => setField('jobDescriptionFile', e.target.files?.[0] || null)}
                    />
                  </label>
                )}
              </div>
              {errors.jobDescription && <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--red)' }}><AlertCircle size={11} />{errors.jobDescription}</p>}
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs font-medium" style={{ color: 'var(--label-secondary)' }}>Review & Confirm</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--fill-quaternary)' }}>
                <div className="flex items-center gap-3">
                  <User size={15} style={{ color: 'var(--blue)' }} />
                  <div>
                    <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>{form.name || '—'}</p>
                    <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>{form.email || '—'}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setStep('details')} className="text-xs transition" style={{ color: 'var(--blue)' }}>Edit</button>
              </div>
              <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: 'var(--fill-quaternary)' }}>
                <div className="flex items-center gap-3">
                  <File size={15} style={{ color: 'var(--blue)' }} />
                  <div>
                    <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>{form.resume ? form.resume.name : 'No resume uploaded'}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setStep('jd')} className="text-xs transition" style={{ color: 'var(--blue)' }}>Edit</button>
              </div>
              <div className="px-4 py-3 rounded-xl" style={{ background: 'var(--fill-quaternary)' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Briefcase size={15} style={{ color: 'var(--blue)' }} />
                    <span className="text-sm" style={{ color: 'var(--label-secondary)' }}>Job Description</span>
                  </div>
                  <button type="button" onClick={() => setStep('jd')} className="text-xs transition" style={{ color: 'var(--blue)' }}>Edit</button>
                </div>
                <p className="text-xs line-clamp-3" style={{ color: 'var(--label-tertiary)' }}>
                  {form.jobDescriptionFile ? form.jobDescriptionFile.name : (form.jobDescription || '—')}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          {step !== 'details' && (
            <button
              type="button" onClick={() => setStep(step === 'jd' ? 'details' : 'jd')}
              className="btn-secondary flex-1"
            >
              Back
            </button>
          )}
          {step !== 'review' ? (
            <button type="button" onClick={handleNext} className="btn-primary flex-1">
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button
              type="submit" disabled={intakeMutation.isPending}
              className="btn-primary flex-1"
            >
              {intakeMutation.isPending ? (
                <><div className="h-4 w-4 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> Submitting...</>
              ) : (
                <><Send size={16} /> Submit for Question Review</>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
