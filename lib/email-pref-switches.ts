// De to org-avhengige bryterne i E-postvarsler-kortet på /profil.
//
// Bakgrunn (10. september 2026): bf0456f ga `weeklyReportEmail` og
// `orgCloseReminderEmail` en avmeldingsvei — lenke i bunnteksten og
// List-Unsubscribe/one-click i Gmail — men /profil fikk ingen brytere.
// Avmeldingen var derfor ENVEIS: kolonnen kunne settes til false av en
// mottaker, og bare SQL kunne sette den tilbake. Ukesrapporten går ut
// fredag; fella lukkes her.
//
// Denne filen eier ÉN beslutning: HVILKE av de to bryterne som skal vises,
// og hva de sier i hver tilstand. Selve bryteren er den samme markupen som
// de fire eksisterende — ingen ny komponent.
//
// ── Hvem skal se dem ────────────────────────────────────────────────────
// Ukesrapporten går kun til org-ADMINS (cron/weekly-report → getOrgAdminEmails).
// Org-påminnelsen går kun til org-MEDLEMMER (cron/send-reminders, org-grenen).
// En bruker uten organisasjon vil aldri motta noen av dem, og en bryter for
// noe du aldri får er støy — eller verre, en antydning om at du går glipp av
// noe.
//
// MEN relevans alene er ikke nok, for da kan bryteren forsvinne akkurat når
// den trengs. Regelen har derfor TO ledd:
//
//   vises = (relevant for meg i dag) ELLER (verdien står AV)
//
// Andre ledd er hele poenget. Kolonnene er NOT NULL DEFAULT true
// (migrasjon 20260909000001), så false kan bare oppstå ved at NOEN har
// meldt seg av — og en avmelding når bare den som faktisk fikk e-posten.
// En AV-verdi er altså i seg selv beviset på at flaten var relevant. Da er
// veien tilbake garantert uansett hva medlemskapsoppslaget sier: har du
// meldt deg av, ser du bryteren.
//
// Det løser samtidig ukjent-tilstanden uten en tredje visuell variant:
// `membership: null` (myOrgs ikke bekreftet hentet, eller feilet) skjuler en
// bryter som står PÅ — ufarlig, brukeren er påmeldt og mister ingenting —
// mens en bryter som står AV fortsatt vises, fordi andre ledd ikke spør om
// medlemskap i det hele tatt. Ukjent gir aldri en låst dør.

export type OrgEmailSwitchKey = 'weeklyreport' | 'orgreminders'

export type OrgEmailSwitch = {
  key: OrgEmailSwitchKey
  /** Kolonnen PATCH /api/profile/preferences skal sette. */
  column: 'email_weekly_report' | 'email_org_reminders'
  title: string
  desc: string
  value: boolean
}

/**
 * Medlemskapet slik profilsiden allerede kjenner det.
 *
 * `null` betyr VET IKKE, ikke «ingen org». Skillet finnes fra før i
 * ProfileProvider (`myOrgsLoaded` / `myOrgsError`) nettopp fordi en tom
 * `myOrgs` ellers betyr både «ikke hentet ennå» og «ikke medlem». Det
 * krever ingen nytt oppslag — begge flaggene ligger i samme context som
 * profilsiden allerede leser `myOrgs` fra.
 */
export type OrgMembership = { isAdmin: boolean; isMember: boolean } | null

export type OrgEmailInput = {
  emailWeeklyReport: boolean
  emailOrgReminders: boolean
  /**
   * Fredagspåminnelsen. Org-grenen i cron/send-reminders krever BEGGE
   * kolonnene (`fetchOptedInIds(..., ['email_reminders', 'email_org_reminders'])`),
   * så en org-bryter som står på mens fredagspåminnelsen står av er en
   * usann påstand: e-posten kommer ikke uansett. Det skal stå i teksten.
   */
  emailReminders: boolean
  membership: OrgMembership
}

const ORG_REMINDER_DESC = 'Få e-post en time før bedriftens quiz stenger'

export function decideOrgEmailSwitches(input: OrgEmailInput): OrgEmailSwitch[] {
  const ut: OrgEmailSwitch[] = []

  // Ukesrapport — relevant for org-admins.
  if (input.membership?.isAdmin === true || input.emailWeeklyReport === false) {
    ut.push({
      key: 'weeklyreport',
      column: 'email_weekly_report',
      title: 'Ukesrapport for bedriften',
      desc: 'Oppsummering av bedriftens quiz-uke, til deg som er administrator',
      value: input.emailWeeklyReport,
    })
  }

  // Org-påminnelse — relevant for alle org-medlemmer.
  if (input.membership?.isMember === true || input.emailOrgReminders === false) {
    ut.push({
      key: 'orgreminders',
      column: 'email_org_reminders',
      title: 'Påminnelse fra bedriften',
      // Kun når bryteren står PÅ og fredagspåminnelsen står AV: da lover
      // bryteren noe den ikke kan holde. Står den AV, er den ærlig som den
      // er, og teksten skal ikke gjøre det vanskeligere å skru den på.
      desc: input.emailOrgReminders && !input.emailReminders
        ? `${ORG_REMINDER_DESC}. Krever at Fredagspåminnelse over står på.`
        : ORG_REMINDER_DESC,
      value: input.emailOrgReminders,
    })
  }

  return ut
}

// ── Skriving som feiler ─────────────────────────────────────────────────
//
// `savePref` var optimistisk OG stum: den leste aldri `res.ok`, og
// `catch {}` svelget nettverksfeil. Skjermen viste derfor «Lagret» og den
// nye bryterstillingen selv når databasen sto uendret.
//
// For de fire eksisterende bryterne var det en skjønnhetsfeil. For disse to
// er det selve fella om igjen: den som prøver å melde seg PÅ igjen etter en
// feilklikket avmelding får «Lagret», tror hun er tilbake, og er det ikke.
// En bryter skal ikke påstå noe vi ikke vet — samme regel som feil-vs-tomt
// ellers i produktet.
export type PrefSaveOutcome = { kind: 'saved' } | { kind: 'failed'; message: string }

const SAVE_FAILED = 'Kunne ikke lagre. Prøv igjen.'

/**
 * `null` = kallet kastet (nettverk/abort). Alt annet enn en OK-respons er
 * en feil. Kalleren skal da REVERSERE den optimistiske oppdateringen —
 * bryteren skal tilbake til det serveren fortsatt har.
 */
export function decidePrefSave(response: { ok: boolean } | null): PrefSaveOutcome {
  if (response === null) return { kind: 'failed', message: SAVE_FAILED }
  if (!response.ok) return { kind: 'failed', message: SAVE_FAILED }
  return { kind: 'saved' }
}
