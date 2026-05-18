// ============================================================
// SCHEDULE INTERVIEW MODAL — Isolated, zero parent re-renders
// Rich text editor, auto-fetch emails, .ics calendar blocking
// ============================================================
import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Calendar, CheckCircle, Loader2, Bold, Italic, Link as LinkIcon, ChevronDown } from 'lucide-react'
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

// ── .ics generator ────────────────────────────────────────────
function makeICS(params: {
  title: string; description: string; start: Date; minutes: number
  organizer: string; organizerName: string
  attendees: { name: string; email: string }[]
  location: string
}) {
  const fmt = (d: Date) => d.toISOString().replace(/[-:.]/g,'').slice(0,15)+'Z'
  const end = new Date(params.start.getTime() + params.minutes * 60000)
  const uid = `ats-${Date.now()}@enout.in`
  const desc = params.description.replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/<[^>]+>/g,'')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Enout ATS//EN',
    'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${fmt(params.start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${params.title}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${params.location}`,
    `ORGANIZER;CN="${params.organizerName}":mailto:${params.organizer}`,
    ...params.attendees.map(a => `ATTENDEE;CN="${a.name}";RSVP=TRUE:mailto:${a.email}`),
    `DTSTAMP:${fmt(new Date())}`,
    'STATUS:CONFIRMED', 'SEQUENCE:0',
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Interview in 30 min', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}

function downloadICS(content: string, name: string) {
  const b = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const u = URL.createObjectURL(b)
  const a = Object.assign(document.createElement('a'), { href: u, download: name })
  a.click(); URL.revokeObjectURL(u)
}

// ── Rich text toolbar ─────────────────────────────────────────
const RichBar = memo(({ editorRef }: { editorRef: React.RefObject<HTMLDivElement> }) => {
  const cmd = (command: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
  }
  const insertLink = () => {
    const url = prompt('Enter URL:')
    if (url) cmd('createLink', url)
  }
  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50/50">
      <button onMouseDown={e=>{e.preventDefault();cmd('bold')}}
        className="p-1.5 rounded hover:bg-gray-200 text-gray-600 transition-colors" title="Bold">
        <Bold className="w-3.5 h-3.5"/>
      </button>
      <button onMouseDown={e=>{e.preventDefault();cmd('italic')}}
        className="p-1.5 rounded hover:bg-gray-200 text-gray-600 transition-colors" title="Italic">
        <Italic className="w-3.5 h-3.5"/>
      </button>
      <div className="w-px h-4 bg-gray-200 mx-1"/>
      <button onMouseDown={e=>{e.preventDefault();insertLink()}}
        className="p-1.5 rounded hover:bg-gray-200 text-gray-600 transition-colors" title="Insert link">
        <LinkIcon className="w-3.5 h-3.5"/>
      </button>
    </div>
  )
})

// ── Default template ──────────────────────────────────────────
const makeTemplate = (candidateName: string, interviewerName: string, jobTitle: string, hrName: string, jdLink?: string|null, resumeUrl?: string|null) =>
`Dear ${candidateName},

We are pleased to invite you for an interview for the <strong>${jobTitle}</strong> role at Enout.

You will be meeting with <strong>${interviewerName}</strong>. Please accept the calendar invite attached to block the time on your calendar.

${jdLink ? `<a href="${jdLink}">📄 Job Description</a>` : ''}
${resumeUrl ? `<a href="${resumeUrl}">📎 Your Resume on file</a>` : ''}

Please feel free to reach out if you have any questions.

Warm regards,<br/>
<strong>${hrName}</strong><br/>
Hiring Team, Enout`

// ── Main modal ────────────────────────────────────────────────
export function ScheduleInterviewModal({ candidateId, candidateName, candidateEmail, resumeUrl, jobTitle='Open Position', jdLink, onClose }: Props) {
  const { user, hasRole } = useAuthStore()
  const qc = useQueryClient()
  if (!hasRole(['admin','super_admin','hr_team'])) return null

  // All state isolated — no parent re-renders
  const [interviewerId, setInterviewerId] = useState('')
  const [dateTime, setDateTime]           = useState('')
  const [duration, setDuration]           = useState('60')
  const [location, setLocation]           = useState('Google Meet / Video Call')
  const [toField, setToField]             = useState(candidateEmail)
  const [showAdv, setShowAdv]             = useState(false)
  const [done, setDone]                   = useState(false)
  const [saving, setSaving]               = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  const { data: interviewers = [] } = useQuery({
    queryKey: ['users','interviewers-schedule'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id,full_name,email').eq('role','interviewer').eq('is_active',true)
      return (data ?? []) as { id:string; full_name:string; email:string }[]
    },
    staleTime: 60_000,
  })

  // Fetch org email from settings
  const { data: orgEmail } = useQuery({
    queryKey: ['settings','org-email'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key','org_email').maybeSingle()
      return data?.value ?? user?.email ?? ''
    },
    staleTime: 60_000,
  })

  const interviewer = interviewers.find(u => u.id === interviewerId)

  // Auto-fill template when interviewer selected
  useEffect(() => {
    if (!interviewer || !editorRef.current) return
    editorRef.current.innerHTML = makeTemplate(candidateName, interviewer.full_name, jobTitle, user?.full_name ?? 'Hiring Team', jdLink, resumeUrl)
    setToField(`${candidateEmail}, ${interviewer.email}`)
  }, [interviewerId])

  const handleSend = useCallback(async () => {
    if (!interviewer || !dateTime) return
    setSaving(true)

    const bodyHTML = editorRef.current?.innerHTML ?? ''
    const bodyText = editorRef.current?.innerText ?? ''

    // 1. Generate + download .ics
    const ics = makeICS({
      title: `Interview: ${candidateName} — ${jobTitle}`,
      description: `${bodyText}\n\n${jdLink ? 'JD: ' + jdLink : ''}\n${resumeUrl ? 'Resume: ' + resumeUrl : ''}`,
      start: new Date(dateTime),
      minutes: parseInt(duration),
      organizer: orgEmail || user?.email || '',
      organizerName: user?.full_name || 'HR',
      attendees: [
        { name: candidateName, email: candidateEmail },
        { name: interviewer.full_name, email: interviewer.email },
      ],
      location,
    })
    downloadICS(ics, `interview-${candidateName.replace(/\s+/g,'-')}.ics`)

    // 2. Save interview date to DB
    await supabase.from('candidates').update({
      interview_date: new Date(dateTime).toISOString(),
      assigned_interviewers: [interviewerId],
    }).eq('id', candidateId)

    // 3. Open mailto
    const subject = `Interview Invitation — ${candidateName} | ${jobTitle}`
    window.open(`mailto:${toField}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`, '_blank')

    qc.invalidateQueries({ queryKey: ['candidates'] })
    setSaving(false)
    setDone(true)
  }, [interviewer, dateTime, duration, location, toField, interviewerId, candidateId, orgEmail])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm"/>
      <div onClick={e=>e.stopPropagation()}
        className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center flex-shrink-0">
              <Calendar className="w-4 h-4 text-white"/>
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

        {done ? (
          <div className="px-6 py-12 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600"/>
            </div>
            <p className="font-semibold text-gray-900">Interview scheduled!</p>
            <p className="text-xs text-gray-500 max-w-xs">Calendar invite (.ics) downloaded. Open it to add to Google/Outlook Calendar. Email draft opened.</p>
            <button onClick={onClose} className="mt-2 px-5 py-2 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800 transition-colors">Done</button>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Interviewer */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Interviewer</label>
                <select value={interviewerId} onChange={e=>setInterviewerId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">Select interviewer…</option>
                  {interviewers.map(u=><option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>)}
                </select>
              </div>

              {/* Date + Duration */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date & Time</label>
                  <input type="datetime-local" value={dateTime} onChange={e=>setDateTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Duration</label>
                  <select value={duration} onChange={e=>setDuration(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    {[['30','30 min'],['45','45 min'],['60','1 hour'],['90','1.5 hrs'],['120','2 hours']].map(([v,l])=>(
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* To field */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To <span className="text-gray-400 font-normal">(editable)</span></label>
                <input value={toField} onChange={e=>setToField(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-400"/>
                <p className="mt-0.5 text-xs text-gray-400">From: {orgEmail || user?.email}</p>
              </div>

              {/* Rich text body */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email body <span className="text-gray-400 font-normal">— fully editable</span></label>
                <div className="border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-slate-400">
                  <RichBar editorRef={editorRef}/>
                  <div
                    ref={editorRef}
                    contentEditable="true"
                    suppressContentEditableWarning
                    className="min-h-[160px] px-3 py-2.5 text-sm leading-relaxed focus:outline-none"
                    style={{ whiteSpace: 'pre-wrap' }}
                  />
                </div>
              </div>

              {/* Location */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Location / Meeting link</label>
                <input value={location} onChange={e=>setLocation(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"/>
              </div>

              {/* Advanced */}
              <button onClick={()=>setShowAdv(o=>!o)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdv?'':'rotate-[-90deg]'}`}/>
                How calendar blocking works
              </button>
              {showAdv && (
                <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1 border border-gray-100">
                  <p>1. <strong className="text-gray-700">.ics file downloads</strong> — open it to add to Google/Outlook/Apple Calendar</p>
                  <p>2. All attendees (candidate + interviewer) are added to the invite</p>
                  <p>3. <strong className="text-gray-700">Email draft opens</strong> with the body above — send from your mail client</p>
                  <p>4. JD + Resume links auto-included in invite description</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
              <button onClick={handleSend} disabled={!interviewerId || !dateTime || saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                {saving
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/>Scheduling…</>
                  : <><Calendar className="w-3.5 h-3.5"/>Download invite & send email</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
