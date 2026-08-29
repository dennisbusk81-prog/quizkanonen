// Heroen og Rekorder-kortet på /historikk. Ren logikk, testdekket i
// historikk-oversikt.test.ts.
//
// HVORFOR DETTE LIGGER I lib/ OG IKKE I .tsx-FILA:
// Samme grunn som lib/kategori-tall.ts. Beslutningene under er en kjede av
// grener der hver gren har en påstand i seg — «dette er rekorden din», «så
// starter rekken din» — og en påstand som er sann i den typiske tilstanden kan
// være direkte usann i en nabotilstand. Ligger grenene i JSX bak innlogging og
// Premium, kan ingen test nå dem.
//
// BAKGRUNN (13. august 2026): heroen viste før «#N — din beste plassering» i
// 64px gull. Tallet ble regnet live over attempts, ikke lest fra
// season_scores, og pekte bakover for de fleste: av 75 spillere med ≥3 quizer
// har bare 11 sin beste plassering fra siste quiz. Eieren av kontoen kom sist
// av 71. Heroen svarer nå på «kommer jeg tilbake?» i stedet, som er spørsmålet
// /historikk faktisk er til for — rangering hører hjemme på topplista.
//
// TO REGLER STYRER ALL ORDLYD HER:
//   1. Teksten må være sann i ENHVER tilstand som utløser grenen, ikke bare
//      den typiske.
//   2. Et tall skal ikke stå to steder på samme skjerm. Det gjelder også når
//      to ULIKE størrelser tilfeldigvis har samme verdi — leseren ser ett
//      siffer to ganger og leter etter sammenhengen.

import { pluralNo } from './plural-no'

// ── Hero ─────────────────────────────────────────────────────────────────────

export type HeroInput = {
  totalAttempts: number
  deltakelsesrekke: number
  lengsteDeltakelsesrekke: number
}

export type Hero =
  | { kind: 'empty' }
  | {
      // 'rekke' = tallet er deltakelsesrekken. 'total' = tallet er antall
      // spilte quizer. Kalleren bruker dette til å avgjøre om
      // deltakelsesrekord-raden i Rekorder-kortet skal vises — se
      // decideRecords(): rekorden skal bo ETT sted, og i 'rekke'-tilstandene
      // bor den i `sub` under.
      kind: 'rekke' | 'total'
      tall: number
      label: string
      sub: string
    }

/**
 * Heroens tall, label og undertekst.
 *
 * ORDET «KVELD» BRUKES IKKE, verken her eller ellers på siden: 130 av 488
 * forsøk i prod ligger i lunsjtimen (12–13), så «fredagskveld» er feil om
 * mange av dem uansett hva kolonnen måler.
 *
 * LABELEN PÅ TOTALEN ER «quizer spilt», IKKE «fredagsquizer»:
 * de to tallene heroen kan vise regnes over ULIKE populasjoner.
 *
 *   `total_attempts`   — getPlayerStats() i lib/history.ts, gatet med
 *                        `onlyRealQuizAttempts` (history.ts:596). Slipper
 *                        gjennom HELE hvitelisten `REAL_QUIZ_TYPES`, altså
 *                        `weekly` OG `bonus`.
 *   `deltakelsesrekke` — fetchParticipationStreak, som legger
 *                        `.eq('quiz_type', 'weekly')` OPPÅ gulvet
 *                        (history.ts:434). Kun fredagsserien.
 *
 * Gapet er altså «bonus», ikke «alt kunstig»: begge utelukker testquizer og
 * arkivrunder. I dag er populasjonene like — alle quizene i prod er `weekly`
 * (målt 25. august 2026) — men den første bonusquizen gjør «fredagsquizer»
 * usant uten at noe ser galt ut. «quizer» er sant i begge tilfeller.
 *
 * Rettet 29. august 2026. Fram til da sa dette avsnittet at `total_attempts`
 * telles «UTEN filter på `is_test` eller `quiz_type`». Det var sant til
 * 25. august, da gulvet kom inn i getPlayerStats — og en begrunnelse som
 * hviler på et premiss som ikke lenger gjelder er verre enn ingen: neste
 * leser ville avvist den, og med den labelen den forsvarer.
 *
 * GRENREKKEFØLGEN ER BINDENDE. `total === rekke` sjekkes FØR rekord-grenene,
 * ellers ville sub-teksten sagt «{total} quizer til sammen» med nøyaktig det
 * tallet heroen alt viser. Det gjelder 14 av 137 spillere i prod — alle som
 * har vært med hver eneste gang siden de startet, altså de mest lojale.
 */
export function decideHero(input: HeroInput): Hero {
  const total = input.totalAttempts ?? 0
  const rekke = input.deltakelsesrekke ?? 0
  const rekord = input.lengsteDeltakelsesrekke ?? 0

  if (total <= 0) return { kind: 'empty' }

  if (rekke >= 2) {
    const base = { kind: 'rekke' as const, tall: rekke, label: 'fredager på rad' }

    // Alle forsøkene ligger i den løpende rekken. Da er både «{total} til
    // sammen» og «rekorden din er {rekord}» det samme tallet som heroen viser,
    // og setningen sier ingenting nytt. Den erstattes av det den faktisk
    // betyr.
    if (total === rekke) {
      return { ...base, sub: 'Du har ikke stått over en eneste fredag siden du startet' }
    }
    if (rekord > rekke) {
      // «{total} quizer til sammen» droppes når totalen er samme tall som
      // rekorden — da ville setningen båret samme siffer to ganger med to
      // ulike betydninger. Kombinasjonen ser uåpnelig ut (en rekord lik
      // totalen betyr at alle forsøk ligger i én rekke, som da også må være
      // den løpende), men vakten koster ingenting og resonnementet over er
      // nettopp den typen «kan ikke skje» som slutter å stemme når en regel
      // lenger nede endres. Testen holder den i live.
      return {
        ...base,
        sub:
          total === rekord
            ? `Rekorden din er ${rekord}`
            : `${total} quizer til sammen · rekorden din er ${rekord}`,
      }
    }
    // rekord === rekke: rekorden settes akkurat nå. Å skrive tallet igjen
    // ville vært tredje forekomst på skjermen.
    return { ...base, sub: `${total} quizer til sammen · dette er rekorden din` }
  }

  const label = pluralNo(total, 'quiz spilt', 'quizer spilt')
  const base = { kind: 'total' as const, tall: total, label }

  // ── B-TILSTANDENE: heroen viser TOTALEN, ikke rekken ──────────────────────
  //
  // Underteksten her har én jobb utover å peke framover: den skal forklare
  // hvorfor tallet over er en total og ikke en rekke. Uten det leser man «2
  // quizer spilt» rett over en graf med fire ukers hull mellom punktene, og
  // ingenting forbinder de to.
  //
  // INGEN TALLORD I DISSE GRENENE — heller ikke skrevet med bokstaver.
  // Teksten sa til 13. august 2026 «har du to på rad», og 7 av de 18 spillerne
  // i grenen har `total === 2`. Heroen viste da «2» og underteksten «to»:
  // samme størrelse med to helt ulike betydninger, rett under hverandre. Den
  // uttømmende testen fanget det ikke, fordi den lette etter sifre og «to» er
  // bokstaver. Derfor sier grenene «en rekke på gang» i stedet for å telle —
  // og «en» er artikkel, ikke tallord.
  //
  // TERSKELEN «rekke» = 2 er den samme som i decideRecords(): en rekke på 1 er
  // ikke en rekke, det er én gang. Derfor kan en spiller med rekke 1 fortsatt
  // få høre at hen får «en rekke på gang» ved å spille neste.
  //
  // DATOEN FOR SISTE SPILTE QUIZ ER BEVISST IKKE HER. Kortet «Din siste quiz»
  // står rett under heroen og bærer både quiztittel og full dato; å gjenta
  // datoen i underteksten ville sagt det samme to ganger innenfor samme
  // skjermhøyde. Dessuten har 4 spillere i prod et nyeste forsøk som aldri ble
  // levert inn — for dem ville «du spilte sist ...» vært en påstand om noe de
  // ikke gjorde.

  // rekke === 1: rekken ER startet. Ingen av grenene her får si «så starter
  // rekken din» — det ville vært direkte usant for 22 av 137 spillere i prod.
  if (rekke === 1) {
    return {
      ...base,
      sub:
        total === 1
          ? 'Du er i gang. Spiller du neste fredagsquiz også, har du en rekke på gang'
          : 'Du er i gang igjen etter et opphold. Spill neste fredagsquiz, så har du en rekke på gang',
    }
  }

  // rekke === 0 herfra. Rekord-TALLET nevnes bevisst ikke i noen av grenene
  // under: heroen viser her totalen, og 45 av de 72 spillerne i grenen rett
  // under har `total === rekord`. Rekorden bor i Rekorder-kortet i disse
  // tilstandene — se decideRecords().
  if (rekord > 0) {
    // Har hatt en rekke som er brutt. «Så starter en ny rekke» ville lovet noe
    // som allerede har skjedd og gikk i stykker.
    //
    // Delt på om rekorden var en ekte rekke: 27 spillere i prod har rekord ≥ 2
    // og har altså faktisk hatt en rekke som brakk, mens 45 har rekord 1 og
    // aldri har spilt to fredager etter hverandre. «Rekken din er brutt» ville
    // vært en merkelig påstand til den andre gruppa — de har aldri hatt en.
    return {
      ...base,
      sub:
        rekord >= 2
          ? 'Rekken din er brutt. Spill neste fredagsquiz, så er du i gang igjen'
          : 'Du har ikke fått en rekke på gang ennå. Spill neste fredagsquiz, så er du i gang',
    }
  }
  if (total === 1) {
    return { ...base, sub: 'Velkommen — spill neste fredagsquiz, så starter rekken din' }
  }
  // Har spilt flere ganger, men aldri to fredager på rad — og har heller ingen
  // rekord å komme tilbake til. Uåpnelig i prod i dag (0 spillere), men
  // grenen finnes: den treffer den som kun har forsøk uten `submitted_at`.
  return { ...base, sub: 'Spill neste fredagsquiz, så starter rekken din' }
}

// ── Rekorder-kortet ──────────────────────────────────────────────────────────

export type BesteResultat = {
  riktige: number
  totalt: number
  tittel: string
}

export type RecordsInput = {
  /**
   * Beste enkeltresultat, eller null når det ikke kan avgjøres.
   *
   * KALLEREN SKAL SENDE null NÅR HELE HISTORIKKEN IKKE ER LASTET. Tallet
   * finnes ikke i PlayerStats og kan bare utledes av `history`, som er
   * paginert med 50 rader per side. Regnes det på en delvis liste, blir det
   * «beste av de 50 siste» uten at noe ser galt ut — og det ville rammet
   * nettopp de mest trofaste spillerne, som er de eneste som noen gang
   * passerer 50 quizer.
   */
  besteResultat: BesteResultat | null
  bestStreak: number
  lengsteDeltakelsesrekke: number
  totalAttempts: number
  /** True når heroen alt viser deltakelsesrekken — se Hero.kind. */
  heroViserRekke: boolean
  /**
   * Beste frosne plassering fra `season_scores`, med quiz og feltstørrelse.
   *
   * `null` når spilleren ikke har noen global plassering — f.eks. fordi hen
   * har meldt seg ut av den åpne konkurransen. Da vises INGEN plasseringsrad;
   * det finnes ingen fallback til en live-beregnet rangering.
   *
   * Denne raden ble bevisst holdt ute av kortet 13. august (bolk 1), fordi
   * kilden den gang var `computeRanks()`, som fabrikkerte en plassering også
   * for spillere som ikke hadde noen. Et fabrikkert tall skulle ikke flyttes,
   * det skulle vente på riktig kilde. Nå har det det.
   */
  bestePlassering?: { rank: number; total_players: number; quiz_title: string } | null
}

export type RecordRow = { label: string; verdi: string }

/**
 * Radene i Rekorder-kortet. Tom liste betyr at kortet ikke skal vises i det
 * hele tatt — ingen tom-tilstand er ønsket, samme mønster som kategorikortene.
 *
 * TERSKEL 2 PÅ BEGGE REKKENE er ikke pynt: «1 riktig på rad» og «1 fredag på
 * rad» er ikke rekker, de er én gang. Målt mot prod 13. august 2026 har 59 av
 * 137 spillere `lengste_deltakelsesrekke === 1` — uten terskelen ville et
 * flertall av siden fått en rad som høytidelig meldte at de aldri har kommet
 * to fredager etter hverandre.
 *
 * Kortet blir tomt for 3 spillere i prod. Alle tre har kun ett forsøk som ble
 * påbegynt og forlatt (`submitted_at` NULL, 0 av 15, `correct_streak` 0) —
 * altså ingen rekorder å vise, og «Beste resultat: 0 av 15» ville vært den
 * typen tall denne omskrivingen finnes for å fjerne.
 */
export function decideRecords(input: RecordsInput): RecordRow[] {
  const rows: RecordRow[] = []
  const bestStreak = input.bestStreak ?? 0
  const rekord = input.lengsteDeltakelsesrekke ?? 0
  const total = input.totalAttempts ?? 0

  const beste = input.besteResultat
  if (beste && beste.riktige >= 1 && beste.totalt > 0) {
    // Nevneren leses fra forsøket selv, aldri hardkodet: alle 488 forsøk i
    // prod har 15 spørsmål i dag, men det er et faktum om i dag, ikke om
    // datamodellen.
    rows.push({
      label: 'Beste resultat',
      verdi: `${beste.riktige} av ${beste.totalt} · ${beste.tittel}`,
    })
  }

  if (bestStreak >= 2) {
    rows.push({
      label: 'Lengste svar-rekke',
      verdi: `${bestStreak} ${pluralNo(bestStreak, 'riktig', 'riktige')} på rad`,
    })
  }

  // Utelates når heroen alt bærer rekken, OG når rekorden er nøyaktig like
  // stor som antall spilte quizer — da har heroen allerede vist sifferet, og
  // raden ville bare gjentatt det med en annen etikett.
  if (!input.heroViserRekke && rekord >= 2 && rekord !== total) {
    rows.push({
      label: 'Lengste deltakelsesrekke',
      verdi: `${rekord} fredager på rad`,
    })
  }

  // Nederst: plasseringen er den eneste raden som måler mot andre, og skal
  // ikke lede kortet. Feltstørrelsen står med, fordi «#4» betyr helt ulike
  // ting i et felt på 48 og et på 75 — og quiztittelen, fordi en rekord uten
  // anledning er et løsrevet tall.
  const bp = input.bestePlassering
  if (bp && typeof bp.rank === 'number' && typeof bp.total_players === 'number') {
    rows.push({
      label: 'Beste plassering',
      verdi: `#${bp.rank} av ${bp.total_players} · ${bp.quiz_title}`,
    })
  }

  return rows
}

// ── Beste resultat ut av en historikkliste ───────────────────────────────────

export type BesteResultatKandidat = {
  correct_answers: number
  total_questions: number
  quiz_title: string
  completed_at: string
}

/**
 * Plukker beste enkeltresultat ut av en KOMPLETT historikkliste.
 *
 * Kalleren MÅ selv ha slått fast at lista er komplett; denne funksjonen kan
 * ikke vite det. Se `RecordsInput.besteResultat`.
 *
 * UAVGJORT BRYTES PÅ NYESTE. 29 av 137 spillere i prod har flere kvelder med
 * samme antall riktige, og uten et eksplisitt tie-break ville tittelen i
 * raden avhengt av sorteringen på lista som tilfeldigvis ble sendt inn.
 * Nyeste er valgt framfor raskeste fordi raden er en personlig rekord, ikke
 * en rangering — blant like resultater er det ferskeste det som fortsatt
 * gjelder.
 */
export function pickBesteResultat(
  historikk: readonly BesteResultatKandidat[],
): BesteResultat | null {
  let best: BesteResultatKandidat | null = null

  for (const a of historikk) {
    if (!a || typeof a.correct_answers !== 'number' || typeof a.total_questions !== 'number') {
      continue
    }
    if (best === null) {
      best = a
      continue
    }
    if (a.correct_answers > best.correct_answers) {
      best = a
      continue
    }
    if (
      a.correct_answers === best.correct_answers &&
      new Date(a.completed_at).getTime() > new Date(best.completed_at).getTime()
    ) {
      best = a
    }
  }

  if (best === null) return null
  return {
    riktige: best.correct_answers,
    totalt: best.total_questions,
    tittel: best.quiz_title,
  }
}
