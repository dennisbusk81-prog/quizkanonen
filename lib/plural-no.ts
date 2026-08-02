// Norsk tallbøyning for antall innskutt i løpende tekst: «1 riktig»,
// «2 riktige». Brukes overalt der tallet er variabelt og kan være 1 —
// «Ferdig med 1 riktige» var en av entallsfeilene fra gjennomspillingen
// 30. juli 2026 (QK_4 punkt 12).
export function pluralNo(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}
