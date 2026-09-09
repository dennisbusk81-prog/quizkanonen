// Døgnkvote for org-påminnelser (app/api/org/[slug]/send-reminder).
//
// BAKGRUNN (F1, 9. september 2026)
// Ruten hadde kun en IP-teller (5/time). En IP er ikke en organisasjon: den
// begrenser en maskin, så samme org kunne sendes fra flere nett, og et
// kontornett kunne dele bøtta med noen andre. Samme feilklasse som
// IP-nøklingen i spillestien (lib/play-rate-limit.ts) — mekanismen var
// korrekt, parameteren var det ikke.
//
// HVORFOR IKKE resolveInviteQuota (lib/invite-quota.ts)
// Invitasjonskvoten tier-deler på ALDER og MEDLEMSTALL fordi mottakerne der er
// vilkårlige e-postadresser: en fersk org med få medlemmer er det eneste
// signalet vi har på et relé-forsøk. Her må hver mottaker være medlem av
// orgen (håndhevet i ruten), så mottakerlista er allerede lukket — og da ville
// tier-delingen slått feil vei: en ekte bedrift som kjøper Standard og legger
// inn 40 kolleger på dag én er 'ny' etter invitasjonsmodellen og ville fått
// 15 per kall, altså blitt sperret ute fra å minne på sine egne ansatte.
//
// MEDLEMSTALLET ER GRENSEN
// Én påminnelse går til høyst hvert medlem. `DAILY_ROUNDS = 3` er derfor tre
// fulle runder i døgnet: den ukentlige quizen, en bonusquiz og ett nytt forsøk
// hvis noe feilet — mer enn en reell uke trenger, og et tak som vokser med
// bedriften i stedet for å straffe den for å være stor eller ny.
// `MIN_PER_DAY` gir et gulv, slik at en org med 2 medlemmer ikke får en kvote
// på 6 og blir sperret av sin egen testing.

export type ReminderQuota = {
  /** Maks mottakere i ÉN forespørsel. */
  perCall: number
  /** Maks mottakere summert over siste døgn, per org. */
  perDay: number
}

/** Uendret fra før kvoten fantes — ruten avviste allerede over 50 per kall. */
export const REMINDER_MAX_PER_CALL = 50

export const REMINDER_DAILY_ROUNDS = 3
export const REMINDER_MIN_PER_DAY = 50

/** action_type i admin_actions. Telles der, ikke i minnet: en modul-lokal Map
 *  lever per serverless-instans, så en kald start ville gitt fersk kvote. */
export const REMINDER_ACTION = 'org_reminder_email'

export function resolveReminderQuota(memberCount: number): ReminderQuota {
  const members = Number.isFinite(memberCount) && memberCount > 0 ? Math.floor(memberCount) : 0
  return {
    perCall: REMINDER_MAX_PER_CALL,
    perDay: Math.max(REMINDER_MIN_PER_DAY, members * REMINDER_DAILY_ROUNDS),
  }
}
