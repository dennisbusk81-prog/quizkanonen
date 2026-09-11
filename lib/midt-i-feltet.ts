// ── «Midt i feltet» — ÉN definisjon, tre lesere ─────────────────────────────
//
// Hvem er spilleren midt i resultatlista? Regnestykket lå i tre kopier:
//   • app/api/admin/quiz-results-text/route.ts   — «Midt på treet» i
//     delingsteksten Dennis limer inn i Facebook
//   • app/api/admin/quizzes/[id]/results/route.ts — «median-spilleren» +
//     naboene på admin sin resultatside
//   • app/admin/resultatkort/[quizId]/route.tsx   — «MIDT I FELTET»-kortet på
//     resultatbildet (via lib/resultatkort.ts)
//
// De to første var enige (`Math.floor(total / 2)`), men enigheten var en
// KOMMENTAR, ikke en kobling: results-ruta skrev bokstavelig «Samme definisjon
// som midt på treet i quiz-results-text: floor(total/2)» rett over sin egen
// kopi av uttrykket. Den tredje ble skrevet 11. september 2026 med `ceil(N/2)`
// og var dermed uenig med begge — for ODDE N gir de to formlene samme svar
// (N=67 → 34 begge veier), så avviket var usynlig annenhver uke og traff
// først ved PARTALL: N=68 gir 35 med floor+1 og 34 med ceil.
//
// Det gjorde bildet og teksten i SAMME Facebook-innlegg i stand til å oppgi
// hvert sitt navn på samme plass.
//
// ── HVILKEN FORM SOM VANT, OG HVORFOR ──────────────────────────────────────
// `floor(N/2) + 1`. Ikke fordi den er matematisk penere — for partall peker
// den på den nederste av de to midterste — men fordi den ALLEREDE ER I DRIFT
// og har stått i publiserte innlegg. Resultatkortet er nytt og aldri
// publisert. Beslutningen er Dennis' (11. september 2026).
//
// ── TO TALL, SAMME DEFINISJON ──────────────────────────────────────────────
// Kallerne trenger hver sin form av det samme svaret, og det er nettopp derfor
// begge bor her: utledes den ene av den andre HOS KALLEREN, er `+ 1` tilbake i
// tre kopier og kan drifte på nytt.
//   • `midtIndeks`     — 0-basert. Brukes som `.range(i, i)`-offset mot
//                        PostgREST og som `players[i]` i et array.
//   • `midtPlassering`  — 1-basert. Tallet som VISES for folk.
//
// ── HVA SOM IKKE BOR HER ───────────────────────────────────────────────────
// Populasjonen. `deltakere` er noe kalleren teller selv, og de tre teller
// ULIKT (rå forsøk vs. dedupet, blokkerte inne eller ute). Denne filen svarer
// kun på «gitt N, hvilken plass er midten» — ikke på hva N er. Se rapporten
// 11. september 2026 for det åpne avviket i selve populasjonen.

/**
 * Minste felt der «midten» i det hele tatt betyr noe.
 *
 * Under tre deltakere er midtmannen enten vinneren eller sisteplassen, og
 * begge deler er en påstand som sier noe annet enn den skal. Tallet er hentet
 * fra `total >= 3`-vakta som allerede sto i begge de to live-flatene.
 *
 * MERK at resultatkortet har sin EGEN, strengere grense for om kortet
 * i det hele tatt tegnes (`MIN_DELTAKERE_FOR_MIDTEN` i lib/resultatkort.ts,
 * som er 5). Det er en visningsbeslutning for ett bestemt format, ikke en del
 * av definisjonen av hvor midten er — og de to skal derfor ikke slås sammen.
 */
export const MIN_FELT_FOR_MIDTEN = 3

/**
 * 0-basert indeks til spilleren midt i det rangerte feltet.
 *
 * Returnerer null når feltet er for lite. Null og ikke 0: en kaller som
 * indekserer med et tall kan ikke skille «ingen midtmann» fra «midtmannen er
 * førsteplassen» hvis svaret er et gyldig indeks-tall.
 */
export function midtIndeks(deltakere: number): number | null {
  if (!Number.isFinite(deltakere) || deltakere < MIN_FELT_FOR_MIDTEN) return null
  return Math.floor(deltakere / 2)
}

/**
 * 1-basert plassering for spilleren midt i det rangerte feltet — tallet som
 * vises («på 35. plass»).
 *
 * Utledet av `midtIndeks` og ikke regnet ut på nytt, slik at de to formene
 * ikke kan komme i utakt.
 */
export function midtPlassering(deltakere: number): number | null {
  const indeks = midtIndeks(deltakere)
  return indeks === null ? null : indeks + 1
}
