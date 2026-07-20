# Quizkanonen — Claude Code kontekst
Sist oppdatert: 20. juli 2026

## PROSJEKT
Solo-gründer bygger Quizkanonen (quizkanonen.no) — en ukentlig quiz-plattform
som skal erstatte Kahoot for en etablert Facebook-gruppe (400 medlemmer).
Nordisk marked. Budsjett nær null i startfasen.

---

## TEKNISK STACK — IKKE ENDRE
- **Frontend + backend:** Next.js (App Router, TypeScript) — aldri Pages Router
- **Database + auth:** Supabase (PostgreSQL, RLS aktivert)
- **Hosting:** Vercel (auto-deploy fra GitHub)
- **Betaling:** Stripe — **LIVE MODE** siden ~23. juni 2026. Ekte kort, ekte penger.
  Ikke bytt tilbake til test-modus, og ikke rør live-nøklene, uten eksplisitt beskjed.
- **Styling:** Ingen Tailwind — inline CSS via konstantobjekter

Arbeidsflyt: Claude Code pusher til git → Vercel deployer automatisk.

---

## DESIGNSYSTEM — FØLG NØYAKTIG
Les `app/quiz/[id]/page.tsx` som referanse før du starter ny feature.

### Farger
| Rolle | Verdi |
|---|---|
| Bakgrunn | `#1a1c23` |
| Kort | `#21242e` |
| Border | `#2a2d38` |
| Gull | `#c9a84c` |
| Titler | `#ffffff` |
| Brødtekst | `#e8e4dd` |
| Hint/meta | `#7a7873` |
| **FORBUDT** | `#9a9590`, `#6a6860`, `#8a8fa8` |

### Typografi
- Titler: `Libre Baskerville` (serif)
- Brødtekst: `Instrument Sans`

### Knapper
- Primær (gul fylt): `background #c9a84c`, `color #1a1c23`, `padding 10px 28px`, `width auto`
- Aldri to gule elementer (knapp ELLER tekstlenke) på samme skjerm
- Sekundær: outline, transparent bakgrunn
- Founders-knapp: hvit outline (`border: 1px solid #e8e4dd`, `color: #e8e4dd`) — ikke gull

### Border-radius
- Kort: `16px`
- Knapper: `10px`

### Luft og padding
- Kort padding: minimum `24px 20px`, gjerne `28px`
- Mer luft er alltid bedre enn tettere

### Lenker
- Lenker som ikke er primærhandlinger: `#e8e4dd` — aldri `#7a7873`
- Unntak: hint-tekst og metadata som ikke krever klikk kan være `#7a7873`

### Regler
- Ingen Tailwind
- Ingen emoji i UI — SVG der nødvendig (unntak: medalje-emoji på leaderboard)
- Ingen hardkodede farger utenfor systemet ovenfor

---

## ARKITEKTUR OG MØNSTRE

### Auth
- Supabase auth med Google OAuth + magic link + **passord** (se under)
- `lib/auth.ts` for signIn, signOut, getSession, getProfile
- `lib/supabase-admin.ts` er server-only (service role)
- Admin-auth: se egen seksjon under (rate-limitet + signert token, ikke lenger
  klartekst-passord i sessionStorage — endret 19. juli)

### Passordinnlogging (fullt bygget og verifisert 18. juli 2026)
- **Identifier-first-flyt** på `/login`: bruker skriver e-post først, siden
  viser deretter kun de innloggingsmetodene som faktisk er relevante for den
  kontoen (passord og/eller Google) — ikke et statisk skjema med alle metoder
- `profiles.has_password` (boolean) — settes til `true` når en bruker har satt
  passord, enten ved passord-signup eller senere fra profilsiden
- `POST /api/auth/check-email` — rate-limitet oppslag som returnerer
  `{ exists, hasPassword, hasGoogle }` for en gitt e-post. Brukes av
  identifier-first-flyten på `/login`, og av selve signup-stien for å hindre
  duplikate kontoer (appen kobler `profiles` på `auth.users.id`, ikke e-post,
  og stoler ikke blindt på Supabase sin automatiske identitetskobling)
- `components/PasswordInput.tsx` — passordfelt med vis/skjul-ikon, delt av
  signup, innlogging og passord-bytte
- `/sett-passord` — side for å sette passord første gang (etter passord-signup)
- Endring av passord er tilgjengelig fra profilsiden for innloggede brukere

### Navnepolicy
- display_name er påkrevd for innloggede brukere
- Regex: `/^[\p{L}\s\-']{2,40}$/u`
- Google-navn settes automatisk som default ved OAuth (AuthListener.tsx)
- NameRequiredModal.tsx blokkerer ved manglende/ugyldig navn
- Validering håndheves i `/api/profile/upsert/route.ts`

### Lag og sesong
- leader_display_name (TEXT, nullable) på attempts-tabellen
- Laglederens user_id registreres på season_scores
- Hint-tekst på quiz-startsiden: "Sesong-poeng registreres på deg som er innlogget."

### Database-tabeller (eksisterende)
`quizzes`, `questions`, `attempts` (+ leader_display_name),
`attempt_answers`, `played_log`, `access_codes`, `admin_users`,
`site_settings`, `profiles`, `organizations`, `organization_members`,
`organization_invites`, `leagues`, `league_members`, `ranking_snapshots`,
`season_scores`, `admin_actions`, `excluded_members`

### Sesong-leaderboard-arkitektur
- `season_scores`: scope_type IN ('global', 'league', 'organization')
- Global: scope_type='global', scope_id=NULL
- Poeng skrives av `/api/cron/award-season-points` hvert 5. minutt
- `SeasonLeaderboard.tsx` er delt komponent — brukes av /toppliste, /liga/[slug], /org/[slug]
- Forsiden viser månedens globale topp 3 fra season_scores (ikke fra attempts)

### ranking_snapshots-arkitektur (endret 19. juli 2026)
- Cache for live-plassering under spilling, delt av `/api/quiz/[id]/standings`,
  `/api/quiz/[id]/ranking-snapshot` og `/api/quiz/live-ranking` via den felles
  `getOrBuildSnapshot()`-funksjonen i `lib/ranking-snapshot.ts`
- **Én cache-rad PER QUIZ** — ikke lenger én rad per (quiz_id, question_index).
  Fram til 19. juli var nøkkelen per spørsmål, noe som delte trafikken på like
  mange nøkler som quizen har spørsmål og gjorde at cachen i praksis aldri
  traff (Disk IO-hovedårsak, funnet og rettet 19. juli)
- TTL: 10 sekunder
- Ved `ensureAttemptId`-tvungede rebuilds (rett etter at en spiller leverer og
  ikke er i den cachede snapshoten ennå) beregnes en fersk snapshot og
  returneres i responsen, men den skrives **ikke** til DB — kun ordinære,
  TTL-utløste rebuilds skriver. Dette hindrer at mange samtidige innsendinger
  ved quiz-stenging hver trigger en full JSONB-UPDATE

**NY REGEL for denne filen (ranking_snapshots) spesifikt:** kartlegging og
lesing av denne kodestien er alltid tillatt uten å spørre først — kun faktiske
PUSH-endringer krever eksplisitt godkjenning fra Dennis før de gjøres.
Bakgrunn: filen sto tidligere under «skal ikke røres uten eksplisitt beskjed»,
noe som gjorde at en ytelsesgjennomgang filtrerte den bort og lot en reell
Disk IO-bug vokse ukjent i flere uker før den ble funnet.

### Miljøvariabler (ligger i Vercel — ikke hardkod)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SITE_URL`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`,
`RESEND_API_KEY`, `ANTHROPIC_API_KEY`,
`STRIPE_PRICE_FOUNDERS`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`STRIPE_ORG_STARTER_PRICE_ID`, `STRIPE_ORG_STANDARD_PRICE_ID`, `STRIPE_ORG_PRO_PRICE_ID`

---

## PAYWALL-LOGIKK
| Feature | Gratis | Innlogget | Premium |
|---|---|---|---|
| Spille quiz | ✓ | ✓ | ✓ |
| Nøyaktig plassering | — | ✓ | ✓ |
| Historikk og statistikk | — | — | ✓ |
| Private ligaer | — | — | ✓ |
| Sesong-leaderboard (egen plass) | — | — | ✓ |

Premium: kr 49/mnd. Stripe i **live mode** siden ~23. juni 2026.

---

## FORSIDE — STRUKTUR (app/page.tsx)
Rekkefølge ovenfra:
1. Nav (NavAuth.tsx) — "Toppliste" synlig på desktop, skjult på mobil
2. Hero — tittel, undertittel, gul knapp, statuslinje
3. Sitat-linje — kursiv, #7a7873
4. Fakta-ikoner — tre SVG (kalender, person, stjerne)
5. Divider
6. Quiz-kort — eyebrow, tittel, tagline, månedlig leaderboard, outline-knapp
7. Lenker under kortet — sesong-toppliste + alle quizer
8. Accordion — tre items
9. Bedrifts-seksjon — #1e1a0e bakgrunn, gull-border
10. Founders-seksjon — uendret, hvit outline-knapp

Månedlig leaderboard i quiz-kortet:
- Henter fra season_scores WHERE scope_type='global' AND scope_id IS NULL
- Filtrert på inneværende kalender-måned (closes_at)
- Aggregeres i JS på serveren, sortert DESC på total_points
- Vises kun hvis minst 1 rad finnes med gyldig display_name

---

## STRIPE — VIKTIG
- **Live mode** siden ~23. juni 2026 — ekte kort, ekte penger. Ikke test-kort lenger.
- Kun Premium månedlig kr 49 — ukespass er fjernet
- Founders Access: gratis trial (30 dager, eller fast dato 15. august 2026 for
  nye B2C-signups under det forlengede tilbudet), ingen kortinfo
- Founders-knapp: hvit outline — ikke gull (to-gule-regel)
- Webhook håndterer: `checkout.session.completed`, `subscription.deleted`,
  `subscription.updated`, `invoice.payment_succeeded`, `invoice.payment_failed`,
  `charge.refunded`
- Idempotens: `stripe_events`-tabellen stempler behandlede event-id-er
  (aktivert 19. juli 2026 — se Sikkerhet-seksjonen)

---

## HVA SOM IKKE SKAL RØRES UTEN EKSPLISITT BESKJED
- Stripe live-nøkler (er i **live mode** — ekte penger, ikke bytt til test uten beskjed)
- RLS-policies i Supabase
- `lib/supabase-admin.ts` (server-only, ikke eksporter til klient)
- `FOUNDERS_ACTIVE`-konstanten i `app/quiz/[id]/page.tsx`
- Autentiseringsflyt og OAuth callback (`app/auth/callback/route.ts`)

`ranking_snapshots` har et EGET, mer presist unntak — se
«ranking_snapshots-arkitektur» under ARKITEKTUR OG MØNSTRE: lesing/kartlegging
er alltid greit uten å spørre, kun push krever godkjenning.

---

## SIKKERHET
Status per 20. juli 2026, etter to runder sikkerhetsgjennomgang og retting:

- **Quiz-integritet — signert attempt-token (20. juli):** `/api/quiz/[id]/questions`
  leverte tidligere fasiten til hvem som helst som kjente quiz-id + en attempt-id,
  så et script kunne hente hele fasiten på forhånd (ett kall per index) uten å
  spille. `/submit` hadde ingen kobling mellom den som startet og den som leverte.
  Nå utsteder `start-attempt` et HMAC-signert token (`lib/attempt-token.ts`,
  speiler `lib/admin-token.ts`) over `(attemptId, quizId, utstedt)`. Både
  `questions` og `submit` krever `x-attempt-token`, verifisert mot forespørselens
  `(attemptId, quizId)` — tokenet kan ikke flyttes til et annet forsøk/quiz.
  `questions` avviser dessuten attempts der `submitted_at` er satt (ingen
  fasit-uthenting etter innsending), og gir aldri spørsmålsdata ved avvisning.
  `submit` har fått rate-limit (10/10min/IP) og tidsvalidering mot server-klokka:
  hard `403` under 2 sek totalt, `console.warn` under 1 sek/spørsmål i snitt.
  Nøkkel: `QUIZ_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY` (ingen ny env-variabel
  kreves i Vercel). Merk: tidsvalideringen måler mot `attempts.completed_at` —
  tabellen har INGEN `created_at`-kolonne; `completed_at` settes av DB-defaulten
  `now()` ved opprettelse og overskrives aldri, så den er forsøkets
  starttidspunkt.
- **`organizations`-tabellen:** RLS strammet til kun `service_role` 19. juli.
  Var offentlig lesbar (inkl. `stripe_customer_id`/`stripe_subscription_id` for
  alle bedriftskunder) via den åpne `organizations_select_all`-policyen siden
  tabellen ble opprettet 1. april — aldri strammet inn før nå.
- **Admin-innlogging:** rate-limitet (5 forsøk / 15 min per IP) og bruker et
  signert, tidsbegrenset sesjonstoken i stedet for å lagre selve
  `ADMIN_PASSWORD` i klartekst i `sessionStorage`. Endret 19. juli.
- **Webhook-idempotens:** `stripe_events`-tabellen (stempler behandlede
  Stripe event-id-er) opprettet og aktivert 19. juli. Var tidligere fraværende,
  så idempotens-sjekken i webhooken feilet stille og gjorde ingenting.
- **Fortsatt åpent:** bot-/spam-beskyttelse (CAPTCHA e.l.) er ikke
  implementert — kun planlagt.

## KJENTE IKKE-BUGS (ikke fiks disse)
- Scroll-effekt på forsiden: kun synlig i Claude in Chrome-utvidelsen
- "Laster profil...": isolert til én spesifikk testbruker

## KJENTE BUGS (lav prioritet)
- "Spill nå"-knappen i quiz-kortet på forsiden vises gul fylt istedenfor outline
  Koden er riktig (inline style, transparent bg) men noe overstyrer den
  Tas i dedikert økt — ikke kritisk

---

## STATUS — LANSERT, LIVE DRIFT
Produktet er lansert og kjører i live drift. Stripe er i **live mode** siden
~23. juni 2026. Flere fredagsquizer er gjennomført i live-modus, inkludert en
betalende B2B-kunde (Elkjøp Nordic).

Fullført siden forrige status (15. juni):
- ~~Stripe live-modus~~ — AKTIVERT ~23. juni 2026
- ~~Supabase Pro~~ — AKTIVERT 14. juni 2026
- ~~E-post ved Stripe-hendelser~~ — bygget (9 ulike varsler i webhooken:
  kjøpsbekreftelse, fornyelse, kansellering, betalingsfeil m.fl., både B2C og org)
- ~~Passordinnlogging~~ — bygget og verifisert 18. juli 2026
- ~~organizations-tabellen offentlig lesbar~~ — RLS strammet 19. juli 2026
- ~~Admin-innlogging uten rate-limit / klartekst-passord~~ — rettet 19. juli 2026
- ~~Webhook-idempotens fraværende~~ — `stripe_events` aktivert 19. juli 2026
- ~~Fasit hentbar på forhånd via /questions uten å spille~~ — signert
  attempt-token på questions/submit + tidsvalidering, 20. juli 2026

Gjenstående/pågående:
1. Forklaringstekst per spørsmål (admin-felt)
2. Mobil-test på ekte enheter
3. Bot-/spam-beskyttelse (kun planlagt, ikke bygget)
