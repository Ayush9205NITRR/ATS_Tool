export function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, hasRole } = useAuthStore()
  const qc = useQueryClient()

  const canEditBase = hasRole(['admin', 'super_admin', 'hr_team'])
  const isInterviewer = hasRole(['interviewer'])
  
  // GLOBAL EDIT STATE
  const [isEditingMode, setIsEditingMode] = useState(false)
  const canEdit = canEditBase && isEditingMode // Fields only editable if mode is active

  const [notes, setNotes] = useState('')
  const [savingGlobal, setSavingGlobal] = useState(false)
  
  // ... (Keep your existing useQuery hooks for candidate, hrUsers, interviewers here) ...

  const updateCandidate = async (patch: Record<string, any>) => {
    await supabase.from('candidates').update(patch).eq('id', id!)
    qc.invalidateQueries({ queryKey: ['candidate', id] })
    qc.invalidateQueries({ queryKey: ['candidates'] })
  }

  const handleGlobalSave = async () => {
    setSavingGlobal(true)
    await updateCandidate({ notes })
    setIsEditingMode(false)
    setSavingGlobal(false)
  }

  // ... (Keep your submitFeedback logic here) ...

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
           {/* Header Info */}
          <h1 className="text-2xl font-bold text-gray-900">{candidate?.full_name}</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* NEW: GLOBAL EDIT BUTTON */}
          {canEditBase && (
            <Button 
              size="sm" 
              variant={isEditingMode ? "primary" : "secondary"}
              onClick={isEditingMode ? handleGlobalSave : () => setIsEditingMode(true)}
              loading={savingGlobal}
            >
              {isEditingMode ? '💾 Save All Changes' : '✏️ Edit Info'}
            </Button>
          )}

          {/* ... Submit Feedback button logic stays same ... */}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2 space-y-4">
          {/* ASSIGNMENT CARD */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Assignment</h3>
            
            {/* NEW: HR Owner is now Multi-Select */}
            <PillMultiSelect
              label="HR Owner (Multi-select)"
              options={hrUsers as any[]}
              selectedIds={candidate?.hr_owner ? [candidate.hr_owner] : []} // Update DB logic if storing array
              disabled={!canEdit}
              onChange={ids => updateCandidate({ hr_owner: ids[0] || null })} // Assuming DB expects string. If array, pass 'ids'
            />

            <PillMultiSelect
              label="Interviewers"
              options={interviewers as any[]}
              selectedIds={candidate?.assigned_interviewers ?? []}
              disabled={!canEdit}
              onChange={ids => updateCandidate({ assigned_interviewers: ids })}
            />
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          {/* GENERAL NOTES */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">General Notes</h3>
            {/* NEW: resize-y allows dragging to make bigger/smaller */}
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={!canEdit}
              rows={4}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none resize-y ${canEdit ? 'border-blue-400 bg-white' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
