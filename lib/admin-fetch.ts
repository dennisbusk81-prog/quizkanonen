import { getAdminPassword } from './admin-auth'

export function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const password = getAdminPassword() ?? ''
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
      ...(options.headers ?? {}),
    },
  })
}
