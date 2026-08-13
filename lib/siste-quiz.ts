// «Din siste quiz»-kortet på /historikk. Ren logikk, testdekket i
// siste-quiz.test.ts.
//
// HVA KORTET ER TIL FOR: det brukerne faktisk kommer for etter fredag er «hvor
// gikk det sist?». Før 13. august 2026 måtte de lese det ut av den første raden
// i en liste, ved siden av en hero som viste et helt annet tall.
//
// KORTET HETER IKKE «SIST FREDAG». Spilleren kan sist ha spilt for tre uker
// siden, og da er «sist fredag» usant. Ordet «kveld» brukes heller ikke noe
// sted — 130 av 488 forsøk i prod ligger i lunsjtimen.

export type SisteQuizInput = {
  quizTittel: string
  riktige: number
  totalt: number
  /** Feltets gjennomsnittlige antall riktige på samme quiz, eller null. */
  feltSnittRiktige: number | null
  /** Frossen plassering fra season_scores, eller null når den ikke finnes. */
  plassering: { rank: number; total_players: number } | null
  /**
   * Om dette forsøket satte en personlig rekord.
   *
   * `null` betyr «vet ikke» — se `settPersonligRekord()`. Da vises den
   * nøytrale eyebrowen, aldri en påstand vi ikke har dekning for.
   */
  erPersonligRekord: boolean | null
}

export type SisteQuizKort = {
  eyebrow: string
  tittel: string
  /** «11 av 15 riktige» */
  resultat: string
  /** «Feltet traff 8,2 av 15 i snitt», eller null når snittet mangler. */
  felt: string | null
  /** «#12 av 63», eller null når frossen plassering ikke finnes. */
  plassering: string | null
}

/** Norsk desimaltall med komma, én desimal. */
function tall(v: number): string {
  return v.toFixed(1).replace('.', ',')
}

/**
 * Bygger kortet, eller null når det ikke finnes noe forsøk å vise.
 *
 * FELTLINJA BRUKER SAMME NEVNER SOM RESULTATLINJA — «11 av 15» over «8,2 av
 * 15». Det er hele grunnen til at feltet oppgis i riktige svar og ikke i
 * prosent: to tall med ulike nevnere ved siden av hverandre er nettopp det
 * persentilblokken ble fjernet for.
 *
 * PLASSERINGEN UTELATES HELT når det ikke finnes en frossen rank. Ingen
 * fallback til en live-beregnet rangering, ingen «ukjent». Kortet viser da
 * resultat og felt, som er sant.
 */
export function decideSisteQuiz(input: SisteQuizInput): SisteQuizKort | null {
  if (!input || typeof input.riktige !== 'number' || typeof input.totalt !== 'number') return null
  if (input.totalt <= 0) return null

  const feltSnitt = input.feltSnittRiktige
  const felt =
    typeof feltSnitt === 'number' && Number.isFinite(feltSnitt)
      ? `Feltet traff ${tall(feltSnitt)} av ${input.totalt} i snitt`
      : null

  const p = input.plassering
  const plassering =
    p && typeof p.rank === 'number' && typeof p.total_players === 'number'
      ? `#${p.rank} av ${p.total_players}`
      : null

  return {
    // «Ny personlig rekord» krever et JA, ikke fravær av et nei: `null` er
    // «vet ikke» og skal gi den nøytrale teksten.
    eyebrow: input.erPersonligRekord === true ? 'Ny personlig rekord' : 'Din siste quiz',
    tittel: input.quizTittel,
    resultat: `${input.riktige} av ${input.totalt} riktige`,
    felt,
    plassering,
  }
}

// ── Personlig rekord ─────────────────────────────────────────────────────────

export type RekordKandidat = {
  correct_answers: number
  completed_at: string
}

/**
 * Satte det NYESTE forsøket en personlig rekord?
 *
 * Returnerer `null` når spørsmålet ikke kan besvares — se `historikkErKomplett`
 * hos kalleren. Historikken er paginert med 50 rader per side, og en rekord er
 * en påstand om ALLE tidligere forsøk. Regnes den på en delvis liste, ville
 * «Ny personlig rekord» dukket opp for en spiller som har et bedre resultat
 * lenger bak i historikken — altså akkurat for de mest trofaste.
 *
 * KREVER MINST TO FORSØK. Det første forsøket er trivielt det beste man har
 * gjort, og «Ny personlig rekord» på sin aller første quiz er en tom påstand.
 *
 * KREVER STRENGT BEDRE enn alle tidligere. Å tangere sin egen rekord er ikke å
 * sette en ny.
 */
export function settPersonligRekord(
  historikk: readonly RekordKandidat[] | null,
): boolean | null {
  if (historikk === null) return null

  const gyldige = historikk.filter(
    (a) => a != null && typeof a.correct_answers === 'number' && Number.isFinite(a.correct_answers),
  )
  if (gyldige.length < 2) return gyldige.length === 1 ? false : null

  const sortert = [...gyldige].sort(
    (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
  )
  const nyeste = sortert[0]
  const tidligereBeste = Math.max(...sortert.slice(1).map((a) => a.correct_answers))

  return nyeste.correct_answers > tidligereBeste
}
