import { getAdminToken } from './admin-auth'

// Sender det signerte sesjonstokenet, ikke lenger selve admin-passordet.
// Header-navnet er nytt (x-admin-token), men verifyAdminRequest godtar fortsatt
// x-admin-password og Bearer, så manuelle curl-kall og økter som ennå ikke er
// fornyet fungerer uendret.
export function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAdminToken() ?? ''
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': token,
      ...(options.headers ?? {}),
    },
  })
}
