import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'

// Per-mottaker-tilstanden som gjør quiz-varslingen gjenopptakbar. Se
// supabase/migrations/20260805000000_quiz_notification_log.sql for hvorfor
// tabellen finnes og hvorfor kolonnene ser ut som de gjør.
//
// Kontrakten mot cron-rutene er to funksjoner:
//   • fetchAlreadyNotified() FØR sendingen — hvem er alt dekket?
//   • stampNotified() PER BATCH under sendingen — hvem er nettopp dekket?
//
// Det er bevisst ingen «er denne quizen ferdig varslet?»-funksjon her. En slik
// sjekk ville vært alt-eller-intet, og sammen med stempling per batch bytter
// den dobbeltsending mot stille undersending. Er alle varslet, kommer settet
// fra fetchAlreadyNotified tilbake som et supersett av mottakerlisten, og
// kjøringen avsluttes like billig — men uten å kunne ta feil.

export const NOTIFY_CHANNEL = {
  /** Åpningse-post til innloggede med profiles.email_reminders = true. */
  quizOpenEmail: 'quiz_open_email',
  /** Web push til hvert abonnement i push_subscriptions. */
  quizOpenPush: 'quiz_open_push',
  /** «En time igjen»-e-post til medlemmene i én organisasjon. */
  orgCloseEmail: 'org_close_email',
} as const

export type NotifyChannel = (typeof NOTIFY_CHANNEL)[keyof typeof NOTIFY_CHANNEL]

/**
 * scope_id for varsler som ikke hører til en organisasjon.
 *
 * Sentinel og ikke NULL: kolonnen er del av primærnøkkelen, og PostgREST sin
 * upsert må kunne navngi en unik indeks over vanlige kolonner.
 */
export const GLOBAL_SCOPE = '00000000-0000-0000-0000-000000000000'

export type NotifyTarget = {
  quizId: string
  channel: NotifyChannel
  /** Utelates for alt som ikke er org-spesifikt. */
  scopeId?: string
}

/**
 * Mottakerne som allerede har fått nettopp dette varselet.
 *
 * Paginert. Ett kall dekker én quiz og én kanal, altså på det meste antall
 * mottakere for den quizen — under 1000 i dag, men det er nøyaktig den typen
 * antakelse som gir stille avkutting når listen vokser.
 *
 * MERK: vi filtrerer på quiz_id + channel og trekker fra i JS. Å snu det og
 * spørre `.in('recipient_id', ids)` ville truffet URL-lengdegrensen på ~390
 * id-er lenge før radtaket på 1000 — se lib/paginate.ts.
 */
export async function fetchAlreadyNotified(
  { quizId, channel, scopeId = GLOBAL_SCOPE }: NotifyTarget
): Promise<Set<string>> {
  const rows = await fetchAllRows<{ recipient_id: string }>((from, to) =>
    supabaseAdmin
      .from('quiz_notification_log')
      .select('recipient_id')
      .eq('quiz_id', quizId)
      .eq('channel', channel)
      .eq('scope_id', scopeId)
      .order('recipient_id', { ascending: true })
      .range(from, to)
  )
  return new Set(rows.map(r => r.recipient_id))
}

/**
 * Stempler mottakerne som FAKTISK fikk varselet i denne batchen.
 *
 * Kastes det her, skal kalleren stoppe — ikke fortsette. Fortsatte den, ville
 * hver videre batch sendes uten å kunne merkes, og neste kjøring sende alt på
 * nytt. `dispatchInBatches` gjør nettopp dette.
 *
 * `ignoreDuplicates` gjør skrivingen idempotent: to overlappende kjøringer
 * skal ikke kunne felle hverandre på primærnøkkelen.
 */
export async function stampNotified(
  { quizId, channel, scopeId = GLOBAL_SCOPE }: NotifyTarget,
  recipientIds: readonly string[],
): Promise<void> {
  if (recipientIds.length === 0) return

  const { error } = await supabaseAdmin
    .from('quiz_notification_log')
    .upsert(
      recipientIds.map(recipient_id => ({
        quiz_id: quizId,
        channel,
        scope_id: scopeId,
        recipient_id,
      })),
      { onConflict: 'quiz_id,channel,scope_id,recipient_id', ignoreDuplicates: true },
    )

  if (error) throw new Error(error.message)
}
