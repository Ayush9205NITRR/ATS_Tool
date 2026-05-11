import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Star, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../auth/authStore'
import { PageHeader } from '../../shared/components/PageHeader'
import { Badge } from '../../shared/components/Badge'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { EmptyState } from '../../shared/components/EmptyState'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Recommendation } from '../../types/database.types'

const RECS: { value: Recommendation; label: string; colour: string }[] = [
  { value: 'strong_yes', label: 'Strong Yes', colour: 'bg-green-600 text-white' },
  { value: 'yes', label: 'Yes', colour: 'bg-green-100 text-green-700' },
  { value: 'neutral', label: 'Neutral', colour: 'bg-gray-100 text-gray-700' },
  { value: 'no', label: 'No', colour: 'bg-red-100 text-red-600' },
  { value: 'strong_no', label: 'Strong No', colour: 'bg-red-600 text-white' },
]

const schema = z.object({
  stage: z.string().min(1, 'Required'),
  overall_score: z.number().min(1).max(5),
  technical: z.number().min(1).max(5),
  communication: z.number().min(1).max(5),
  culture_fit: z.number().min(1).max(5),
  problem_solving: z.number().min(1).max(5),
  strengths: z.string().optional(),
  concerns: z.string().optional(),
  recommendation: z.enum(['strong_yes','yes','neutral','no','strong_no']),
})
type FormData = z.infer<typeof schema>
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export function InterviewsPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<any>(null)

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['assigned-candidates', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('*, job:jobs(id,title)')
        .contains('assigned_interviewers', [user!.id])
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!user,
  })

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { overall_score: 3, technical: 3, communication: 3, culture_fit: 3, problem_solving: 3 },
  })

  const submitFeedback = useMutation({
    mutationFn: async (d: FormData) => {
      const { error } = await supabase.from('interview_feedback').insert({
        candidate_id: selected.id,
        job_id: selected.job_id,
        interviewer_id: user!.id,
        stage: d.stage,
        overall_score: d.overall_score,
        scores: { technical: d.technical, communication: d.communication, culture_fit: d.culture_fit, problem_solving: d.problem_solving },
        strengths: d.strengths || null,
        concerns: d.concerns || null,
        recommendation: d.recommendation,
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assigned-candidates'] }); setSelected(null); reset() },
  })

  const rec = watch('recommendation')

  return (
    <div>
      <PageHeader title="My Interviews" subtitle={`${candidates.length} candidates assigned to you`} />
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
      ) : candidates.length === 0 ? (
        <EmptyState icon={<ClipboardList className="w-5 h-5" />} title="No candidates assigned" description="You'll see candidates here once an admin assigns them to you." />
      ) : (
        <div className="space-y-3">
          {candidates.map((c: any) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-gray-900">{c.full_name}</p>
                <p className="text-sm text-gray-400">{c.job?.title ?? 'No role'} · {c.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge label={c.current_stage} type="stage" />
                <Button size="sm" onClick={() => setSelected(c)}>Submit Feedback</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Feedback — ${selected?.full_name}`} size="md">
        <form onSubmit={handleSubmit((d) => submitFeedback.mutate(d))} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Interview Stage</label>
            <input {...register('stage')} placeholder="e.g. Technical Round 1" className={inputCls} />
            {errors.stage && <p className="mt-1 text-xs text-red-600">{errors.stage.message}</p>}
          </div>
          {([['overall_score','Overall Score'],['technical','Technical'],['communication','Communication'],['culture_fit','Culture Fit'],['problem_solving','Problem Solving']] as const).map(([field, label]) => (
            <div key={field}>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
              <div className="flex gap-2">
                {[1,2,3,4,5].map((n) => (
                  <button key={n} type="button" onClick={() => setValue(field, n)}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${watch(field) >= n ? 'bg-amber-400 text-white' : 'bg-gray-100 text-gray-400 hover:bg-amber-100'}`}>
                    <Star className="w-4 h-4" fill={watch(field) >= n ? 'currentColor' : 'none'} />
                  </button>
                ))}
                <span className="ml-2 text-sm text-gray-500 self-center">{watch(field)}/5</span>
              </div>
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Strengths</label>
            <textarea {...register('strengths')} rows={2} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Concerns</label>
            <textarea {...register('concerns')} rows={2} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Recommendation *</label>
            <div className="flex gap-2 flex-wrap">
              {RECS.map((r) => (
                <button key={r.value} type="button" onClick={() => setValue('recommendation', r.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border-2 ${rec === r.value ? r.colour + ' border-transparent' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setSelected(null)}>Cancel</Button>
            <Button type="submit" loading={submitFeedback.isPending}>Submit Feedback</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
