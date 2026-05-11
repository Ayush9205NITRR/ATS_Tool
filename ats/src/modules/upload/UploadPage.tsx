// ============================================================
// UPLOAD PAGE — two clear modes: single entry or CSV bulk
// ============================================================
import { useSearchParams } from 'react-router-dom'
import { UserPlus, FileSpreadsheet } from 'lucide-react'
import { SingleEntryForm } from './single/SingleEntryForm'
import { CsvUploader } from './bulk/CsvUploader'
import { PageHeader } from '../../shared/components/PageHeader'

type Mode = 'single' | 'bulk'

export function UploadPage() {
  const [params, setParams] = useSearchParams()
  const mode = (params.get('mode') as Mode) ?? 'single'

  return (
    <div>
      <PageHeader
        title="Add Candidates"
        subtitle="Add candidates one by one or upload a CSV in bulk."
      />

      {/* Mode selector */}
      <div className="flex gap-3 mb-6">
        <ModeCard
          active={mode === 'single'}
          icon={<UserPlus className="w-5 h-5" />}
          title="Add one candidate"
          description="Fill a form manually"
          onClick={() => setParams({ mode: 'single' })}
        />
        <ModeCard
          active={mode === 'bulk'}
          icon={<FileSpreadsheet className="w-5 h-5" />}
          title="Bulk CSV upload"
          description="Upload many at once"
          onClick={() => setParams({ mode: 'bulk' })}
        />
      </div>

      {/* Form area */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {mode === 'single' ? <SingleEntryForm /> : <CsvUploader />}
      </div>
    </div>
  )
}

function ModeCard({ active, icon, title, description, onClick }: {
  active: boolean; icon: React.ReactNode; title: string; description: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center gap-4 px-5 py-4 rounded-xl border-2 text-left transition-all ${
        active
          ? 'border-blue-600 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className={`${active ? 'text-blue-600' : 'text-gray-400'}`}>{icon}</div>
      <div>
        <p className={`text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-700'}`}>{title}</p>
        <p className={`text-xs ${active ? 'text-blue-500' : 'text-gray-400'}`}>{description}</p>
      </div>
    </button>
  )
}
