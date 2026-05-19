// SubSourceField — dynamic dropdown based on source_category
// Source=Agency   → dropdown of agency users
// Source=Platform → dropdown of platform names
// Source=College  → free text input
import { useAgencies, PLATFORM_SOURCES } from '../hooks/useAgencies'

interface Props {
  sourceCategory: string
  value: string
  onChange: (v: string) => void
  className?: string
  disabled?: boolean
  required?: boolean
}

export function SubSourceField({ sourceCategory, value, onChange, className = '', disabled, required }: Props) {
  const { data: agencies = [] } = useAgencies()

  const inputCls = `w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 ${className}`

  if (sourceCategory === 'agency') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls} disabled={disabled} required={required}>
        <option value="">Select agency…</option>
        {agencies.map(a => (
          <option key={a.id} value={a.name}>{a.name}</option>
        ))}
        {agencies.length === 0 && (
          <option disabled value="">No agency users — add in Settings → Team Members (role: Agency)</option>
        )}
      </select>
    )
  }

  if (sourceCategory === 'platform') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls} disabled={disabled} required={required}>
        <option value="">Select platform…</option>
        {PLATFORM_SOURCES.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    )
  }

  // College — free text
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="e.g. IIT Delhi, IIM Bangalore, BITS Pilani…"
      className={inputCls}
      disabled={disabled}
      required={required}
    />
  )
}
