// Progresjonsteksten på /historikk. Ren logikk, testdekket i
// field-relative-progress.test.ts.
//
// HVA DENNE ERSTATTER OG HVORFOR (13. august 2026):
// Den gamle `computeProgresjon` sammenlignet spillerens RÅ score i prosent
// mellom to perioder — «Du har blitt 11% dårligere de siste 4 ukene». Den
// målte i praksis hvor vanskelige quizene tilfeldigvis var, ikke spilleren.
// Målt mot prod: feltets snitt per quiz svinger fra 6,43 til 10,32 riktige av
// 15 mellom uker, altså nesten fire riktige svar i ren vanskelighetsvariasjon.
// Rå trend ga 21 bedre / 13 stabile / 26 dårligere blant spillere med minst 4
// quizer — en skjevhet som forsvinner når man måler mot feltet: 19 / 20 / 20.
// En spiller som «ble dårligere» hadde som regel bare vært med på en vanskelig
// uke.
//
// ENHETEN ER RIKTIGE SVAR, IKKE PROSENTPOENG. «Prosentpoeng over snittet» er
// sjargong, og «prosent» er allerede opptatt av score. Riktige svar er samme
// enhet som «11 av 15» ellers på siden. Ordet «poeng» brukes bevisst IKKE:
// `season_scores.points` er sesongpoeng, et helt annet tall spilleren ser på
// topplista, og å gjenbruke ordet her ville koblet to størrelser som ikke har
// noe med hverandre å gjøre.
//
// DIFFEN REGNES ALLTID INNENFOR ÉN QUIZ — spillerens riktige minus feltets
// snitt på nøyaktig den quizen — og først DERETTER snittes diffene. Motsatt
// rekkefølge ville sammenlignet quizer med hverandre.

/** Ett forsøk, med feltets snitt på samme quiz. */
export type FieldEntry = {
  /** Spillerens antall riktige på denne quizen. */
  correct: number
  /** Feltets gjennomsnittlige antall riktige på samme quiz. */
  fieldAvgCorrect: number
  completedAt: string
}

export type ProgressVariant = 'positive' | 'negative' | 'neutral'
export type FieldProgress = { tekst: string; variant: ProgressVariant }

/**
 * Nøytralbånd: en forskjell under et halvt riktig svar per quiz er ikke en
 * forskjell verdt å påstå. Under båndet sier teksten «rundt feltets snitt» i
 * stedet for å trykke et tall som «0,2 over» på leseren.
 *
 * 0,5 er valgt mot målte tall: median for siste periode er 0,6 og for forrige
 * 0,2, og spennet går fra −4,2 til +2,7. Et bånd på 0,5 lar de fleste ekte
 * forskjellene stå, og fanger de 19 av 59 trend-spillerne der minst én av de
 * to periodene reelt ligger på linje med feltet.
 */
export const NEUTRAL_BAND = 0.5

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000

/** Norsk desimaltall med komma, alltid én desimal, alltid uten fortegn. */
function tall(v: number): string {
  return Math.abs(v).toFixed(1).replace('.', ',')
}

function side(v: number): string {
  return v > 0 ? 'over' : 'under'
}

function snitt(xs: readonly number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length
}

/**
 * Progresjonstekst målt mot feltet, eller null når det ikke finnes noe å si.
 *
 * NULL VED FÆRRE ENN TO FORSØK er ikke en mangel — det er tilstanden.
 * Utviklingskortet skjules helt da, og oppfordringen til den nye spilleren
 * ligger allerede i heroens undertekst (se lib/historikk-oversikt.ts,
 * tilstand B1 og B4). Et kort som kun inneholder «spill flere quizer» ser ut
 * som en feil, ikke som en tilstand.
 *
 * `now` sendes inn framfor å leses fra klokka her, slik at grenene kan testes.
 */
export function computeFieldProgress(
  entries: readonly FieldEntry[],
  now: number,
): FieldProgress | null {
  const gyldige = entries.filter(
    (e) =>
      e != null &&
      typeof e.correct === 'number' &&
      typeof e.fieldAvgCorrect === 'number' &&
      Number.isFinite(e.correct) &&
      Number.isFinite(e.fieldAvgCorrect),
  )

  if (gyldige.length < 2) return null

  const diffs = gyldige
    .map((e) => ({ d: e.correct - e.fieldAvgCorrect, t: new Date(e.completedAt).getTime() }))
    .sort((a, b) => a.t - b.t)

  // ── 2–3 forsøk: for få til å kalle noe en trend ───────────────────────────
  // 41 av 137 spillere i prod. Her telles ganger i stedet for å snittes: to
  // målepunkter gir et snitt som svinger vilt, mens «2 av 3» er nøyaktig så
  // presist som grunnlaget tillater.
  if (diffs.length <= 3) {
    const over = diffs.filter((x) => x.d > 0).length
    const n = diffs.length

    if (over === n) {
      return {
        tekst:
          n === 2
            ? 'Du har truffet over feltets snitt begge gangene'
            : `Du har truffet over feltets snitt alle ${n} gangene`,
        variant: 'positive',
      }
    }
    if (over === 0) {
      // 8 spillere i prod. Bevisst nøytral, ikke negativ: to–tre forsøk er
      // ikke nok til en dom, og «ennå» peker framover.
      return { tekst: 'Du har ikke truffet over feltets snitt ennå', variant: 'neutral' }
    }
    return {
      tekst: `Du har truffet over feltets snitt ${over} av ${n} ganger`,
      variant: 'neutral',
    }
  }

  // ── 4+ forsøk: to perioder på fire uker ───────────────────────────────────
  const siste = diffs.filter((x) => now - x.t < FOUR_WEEKS_MS).map((x) => x.d)
  const forrige = diffs
    .filter((x) => now - x.t >= FOUR_WEEKS_MS && now - x.t < 2 * FOUR_WEEKS_MS)
    .map((x) => x.d)

  // Bare én periode har data — 1 spiller i prod, typisk noen som spilte flere
  // quizer tett og så sluttet, eller nettopp har begynt. Da finnes det ingen
  // utvikling å måle, men fortsatt et nivå å oppgi. Alltid nøytral: ingen
  // endring er påvist, så hverken grønt eller rødt ville vært dekket.
  if (siste.length === 0 || forrige.length === 0) {
    const d = snitt(diffs.map((x) => x.d))
    if (Math.abs(d) < NEUTRAL_BAND) {
      return { tekst: 'Du ligger stabilt rundt feltets snitt', variant: 'neutral' }
    }
    return {
      tekst: `Du ligger i snitt ${tall(d)} riktige svar ${side(d)} feltets snitt`,
      variant: 'neutral',
    }
  }

  const R = snitt(siste)
  const P = snitt(forrige)
  const rFlat = Math.abs(R) < NEUTRAL_BAND
  const pFlat = Math.abs(P) < NEUTRAL_BAND

  // Fargen følger ENDRINGEN (R − P), ikke nivået: kortet heter «Utvikling».
  //
  // MEN RØDT KREVER I TILLEGG AT SPILLEREN FAKTISK LIGGER UNDER FELTET NÅ.
  // Uten det leddet fikk en ekte spiller i prod — Håkon Lorentsen, 1,6 over
  // feltet nå mot 2,1 før — en rød ramme rundt setningen «1,6 riktige svar
  // OVER feltets snitt». Fargen motsa teksten, og en leser som ligger godt an
  // fikk et varsel han ikke hadde bruk for.
  //
  // Asymmetrien mellom grønt og rødt er tilsiktet: framgang er gode nyheter på
  // ethvert nivå, så grønt kan aldri motsi teksten. Rødt påstår at noe er
  // galt, og skal derfor bare stå når setningen selv sier at spilleren ligger
  // merkbart under feltet — altså utenfor nøytralbåndet, ikke bare så vidt på
  // feil side av null.
  const endring = R - P
  const liggerUnderFeltet = R <= -NEUTRAL_BAND
  const variant: ProgressVariant =
    endring > NEUTRAL_BAND
      ? 'positive'
      : endring < -NEUTRAL_BAND && liggerUnderFeltet
        ? 'negative'
        : 'neutral'

  // Begge periodene ligger på linje med feltet. Da SKAL fargen være nøytral
  // uansett hva differansen mellom to nesten-nuller tilfeldigvis blir — en
  // grønn ramme rundt ordet «stabilt» ville motsagt seg selv.
  if (rFlat && pFlat) {
    return { tekst: 'Du ligger stabilt rundt feltets snitt', variant: 'neutral' }
  }

  if (rFlat) {
    return {
      tekst: `Siste 4 uker ligger du rundt feltets snitt — før lå du ${tall(P)} riktige svar ${side(P)}`,
      variant,
    }
  }

  if (pFlat) {
    return {
      tekst: `Siste 4 uker: ${tall(R)} riktige svar ${side(R)} feltets snitt per quiz — før lå du på linje med feltet`,
      variant,
    }
  }

  return {
    tekst: `Siste 4 uker: ${tall(R)} riktige svar ${side(R)} feltets snitt per quiz — før lå du ${tall(P)} ${side(P)}`,
    variant,
  }
}

// ── Feltets snitt per quiz ───────────────────────────────────────────────────

export type FieldAttemptRow = {
  quiz_id: string
  correct_answers: number
}

/**
 * Gjennomsnittlig antall riktige per quiz, over alle forsøk som sendes inn.
 *
 * SPILLEREN SELV ER MED I SNITTET. «Feltets snitt» leses naturlig som alles
 * snitt, deg inkludert — samme betydning som et klassesnitt. Med 48–75
 * deltakere per quiz flytter én spiller snittet under to prosent, så
 * forskjellen er uansett under båndet teksten bryr seg om, og et snitt som
 * ekskluderte deg selv ville vært et annet tall for hver leser av samme quiz.
 *
 * Returnerer ANTALL RIKTIGE, ikke prosent: progresjonsteksten trenger riktige
 * svar, og grafen kan regne om til prosent med sin egen `total_questions` —
 * som er den eneste nevneren som er sann for nøyaktig den quizen. Lagres
 * prosent her, låses nevneren til det som var sant da snittet ble regnet.
 */
export function averageCorrectByQuiz(
  rows: readonly FieldAttemptRow[],
): Record<string, number> {
  const bøtter = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    if (!r || typeof r.correct_answers !== 'number') continue
    const b = bøtter.get(r.quiz_id) ?? { sum: 0, n: 0 }
    b.sum += r.correct_answers
    b.n++
    bøtter.set(r.quiz_id, b)
  }

  const ut: Record<string, number> = {}
  for (const [quizId, b] of bøtter) {
    if (b.n > 0) ut[quizId] = b.sum / b.n
  }
  return ut
}
