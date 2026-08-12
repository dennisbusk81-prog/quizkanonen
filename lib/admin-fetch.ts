import { getAdminToken, adminLoginPath, isAdminLoginPath } from './admin-session'

// Sender det signerte sesjonstokenet, ikke lenger selve admin-passordet.
// Header-navnet er nytt (x-admin-token), men verifyAdminRequest godtar fortsatt
// x-admin-password og Bearer, så manuelle curl-kall og økter som ennå ikke er
// fornyet fungerer uendret.
//
// ── 401 sendes til innlogging, ETT sted (12. august 2026) ───────────────────
//
// Det finnes 72 adminFetch-kall fordelt på fjorten sider. Ingen av dem
// håndterte 401: kallet feilet, siden viste «Kunne ikke hente …» i tre
// sekunder, og satt så igjen med en tom liste som så ut som en tom database.
//
// En 401 betyr én ting — sesjonen er borte — og svaret er alltid det samme, så
// den hører hjemme her og ikke i 72 catch-blokker. Legitime 401-er finnes selv
// etter at lagringen ble samlet i lib/admin-session.ts: tokenet kan utløpe mens
// fanen står åpen (8 timer), og roteres ADMIN_PASSWORD blir alle utstedte
// tokens ugyldige umiddelbart — nøkkelen ER passordet.

/**
 * Hvor forespørselen skal sendes videre, eller null hvis den ikke skal det.
 *
 * Ren funksjon, skilt fra selve navigeringen slik at regelen kan testes uten
 * DOM. Samme deling som `decidePremiumState` / `syncPremiumCache`.
 *
 * Selve URL-en bygges av `adminLoginPath` — samme funksjon som sidenes egen
 * vakt bruker. To formuleringer av «hvor skal jeg tilbake til» var akkurat det
 * som gjorde at `next` virket her og manglet på de tretten sidene.
 */
export function decideAdminRedirect(status: number, currentPath: string): string | null {
  // KUN 401. En 403 betyr «autentisert, men ikke lov», og en 500 betyr at
  // serveren har et problem — å sende brukeren til innlogging i de tilfellene
  // ville skjult den ekte feilen bak en irrelevant innloggingsside.
  if (status !== 401) return null

  // Er vi allerede på innloggingssiden, skal vi ikke navigere I DET HELE TATT —
  // ikke bare unngå `next`. Innloggingen kaller riktignok ikke adminFetch i dag
  // (den går via en server action), men vakten koster ingenting.
  if (isAdminLoginPath(currentPath)) return null

  return adminLoginPath(currentPath)
}

/** Byttes ut i tester. Ellers en full sidenavigering. */
export type Navigate = (url: string) => void

const defaultNavigate: Navigate = (url) => {
  // `replace`, ikke `assign`: tilbakeknappen skal ikke føre brukeren inn i
  // siden som nettopp feilet, der neste kall ville feilet likedan.
  window.location.replace(url)
}

export function adminFetch(
  url: string,
  options: RequestInit = {},
  navigate: Navigate = defaultNavigate,
): Promise<Response> {
  const token = getAdminToken() ?? ''
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': token,
      ...(options.headers ?? {}),
    },
  }).then(res => {
    if (typeof window !== 'undefined') {
      const here = window.location.pathname + window.location.search
      const target = decideAdminRedirect(res.status, here)
      if (target) navigate(target)
    }
    // Responsen returneres uendret. Kallstedet skal fortsatt kunne rydde opp
    // (skru av spinneren, sette loadError) mens navigeringen skjer — ikke få en
    // kastet feil den ikke har bedt om.
    return res
  })
}
