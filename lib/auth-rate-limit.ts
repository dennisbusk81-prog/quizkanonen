// ── Rate-limit for de UAUTENTISERTE innloggingsrutene ───────────────────────
//
// Gjelder `app/auth/callback/route.ts` (OAuth-kodeveksling) og
// `app/api/auth/bekreft/route.ts` (magic link / e-postbekreftelse).
//
// HVORFOR IP HER, NÅR SPILLESTIEN GIKK BORT FRA DET
// lib/play-rate-limit.ts nøkler på bruker-id fordi den kan: der finnes et
// verifisert token. Her gjør den per definisjon ikke det — hele poenget med
// rutene er at brukeren ennå IKKE er innlogget. IP er det eneste vi har, og
// det er ikke en mangel som kan fikses, bare en som må dimensjoneres rundt.
//
// HVORFOR 60 OG IKKE 20 (hevet 5. august 2026)
// En IP-adresse er ikke en person. Elkjøp Nordic har 29 medlemmer bak ett
// kontornett, og en mobiloperatørs CGNAT-pool samler langt flere. Med 20/min
// fikk person nr. 21 som fullførte innlogging innenfor samme minutt en hard
// avvisning — og her feiler SELVE INNLOGGINGEN, ikke bare en diagnose.
// Kommentaren i callback-ruten pekte allerede på nettopp dette («treffer ikke
// bare misbruk, men også en gruppe ekte folk som logger inn samtidig»).
//
// Med annonsering til ~2500 kontakter er 20 innlogginger per minutt per
// utgangs-IP innen rekkevidde, ikke teoretisk.
//
// HVORFOR DET ER TRYGT Å SLIPPE OPP
// Grensen er SEKUNDÆR polstring, ikke primærforsvaret. Begge rutene krever
// noe som ikke kan gjettes: en OAuth-kode bundet til en PKCE-verifier
// (callback), eller et `token_hash` fra Supabase (bekreft). Uten den er et
// forsøk verdiløst uansett hvor mange ganger det gjentas. 60/min per IP
// bremser fortsatt en maskin som maler, og ligger godt over det største
// kontornettet vi kjenner.
//
// Vinduet er bevisst kort (60 s, ikke 10 min som spillestien): en ekte
// gruppe som blir bremset skal komme inn på neste minutt, ikke være låst ute
// resten av kvelden.
//
// ÉN KONSTANT, TO KALLSTEDER — med vilje. Samme lærdom som EMAIL_BATCH_SIZE
// i lib/email-batch.ts: tallet sto seks ulike steder som lokale kopier, og
// drev fra hverandre. De to innloggingsveiene er samme flate for en bruker og
// skal ikke kunne få ulike grenser ved et uhell.
import 'server-only'

/** Uautentiserte innloggingsruter: forsøk per IP per vindu. */
export const AUTH_LINK_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const
