import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Upload, UserPlus, Loader2, ExternalLink, FileText, ChevronDown } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCandidates } from './useCandidates'
import { PageHeader } from '../../shared/components/PageHeader'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { EmptyState } from '../../shared/components/EmptyState'
import { useAuthStore } from '../auth/authStore'
import { supabase } from '../../lib/supabaseClient'
import type { CandidateFilters } from './candidateService'
import type { SourceCategory } from '../../types/database.types'
import { INTERVIEW_STAGES } from '../../types/database.types'

const SOURCES: SourceCategory[] = ['platform', 'agency', 'college']

const SOURCE_NAMES: Record<SourceCategory, string[]> = {
  platform: ['LinkedIn', 'Naukri', 'Indeed', 'Instahyre', 'Cutshort', 'Other'],
  agency:   ['Agency 1', 'Agency 2', 'Other'],
  college:  ['IIT Delhi', 'IIT Kanpur', 'IIT Bombay', 'IIM', 'Other'],
}

export function CandidatesPage() {
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const qc = useQueryClient()
  const canEdit = hasRole(['admin', 'super_admin', 'hr_team'])
  const isSuperAdmin = hasRole(['super_admin'])

  const [filters, setFilters] = useState<CandidateFilters>({})
  const [search, setSearch] = useState('')
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'filter'],
    queryFn: async () => {
      const { data } = await supabase.from('jobs').select('id,title').order('title')
      return data ?? []
    },
  })

  const { data: hrUsers = [] } = useQuery({
    queryKey: ['users', 'hr'],
    queryFn: async () => {
      const { data } = await supabase
        .from('users')
        .select('id,full_name')
        .in('role', ['hr_team', 'admin', 'super_admin'])
        .eq('is_active', true)
      return data ?? []
    },
  })

  const { data: candidates = [], isLoading } = useCandidates({
    ...filters,
    search: search || undefined,
  })

  const updateField = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const { error } = await supabase.from('candidates').update({ [field]: value }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['widget'] })
      setEditingCell(null)
    },
  })

  const setFilter = (key: keyof CandidateFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }))
  }

  const getHRName = (hrId: string | null) => {
    if (!hrId) return null
    return (hrUsers as any[]).find((u) => u.id === hrId)?.full_name ?? null
  }

  const getJobTitle = (jobId: string | null) => {
    if (!jobId) return null
    return (jobs as any[]).find((j) => j.id === jobId)?.title ?? null
  }

  // Inline editable cell — dropdown
  const EditableDropdown = ({ candidateId, field, value, options }: {
    candidateId: string; field: string; value: string | null; options: { label: string; value: string }[]
  }) => {
    const isEditing = editingCell?.id === candidateId && editingCell?.field === field
    if (!canEdit) return <span className="text-gray-600 text-sm">{value ?? <span className="text-gray-300">—</span>}</span>

    return isEditing ? (
      <select
        autoFocus
        defaultValue={value ?? ''}
        onBlur={(e) => {
          if (e.target.value !== value) {
            updateField.mutate({ id: candidateId, field, value: e.target.value || null })
          } else {
            setEditingCell(null)
          }
        }}
        className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none bg-white"
      >
        <option value="">— None —</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : (
      <button
        onClick={() => setEditingCell({ id: candidateId, field })}
        className="flex items-center gap-1 text-sm text-gray-600 hover:text-blue-600 group/cell w-full text-left"
      >
        <span className="truncate">{value ?? <span className="text-gray-300">—</span>}</span>
        <ChevronDown className="w-3 h-3 text-gray-300 group-hover/cell:text-blue-400 flex-shrink-0 opacity-0 group-hover/cell:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <div>
      <PageHeader
        title="Candidates"
        subtitle={`${candidates.length} total`}
        action={
          canEdit ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => navigate('/upload')}>
                Upload
              </Button>
              <Button size="sm" icon={<UserPlus className="w-3.5 h-3.5" />} onClick={() => navigate('/upload?mode=single')}>
                Add One
              </Button>
            </div>
          ) : null
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select value={filters.job_id ?? ''} onChange={(e) => setFilter('job_id', e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All jobs</option>
          {(jobs as any[]).map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        <select value={filters.stage ?? ''} onChange={(e) => setFilter('stage', e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All stages</option>
          {INTERVIEW_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.source_category ?? ''} onChange={(e) => setFilter('source_category', e.target.value as SourceCategory)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
        {(filters.stage || filters.source_category || filters.job_id || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setSearch('') }}>Clear</Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
      ) : candidates.length === 0 ? (
        <EmptyState title="No candidates found" description="Try clearing filters or upload your first candidate."
          action={canEdit ? <Button size="sm" onClick={() => navigate('/upload')}>Upload candidates</Button> : undefined} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '1400px' }}>
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium sticky left-0 bg-gray-50 z-10">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">LinkedIn</th>
                  <th className="text-left px-4 py-3 font-medium">Resume</th>
                  <th className="text-left px-4 py-3 font-medium">Stage</th>
                  <th className="text-left px-4 py-3 font-medium">Job</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-left px-4 py-3 font-medium">Sub-Source</th>
                  <th className="text-left px-4 py-3 font-medium">HR Owner</th>
                  <th className="text-left px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {candidates.map((c) => (
                  <tr key={c.id} className="hover:bg-blue-50/20 transition-colors group">

                    {/* Name — sticky */}
                    <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-blue-50/20 z-10">
                      <button onClick={() => navigate(`/candidates/${c.id}`)}
                        className="font-medium text-blue-600 hover:underline text-left whitespace-nowrap">
                        {c.full_name}
                      </button>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3">
                      <a href={`mailto:${c.email}`} className="text-gray-600 hover:text-blue-600 text-xs whitespace-nowrap">
                        {c.email}
                      </a>
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.phone
                        ? <a href={`tel:${c.phone}`} className="text-gray-600 hover:text-blue-600 text-xs">{c.phone}</a>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>

                    {/* LinkedIn */}
                    <td className="px-4 py-3">
                      {c.linkedin_url
                        ? <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                            <ExternalLink className="w-3 h-3" />View
                          </a>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>

                    {/* Resume */}
                    <td className="px-4 py-3">
                      {c.resume_url
                        ? <a href={c.resume_url} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                            <FileText className="w-3 h-3" />View
                          </a>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>

                    {/* Stage — inline editable */}
                    <td className="px-4 py-3 min-w-[140px]">
                      <EditableDropdown
                        candidateId={c.id}
                        field="current_stage"
                        value={c.current_stage}
                        options={INTERVIEW_STAGES.map((s) => ({ label: s, value: s }))}
                      />
                    </td>

                    {/* Job — inline editable */}
                    <td className="px-4 py-3 min-w-[160px]">
                      <EditableDropdown
                        candidateId={c.id}
                        field="job_id"
                        value={getJobTitle((c as any).job_id)}
                        options={(jobs as any[]).map((j) => ({ label: j.title, value: j.id }))}
                      />
                    </td>

                    {/* Source Category — inline editable */}
                    <td className="px-4 py-3 min-w-[120px]">
                      <EditableDropdown
                        candidateId={c.id}
                        field="source_category"
                        value={c.source_category}
                        options={SOURCES.map((s) => ({ label: s.charAt(0).toUpperCase() + s.slice(1), value: s }))}
                      />
                    </td>

                    {/* Sub-Source — inline editable */}
                    <td className="px-4 py-3 min-w-[140px]">
                      <EditableDropdown
                        candidateId={c.id}
                        field="source_name"
                        value={c.source_name}
                        options={SOURCE_NAMES[c.source_category]?.map((s) => ({ label: s, value: s })) ?? []}
                      />
                    </td>

                    {/* HR Owner — inline editable (super admin + admin only) */}
                    <td className="px-4 py-3 min-w-[140px]">
                      {isSuperAdmin || hasRole(['admin']) ? (
                        <EditableDropdown
                          candidateId={c.id}
                          field="hr_owner"
                          value={getHRName((c as any).hr_owner)}
                          options={(hrUsers as any[]).map((u) => ({ label: u.full_name, value: u.id }))}
                        />
                      ) : (
                        <span className="text-gray-600 text-sm">{getHRName((c as any).hr_owner) ?? <span className="text-gray-300">—</span>}</span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-4 py-3 max-w-[180px]">
                      {c.notes
                        ? <p className="text-gray-500 text-xs truncate">{c.notes}</p>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
              <p className="text-xs text-gray-400">💡 Click any Stage, Job, Source, or HR Owner cell to edit inline</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
