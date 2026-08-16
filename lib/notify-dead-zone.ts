import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { NOTIFY_WINDOW_MS, quizHasQuestions, varsleNotifyGuard } from '@/lib/opened-quiz-lookup'
import { GLOBAL_SCOPE, NOTIFY_CHANNEL, type NotifyChannel } from '@/lib/quiz-notification-log'

// ── DØDSONEN: quizer som falt utenfor varslingsvinduet ──────────────────────
//
// BAKGRUNN (16. august 2026)
// `findOpenedQuizToNotify` finner kun quizer der `opens_at` ligger inne i de
// siste 60 minuttene. Gikk hele den timen uten en eneste vellykket cron-kjøring
// — fordi jobben hos cron-job.org var deaktivert, fordi tjenesten var nede,
// eller fordi ruten svarte 500 — så lukker vinduet seg, og quizen blir ALDRI
// varslet av noen kanal. Loggen sier da «Ingen quiz åpnet i vinduet», som er
// den normale meldingen nesten hele tiden. Stille, permanent tap.
//
// Denne filen SENDER INGENTING. Den leser, og rapporterer til Sentry. Det er
// hele poenget: å utvide vinduet ville flyttet grensen noen timer ut og gjort
// feilen sjeldnere, men like usynlig når den først traff. Her blir den synlig
// i stedet, og `NOTIFY_WINDOW_MS` står urørt på 60 minutter.
//
// ── HVORFOR DEN IKKE KAN SENDE DOBBELT ─────────────────────────────────────
// Filen importerer hverken `sendEmail`, `web-push`, `dispatchInBatches` eller
// `stampNotified`. Den skriver ingenting til `quiz_notification_log`, så den
// kan hverken sende et varsel eller stemple noen som varslet — og kan derfor
// heller ikke få en senere, ekte kjøring til å hoppe over noen.
// `lib/notify-dead-zone.test.ts` feller dette som en strukturell sperre, og
// den falske klienten der kaster på enhver skriveoperasjon.
//
// ── HVOR DEN KJØRER, OG HVA DET KOSTER ─────────────────────────────────────
// Kalles fra alle tre varslingsrutene, ikke fra én. Det er ikke for
// sikkerhets skyld: hver rute sjekker ALLE kanaler, så en levende rute
// rapporterer søsterrutenes dødsone. Blir kun `send-push` sin cron-jobb slått
// av, er det `send-reminders` som oppdager det. Lå deteksjonen kun i én rute,
// ville den delt skjebne med nettopp det den skal overvåke.
//
// Steady state koster ÉN spørring per kall: kandidatoppslaget under returnerer
// null rader nesten alltid, og først når en kandidat FAKTISK finnes gjøres
// innholds-, logg- og mottakersjekkene. Med tre ruter à 5 minutter blir det
// ~864 tomme spørringer i døgnet.
//
// Om kostnaden, presist: det finnes INGEN indeks på `quizzes.opens_at` — kun
// på `is_active` (20260401000002). Spørringen er altså en skanning, men over
// 13 rader, og tabellen vokser med én rad i uken. Den er billig fordi
// tabellen er bitteliten, ikke fordi den er indeksert. Skulle `quizzes` en
// gang bli stor, er det denne antakelsen som ryker først.
//
// Kallet ligger dessuten i `waitUntil`, så det legger ikke ett millisekund på
// svartiden cron-job.org måler.
//
// ÆRLIG BEGRENSNING: er HELE cron-job.org nede, kjører ingen av de tre rutene,
// og da kjører heller ikke deteksjonen. Vakten kan ikke observere sin egen
// totale bortfall innenfra. Den dekker «én eller to jobber døde», som er den
// formen kartleggingen fant sannsynlig, ikke «alt er borte».

/**
 * Hvor langt bakover vi ser etter quizer som falt ut av vinduet.
 *
 * Nedre grense er `NOTIFY_WINDOW_MS`: alt nyere enn det er fortsatt innenfor
 * det ordinære vinduet, og en manglende logg der betyr bare at kjøringen ikke
 * har rukket det ennå — ikke at noe er galt.
 */
export const DEAD_ZONE_LOOKBACK_MS = 6 * 60 * 60 * 1000

/** Hvor mange kandidater vi ser på per kjøring. Se CANDIDATE_PROBE_LIMIT. */
const CANDIDATE_LIMIT = 5

export type DeadZoneFunn = {
  quizId: string
  title: string | null
  opensAt: string
  channel: NotifyChannel
}

export type DeadZoneResultat = {
  /** Quizer i dødsone-intervallet som ble undersøkt. */
  kandidater: number
  /** Bekreftede tilfeller: ingen loggrad, men mottakere fantes. */
  funn: DeadZoneFunn[]
  /** Sant hvis selve undersøkelsen feilet. Aldri kastet videre. */
  feilet: boolean
}

/**
 * Kanalene dødsonen kan måles på.
 *
 * KUN de to som fører per-mottaker-logg i `quiz_notification_log`. Bevisste
 * utelatelser:
 *
 *  • `notify-subscribers` dedupliserer i `quiz_notifications.notified_quiz_id`
 *    — ETT felt som overskrives ved hver varsling. Det kan ikke skille «denne
 *    quizen ble aldri varslet» fra «mottakeren har senere fått en nyere quiz»,
 *    så en dødsone-sjekk der ville vært gjetning. (Listen har dessuten én rad
 *    i prod i dag.)
 *  • `org_close_email` er ikke et åpningsvarsel — den grenen finner quizen sin
 *    med «aktiv akkurat nå» og har ikke noe 60-minutters vindu å falle ut av.
 */
const KANALER: ReadonlyArray<{
  channel: NotifyChannel
  beskrivelse: string
  /** Finnes det i det hele tatt en mottaker for denne kanalen? */
  harMottakere: () => Promise<boolean | null>
}> = [
  {
    channel: NOTIFY_CHANNEL.quizOpenEmail,
    beskrivelse: 'åpnings-e-post til innloggede (profiles.email_reminders)',
    harMottakere: async () => {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email_reminders', true)
        .limit(1)
      return error ? null : (data?.length ?? 0) > 0
    },
  },
  {
    channel: NOTIFY_CHANNEL.quizOpenPush,
    beskrivelse: 'web push (push_subscriptions)',
    harMottakere: async () => {
      const { data, error } = await supabaseAdmin
        .from('push_subscriptions')
        .select('id')
        .limit(1)
      return error ? null : (data?.length ?? 0) > 0
    },
  },
]

/** Finnes det ÉN eneste stemplet mottaker for denne quizen og kanalen? */
async function harNoenSomHelstLoggrad(
  quizId: string,
  channel: NotifyChannel,
): Promise<boolean | null> {
  // Bevisst en eksistenssjekk med `.limit(1)` og ikke en telling: vi spør om
  // varslingen kom i gang i det hele tatt, ikke om den ble fullført. En
  // DELVIS levert quiz er ikke en dødsone — den plukkes opp av neste ordinære
  // kjøring så lenge vinduet står åpent, og etter det er den utenfor det denne
  // vakten kan uttale seg om.
  const { data, error } = await supabaseAdmin
    .from('quiz_notification_log')
    .select('recipient_id')
    .eq('quiz_id', quizId)
    .eq('channel', channel)
    .eq('scope_id', GLOBAL_SCOPE)
    .limit(1)

  return error ? null : (data?.length ?? 0) > 0
}

/**
 * Ser etter quizer som åpnet for mellom 60 minutter og 6 timer siden, står
 * åpne, har innhold — og likevel ikke har ett eneste varslingsspor.
 *
 * KASTER ALDRI, og SENDER ALDRI. Ment å kalles i `waitUntil` fra
 * varslingsrutene, slik at den aldri legger latency på cron-svaret.
 */
export async function detectNotifyDeadZone(
  context: string,
  now: number = Date.now(),
): Promise<DeadZoneResultat> {
  const tomt: DeadZoneResultat = { kandidater: 0, funn: [], feilet: false }

  try {
    const nowIso = new Date(now).toISOString()
    const eldsteIso = new Date(now - DEAD_ZONE_LOOKBACK_MS).toISOString()
    const yngsteIso = new Date(now - NOTIFY_WINDOW_MS).toISOString()

    // Samme guards som det ordinære oppslaget, med ÉN forskjell: intervallet
    // ligger UTENFOR vinduet i stedet for inni det (`.lt` mot vindusgrensen,
    // ikke `.lte` mot nå).
    //
    // `closes_at`-kravet er med fordi varselet bare er handlingsbart mens
    // quizen fortsatt står åpen — og fordi en quiz som rakk å stenge innen
    // vinduet lovlig ble holdt tilbake av closes_at-vakten i
    // findOpenedQuizToNotify. Uten dette kravet ville den vakten produsert
    // falske dødsone-treff til seg selv.
    const { data, error } = await supabaseAdmin
      .from('quizzes')
      .select('id, title, opens_at, closes_at')
      .eq('is_test', false)
      .eq('is_active', true)
      .gte('opens_at', eldsteIso)
      .lt('opens_at', yngsteIso)
      .or(`closes_at.is.null,closes_at.gte.${nowIso}`)
      .order('opens_at', { ascending: false })
      .limit(CANDIDATE_LIMIT)

    if (error) {
      console.error(`[notify-dead-zone] kandidatoppslaget feilet (${context}):`, error.message)
      return { ...tomt, feilet: true }
    }

    const kandidater = (data ?? []) as Array<{
      id: string; title: string | null; opens_at: string; closes_at: string | null
    }>
    if (kandidater.length === 0) return tomt

    const funn: DeadZoneFunn[] = []

    for (const quiz of kandidater) {
      // En quiz uten spørsmål ble holdt tilbake MED VILJE, og er allerede
      // rapportert av innholdsvakten. Uten dette skillet ville hver
      // placeholder-quiz gitt to Sentry-saker som beskriver samme tilstand,
      // og den ene av dem ville pekt på feil årsak.
      if (!(await quizHasQuestions(quiz.id, `${context} dead-zone`))) continue

      for (const kanal of KANALER) {
        const harLogg = await harNoenSomHelstLoggrad(quiz.id, kanal.channel)
        if (harLogg === null) {
          console.error(`[notify-dead-zone] loggoppslag feilet for ${quiz.id}/${kanal.channel} (${context})`)
          continue
        }
        if (harLogg) continue

        // Ingen loggrad. Betyr det «ingen ble varslet» eller «det fantes ingen
        // å varsle»? Uten dette skillet ville en tom mottakerliste gitt et
        // falskt varsel hvert femte minutt i timevis.
        const harMottakere = await kanal.harMottakere()
        if (harMottakere === null) {
          console.error(`[notify-dead-zone] mottakeroppslag feilet for ${kanal.channel} (${context})`)
          continue
        }
        if (!harMottakere) continue

        funn.push({ quizId: quiz.id, title: quiz.title, opensAt: quiz.opens_at, channel: kanal.channel })

        const minutterSiden = Math.round((now - Date.parse(quiz.opens_at)) / 60000)
        console.error(
          `[notify-dead-zone] DØDSONE: "${quiz.title}" (${quiz.id}) åpnet for ${minutterSiden} min siden ` +
          `og har ingen ${kanal.channel}-varsler i det hele tatt (${context})`
        )
        varsleNotifyGuard('quiz falt i dødsonen — ingen ble varslet', 'error', {
          context,
          quizId: quiz.id,
          quizTitle: quiz.title,
          opensAt: quiz.opens_at,
          closesAt: quiz.closes_at,
          channel: kanal.channel,
          kanalBeskrivelse: kanal.beskrivelse,
          minutterSidenÅpning: minutterSiden,
          consequence:
            'Quizen er åpen og spillbar, men INGEN har fått varsel på denne kanalen, og det ordinære ' +
            '60-minutters vinduet er passert — den blir aldri plukket opp av seg selv. Sannsynlig årsak: ' +
            'cron-jobben hos cron-job.org var av eller nede i timen etter opens_at, eller quizen ble ' +
            'publisert/fikk opens_at flyttet mer enn en time i etterkant.',
          falskPositivHvis:
            'Kanalen hadde null mottakere da quizen åpnet, og fikk sin første mottaker etterpå. ' +
            'Sjekk mot antallet mottakere før du konkluderer.',
        })
      }
    }

    return { kandidater: kandidater.length, funn, feilet: false }
  } catch (e) {
    // Deteksjonen skal aldri kunne velte en cron-jobb som ellers gjorde jobben
    // sin. Den kjører igjen om fem minutter.
    console.error(`[notify-dead-zone] uventet feil (${context}):`, e instanceof Error ? e.message : e)
    return { ...tomt, feilet: true }
  }
}
