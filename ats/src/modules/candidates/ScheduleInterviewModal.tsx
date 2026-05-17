// ============================================================
// SCHEDULE INTERVIEW MODAL
// - Generates .ics calendar invite (blocks calendar for all)
// - To: Candidate + Interviewer, Organizer: HR
// - Auto-fetches JD link from job, resume from candidate
// - Debounced body, isolated state
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Send, ChevronDown, ExternalLink, Calendar, CheckCircle, Loader2, Link } from 'lucide-react'
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

// ── Generate .ics file content ─────────────────────────────────
function generateICS(params: {
  title: string
  description: string
  startISO: string
  durationMinutes: number
  organizerEmail: string
  organizerName: string
  attendees: { name: string; email: string }[]
  location?: string
}): string {
  const start = new Date(params.startISO)
  const end = new Date(start.getTime() + params.durationMinutes * 60_000)

  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')

  const uid = `interview-${Date.now()}@ats`

  const attendeeLines = params.attendees
    .map(a => `ATTENDEE;CN="${a.name}";RSVP=TRUE:mailto:${a.email}`)
    .join('\r\n')

  const desc = params.description.replace(/\n/g, '\\n').replace(/,/g, '\\,')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ATS Interview Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${params.title}`,
    `DESCRIPTION:${desc}`,
    `ORGANIZER;CN="${params.organizerName}":mailto:${params.organizerEmail}`,
    attendeeLines,
    params.location ? `LOCATION:${params.location}` : '',
    `DTSTAMP:${fmt(new Date())}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Interview in 30 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

// ── Download .ics file ─────────────────────────────────────────
function downloadICS(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const DEFAULT_BODY = (
  candidateName: string,
  interviewerName: string,
  jobTitle: string,
  hrName: string,
  jdLink?: string | null,
  resumeUrl?: string | null
) => `Dear ${candidateName},

We are pleased to invite you for an interview for the ${jobTitle} role.

You will be meeting with ${interviewerName}. Please accept the calendar invite to confirm your availability.

${jdLink ? `Job Description: ${jdLink}\n` : ''}${resumeUrl ? `Your Resume on file: ${resumeUrl}\n` : ''}
Please let us know if you have any questions.

Best regards,
${hrName}
Hiring Team`

export function ScheduleInterviewModal({
  candidateId, candidateName, candidateEmail,
  resumeUrl, jobTitle = 'Open Position', jdLink, onClose
}: Props) {
  const { user, hasRole } = useAuthStore()
  const canSchedule = hasRole(['admin', 'super_admin', 'hr_team'])

  // ── All state is local — zero parent re-renders ───────────
  const [selectedInterviewerId, setSelectedInterviewerId] = useState('')
  const [dateTime, setDateTime]     = useState('')
  const [duration, setDuration]     = useState('60')
  const [location, setLocation]     = useState('Google Meet / Video Call')
  const [liveBody, setLiveBody]     = useState('')
  const [committedBody, setCommittedBody] = useState('')
  const [toEmails, setToEmails]     = useState(candidateEmail)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [done, setDone]             = useState(false)
  const [saving, setSaving]         = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Interviewers list
  const { data: interviewers = [] } = useQuery({
    queryKey: ['users', 'interviewers-schedule'],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, full_name, email').eq('role', 'interviewer').eq('is_active', true)
      return (data ?? []) as { id: string; full_name: string; email: string }[]
    },
    staleTime: 60_000,
  })

  const interviewer = interviewers.find(u => u.id === selectedInterviewerId)

  // Auto-populate body when interviewer changes
  useEffect(() => {
    if (!interviewer) return
    const body = DEFAULT_BODY(
      candidateName, interviewer.full_name, jobTitle,
      user?.full_name ?? 'Hiring Team', jdLink, resumeUrl
    )
    setLiveBody(body)
    setCommittedBody(body)
    // Update To field: Candidate + Interviewer
    setToEmails(`${candidateEmail}, ${interviewer.email}`)
  }, [selectedInterviewerId, interviewer?.email])

  // Debounced body
  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLiveBody(e.target.value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setCommittedBody(e.target.value), 250)
  }

  const handleSend = useCallback(async () => {
    if (!interviewer || !dateTime) return
    setSaving(true)

    const description = [
      committedBody || liveBody,
      '',
      '--- Interview Details ---',
      `Role: ${jobTitle}`,
      `Time: ${new Date(dateTime).toLocaleString('en-IN', { dateStyle:'full', timeStyle:'short' })}`,
      `Duration: ${duration} minutes`,
      `Location: ${location}`,
      jdLink ? `Job Description: ${jdLink}` : '',
      resumeUrl ? `Candidate Resume: ${resumeUrl}` : '',
    ].filter(Boolean).join('\n')

    // 1. Generate & download .ics calendar invite
    const ics = generateICS({
      title: `Interview: ${candidateName} — ${jobTitle}`,
      description,
      startISO: dateTime,
      durationMinutes: parseInt(duration),
      organizerEmail: user?.email ?? '',
      organizerName: user?.full_name ?? 'HR',
      attendees: [
        { name: candidateName, email: candidateEmail },
        { name: interviewer.full_name, email: interviewer.email },
      ],
      location,
    })
    downloadICS(ics, `interview-${candidateName.replace(/\s+/g,'-')}.ics`)

    // 2. Save to DB
    await supabase.from('candidates').update({
      interview_date: new Date(dateTime).toISOString(),
      assigned_interviewers: [selectedInterviewerId],
    }).eq('id', candidateId)

    // 3. Open email draft for the body
    const subject = encodeURIComponent(`Interview Invitation: ${candidateName} — ${jobTitle}`)
    const body = encodeURIComponent(description)
    const mailto = `mailto:${toEmails}?subject=${subject}&body=${body}`
    window.open(mailto, '_blank')

    setSaving(false)
    setDone(true)
  }, [interviewer, dateTime, duration, location, committedBody, liveBody, jobTitle, jdLink, resumeUrl, candidateName, candidateEmail, toEmails, selectedInterviewerId, candidateId, user])

  if (!canSchedule) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm"/>
      <div
        onClick={e => e.stopPropagation()}
        className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[90vh] overflow-hidden rounded-t-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
              <Calendar className="w-4 h-4 text-white"/>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Schedule Interview</p>
              <p className="text-xs text-gray-400 mt-0.5">{candidateName} · {jobTitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4"/>
          </button>
        </div>

        {done ? (
          <div className="px-6 py-12 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600"/>
            </div>
            <p className="text-sm font-semibold text-gray-900">Interview scheduled!</p>
            <p className="text-xs text-gray-500 max-w-xs">
              Calendar invite (.ics) downloaded — open it to add to your calendar.
              Email draft opened in your mail client.
            </p>
            <button onClick={onClose}
              className="mt-3 px-6 py-2 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800 transition-colors">
              Done
            </button>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            <div className="px-6 py-5 space-y-5">

              {/* Interviewer */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Interviewer</label>
                <select value={selectedInterviewerId} onChange={e => setSelectedInterviewerId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">Select interviewer…</option>
                  {interviewers.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>
                  ))}
                </select>
              </div>

              {/* Date/Time + Duration row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Date & Time</label>
                  <input type="datetime-local" value={dateTime} onChange={e => setDateTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Duration</label>
                  <select value={duration} onChange={e => setDuration(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    {[['30','30 min'],['45','45 min'],['60','1 hour'],['90','1.5 hours'],['120','2 hours']].map(([v,l])=>(
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* To: field — editable */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  To <span className="text-gray-400 font-normal">— candidate + interviewer</span>
                </label>
                <input value={toEmails} onChange={e => setToEmails(e.target.value)}
                  placeholder="email1@example.com, email2@example.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                <p className="mt-1 text-xs text-gray-400">Organizer: {user?.full_name} ({user?.email})</p>
              </div>

              {/* Attachments row */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Attachments in email</label>
                <div className="flex flex-wrap gap-2">
                  {jdLink ? (
                    <a href={jdLink} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
                      <Link className="w-3 h-3"/>Job Description
                    </a>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-lg">
                      <Link className="w-3 h-3"/>No JD link on job
                    </span>
                  )}
                  {resumeUrl ? (
                    <a href={resumeUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 border border-violet-100 px-2.5 py-1.5 rounded-lg hover:bg-violet-100 transition-colors">
                      <ExternalLink className="w-3 h-3"/>Resume
                    </a>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-lg">
                      <ExternalLink className="w-3 h-3"/>No resume on file
                    </span>
                  )}
                </div>
              </div>

              {/* Email body — editable, debounced */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Email body <span className="text-gray-400 font-normal">— fully editable</span>
                </label>
                <textarea
                  rows={8}
                  value={liveBody}
                  onChange={handleBodyChange}
                  placeholder={selectedInterviewerId ? '' : 'Select an interviewer first to auto-fill…'}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y bg-gray-50/50 focus:bg-white transition-colors font-mono"
                />
              </div>

              {/* Location */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Meeting Link / Location</label>
                <input value={location} onChange={e => setLocation(e.target.value)}
                  placeholder="https://meet.google.com/... or office address"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"/>
              </div>

              {/* Advanced */}
              <div>
                <button onClick={() => setShowAdvanced(o => !o)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors select-none">
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced?'':'−rotate-90'}`}/>
                  How it works
                </button>
                {showAdvanced && (
                  <div className="mt-3 bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1.5 border border-gray-100">
                    <p>1. <strong className="text-gray-700">Download .ics file</strong> — opens in Google/Outlook/Apple Calendar and blocks the slot for all attendees</p>
                    <p>2. <strong className="text-gray-700">Email draft opens</strong> — pre-filled with the body above, send it from your mail client</p>
                    <p>3. <strong className="text-gray-700">Candidate & Interviewer</strong> both receive calendar invite and email</p>
                    <p>4. <strong className="text-gray-700">JD + Resume links</strong> auto-included in calendar invite description</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {!done && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0 bg-gray-50/50">
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!selectedInterviewerId || !dateTime || saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/>Scheduling…</>
                : <><Calendar className="w-3.5 h-3.5"/>Download invite + Send email</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
