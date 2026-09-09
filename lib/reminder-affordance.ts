// «Få e-post når quizen åpner» på forsidens KOMMENDE-kort — for INNLOGGEDE.
//
// Fram til nå pekte affordansen feil vei: den anonyme besøkende fikk
// «Få påminnelse på e-post →» (til /login, der kontoen opprettes og
// velkomstskjermen spør om samtykket), mens den innloggede — den eneste vi
// faktisk KAN sende e-post til — fikk ingenting. `profiles.email_reminders`
// er NOT NULL DEFAULT false, bryteren bor på /profil der ingen leter, og de
// fleste innloggede vet derfor ikke at valget finnes.
//
// ── Hvorfor en egen funksjon og ikke to inline-ternærer ──────────────────
// Linja er en PÅSTAND OM KONTOEN, og det finnes tre tilstander, ikke to:
//
//   på      → «Du får e-post når quizen åpner.»   (ren tekst, ingen lenke)
//   av      → «Få e-post når quizen åpner →»      (lenke til varslingsvalget)
//   ukjent  → INGEN linje
//
// Den tredje er hele poenget. Landet ikke profiloppslaget, vet vi ikke om
// bryteren står på — og «Få e-post når quizen åpner» til en som allerede har
// den på er en usann påstand, ikke en harmløs oppfordring. Ukjent tilstand
// gir ingen påstand, aldri en gjetning. Samme skille som `premiumUnknown`
// gjør for Premium-teksten rett over på samme side, og som `memberErr → 503`
// gjør i send-reminder: ikke fått svar betyr UKJENT, aldri «av».
export type ReminderLine = 'on' | 'off' | null

/** Kun feltet vi leser — funksjonen skal kunne testes uten en hel profilrad. */
export type ReminderProfileRow = { email_reminders?: boolean | null }

export function decideReminderLine(input: {
  /** true når profil-spørringen FEILET (logHomeQuery på forsiden). */
  profileUnknown: boolean
  /** Profilraden, eller null når den ikke ble lest / ikke finnes. */
  profile: ReminderProfileRow | null
}): ReminderLine {
  if (input.profileUnknown) return null
  // Tomt svar er også ukjent: uten rad finnes det ingen bryter å påstå noe om.
  if (!input.profile) return null

  const flagg = input.profile.email_reminders
  if (flagg === true) return 'on'
  // NULL i kolonnen er «av» i praksis — send-reminders filtrerer på
  // `.eq('email_reminders', true)`, så en slik bruker får faktisk ingen
  // e-post, og tilbudet om å skru den på er sant. Samme fallback som
  // lib/profile-load.ts.
  if (flagg === null || flagg === false) return 'off'
  // `undefined` er noe ANNET enn null: da mangler kolonnen i select-lista, og
  // vi har aldri spurt. Falt den til 'off' her, ville en fjernet kolonne gjort
  // linja til en stille løgn overfor alle som har varselet PÅ. Den skal i
  // stedet forsvinne. (Buggen kan bo i select-lista.)
  return null
}
