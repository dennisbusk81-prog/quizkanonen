import { supabase } from './supabase'

export async function checkIsAdmin(email: string): Promise<boolean> {
  const { data } = await supabase
    .from('admin_users')
    .select('email')
    .eq('email', email)
    .maybeSingle()
  return !!data
}

// Legacy localStorage helpers — still used by existing admin pages.
// The auth callback writes these after verifying admin_users, so
// the rest of the admin section continues to work unchanged.
export function setAdminSession(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('qk_admin', 'true')
  localStorage.setItem('qk_admin_time', Date.now().toString())
}

export function isAdminLoggedIn(): boolean {
  if (typeof window === 'undefined') return false
  const isAdmin = localStorage.getItem('qk_admin')
  const loginTime = localStorage.getItem('qk_admin_time')
  if (!isAdmin || !loginTime) return false
  const eightHours = 8 * 60 * 60 * 1000
  return Date.now() - parseInt(loginTime) < eightHours
}

export function logoutAdmin(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem('qk_admin')
  localStorage.removeItem('qk_admin_time')
  supabase.auth.signOut()
}
