// ============================================================
// SCHEDULE INTERVIEW MODAL
// Isolated state — no parent re-renders
// Auto-fetches emails, debounced body, resume + JD attachments
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { X, Send, ChevronDown, ExternalLink, Loader2, CheckCircle, Calendar } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'

interface Props {
  candidateId: string
  candidateName: string
  candidateEmail: string
  resumeUrl?: string | null
  jobTitle?: string
  jdLink?: string | null
  onClose: () => void
}

const DEFAULT_TEMPLATE = (candidateName: string, jobTitle: string, interviewerName: string) =>
`Hi ${candidateName},

We're pleased to invite you for an interview for the ${jobTitle} position.

Your interviewer will be ${interviewerName}. Please join the meeting at the scheduled time.

We look forward to speaking with you.

Regards,
The Hiring Team`

export function ScheduleInterviewModal({
  candidateId, candidateName, candidateEmail, resumeUrl, jobTitle = 'the position', jdLink, onClose
}: Props) {
  const { user, hasRole } = useAuthStore()
  const canSchedule = hasRole(['admin', 'super_admin', 'hr_team'])

  // ── Isolated state — no parent re-renders ─────────────────
  const [selectedInterviewerId, setSelectedInterviewerId] = useState('')
  const [dateTime, setDateTime]     = useState('')
  const [bodyText, setBodyText]     = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [sent, setSent]             = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Debounce body edits
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const [liveBody, setLiveBody] = useState('')

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLiveBody(e.target.value) // local — no parent re-render
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setBodyText(e.target.value), 300)
  }

  const { data: interviewers = [] } = useQuery({
    queryKey: ['users', 'interviewers-modal'],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, full_name, email').eq('role', 'interviewer').eq('is_active', true)
      return (data ?? []) as { id: string; full_name: string; email: string }[]
    },
    staleTime: 60_000,
  })

  const selectedInterviewer = interviewers.find(u => u.id === selectedInterviewerId)

  // Auto-populate body when interviewer selected
  useEffect(() => {
    if (!selectedInterviewer) return
    const tmpl = DEFAULT_TEMPLATE(candidateName, jobTitle, selectedInterviewer.full_name)
    setLiveBody(tmpl)
    setBodyText(tmpl)
  }, [selectedInterviewerId, candidateName, jobTitle])

  // Send invite via mailto (calendar link approach — no backend needed)
  const sendInvite = useCallback(() => {
    if (!selectedInterviewer || !dateTime) return

    const subject = encodeURIComponent(`Interview: ${candidateName} — ${jobTitle}`)
    const body = encodeURIComponent([
      bodyText || liveBody,
      '',
      '--- Details ---',
      `Candidate: ${candidateName}`,
      `Email: ${candidateEmail}`,
      `Interview time: ${new Date(dateTime).toLocaleString('en-IN', { dateStyle:'full', timeStyle:'short' })}`,
      resumeUrl ? `Resume: ${resumeUrl}` : '',
      jdLink    ? `Job Description: ${jdLink}` : '',
    ].filter(Boolean).join('\n'))

    // Open mailto with pre-filled to, cc, subject, body
    const mailto = `mailto:${selectedInterviewer.email}?cc=${encodeURIComponent(candidateEmail)}&subject=${subject}&body=${body}`
    window.open(mailto, '_blank')

    // Also update candidate's interview_date in DB
    supabase.from('candidates').update({
      interview_date: new Date(dateTime).toISOString(),
      assigned_interviewers: [selectedInterviewerId],
    }).eq('id', candidateId).then(({ error }) => {
      if (error) console.error('[schedule]', error)
    })

    setSent(true)
  }, [selectedInterviewer, dateTime, bodyText, liveBody, candidateName, candidateEmail, resumeUrl, jdLink, selectedInterviewerId, candidateId, jobTitle])

  if (!canSchedule) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm"/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-gray-100 overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <Calendar className="w-4 h-4 text-blue-600"/>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Schedule Interview</p>
              <p className="text-xs text-gray-400">{candidateName} · {jobTitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4"/>
          </button>
        </div>

        {sent ? (
          <div className="px-6 py-10 flex flex-col items-center gap-3">
            <CheckCircle className="w-10 h-10 text-green-500"/>
            <p className="text-sm font-semibold text-gray-900">Invite email opened!</p>
            <p className="text-xs text-gray-400 text-center">Interview date saved. Send the email from your mail client.</p>
            <button onClick={onClose} className="mt-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors">Done</button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5">

            {/* Interviewer */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Interviewer</label>
              <select value={selectedInterviewerId} onChange={e => setSelectedInterviewerId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none">
                <option value="">Select interviewer…</option>
                {interviewers.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>
                ))}
              </select>
            </div>

            {/* Date & Time */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Date & Time</label>
              <input type="datetime-local" value={dateTime} onChange={e => setDateTime(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
            </div>

            {/* Email preview */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Invite Email Body
                <span className="ml-1.5 text-gray-400 font-normal">— edit before sending</span>
              </label>
              <textarea
                ref={bodyRef}
                rows={7}
                value={liveBody}
                onChange={handleBodyChange}
                placeholder={selectedInterviewerId ? '' : 'Select an interviewer to auto-fill the template…'}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y bg-gray-50 focus:bg-white transition-colors"
              />
            </div>

            {/* Auto-attached items */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
              <p className="text-xs font-medium text-gray-500">Auto-attached to email</p>
              <div className="flex flex-wrap gap-2">
                {resumeUrl ? (
                  <a href={resumeUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full hover:bg-blue-100 transition-colors">
                    <ExternalLink className="w-3 h-3"/>Resume
                  </a>
                ) : (
                  <span className="text-xs text-gray-300 bg-gray-100 px-2.5 py-1 rounded-full">No resume</span>
                )}
                {jdLink ? (
                  <a href={jdLink} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-purple-600 bg-purple-50 px-2.5 py-1 rounded-full hover:bg-purple-100 transition-colors">
                    <ExternalLink className="w-3 h-3"/>Job Description
                  </a>
                ) : (
                  <span className="text-xs text-gray-300 bg-gray-100 px-2.5 py-1 rounded-full">No JD link</span>
                )}
              </div>
            </div>

            {/* Advanced */}
            <div>
              <button onClick={() => setShowAdvanced(o => !o)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced?'':'−rotate-90'}`}/>
                Advanced
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-2 text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
                  <p><span className="font-medium">To:</span> {selectedInterviewer?.email ?? '—'}</p>
                  <p><span className="font-medium">CC:</span> {candidateEmail}</p>
                  <p><span className="font-medium">Subject:</span> Interview: {candidateName} — {jobTitle}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
              <button
                onClick={sendInvite}
                disabled={!selectedInterviewerId || !dateTime}
                className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                <Send className="w-3.5 h-3.5"/>
                Open invite in mail
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
