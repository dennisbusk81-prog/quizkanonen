/**
 * «Er dette svaret en BEKREFTET liste, eller vet vi ingenting?»
 *
 * Bakgrunn (19. august 2026, QK_0 [A-1]): åtte admin-sider oversatte et
 * feilsvar til en tom liste og lot skjermen påstå «Ingen X ennå». Formene var
 * ulike, men feilen den samme — et feilsvar er «vet ikke», aldri «tomt»:
 *
 *   • `if (res.ok) { setRows(data.rows ?? []) }` uten else   (retention)
 *   • `Promise.all([...]).finally(() => setLoading(false))` uten .catch
 *     (classics, sporsmal) — .finally slo av spinneren, .then kjørte aldri
 *   • `catch { console.error(e) }` og ingenting mer                (analytics)
 *   • `if (res.ok) setData(await res.json())` uten else               (results)
 *   • `questionsRes.ok ? await questionsRes.json() : { questions: [] }`
 *     (quizzes/new) — den verste: editoren åpnet med ett tomt spørsmål på en
 *     quiz som hadde ti
 *
 * Grunnen til at feilklassen kunne gjenta seg åtte ganger er at avgjørelsen ble
 * skrevet på nytt i hver kaller. Her er den ETT sted, og den kan kjøres i en
 * test — i motsetning til en `if`-setning inne i en klientkomponent.
 *
 * Samme deling som `decideAdminRedirect` / `autoDismissMs`: regelen er ren og
 * testbar, navigeringen og setState-en blir igjen hos kalleren.
 *
 * Testdekket i lib/admin-load.test.ts.
 */

/**
 * Det minste av `Response` disse funksjonene faktisk bruker.
 *
 * Bevisst ikke `Response`: en test skal kunne mate inn `{ ok: false, status:
 * 500, json: … }` uten fetch, uten DOM og uten nettverk. Det er nettopp den
 * simulerte feilhentingen som er beviset.
 */
export type AdminResponseLike = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

/**
 * Leser kroppen ut av et admin-API-svar, eller KASTER.
 *
 * Kaster — returnerer ikke null eller en tom form — fordi kalleren ellers kan
 * glemme å skille utfallene, og det er akkurat den forglemmelsen hele filen
 * finnes for. En `throw` kan ikke leses som data ved et uhell.
 */
export async function readAdminBody(res: AdminResponseLike): Promise<unknown> {
  if (!res.ok) throw new Error(`API svarte ${res.status}`)

  // En 200 med ugyldig JSON er også «vet ikke». Uten denne ville en avkuttet
  // respons blitt en rå SyntaxError om posisjon 0, i stedet for noe en admin
  // kan handle på.
  try {
    return await res.json()
  } catch {
    throw new Error('Uleselig svar fra serveren')
  }
}

/**
 * Plukker en liste ut av en allerede lest kropp, eller KASTER.
 *
 * Ren funksjon — ingen I/O — slik at flere lister kan hentes ut av ÉN lest
 * kropp (analytics har tre).
 *
 * @param key Nøkkelen lista ligger under (`'rows'`, `'questions'`), eller
 *            `null` når selve kroppen ER lista (`/api/admin/quizzes`).
 */
export function pickAdminList<T>(body: unknown, key: string | null): T[] {
  const value = key === null ? body : (body as Record<string, unknown> | null)?.[key]

  // `?? []` er nettopp mønsteret som skapte feilen — en manglende nøkkel er et
  // uventet svarformat, ikke en tom liste.
  if (!Array.isArray(value)) throw new Error('Uventet svarformat fra serveren')

  return value as T[]
}

/** Vanligste tilfellet: ett svar, én liste. */
export async function readAdminList<T>(res: AdminResponseLike, key: string | null): Promise<T[]> {
  return pickAdminList<T>(await readAdminBody(res), key)
}
