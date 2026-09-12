// ── Premium-prisene: ÉN kilde, alle flatene leser herfra ────────────────────
//
// Fram til 12. september 2026 sto årsprisen (399) hardkodet sju steder —
// admin-dashbordets rutelokale konstant, plan-lista på /premium,
// /slik-fungerer-det, AccordionSection og tre e-postmaler — og månedsprisen
// (49) enda flere. Samme mønster som lib/premium-features.ts (fordelslista)
// og lib/quiz-time-limit.ts (tidsgrensen): tallet bor her, flatene leser det,
// og lib/premium-priser.test.ts krever at ingen av dem får en egen kopi igjen.
//
// DETTE ER SALGSPRISEN, ikke det kunden faktisk betaler. Det en eksisterende
// abonnent betaler leses fra Stripe per abonnent (lib/personal-plan-label.ts)
// og finnes bare for dem som allerede betaler. Endres prisen i Stripe, må
// tallene her følge etter — de er løftet på salgsflatene, og Stripe er
// fasiten ved kassa.
//
// Ren fil, ingen I/O: importeres av server-komponenter, klientkomponenter,
// e-postmalene og en API-rute.

/** Månedsabonnementet, kroner per måned. */
export const PREMIUM_MONTHLY_NOK = 49

/** Årsabonnementet, kroner per år (live siden 30. august 2026, e18eac6). */
export const PREMIUM_YEARLY_NOK = 399

/** 399/12 = 33,25 — det en årsabonnent reelt bidrar per måned. */
export const PREMIUM_YEARLY_AS_MONTHLY_NOK = PREMIUM_YEARLY_NOK / 12

/** 49 × 12 = 588 — hva månedsplanen koster over et år. */
export const PREMIUM_MONTHLY_AS_YEARLY_NOK = PREMIUM_MONTHLY_NOK * 12

/** 588 − 399 = 189 — det årsplanen sparer mot tolv måneder. */
export const PREMIUM_YEARLY_SAVING_NOK = PREMIUM_MONTHLY_AS_YEARLY_NOK - PREMIUM_YEARLY_NOK

/** «kr 49/mnd» */
export const PREMIUM_MONTHLY_LABEL = `kr ${PREMIUM_MONTHLY_NOK}/mnd`

/** «kr 399/år» */
export const PREMIUM_YEARLY_LABEL = `kr ${PREMIUM_YEARLY_NOK}/år`

/** «kr 49/mnd eller kr 399/år» — den vanlige dobbeltformen på salgsflatene. */
export const PREMIUM_PRICES_LABEL = `${PREMIUM_MONTHLY_LABEL} eller ${PREMIUM_YEARLY_LABEL}`
