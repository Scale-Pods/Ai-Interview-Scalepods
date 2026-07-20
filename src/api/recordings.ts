import { supabase } from './client'
import type { Recording } from '@/types'

export async function fetchRecordings(sessionId: string): Promise<Recording[]> {
  const { data, error } = await supabase
    .from('recordings_ai_interview')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createRecording(
  sessionId: string,
  streamType: Recording['stream_type']
): Promise<Recording> {
  const { data, error } = await supabase
    .from('recordings_ai_interview')
    .insert({
      session_id: sessionId,
      stream_type: streamType,
      status: 'processing',
      storage_path: `sessions/${sessionId}/${streamType}/${Date.now()}`
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateRecordingStatus(
  id: string,
  status: Recording['status'],
  updates?: Partial<Recording>
): Promise<void> {
  const { error } = await supabase
    .from('recordings_ai_interview')
    .update({ status, ...updates })
    .eq('id', id)
  if (error) throw error
}

export async function getRecordingUploadUrl(
  recordingId: string
): Promise<string> {
  const { data, error } = await supabase
    .storage
    .from('recordings')
    .createSignedUploadUrl(`recording_${recordingId}.webm`)
  if (error) throw error
  return data.signedUrl
}
