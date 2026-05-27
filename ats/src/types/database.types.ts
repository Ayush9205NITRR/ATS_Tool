// ============================================================
// DATABASE TYPES v4 — mirrors Supabase schema exactly.
// ============================================================

export type Role = 'super_admin' | 'admin' | 'hr_team' | 'interviewer' | 'agency'
export type SourceCategory = 'platform' | 'agency' | 'college' | 'referral'
export type CandidateStatus = 'active' | 'rejected' | 'hired' | 'withdrawn'
export type JobStatus = 'draft' | 'open' | 'paused' | 'closed'
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship'
export type Recommendation = 'strong_yes' | 'yes' | 'neutral' | 'no' | 'strong_no'
export type CostApprovalDecision = 'go_ahead' | 'rework_required'

export const INTERVIEW_STAGES = [
  'Applied', 'Screening', 'R1', 'Case Study', 'R2', 'R3',
  'CF (Virtual)', 'CF (In-Person)', 'Offer', 'Hired', 'Rejected'
] as const

export interface NoteEntry {
  text: string
  author: string
  authorId: string
  timestamp: string
}

export interface Agency {
  id: string
  name: string
  created_at: string
}

export interface User {
  id: string
  email: string
  full_name: string
  role: Role
  agency_id: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Job {
  id: string
  title: string
  department: string | null
  location: string | null
  employment_type: EmploymentType | null
  status: JobStatus
  description: string | null
  pipeline_stages: string[]
  hr_owner: string | null
  jd_link: string | null
  show_to_agency: boolean
  allowed_agency_ids: string[]
  created_by: string
  created_at: string
  updated_at: string
  screening_template: string[]
  interview_templates: Record<string, string[]>
}

export interface InterviewNotes {
  screening?: string
  r1?: string
  case_study?: string
  r2?: string
  r3?: string
  cf_virtual?: string
  cf_inperson?: string
}

export interface Candidate {
  id: string
  job_id: string | null
  full_name: string
  email: string
  phone: string | null
  resume_url: string | null
  linkedin_url: string | null
  current_stage: string
  status: CandidateStatus
  source_category: SourceCategory
  source_name: string
  agency_id: string | null
  hr_owner: string | null
  notes: string | null
  screening_notes: string | null
  interview_notes: InterviewNotes
  interview_date: string | null
  custom_data: Record<string, any>
  tags: string[]
  assigned_interviewers: string[]
  archived_at: string | null
  archived_by: string | null
  uploaded_by: string
  created_at: string
  updated_at: string
  cost_approval_decision: CostApprovalDecision | null
  cost_approval_notes: NoteEntry[]
}

export interface InterviewFeedback {
  id: string
  candidate_id: string
  job_id: string
  interviewer_id: string
  stage: string
  overall_score: number
  scores: {
    technical: number
    communication: number
    culture_fit: number
    problem_solving: number
  }
  strengths: string | null
  concerns: string | null
  recommendation: Recommendation
  submitted_at: string
}

export interface CandidateWithJob extends Candidate {
  job?: Pick<Job, 'id' | 'title' | 'pipeline_stages'> | null
  hr_owner_user?: Pick<User, 'id' | 'full_name'> | null
}

export interface FeedbackWithInterviewer extends InterviewFeedback {
  interviewer?: Pick<User, 'id' | 'full_name' | 'avatar_url'>
}

export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  metadata: Record<string, any>
  read_at: string | null
  created_at: string
}

export interface CostApprovalSettings {
  stage_name: string
  reviewer_ids: string[]
}
