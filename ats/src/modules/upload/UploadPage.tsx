import { useSearchParams } from 'react-router-dom'
import { UserPlus, FileSpreadsheet, FileSearch } from 'lucide-react'
import { SingleEntryForm } from './single/SingleEntryForm'
import { CsvUploader } from './bulk/CsvUploader'
import { SingleResumeUpload } from '../resume-upload/SingleResumeUpload'
import { BulkResumeUpload } from '../resume-upload/BulkResumeUpload'

type Mode = 'single' | 'bulk' | 'resume-single' | 'resume-bulk'

const MODES = [
  {
    id: 'single',
    icon: UserPlus,
    label: 'Manual Entry',
    desc: 'Fill a form for one candidate',
    color: 'blue',
  },
  {
    id: 'bulk',
    icon: FileSpreadsheet,
    label: 'Bulk CSV',
    desc: 'Upload many candidates at once',
    color: 'blue',
  },
  {
    id: 'resume-single',
    icon: FileSearch,
    label: 'Parse Resume URL',
    desc: 'Auto-extract from a single resume',
    color: 'violet',
  },
  {
    id: 'resume-bulk',
    icon: FileSearch,
    label: 'Bulk Resume URLs',
    desc: 'Parse many resumes via CSV',
    color: 'violet',
  },
] as const

export function UploadPage() {
  const [params, setParams] = useSearchParams()
  const mode = (params.get('mode') as Mode) ?? 'single'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Add Candidates</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Choose how you'd like to add candidates to the pipeline.
        </p>
      </div>

      {/* Mode Tabs */}
      <div className="bg-white rounded-2xl shadow-card p-1.5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
          {MODES.map(m => {
            const Icon = m.icon
            const active = mode === m.id
            const isViolet = m.color === 'violet'
            return (
              <button
                key={m.id}
                onClick={() => setParams({ mode: m.id })}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-150 ${
                  active
                    ? isViolet
                      ? 'bg-violet-600 shadow-sm'
                      : 'bg-indigo-600 shadow-sm'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  active
                    ? 'bg-white/20'
                    : isViolet ? 'bg-violet-50' : 'bg-indigo-50'
                }`}>
                  <Icon className={`w-4 h-4 ${
                    active ? 'text-white' : isViolet ? 'text-violet-500' : 'text-indigo-500'
                  }`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold truncate ${active ? 'text-white' : 'text-gray-800'}`}>
                    {m.label}
                  </p>
                  <p className={`text-xs truncate ${active ? 'text-white/70' : 'text-gray-400'}`}>
                    {m.desc}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Divider with label */}
      {(mode === 'resume-single' || mode === 'resume-bulk') && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs font-medium text-violet-600 bg-violet-50 border border-violet-100 px-3 py-1 rounded-full">
            AI Resume Parsing
          </span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>
      )}

      {/* Content */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        {mode === 'single'        && <div className="p-6"><SingleEntryForm /></div>}
        {mode === 'bulk'          && <div className="p-6"><CsvUploader /></div>}
        {mode === 'resume-single' && <SingleResumeUpload />}
        {mode === 'resume-bulk'   && <BulkResumeUpload />}
      </div>
    </div>
  )
}
