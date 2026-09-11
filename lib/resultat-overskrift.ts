// ── Overskriftslinja i delingsteksten ───────────────────────────────────────
//
// «Resultat Fredagsquiz 11.09.2026 11.09.2026» sto det fram til 12. september
// 2026: ruten limte alltid på en formatert `closes_at` etter tittelen, og
// tittelen bar allerede datoen.
//
// Datoen kan ikke bare fjernes, for den er ikke alltid overflødig. Målt mot
// prod 12. september 2026 — 18 ulike titler:
//   • 16 inneholder `dd.mm.åååå`  («Fredagsquiz 11.09.2026»)
//   •  2 gjør det ikke            («Månedsquiz August 2026», «Tilfeldig quiz»)
// For de to siste er den påklistrede datoen den ENESTE opplysningen om når
// quizen ble spilt, og et Facebook-innlegg uten dato aldres dårlig.
//
// Regelen er derfor: legg på datoen KUN når tittelen ikke allerede bærer en.
//
// ── HVORFOR ET MØNSTER OG IKKE «inneholder denne datoen» ───────────────────
// Sjekken kunne vært `tittel.includes(dato)`. Da ville en tittel med en ANNEN
// dato enn `closes_at` — f.eks. en quiz som ble flyttet, eller en arkivkopi
// som arvet tittelen fra originalen — fått to ulike datoer etter hverandre:
// «Resultat Fredagsquiz 04.09.2026 11.09.2026». To datoer som ikke er like er
// verre enn to like, for da må leseren gjette hvilken som gjelder.
// Mønsteret svarer på «bærer tittelen allerede en dato», som er det
// spørsmålet som faktisk avgjør om vi skal legge på en til.

/** `dd.mm.åååå` — formen `toLocaleDateString('nb-NO')` gir med 2-sifret dag/måned. */
const DATO_I_TITTEL = /\b\d{2}\.\d{2}\.\d{4}\b/

/**
 * Bygg overskriftslinja: `«Resultat <tittel>»`, med dato bakpå kun når
 * tittelen ikke allerede har en.
 *
 * `dato` skal være ferdig formatert (nb-NO, Europe/Oslo) — denne funksjonen
 * formaterer ikke, den bestemmer bare om datoen skal med.
 */
export function resultatOverskrift(tittel: string, dato: string): string {
  const t = tittel.trim()
  // Tom tittel finnes ikke i prod, men `quizzes.title` har ingen NOT NULL-
  // garanti vi leser her, og «Resultat  11.09.2026» med dobbelt mellomrom er
  // en stygg måte å oppdage det på.
  if (!t) return `Resultat ${dato}`.trim()
  return DATO_I_TITTEL.test(t) ? `Resultat ${t}` : `Resultat ${t} ${dato}`.trim()
}
