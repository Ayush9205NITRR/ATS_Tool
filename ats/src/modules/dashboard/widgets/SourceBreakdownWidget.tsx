// ============================================================
// SOURCE BREAKDOWN WIDGET — pie/bar of Platform/Agency/College
// ============================================================
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabaseClient'
import { WidgetBase } from './WidgetBase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const COLOURS: Record<string, string> = {
  platform: '#2563EB',
  agency:   '#7C3AED',
  college:  '#D97706',
}

export function SourceBreakdownWidget() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['widget', 'source-breakdown'],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('source_category')
      if (!data) return []
      const counts: Record<string, number> = {}
      data.forEach((c) => {
        counts[c.source_category] = (counts[c.source_category] ?? 0) + 1
      })
      return Object.entries(counts).map(([name, value]) => ({ name, value }))
    },
  })

  return (
    <WidgetBase title="Source Breakdown" loading={isLoading} error={error?.message}>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No data yet</p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="value" radius={[4,4,0,0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLOURS[entry.name] ?? '#6B7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetBase>
  )
}
