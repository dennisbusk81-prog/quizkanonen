import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRowsChunked } from '@/lib/paginate'

/**
 * Hvem har IKKE meldt seg av? (9. september 2026)
 *
 * En avmelding som ikke stopper e-posten er verdiløs, så hver
 * avmeldingstype i lib/unsubscribe.ts har en kolonne på `profiles`, og
 * utsendingsstedet MÅ lese den før det sender. De to nye
 * (`email_weekly_report`, `email_org_reminders`) leses herfra, slik at
 * begge stedene har nøyaktig samme oppførsel — særlig i feiltilfellet.
 *
 * KASTER ved lesefeil, med vilje. Kallstedene skal da IKKE sende: vi vet
 * ikke hvem som har meldt seg av, og ukjent er ikke samtykke. Samme
 * prinsipp som `lib/has-settled-plays.ts` og varslingsloggen i
 * cron/send-reminders — «ikke fått svar» betyr UKJENT, aldri «påmeldt».
 * En tom Set ville sett ut som «alle har meldt seg av» og gitt motsatt
 * feil av den vi frykter, men den skjulte da lesefeilen bak en normal,
 * stille null-utsending.
 *
 * Kolonnene er NOT NULL DEFAULT true (migrasjon 20260909000001), så
 * `.eq(kolonne, true)` er uttømmende. Var de nullable, ville PostgREST
 * filtrert bort NULL-radene også — et stille hull der noen som aldri har
 * meldt seg av mister e-posten.
 */
export async function fetchOptedInIds(
  userIds: string[],
  columns: string[],
): Promise<Set<string>> {
  if (userIds.length === 0 || columns.length === 0) return new Set()

  const rows = await fetchAllRowsChunked<{ id: string }>(
    userIds,
    (chunk, from, to) => {
      // Chunket fordi `.in()` brekker rundt ~390 id-er — en LAVERE grense
      // enn radtaket på 1000, altså den vi treffer først. Se lib/paginate.ts.
      let q = supabaseAdmin.from('profiles').select('id')
      for (const column of columns) q = q.eq(column, true)
      return q.in('id', chunk).order('id', { ascending: true }).range(from, to)
    },
  )

  return new Set(rows.map(r => r.id))
}
