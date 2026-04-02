export function setAdminSession(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('qk_admin', 'true')
    localStorage.setItem('qk_admin_time', Date.now().toString())
  } catch {
    // Ignorer feil (f.eks. privat modus eller quota)
  }
}

export function isAdminLoggedIn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const isAdmin = localStorage.getItem('qk_admin')
    const loginTime = localStorage.getItem('qk_admin_time')
    if (!isAdmin || !loginTime) return false
    const eightHours = 8 * 60 * 60 * 1000
    return Date.now() - parseInt(loginTime) < eightHours
  } catch {
    return false
  }
}

export function setAdminPassword(password: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('qk_admin_pw', password)
  } catch {
    // ignore
  }
}

export function getAdminPassword(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem('qk_admin_pw')
  } catch {
    return null
  }
}

export function logoutAdmin(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem('qk_admin')
    localStorage.removeItem('qk_admin_time')
    sessionStorage.removeItem('qk_admin_pw')
  } catch {
    // ignore
  }
}
