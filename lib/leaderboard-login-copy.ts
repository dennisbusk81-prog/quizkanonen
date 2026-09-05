// Underteksten i innloggingsvinduet på leaderboard-flaten.
//
// Rører INGEN gating. Velger kun hvilken setning AuthModal viser over skjemaet.
// `undefined` betyr «bruk AuthModal sin DEFAULT_DESCRIPTION» — det er et
// gyldig, bevisst utfall her, ikke en manglende gren.
//
// ── HVORFOR EN FUNKSJON OG IKKE EN TERNÆR PÅ STEDET ─────────────────────────
// Kortet som åpner modalen har SEKS teksttilstander, ikke to: tre grener
// (retur-spiller med nok deltakere, retur-spiller med for få, fremmed uten
// forsøk) ganger `isClosed`. Modalen har bare ÉN utløser — knappen inne i det
// kortet — så den arver alle seks. En ternær på `isClosed` alene ville derfor
// vist «spill denne quizen» til en retur-spiller som ALLEREDE har spilt den.
//
// ── HVA EN GRATIS INNLOGGET BRUKER FAKTISK FÅR ──────────────────────────────
// Målt mot koden, ikke antatt:
//   • Listen er trappekuttet: uinnlogget topp 3, gratis topp 10, Premium alt
//     (ANON_TOP/FREE_TOP i app/api/leaderboard/[id]/route.ts:53-57).
//   • Eksakt plassering er Premium; gratis får et bånd.
//   • Sesongpoeng er IKKE Premium-gatet — lib/award-season-points.ts har ingen
//     premium-sjekk. Poengene teller for alle innloggede.
// Ingen setning her skal love noe utenfor den lista.

type Tilstand = {
  /** Quizen er stengt — den kan ikke lenger spilles. */
  isClosed: boolean
  /**
   * Det ligger et lagret forsøk i localStorage (`qk_result_`). Skrives
   * UBETINGET i finishQuiz, også for innloggede, så dette betyr en
   * RETUR-SPILLER som har mistet sesjonen — ikke en gjest. Prod hadde 625
   * forsøk og null med user_id = null da grenene ble målt 24. august 2026.
   */
  hasSavedResult: boolean
}

/**
 * Underteksten, eller `undefined` for AuthModal sin default.
 *
 * ÅPEN QUIZ, INGEN LAGRET SCORE er den eneste grenen med egen tekst i dag.
 * Det er den fremmede som klikket en delt lenke fra Facebook — flaten hele
 * denne runden handler om.
 *
 * De andre grenene faller til defaulten, med vilje:
 *
 *   • `hasSavedResult` (åpen ELLER stengt) — en retur-spiller HAR spilt denne
 *     quizen. «Logg inn for å spille denne quizen» ville bedt hen gjøre noe
 *     hen allerede har gjort, og submit er ikke idempotent: et nytt forsøk
 *     svarer 403. Defaulten («resultatene lagres på deg») er sann for hen.
 *
 * STENGT + ingen lagret score har sin egen tekst. Den lover topp 10, ikke
 * «hele listen»: det første er nøyaktig hva FREE_TOP gir, det andre er
 * Premium. Utkastet «Logg inn for å se hele listen …» ble forkastet 5.
 * september 2026 av nettopp den grunn — det ville lovet gratisbrukeren det
 * ene hun ikke får, på den flaten der hun har minst grunn til å tro noe annet.
 * Quizen er over, så teksten peker framover mot neste i stedet for å love
 * spilling på en som er stengt.
 */
export function leaderboardLoginDescription(t: Tilstand): string | undefined {
  if (t.hasSavedResult) return undefined
  if (t.isClosed) return 'Logg inn for å se topp 10 og spille neste quiz.'
  return 'Logg inn for å spille denne quizen og komme på listen.'
}
