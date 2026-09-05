// ── Mellomskjermens topp-10-kontekst: «i topp 10» eller «du trenger N til» ───
//
// 5. september 2026. Under fredagsquizen 4. september, på spørsmål 13 av 15 —
// altså med TO spørsmål igjen — sto det «Du trenger 9 riktige til for å komme
// inn i topp 10» på én skjerm og «… 8 riktige til …» på en annen. Begge tall
// er umulige: 2 er det høyeste oppnåelige. Løftet kunne ikke innfris uansett
// hva spilleren gjorde de siste to spørsmålene.
//
// Årsaken var at tallet var en REN DIFFERANSE — `top10MinCorrect - score` —
// som aldri ble holdt opp mot hvor mange spørsmål det faktisk var igjen. Den
// eneste bremsen på kallstedet var `questionsLeft < 3`, og den avgjør NÅR
// løftet vises, ikke OM det kan innfris. De to ble lett forvekslet fordi de
// leser samme variabel.
//
// ── HVORFOR SUPPRIMERE, IKKE KLAMRE NED TALLET ──────────────────────────────
// «Du trenger 2 riktige til» til en spiller som reelt trenger 9 er ikke en
// mindre feil enn 9 — det er den samme feilen med et penere tall. Er målet
// uoppnåelig, finnes det ingen sann setning å skrive her, og da skal linja
// ikke stå. Ingen erstatningstekst som lover noe annet (avgjort i
// bestillingen, 5. september 2026).
//
// ── HVORFOR EN EGEN MODUL, OG IKKE EN TERNÆR I JSX-EN ───────────────────────
// Samme grunn som lib/side-panel-placement.ts og lib/archive-ranking-gates.ts:
// npm test kjører uten jsdom, og beslutningen bodde i en JSX-IIFE der ingen
// test kunne felle den — det var nettopp derfor et umulig tall kunne stå på
// spillernes skjermer en hel fredag kveld. Beslutningen bor derfor her, med
// begge retningene testet (lib/top10-gap.test.ts), og kallstedet voktes av en
// kildetekst-test (lib/top10-gap-wiring.test.ts). Ingen av de to holder alene.
//
// ── VAKTEN BOR I BEREGNINGEN, IKKE HOS KALLEREN ─────────────────────────────
// Funksjonen tar hele avgjørelsen: populasjonsterskelen, «er jeg allerede
// inne», tallet og klamringen mot gjenværende spørsmål. En framtidig flate som
// vil vise det samme, skal spørre her — ikke gjenskape differansen lokalt og
// arve hullet på nytt.

/** Snapshotens to felt denne avgjørelsen faktisk leser. */
export type Top10Snapshot = {
  top10MinCorrect: number
  totalPlayers: number
}

export type Top10Context =
  | { kind: 'in-top10' }
  | { kind: 'needed'; needed: number }
  | { kind: 'none' }

/**
 * Feltet må ha nok LEVERTE forsøk før en topp-10-terskel betyr noe.
 * Uendret terskel fra kallstedet (`rankingSnapshot.totalPlayers >= 3`).
 */
export const MIN_PLAYERS_FOR_TOP10_CONTEXT = 3

/**
 * Løftet vises bare mot slutten av quizen. Uendret fra kallstedet
 * (`questionsLeft < 3`) — dette er en TIMING-regel, og den er bevisst holdt
 * atskilt fra oppnåelighetsregelen under. Å blande dem var hele buggen.
 */
export const MAX_QUESTIONS_LEFT_FOR_PROMISE = 3

/**
 * Hva mellomskjermen skal si om topp 10 akkurat nå.
 *
 * `'none'` er standardsvaret og det eneste utfallet ved manglende eller
 * ugyldige inndata: et tall her presenteres som et faktum til spilleren, og et
 * fallback-tall ville vært en påstand vi ikke har dekning for.
 */
export function decideTop10Context(args: {
  /** `null`/`undefined` = ruten svarte ikke, eller kallet feilet. */
  snapshot: Top10Snapshot | null | undefined
  /** Spillerens DELSUM så langt i denne quizen. */
  score: number
  /** Spørsmål igjen ETTER det som nettopp ble besvart. */
  questionsLeft: number
}): Top10Context {
  const { snapshot, score, questionsLeft } = args
  if (!snapshot) return { kind: 'none' }

  const { top10MinCorrect, totalPlayers } = snapshot
  // Feltene kommer rått fra /api/quiz/rival sin JSON uten formvalidering på
  // klienten. TypeScript sier `number`; en nyttelast som mangler feltet sier
  // `undefined`, og `undefined - score` er NaN. Uten denne sjekken ville en
  // slik nyttelast falt gjennom på tilfeldigheter (NaN-sammenligninger er
  // usanne) i stedet for på en regel.
  if (
    !Number.isFinite(top10MinCorrect) ||
    !Number.isFinite(totalPlayers) ||
    !Number.isFinite(score) ||
    !Number.isFinite(questionsLeft)
  ) {
    return { kind: 'none' }
  }

  if (totalPlayers < MIN_PLAYERS_FOR_TOP10_CONTEXT) return { kind: 'none' }

  // Andre ledd er alltid sant under terskelen over, og beholdes med vilje:
  // predikatet skal fortsatt være riktig hvis populasjonsterskelen en dag
  // senkes. Uendret uttrykk fra kallstedet.
  if (score >= top10MinCorrect && (top10MinCorrect > 0 || totalPlayers >= 2)) {
    return { kind: 'in-top10' }
  }

  const needed = top10MinCorrect - score
  // Tre ledd, alle nødvendige:
  //   needed > 0                → det finnes et gap i det hele tatt
  //   needed <= questionsLeft   → gapet KAN lukkes (dette var hullet)
  //   questionsLeft < MAX…      → uendret timing-regel fra før
  if (needed > 0 && needed <= questionsLeft && questionsLeft < MAX_QUESTIONS_LEFT_FOR_PROMISE) {
    return { kind: 'needed', needed }
  }

  return { kind: 'none' }
}
