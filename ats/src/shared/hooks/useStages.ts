import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'

export interface StageConfig {
  name: string
  color: string      // tailwind bg class
  textColor: string  // tailwind text class
  hasNotes: boolean  // show notes section on profile page
}

export const DEFAULT_STAGE_CONFIGS: StageConfig[] = [
  { name:'Applied',        color:'bg-gray-100',    textColor:'text-gray-700',   hasNotes:false },
  { name:'Screening',      color:'bg-blue-100',    textColor:'text-blue-700',   hasNotes:true  },
  { name:'R1',             color:'bg-indigo-100',  textColor:'text-indigo-700', hasNotes:true  },
  { name:'Case Study',     color:'bg-amber-100',   textColor:'text-amber-700',  hasNotes:true  },
  { name:'R2',             color:'bg-orange-100',  textColor:'text-orange-700', hasNotes:true  },
  { name:'R3',             color:'bg-orange-200',  textColor:'text-orange-800', hasNotes:true  },
  { name:'CF (Virtual)',   color:'bg-purple-100',  textColor:'text-purple-700', hasNotes:true  },
  { name:'CF (In-Person)', color:'bg-purple-200',  textColor:'text-purple-800', hasNotes:true  },
  { name:'Offer',          color:'bg-violet-100',  textColor:'text-violet-700', hasNotes:false },
  { name:'Hired',          color:'bg-green-100',   textColor:'text-green-700',  hasNotes:false },
  { name:'Rejected',       color:'bg-red-100',     textColor:'text-red-600',    hasNotes:false },
]

// Simple string list for backwards compat
export const DEFAULT_STAGES = DEFAULT_STAGE_CONFIGS.map(s => s.name)

export const COLOR_OPTIONS = [
  { bg:'bg-gray-100',   text:'text-gray-700',   label:'Gray'   },
  { bg:'bg-blue-100',   text:'text-blue-700',   label:'Blue'   },
  { bg:'bg-indigo-100', text:'text-indigo-700', label:'Indigo' },
  { bg:'bg-violet-100', text:'text-violet-700', label:'Violet' },
  { bg:'bg-purple-100', text:'text-purple-700', label:'Purple' },
  { bg:'bg-amber-100',  text:'text-amber-700',  label:'Amber'  },
  { bg:'bg-orange-100', text:'text-orange-700', label:'Orange' },
  { bg:'bg-green-100',  text:'text-green-700',  label:'Green'  },
  { bg:'bg-teal-100',   text:'text-teal-700',   label:'Teal'   },
  { bg:'bg-red-100',    text:'text-red-600',    label:'Red'    },
  { bg:'bg-pink-100',   text:'text-pink-700',   label:'Pink'   },
  { bg:'bg-cyan-100',   text:'text-cyan-700',   label:'Cyan'   },
]

// useStages — returns rich stage configs
export function useStages() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['app-settings', 'pipeline_stages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings').select('value').eq('key','pipeline_stages').maybeSingle()
      if (error) {
        console.error('[useStages] DB error:', error.message)
        return DEFAULT_STAGE_CONFIGS
      }
      if (!data?.value) {
        console.warn('[useStages] No pipeline_stages in DB, using defaults')
        return DEFAULT_STAGE_CONFIGS
      }
      try {
        const parsed = JSON.parse(data.value)
        if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_STAGE_CONFIGS
        if (typeof parsed[0] === 'string') {
          return parsed.map((name: string) => {
            const def = DEFAULT_STAGE_CONFIGS.find(s => s.name === name)
            return def ?? { name, color:'bg-gray-100', textColor:'text-gray-700', hasNotes:false }
          }) as StageConfig[]
        }
        console.log('[useStages] Loaded', parsed.length, 'stages from DB:', parsed.map((s:any)=>s.name).join(', '))
        return parsed as StageConfig[]
      } catch (e) {
        console.error('[useStages] Parse error:', e)
        return DEFAULT_STAGE_CONFIGS
      }
    },
    staleTime: 0,
    retry: 2,
  })
  return { stageConfigs: data ?? DEFAULT_STAGE_CONFIGS, isLoading, error }
}

// Convenience — just names (backwards compat)
export function useStageNames() {
  const { stageConfigs } = useStages()
  return stageConfigs.map(s => s.name)
}

export function useSaveStages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (stages: StageConfig[]) => {
      const { error } = await supabase.from('app_settings')
        .upsert({ key:'pipeline_stages', value:JSON.stringify(stages) }, { onConflict:'key' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-settings'] })
      qc.invalidateQueries({ queryKey: ['app-settings','pipeline_stages'] })
    },
  })
}
