import { z } from 'zod'

export const candidateFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Valid email is required'),
  jobDescription: z.string().min(10, 'Job description must be at least 10 characters'),
  resume: z.instanceof(File).refine(
    f => ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].includes(f.type),
    'Resume must be PDF, DOCX, or TXT'
  ).optional()
})

export type CandidateFormValues = z.infer<typeof candidateFormSchema>

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trimEnd() + '...'
}
