// ============================================================
// SEND EMAIL MODAL
// - Loads templates, parses {variables}
// - Opens mailto: with pre-filled content (no server needed)
// - Debounced body editing, isolated state
// ============================================================
import { useState, useRef, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Mail, Check, ChevronDown, Send, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'

interface CandidateInfo {
  id: string; full_name: string; email: string
  job?: { title: string; jd_link?: string | null } | null
  resume_url?: string | null
  interview_date?: string | null
}

interface Props {
  candidates: CandidateInfo[]
  defaultType?: string // 'rejection' | 'interview_invite' | 'stage_update'
  onClose: () => void
}

// Parse {variable} placeholders
function parseTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}

export function SendEmailModal({ candidates, defaultType = 'custom', onClose }: Props) {
  const { user, hasRole } = useAuthStore()
  const canSend = hasRole(['admin', 'super_admin', 'hr_team'])

  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [subject, setSubject]   = useState('')
  const [liveBody, setLiveBody] = useState('')
  const [sending, setSending]   = useState(false)
  const [sent, setSent]         = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const [committedBody, setCommittedBody] = useState('')

  const { data: templates = [] } = useQuery({
    queryKey: ['email-templates', 'active'],
    queryFn: async () => {
      const { data } = await supabase.from('email_templates')
        .select('*').eq('is_active', true).order('type').order('name')
      return data ?? []
    },
    staleTime: 60_000,
  })

  const selectedTemplate = (templates as any[]).find(t => t.id === selectedTemplateId)

  // Load template and parse for first candidate as preview
  const loadTemplate = useCallback((templateId: string) => {
    const tmpl = (templates as any[]).find(t => t.id === templateId)
    if (!tmpl) return
    setSelectedTemplateId(templateId)

    // Use first candidate for preview
    const c = candidates[0]
    const vars: Record<string, string> = {
      name: c.full_name,
      job: c.job?.title ?? 'the position',
      company: 'Enout',
      interviewer: '',
      date: c.interview_date ? new Date(c.interview_date).toLocaleString('en-IN', {dateStyle:'full',timeStyle:'short'}) : '',
      mode: 'Video Call',
      sender_name: user?.full_name ?? 'Hiring Team',
      jd_link: c.job?.jd_link ? `Job Description: ${c.job.jd_link}` : '',
      resume_note: c.resume_url ? `Resume on file: ${c.resume_url}` : '',
    }

    const parsedSubject = parseTemplate(tmpl.subject, vars)
    const parsedBody    = parseTemplate(tmpl.body, vars)

    setSubject(parsedSubject)
    setLiveBody(parsedBody)
    setCommittedBody(parsedBody)
  }, [templates, candidates, user])

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLiveBody(e.target.value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setCommittedBody(e.target.value), 250)
  }

  const handleSend = useCallback(async () => {
    if (!subject || !liveBody) return
    setSending(true)

    // For each candidate, open mailto with personalized content
    // (For bulk, open one mailto with all emails in BCC)
    if (candidates.length === 1) {
      const c = candidates[0]
      const vars: Record<string, string> = {
        name: c.full_name,
        job: c.job?.title ?? 'the position',
        company: 'Enout',
        interviewer: '',
        date: c.interview_date ? new Date(c.interview_date).toLocaleString('en-IN',{dateStyle:'full',timeStyle:'short'}) : '',
        mode: 'Video Call',
        sender_name: user?.full_name ?? 'Hiring Team',
        jd_link: c.job?.jd_link ? `Job Description: ${c.job.jd_link}` : '',
        resume_note: c.resume_url ? `Resume on file: ${c.resume_url}` : '',
      }
      const finalSubject = parseTemplate(subject, vars)
      const finalBody = parseTemplate(committedBody || liveBody, vars)
      const mailto = `mailto:${c.email}?subject=${encodeURIComponent(finalSubject)}&body=${encodeURIComponent(finalBody)}`
      window.open(mailto, '_blank')
    } else {
      // Bulk — one draft to BCC all
      const emails = candidates.map(c => c.email).join(',')
      const mailto = `mailto:?bcc=${encodeURIComponent(emails)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(committedBody || liveBody)}`
      window.open(mailto, '_blank')
    }

    // Log in DB
    try {
      await supabase.from('email_log').insert(
        candidates.map(c => ({
          template_id: selectedTemplateId || null,
          candidate_id: c.id,
          to_email: c.email,
          subject: subject,
          status: 'sent',
          sent_at: new Date().toISOString(),
          sent_by: user?.id,
        }))
      )
    } catch (e) { console.error('[email log]', e) }

    setSending(false)
    setSent(true)
  }, [subject, liveBody, committedBody, candidates, selectedTemplateId, user])

  const typeTemplates = useMemo(() => {
    const byType: Record<string, any[]> = {}
    ;(templates as any[]).forEach(t => {
      if (!byType[t.type]) byType[t.type] = []
      byType[t.type].push(t)
    })
    return byType
  }, [templates])

  if (!canSend) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm"/>
      <div onClick={e=>e.stopPropagation()}
        className="relative bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
              <Mail className="w-4 h-4 text-white"/>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Send Email {candidates.length > 1 ? `(${candidates.length} candidates)` : `to ${candidates[0]?.full_name}`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {candidates.length === 1 ? candidates[0]?.email : `${candidates.length} recipients via BCC`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4"/>
          </button>
        </div>

        {sent ? (
          <div className="px-6 py-12 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
              <Check className="w-6 h-6 text-green-600"/>
            </div>
            <p className="text-sm font-semibold text-gray-900">Email draft opened!</p>
            <p className="text-xs text-gray-500">Send from your mail client. Email logged in system.</p>
            <button onClick={onClose} className="mt-3 px-6 py-2 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800">Done</button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

            {/* Template picker */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Load a template</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(typeTemplates).map(([type, tmplList]) => (
                  <div key={type}>
                    <p className="text-xs text-gray-400 mb-1 capitalize">{type.replace('_',' ')}</p>
                    <div className="space-y-1">
                      {tmplList.map((t:any) => (
                        <button key={t.id} onClick={() => loadTemplate(t.id)}
                          className={`w-full text-left text-xs px-2.5 py-2 rounded-lg border transition-all ${
                            selectedTemplateId === t.id
                              ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                          }`}>
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100"/>

            {/* Subject */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subject *</label>
              <input value={subject} onChange={e=>setSubject(e.target.value)}
                placeholder="Email subject…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
            </div>

            {/* Body */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600">Email Body *</label>
                {candidates.length > 1 && (
                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    Preview uses first candidate's data
                  </span>
                )}
              </div>
              <textarea rows={12} value={liveBody} onChange={handleBodyChange}
                placeholder="Write your email or select a template above…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y bg-gray-50/40 focus:bg-white transition-colors"/>
            </div>
          </div>
        )}

        {!sent && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50/40">
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={handleSend} disabled={!subject || !liveBody || sending}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-40 transition-all">
              {sending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/>Opening…</>
                : <><Send className="w-3.5 h-3.5"/>Open email draft</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
