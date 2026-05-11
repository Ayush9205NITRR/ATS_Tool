import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Upload, UserPlus, Loader2, ExternalLink, FileText } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
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

export function CandidatesPage() {
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const canUpload = hasRole(['admin', 'super_admin', 'hr_team'])

  const [filters, setFilters] = useState<CandidateFilters>({})
  const [search, setSearch] = useState('')

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
      return data ?? []
    },
  })

  const { data: candidates = [], isLoading } = useCandidates({
    ...filters,
    search: search || undefined,
  })

  const setFilter = (key: keyof CandidateFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }))
  }

  const getHRName = (hrId: string | null) => {
    if (!hrId) return null
    const u = (hrUsers as any[]).find((u) => u.id === hrId)
    return u?.full_name ?? null
  }

  return (
    <div>
      <PageHeader
        title="Candidates"
        subtitle={`${candidates.length} total`}
        action={
          canUpload ? (
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

        <select
          value={filters.job_id ?? ''}
          onChange={(e) => setFilter('job_id', e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All jobs</option>
          {(jobs as any[]).map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>

        <select
          value={filters.stage ?? ''}
          onChange={(e) => setFilter('stage', e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All stages</option>
          {INTERVIEW_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={filters.source_category ?? ''}
          onChange={(e) => setFilter('source_category', e.target.value as SourceCategory)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>

        {(filters.stage || filters.source_category || filters.job_id || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setSearch('') }}>
            Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
      ) : candidates.length === 0 ? (
        <EmptyState
          title="No candidates found"
          description="Try clearing filters or upload your first candidate."
          action={canUpload ? <Button size="sm" onClick={() => navigate('/upload')}>Upload candidates</Button> : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '1100px' }}>
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">LinkedIn</th>
                  <th className="text-left px-4 py-3 font-medium">Resume</th>
                  <th className="text-left px-4 py-3 font-medium">Stage</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-left px-4 py-3 font-medium">Sub-Source</th>
                  <th className="text-left px-4 py-3 font-medium">HR Owner</th>
                  <th className="text-left px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {candidates.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-blue-50/30 transition-colors group"
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/candidates/${c.id}`)}
                        className="font-medium text-blue-600 hover:underline text-left"
                      >
                        {c.full_name}
                      </button>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3">
                      <a href={`mailto:${c.email}`} className="text-gray-600 hover:text-blue-600 transition-colors">
                        {c.email}
                      </a>
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3 text-gray-600">
                      {c.phone
                        ? <a href={`tel:${c.phone}`} className="hover:text-blue-600">{c.phone}</a>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>

                    {/* LinkedIn */}
                    <td className="px-4 py-3">
                      {c.linkedin_url
                        ? (
                          <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                            <ExternalLink className="w-3 h-3" />View
                          </a>
                        )
                        : <span className="text-gray-300">—</span>
                      }
                    </td>

                    {/* Resume */}
                    <td className="px-4 py-3">
                      {c.resume_url
                        ? (
                          <a href={c.resume_url} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                            <FileText className="w-3 h-3" />View
                          </a>
                        )
                        : <span className="text-gray-300">—</span>
                      }
                    </td>

                    {/* Stage */}
                    <td className="px-4 py-3">
                      <Badge label={c.current_stage} type="stage" />
                    </td>

                    {/* Source Category */}
                    <td className="px-4 py-3 text-gray-600 capitalize">
                      {c.source_category}
                    </td>

                    {/* Sub-Source */}
                    <td className="px-4 py-3 text-gray-600">
                      {c.source_name}
                    </td>

                    {/* HR Owner */}
                    <td className="px-4 py-3 text-gray-600">
                      {getHRName((c as any).hr_owner) ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Notes preview */}
                    <td className="px-4 py-3 max-w-xs">
                      {c.notes
                        ? <p className="text-gray-500 text-xs truncate max-w-[160px]">{c.notes}</p>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
