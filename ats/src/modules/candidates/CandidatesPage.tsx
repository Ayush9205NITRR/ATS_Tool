// ============================================================
// CANDIDATES PAGE — filterable, searchable list
// ============================================================
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Upload, UserPlus, Loader2 } from 'lucide-react'
import { useCandidates } from './useCandidates'
import { PageHeader } from '../../shared/components/PageHeader'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { EmptyState } from '../../shared/components/EmptyState'
import { useAuthStore } from '../auth/authStore'
import { formatRelative } from '../../shared/utils/helpers'
import type { CandidateFilters } from './candidateService'
import type { SourceCategory, CandidateStatus } from '../../types/database.types'

const STAGES = ['Applied','Screening','Interview','Offer','Hired','Rejected','Withdrawn']
const SOURCES: SourceCategory[] = ['platform','agency','college']

export function CandidatesPage() {
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const canUpload = hasRole(['admin', 'super_admin'])

  const [filters, setFilters] = useState<CandidateFilters>({})
  const [search, setSearch] = useState('')

  const { data: candidates = [], isLoading } = useCandidates({
    ...filters,
    search: search || undefined,
  })

  const setFilter = (key: keyof CandidateFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }))
  }

  return (
    <div>
      <PageHeader
        title="Candidates"
        subtitle={`${candidates.length} total`}
        action={
          canUpload ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={<Upload className="w-3.5 h-3.5" />}
                onClick={() => navigate('/upload')}>
                Upload
              </Button>
              <Button size="sm" icon={<UserPlus className="w-3.5 h-3.5" />}
                onClick={() => navigate('/upload?mode=single')}>
                Add One
              </Button>
            </div>
          ) : null
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Stage filter */}
        <select
          value={filters.stage ?? ''}
          onChange={(e) => setFilter('stage', e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Source filter */}
        <select
          value={filters.source_category ?? ''}
          onChange={(e) => setFilter('source_category', e.target.value as SourceCategory)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Clear */}
        {(filters.stage || filters.source_category || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setSearch('') }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : candidates.length === 0 ? (
        <EmptyState
          title="No candidates found"
          description={
            filters.stage || filters.source_category || search
              ? 'Try clearing the filters above.'
              : 'Upload your first candidate to get started.'
          }
          action={
            canUpload ? (
              <Button size="sm" onClick={() => navigate('/upload')}>
                Upload candidates
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Job</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Stage</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {candidates.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/candidates/${c.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900">{c.full_name}</p>
                        <p className="text-xs text-gray-400">{c.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                      {(c as any).job?.title ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div>
                        <p className="text-gray-600 capitalize">{c.source_category}</p>
                        <p className="text-xs text-gray-400">{c.source_name}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={c.current_stage} type="stage" />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">
                      {formatRelative(c.created_at)}
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
