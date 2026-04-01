import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

export type Profile = {
  id: string
  display_name: string | null
  avatar_url: string | null
  premium_status: boolean
  created_at: string
}

export type Quiz = {
  id: string
  title: string
  description: string
  opens_at: string
  closes_at: string
  time_limit_seconds: number
  num_options: number
  show_leaderboard: boolean
  hide_leaderboard_until_closed: boolean
  show_live_placement: boolean
  show_answer_explanation: boolean
  randomize_questions: boolean
  allow_teams: boolean
  requires_access_code: boolean
  is_active: boolean
}

export type Question = {
  id: string
  quiz_id: string
  question_text: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
  correct_answer: string
  explanation: string | null
  order_index: number
  time_limit_seconds: number | null
}

export type Attempt = {
  id: string
  quiz_id: string
  player_name: string
  is_team: boolean
  team_size: number
  correct_answers: number
  total_questions: number
  total_time_ms: number
  completed_at: string
}
