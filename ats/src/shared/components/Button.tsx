import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: React.ReactNode
}

const VARIANTS = {
  primary:   'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white border-transparent shadow-sm',
  secondary: 'bg-white hover:bg-zinc-50 active:bg-zinc-100 text-zinc-700 border-zinc-200 shadow-xs',
  ghost:     'bg-transparent hover:bg-zinc-100 active:bg-zinc-200 text-zinc-600 border-transparent',
  danger:    'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border-transparent shadow-sm',
}

const SIZES = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2 text-sm gap-2 rounded-xl',
}

export function Button({
  variant = 'primary', size = 'md', loading, icon, children,
  className = '', disabled, ...props
}: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-medium border
        transition-all duration-150 ease-out
        focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1
        disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
        ${VARIANTS[variant]} ${SIZES[size]} ${className}
      `}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}
