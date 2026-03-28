export const ADMIN_EMAIL = 'quizkanonen@gmail.com'

export function checkAdminPassword(password: string): boolean {
  return password === 'QuizAdmin2025!'
}

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
}