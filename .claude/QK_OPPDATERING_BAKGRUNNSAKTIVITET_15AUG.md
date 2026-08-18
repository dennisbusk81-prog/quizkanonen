# QK_4-oppdatering: unødvendig bakgrunnsaktivitet i ro — tre punkter lukket

**Dato:** 15. august 2026
**Commit:** `b7d53a2` (`perf(cron): fjern unødvendig bakgrunnsarbeid i ro`)

Kartleggingen 15. august fant tre kilder til unødvendig bakgrunnsaktivitet
når systemet er i ro. Alle tre er nå lukket.

## 1. publish-quiz: betinget cache-purge (LUKKET)

Ruten purget `home-shared-data` og `home-page-insights` ubetinget hvert
minutt, så hvert påfølgende forsidebesøk tvang full rekomputering av
forsidens tyngste spørringer (nestet embed quizzes→attempts→attempt_answers
over inntil 500 forsøk).

**VIKTIG AVVIK fra den opprinnelige bestillingen:** fiksen ble IKKE gatet på
kun «UPDATE traff rader». Den ubetingede purgen var et bevisst valg i
`a32dff9` (20. juli): forsidens åpen/stengt-status styres av
`opens_at`/`closes_at`-tidsstempler som passerer UTEN at noen rad skrives, og
`participantCount` er live under åpen quiz. En ren UPDATE-gate ville
gjeninnført buggen der en kvalifiserende quiz var usynlig på forsiden i 12+
minutter. Purgen gates i stedet på tre vilkår (purg hvis minst ett holder):

1. UPDATE-en publiserte minst én quiz
2. en ekte quiz (is_test=false) er åpen NÅ
3. en ekte quiz stengte i løpet av de siste 10 minuttene

Fail-open ved oppslagsfeil (= dagens atferd). Akseptert residual: rene
admin-redigeringer i rolige perioder (f.eks. endret «neste quiz»-tekst)
propagerer via det ordinære 60s-revalidate-vinduet i stedet for innen ett
minutt.

Testdekket i `lib/publish-quiz-purge-route.test.ts` (begge retninger: ingen
purge i ro, purge ved publisering/åpen quiz/nettopp stengt/oppslagsfeil).

## 2. weekly-report: vakt før tung beregning (LUKKET)

For `after_quiz`-orger kjørte hele `computeWeeklySummary`
(organization_members + attempts + profiles) hvert 15. minutt hele uken —
opptil 96 ganger i døgnet — og resultatet ble nesten alltid kastet av
duplikatsjekken som lå ETTER beregningen.

Duplikatsjekken (quizen må ha stengt, og `weekly_report_sent_at` må ikke
allerede dekke den) er flyttet FØR beregningen, inn i `timeMatches`-grenen.
Sjekken bruker ny delt helper `getLatestClosedQuiz()` i `lib/weekly-report.ts`
— samme spørring som `computeWeeklySummary` selv bruker, så vakt og beregning
kan aldri peke på hver sin quiz. Oppslaget er globalt og memoiseres på tvers
av orgene i én kjøring. Den gamle sjekken står igjen som billig backstop i
sendestien (dekker racet der en quiz stenger mellom vakt og beregning).

Testdekket i `lib/weekly-report-guard-route.test.ts` (rapport alt sendt →
ingen beregning; ikke sendt → sendes og stemples som før; ny quiz etter
gammelt stempel → sendes; ingen stengt quiz → ingen beregning).

## 3. ping: markert overflødig (LUKKET i koden; dashbord-del gjenstår hos Dennis)

`app/api/cron/ping/route.ts` var keep-alive for Supabase free tier.
Prosjektet har vært på Supabase Pro siden 14. juni — Pro pauses aldri. Ruten
er merket «OVERFLØDIG SIDEN 14. JUNI 2026, kandidat for sletting» i koden,
men ikke fjernet, i tilfelle den brukes til ekstern overvåkning.

**Gjenstår (Dennis, utenfor kodebasen):** deaktiver jobben i
cron-job.org-dashbordet — skru av «Aktivér job»-bryteren, ikke slett den.
