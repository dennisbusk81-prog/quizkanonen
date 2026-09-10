// Profil-hentingen som en BEKREFTET henting, ikke en verdi med fallbacks.
//
// Bakgrunn (6. august 2026): `app/profil/page.tsx` hentet profilraden med
//   Promise.race([ …maybeSingle(), <5s reject> ]).catch(() => ({ data: null, error: null }))
// og satte deretter `loadState` til 'ready' UBETINGET. To konsekvenser:
//
//   1. Fordi .catch() svelget alt, kunne loadProfile aldri kaste — feilgrenen
//      `.catch(() => setLoadState('error'))` på kallstedet var i praksis død kode.
//   2. `error`-feltet fra Supabase ble aldri lest (kun `.data`), så en ekte
//      spørringsfeil ble bit-identisk med «raden finnes ikke».
//
// Resultatet var at ni felt ble presentert med `??`-fallbacks som om de var
// brukerens lagrede innstillinger: blankt visningsnavn, grå avatar, borte
// medlemsnummer, og e-postbrytere som viste noe annet enn det cronene faktisk
// gjør. Skjermen påsto noe vi ikke visste — nøyaktig samme feilklasse som
// lib/fetch-result.ts ble skrevet for.
//
// Derfor: `Loaded<T>` gjenbrukes herfra (ikke et nytt parallelt mønster), og
// `withTimeout` fra lib/with-timeout.ts eier tidsgrensen — den rydder timeren i
// begge utfall og gjør en sen resolve harmløs, i motsetning til `Promise.race`,
// som lot 5-sekunders-timeren løpe videre etter at svaret hadde landet.
import { type Loaded } from './fetch-result'
import { withTimeout, type TimeoutOptions } from './with-timeout'

export type ProfileRow = {
  display_name: string | null
  nickname: string | null
  member_number: number | null
  show_member_number: boolean | null
  email_reminders: boolean | null
  email_reengagement: boolean | null
  email_duel_notifications: boolean | null
  created_at: string | null
  avatar_color: string | null
}

// Kun den delen av supabase-js sin `.maybeSingle()`-kontrakt vi faktisk bruker
// — samme grep som `MinimalResponse` i lib/fetch-result.ts, så logikken kan
// testes uten en ekte Supabase-klient.
export type MaybeSingleResult = { data: unknown; error: unknown }

/**
 * Ett oppslag → «vet» eller «vet ikke».
 *
 * `error` sjekkes FØRST og er utslagsgivende alene. Det er hele rettelsen:
 * PostgREST gir `{ data: null, error: {...} }` ved RLS-avslag, 500 og
 * nettverksbrudd, og den gamle koden leste kun `.data` — altså samme verdi som
 * en tom rad. `ok: true, value: null` er forbeholdt det ene tilfellet der vi
 * FAKTISK har fått svar og svaret er «ingen rad».
 */
export function toLoadedRow<T>(res: MaybeSingleResult): Loaded<T | null> {
  if (res.error) return { ok: false }
  if (res.data == null) return { ok: true, value: null }
  return { ok: true, value: res.data as T }
}

export function toLoadedProfile(res: MaybeSingleResult): Loaded<ProfileRow | null> {
  return toLoadedRow<ProfileRow>(res)
}

/**
 * Oppslaget med tidsgrense. Timeout og feil kollapser bevisst til samme
 * `{ ok: false }`: skjermen skal si det samme i begge tilfeller («vi klarte
 * ikke å hente innstillingene dine, prøv igjen»), og et skille ville bare
 * fristet en framtidig kaller til å behandle den ene som «tomt».
 */
export async function loadProfileRow(
  // PromiseLike, ikke Promise: supabase-js sin spørringsbygger er en thenable
  // uten .catch/.finally. `Promise.resolve` gjør den om til et ekte promise —
  // og abonnerer samtidig, som er nettopp når spørringen skal fyre av.
  query: PromiseLike<MaybeSingleResult>,
  options: TimeoutOptions,
): Promise<Loaded<ProfileRow | null>> {
  const outcome = await withTimeout(Promise.resolve(query), options)
  if (!outcome.ok) return { ok: false }
  return toLoadedProfile(outcome.value)
}

// Feltene profilsiden faktisk skriver inn i React-state. `createdAt` er med
// fordi BÅDE medlemsnummer-tellingen og «Medlem siden»-linjen utledes av den.
export type ProfileFields = {
  displayName: string
  nickname: string
  avatarColor: string | null
  showMemberNumber: boolean
  emailReminders: boolean
  emailReengagement: boolean
  emailDuelNotifications: boolean
  createdAt: string | null
}

/**
 * Skjermtilstanden. Dette er den strukturelle sperren i endringen:
 * `fields` finnes KUN på 'ready'-grenen. Det er umulig å få tak i et sett
 * fallback-verdier ut av en feilet henting — ikke fordi kalleren husker å la
 * være, men fordi verdiene ikke eksisterer i den grenen.
 *
 * Det er viktigere enn det ser ut. Skrivestien på profilsiden (savePref,
 * handleSaveNickname, handleToggleShowMember) sender nøyaktig disse verdiene
 * tilbake til serveren. Fram til nå var det bare tilfeldige gates som hindret
 * en skriving basert på fallbacks: avkryssingsboksen for medlemsnummer er
 * gated på `memberNumber !== null`, og Lagre-knappen for kallenavn er disabled
 * når feltet er uendret — begge sanne ved en feilet henting, men ingen av dem
 * satt der for å beskytte mot dette.
 */
export type ProfileScreen =
  | { state: 'ready'; fields: ProfileFields }
  | { state: 'error' }

/**
 * Fallback-verdiene under speiler kolonnenes DEFAULT i databasen, og er
 * uendret fra 89c0b27: `email_reminders` er NOT NULL DEFAULT false (opt-in —
 * send-reminders-cronen henter kun på `= true`), mens `email_reengagement` og
 * `email_duel_notifications` er nullable DEFAULT true (opt-out).
 *
 * De er nå bare gyldige der de er sanne: på en BEKREFTET henting. Er raden
 * fraværende (`value === null`), er defaultene faktisk det brukeren har —
 * raden opprettes med dem ved første skriving. Er hentingen feilet, vet vi
 * ingenting, og da finnes de ikke.
 */
export function deriveProfileScreen(loaded: Loaded<ProfileRow | null>): ProfileScreen {
  if (!loaded.ok) return { state: 'error' }
  const row = loaded.value
  return {
    state: 'ready',
    fields: {
      displayName: row?.display_name ?? '',
      nickname: row?.nickname ?? '',
      avatarColor: row?.avatar_color ?? null,
      showMemberNumber: row?.show_member_number ?? false,
      emailReminders: row?.email_reminders ?? false,
      emailReengagement: row?.email_reengagement ?? true,
      emailDuelNotifications: row?.email_duel_notifications ?? true,
      createdAt: row?.created_at ?? null,
    },
  }
}
