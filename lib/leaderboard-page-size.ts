/**
 * Sidestørrelse for sesong-topplistens paginering.
 *
 * ÉN kilde, delt av de to stedene som MÅ være enige om tallet:
 *   - `app/api/toppliste/route.ts` — regner OFFSET/slice ut fra det
 *   - `components/SeasonLeaderboard.tsx` — bygger knappe-etikettene («21–30»)
 *
 * Fram til 31. juli 2026 var dette to tall som drev fra hverandre INNENFOR
 * ÉN forespørselssyklus: periode-modus brukte `isPaginated ? 20 : 10`, altså
 * 10 ved førstegangslasting (ingen `?page=`) og 20 for hvert påfølgende
 * klikk. Knappene ble merket med 10-tallet, men klikket sendte en offset
 * beregnet med 20 — «21–30» hentet i praksis rad 41–60, og et intervall
 * forbi `total/20` traff bak enden av lista og kom tomt tilbake. Sammen med
 * at den tomme grenen sendte `totalCount: 0` (→ `totalPages = 1`) forsvant
 * hele sidenavigasjonen, og brukeren satt fast uten vei tilbake til side 1
 * uten full sidelasting.
 *
 * Nøyaktig samme feilklasse ble diagnostisert og delvis rettet 20. juni 2026
 * (`a1ff5e8`, «konsekvent PAGE_SIZE=10 for last_quiz overalt») — men bare for
 * last_quiz-grenen; commit-meldingen slår uttrykkelig fast at «Period-modus
 * (måned/kvartal/år/alltime) er uendret». Den halvdelen levde videre i fem
 * uker. Konstanten finnes for at det ikke skal kunne skje en tredje gang:
 * det er ikke lenger mulig å rette én modus og glemme den andre.
 *
 * HVORFOR 10, ikke 20: 10 er allerede verdien den klassiske (upaginerte)
 * visningen bruker i begge moduser, og «topp 10» er hardkodet tre andre
 * steder som avhenger av den — `shouldShowPlacementRow()` i
 * `lib/season-period-table.ts` (`userEntryRank <= 10`), `showControls`
 * (`totalCount > 10`) og `renderUserSection()` (`ue.rank <= 10`). Å låse på
 * 20 ville endret standardvisningen fra 10 til 20 rader og krevd at de tre
 * også ble flyttet — en produktendring, ikke en feilretting.
 */
export const TOPPLISTE_PAGE_SIZE = 10
