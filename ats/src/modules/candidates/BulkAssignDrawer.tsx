// ============================================================
// BULK ASSIGN DRAWER — fast panel / HR-owner assignment
// Interviewers: Add / Replace / Remove across selected candidates
// HR Owner: single-value replace
// ============================================================
import { useState, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, Search, Check, Loader2, Users, UserCog, Plus, RefreshCw, Minus } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'

type Person = { id: string; full_name: string }
type Cand   = { id: string; full_name: string; assigned_interviewers?: string[]; hr_owner?: string | null }
type Mode   = 'add' | 'replace' | 'remove'
type Target = 'interviewers' | 'hr_owner'

const MODES: { value: Mode; label: string; icon: any; hint: string }[] = [
  { value: 'add',     label: 'Add',     icon: Plus,      hint: 'Append to existing panels' },
  { value: 'replace', label: 'Replace', icon: RefreshCw, hint: 'Overwrite panels entirely' },
  { value: 'remove',  label: 'Remove',  icon: Minus,     hint: 'Pull selected off the batch' },
]

export function BulkAssignDrawer({
  open, onClose, candidates, interviewers, hrUsers, canAssignHR, onApplied,
}: {
  open: boolean
  onClose: () => void
  candidates: Cand[]
  interviewers: Person[]
  hrUsers: Person[]
  canAssignHR: boolean
  onApplied: () => void
}) {
  const qc = useQueryClient()
  const [target, setTarget] = useState<Target>('interviewers')
  const [mode, setMode]     = useState<Mode>('add')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // Reset state each time the drawer opens
  useEffect(() => {
    if (open) { setTarget('interviewers'); setMode('add'); setSearch(''); setPicked(new Set()); setError(null) }
  }, [open])

  const isSingle = target === 'hr_owner'
  const people   = isSingle ? hrUsers : interviewers
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? people.filter(p => p.full_name.toLowerCase().includes(q)) : people
  }, [people, search])

  // For Remove mode, only show interviewers actually present on the batch
  const removableIds = useMemo(() => {
    if (mode !== 'remove' || isSingle) return null
    return new Set(candidates.flatMap(c => c.assigned_interviewers ?? []))
  }, [mode, isSingle, candidates])

  const listToShow = removableIds
    ? filtered.filter(p => removableIds.has(p.id))
    : filtered

  const togglePick = (id: string) => {
    setPicked(prev => {
      if (isSingle) return prev.has(id) ? new Set() : new Set([id])
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const ids = candidates.map(c => c.id)
  const canApply = ids.length > 0 && picked.size > 0 && !saving

  const apply = async () => {
    if (!canApply) return
    const pickedArr = [...picked]
    setSaving(true); setError(null)
    try {
      if (isSingle) {
        const { error } = await supabase.from('candidates').update({ hr_owner: pickedArr[0] ?? null }).in('id', ids)
        if (error) throw error
      } else if (mode === 'replace') {
        const { error } = await supabase.from('candidates').update({ assigned_interviewers: pickedArr }).in('id', ids)
        if (error) throw error
      } else {
        // Add / Remove — compute per candidate, then group identical results into one write each
        const resultByKey = new Map<string, string[]>()
        const idsByKey     = new Map<string, string[]>()
        for (const c of candidates) {
          const cur = c.assigned_interviewers ?? []
          const next = mode === 'add'
            ? [...new Set([...cur, ...pickedArr])]
            : cur.filter(x => !picked.has(x))
          const key = JSON.stringify([...next].sort())
          if (!idsByKey.has(key)) { idsByKey.set(key, []); resultByKey.set(key, next) }
          idsByKey.get(key)!.push(c.id)
        }
        for (const [key, cids] of idsByKey) {
          const { error } = await supabase.from('candidates')
            .update({ assigned_interviewers: resultByKey.get(key)! }).in('id', cids)
          if (error) throw error
        }
      }
      qc.invalidateQueries({ queryKey: ['candidates'] })
      onApplied()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to apply changes')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const applyLabel = isSingle
    ? `Assign to ${ids.length}`
    : mode === 'add'     ? `Add to ${ids.length}`
    : mode === 'replace' ? `Replace on ${ids.length}`
    :                      `Remove from ${ids.length}`

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-900/20 backdrop-blur-[1px]" onClick={onClose} />
      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-[slideIn_.18s_ease-out]">
        <style>{`@keyframes slideIn{from{transform:translateX(16px);opacity:.6}to{transform:translateX(0);opacity:1}}`}</style>

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Bulk Assign</h2>
            <p className="text-xs text-gray-400 mt-0.5">{ids.length} candidate{ids.length !== 1 ? 's' : ''} selected</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Target toggle */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Assign</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setTarget('interviewers'); setPicked(new Set()) }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  target === 'interviewers' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                <Users className="w-4 h-4" /> Interview Panel
              </button>
              {canAssignHR && (
                <button
                  onClick={() => { setTarget('hr_owner'); setMode('replace'); setPicked(new Set()) }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    target === 'hr_owner' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  <UserCog className="w-4 h-4" /> HR Owner
                </button>
              )}
            </div>
          </div>

          {/* Mode toggle — interviewers only */}
          {!isSingle && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Operation</p>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map(m => {
                  const Icon = m.icon
                  const active = mode === m.value
                  return (
                    <button key={m.value}
                      onClick={() => { setMode(m.value); setPicked(new Set()) }}
                      className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-xs transition-colors ${
                        active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      <Icon className="w-3.5 h-3.5" />
                      {m.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">{MODES.find(m => m.value === mode)?.hint}</p>
            </div>
          )}

          {/* Search */}
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isSingle ? 'Search HR owners…' : 'Search interviewers…'}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* People list */}
            <div className="mt-2 border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {listToShow.length === 0 ? (
                <p className="text-xs text-gray-400 italic px-3 py-4 text-center">
                  {mode === 'remove' && !isSingle ? 'None of the selected candidates have a panel yet.' : 'No matches.'}
                </p>
              ) : listToShow.map(p => {
                const sel = picked.has(p.id)
                return (
                  <button key={p.id} onClick={() => togglePick(p.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2.5 transition-colors">
                    <span className={`w-4 h-4 rounded ${isSingle ? 'rounded-full' : ''} flex-shrink-0 border flex items-center justify-center ${
                      sel ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                    }`}>
                      {sel && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className={sel ? 'text-gray-900 font-medium' : 'text-gray-700'}>{p.full_name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Affected candidates preview */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Affects</p>
            <div className="flex flex-wrap gap-1">
              {candidates.slice(0, 8).map(c => (
                <span key={c.id} className="text-xs bg-gray-50 border border-gray-100 text-gray-600 px-2 py-0.5 rounded-md">{c.full_name}</span>
              ))}
              {candidates.length > 8 && (
                <span className="text-xs text-gray-400 px-1 py-0.5">+{candidates.length - 8} more</span>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={!canApply}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Applying…</> : applyLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
