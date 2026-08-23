'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase, supabaseData, Quiz, Question } from '@/lib/supabase'
import { calculateStreak } from '@/lib/ranking'
import { seededShuffle, ALL_OPTION_LETTERS, optionOrderSeed } from '@/lib/seeded-shuffle'
import QuizInterlude, { MIN_ANSWERED_FOR_PLACEMENT } from '@/components/QuizInterlude'
import { fetchTrialOffer } from '@/lib/trial-offer-fetch'
import type { TrialOffer } from '@/lib/trial-offer'
import { computeStrongCategory } from '@/lib/select-quiz-message'
import { computeCategoryStats } from '@/lib/category-stats'
import { pluralNo } from '@/lib/plural-no'
import ErrorBoundary from '@/components/ErrorBoundary'
import SiteNav from '@/components/SiteNav'
import { useProfile } from '@/components/ProfileProvider'
import { getAvatarInitial } from '@/lib/avatar-initial'
import DuelChallengeModal from '@/components/DuelChallengeModal'
import AuthModal from '@/components/AuthModal'
import { withTimeout, withTimeoutOrNull } from '@/lib/with-timeout'
import { classifySubmitResponse } from '@/lib/submit-response'
import { placementPercentLine } from '@/lib/placement-percent'
import { decidePlacementDisplay, globalExclusionReason, shouldOfferPlacementRetry } from '@/lib/placement-visibility'
import { describeRetry } from '@/lib/retry-affordance'
import { decideResultPlacementView } from '@/lib/result-placement'
import { withAnswer, buildTimeoutAnswer, type AnswerRecord } from '@/lib/quiz-timeout-answer'
import { describeQuestionTimeLimit } from '@/lib/quiz-time-limit'
import { nextQuizLabel } from '@/lib/next-quiz-label'

// Øvre grense for nettverkskallene mellom to spørsmål (goToNext). Uten en
// grense hang mellomskjermen for alltid hvis ett av kallene stoppet opp på
// klienten — se lib/with-timeout.ts for bakgrunnen. Tallet er satt godt over
// normal svartid (målt i hundredeler av sekunder, verstefall et par sekunder
// ved kaldstart) og godt under det en spiller opplever som «henger».
const NEXT_STEP_TIMEOUT_MS = 9000

// Samme øvre grense ved MÅLSTREKEN (finishQuiz og already_played-stien).
// Fram til 5. august 2026 hadde ingen av kallene der noen grense — nøyaktig
// samme svakhet som goToNext hadde før 1. august, bare på et verre tidspunkt:
// et hengende submit-kall lot spilleren stå på siste spørsmål med knappen
// disabled i «Laster…» for alltid, og et hengende /standings i
// already_played-stien lot siden stå på lasteskjermen (kallet ligger FØR
// setLoading(false)). Egen konstant fra NEXT_STEP_TIMEOUT_MS fordi de to
// stedene er uavhengige og kan trenge ulike tall senere; i dag er begge 9 sek.
const FINISH_TIMEOUT_MS = 9000

// Samme øvre grense ved STARTSTREKEN (startQuiz). Fram til 6. august 2026 var
// dette det siste ubeskyttede leddet i spillestien: getSession, POST
// /api/quiz/start-attempt og spørsmålshentingen lå alle uten grense, så ett
// hengende kall lot «Start quiz»-knappen stå disabled i «Laster…» for alltid —
// eneste vei videre var å laste siden på nytt. Startsekvensen er TO serielle
// nettverkssteg, og hvert steg får sitt eget budsjett på 9 sek (samme form som
// finishQuiz: getSession+POST+json i én blokk, som goToNext: spørsmålshenting i
// én blokk) — en treg mobilforbindelse som klarer 9 sek per kall i resten av
// quizen, klarer den også her. Egen konstant av samme grunn som
// FINISH_TIMEOUT_MS: stedene er uavhengige og kan trenge ulike tall senere.
const START_TIMEOUT_MS = 9000

type PlayerInfo = { name: string; ageConfirmed: boolean }
// Hvorfor vi ikke kom videre — styrer teksten spilleren får. En timeout er
// ikke det samme som en feil: serveren kan ha svart helt fint, kallet nådde
// bare aldri tilbake.
type NextLoadFailure = 'error' | 'timeout' | null

// Siste sikkerhetsnett rett før innsending: selv om withAnswer over hindrer nye
// duplikater i klient-state, dedupliserer vi payloaden også — samme prinsipp
// (siste svar for et spørsmål vinner), i tilfelle answers noensinne populeres fra
// et annet sted enn handleAnswer/handleTimeout (f.eks. en fremtidig kodeendring).
function dedupeAnswers(list: AnswerRecord[]): AnswerRecord[] {
  return [...new Map(list.map(a => [a.questionId, a])).values()]
}

function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('qk_device_id')
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem('qk_device_id', id)
  }
  return id
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:      #1a1c23;
    --card:    #21242e;
    --border:  #2a2d38;
    --gold:    #c9a84c;
    --white:   #ffffff;
    --body:     #e8e4dd;
    --muted:   #918f8a;
    --green:   #4ade80;
    --red:     #c94c4c;
    --rcard:   20px;
    --rbtn:    10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .qk-shell {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
  }

  /* Skjul global footer og nav på alle quiz-faser */
  footer { display: none !important; }

  /* Desktop: top-aligned så kortet vokser nedover i stedet for å hoppe opp/ned */
  @media (min-width: 641px) {
    .qk-shell { align-items: flex-start; padding-top: 80px; }
  }

  .qk-box { width: 100%; max-width: 680px; }

  .qk-panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--rcard);
    padding: 36px 32px;
  }

  @media (max-width: 480px) {
    .qk-panel { padding: 28px 22px; }
  }

  /* ── Laptop / kort viewport: kompaktere resultatskjerm ─────────────────────
     Vanlige bærbare (1366×768, 1440×900) har lav viewport-HØYDE — det er høyden,
     ikke bredden, som skiller laptop fra stor desktop. Den luftige desktop-
     layouten ble da for høy og krevde utzooming. Vi komprimerer KUN
     resultatskjermen (phase 'finished'), og kun på korte viewporter (≥641px bred,
     ≤900px høy). Mobil og høye skjermer (stor desktop) beholder full luft. */
  @media (min-width: 641px) and (max-height: 900px) {
    .qk-shell--result { padding-top: 20px; }
    .qk-panel--result { padding: 22px 30px; }
    .qk-panel--result .qk-rsec { margin-bottom: 9px !important; }
    .qk-result-cta { gap: 6px !important; }
    .qk-result-upsell { padding: 18px !important; }
  }

  .qk-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 10px;
  }

  .qk-heading {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    line-height: 1.2;
    letter-spacing: -0.01em;
    margin-bottom: 6px;
  }

  .qk-sub {
    font-size: 14px;
    color: var(--body);
    line-height: 1.5;
    margin-bottom: 28px;
  }

  .qk-divider { height: 1px; background: var(--border); margin: 24px 0; }

  /* .qk-label og .qk-input er fjernet 24. august 2026. Eneste bruker var
     navnefeltet på registreringsskjermen, som forsvant sammen med
     gjeste-veien. Denne siden har ingen andre skjemafelt — kommer det et,
     skal det hente stil fra det delte skjemaet (components/AuthForm.tsx),
     ikke fra en gjenoppstått lokal kopi. */

  .qk-toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    cursor: pointer;
  }

  .qk-toggle {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: var(--border);
    position: relative;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .qk-toggle.on { background: var(--gold); }

  .qk-toggle-thumb {
    width: 18px;
    height: 18px;
    background: var(--white);
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: transform 0.2s;
  }

  .qk-toggle.on .qk-toggle-thumb { transform: translateX(20px); }
  .qk-toggle-label { font-size: 14px; color: var(--body); }

  .qk-sizes { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }

  .qk-size-btn {
    flex: 1;
    padding: 6px 14px;
    border-radius: var(--rbtn);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    background: transparent;
    color: var(--muted);
    border: 0.5px solid #2a2d38;
    cursor: pointer;
    transition: all 0.15s;
  }

  .qk-size-btn.active {
    background: #c9a84c;
    color: #1a1c23;
    border-color: #c9a84c;
  }

  .qk-check-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
    margin-bottom: 24px;
  }

  .qk-check-box {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1.5px solid var(--border);
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    background: var(--bg);
  }

  .qk-check-box.checked { background: var(--gold); border-color: var(--gold); }
  .qk-check-text { font-size: 13px; color: var(--body); line-height: 1.5; }
  .qk-check-text a { color: var(--gold); text-decoration: underline; }

  .qk-btn-primary {
    width: 100%;
    background: var(--gold);
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 11px;
    border-radius: var(--rbtn);
    border: none;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s, opacity 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-decoration: none;
  }

  .qk-btn-primary:hover:not(:disabled) { background: #d9b85c; transform: translateY(-1px); }
  .qk-btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .qk-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

  .qk-spinner {
    display: inline-block;
    width: 14px; height: 14px;
    border: 2px solid rgba(26,28,35,0.3);
    border-top-color: #1a1c23;
    border-radius: 50%;
    animation: qkSpin 0.6s linear infinite;
  }
  @keyframes qkSpin { to { transform: rotate(360deg); } }

  .qk-btn-secondary {
    width: 100%;
    background: transparent;
    color: var(--body);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 500;
    padding: 10px;
    border-radius: var(--rbtn);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all 0.15s;
    text-decoration: none;
    display: block;
    text-align: center;
  }

  .qk-btn-secondary:hover { border-color: rgba(201,168,76,0.3); color: var(--white); }

  .qk-btn-ghost {
    display: block;
    text-align: center;
    font-size: 13px;
    color: var(--body);
    text-decoration: none;
    padding: 10px 0;
    transition: color 0.15s;
    cursor: pointer;
    background: none;
    border: none;
    width: 100%;
  }

  .qk-btn-ghost:hover { color: var(--gold); }

  .qk-banner {
    background: rgba(201,168,76,0.08);
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: var(--rbtn);
    padding: 12px 16px;
    margin-bottom: 24px;
    font-size: 13px;
    color: var(--gold);
    line-height: 1.5;
  }

  .qk-hint {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    margin-top: 16px;
    line-height: 1.6;
  }

  /* PLAYING */
  .qk-play-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 20px;
    max-width: 560px;
    margin: 0 auto;
  }

  /* margin-top: auto her + margin-bottom: auto på scenen (inline i JSX)
     sentrerer hele kolonnen (header + timer + poengrad + scene) som ÉN enhet
     i ledig høyde. Auto-marger — IKKE justify-content: center — fordi de
     kollapser til 0 når innholdet er høyere enn viewporten (landskap):
     justify-content ville klippet toppen uscrollbart. Scenen holder konstant
     høyde gjennom svar-øyeblikket (se reservasjonen i JSX), ellers ville
     sentreringen flyttet kortet når knappen dukker opp. */
  .qk-play-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: auto;
    margin-bottom: 10px;
    padding-top: 8px;
  }

  .qk-progress-text {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .qk-timer {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    font-weight: 700;
    color: var(--white);
    text-align: center;
    display: block;
    margin-bottom: 6px;
    transform-origin: center;
  }

  .qk-timer-bar-wrap {
    background: var(--border);
    border-radius: 4px;
    height: 4px;
    margin-bottom: 20px;
    overflow: hidden;
  }

  .qk-timer-bar { height: 4px; border-radius: 4px; transition: width 1s linear, background-color 0.5s; }

  .qk-score-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .qk-score-pill {
    font-size: 12px;
    font-weight: 600;
    color: var(--green);
    background: rgba(76,175,125,0.1);
    border: 1px solid rgba(76,175,125,0.2);
    padding: 4px 10px;
    border-radius: 20px;
  }

  .qk-rank-pill {
    font-size: 12px;
    font-weight: 600;
    color: var(--gold);
    background: rgba(201,168,76,0.1);
    border: 1px solid rgba(201,168,76,0.2);
    padding: 4px 10px;
    border-radius: 20px;
  }

  .qk-question-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px 24px;
    margin-bottom: 14px;
  }

  .qk-question-text {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    font-weight: 400;
    color: #ffffff;
    line-height: 1.5;
  }

  @media (max-width: 400px) { .qk-question-text { font-size: 16px; } }

  /* 2×2-rutenett (A B / C D i visningsrekkefølge). align-items er bevisst
     IKKE satt — default stretch gjør at begge ruter i en rad alltid holder
     samme høyde, også når bare den ene brekker til flere linjer. */
  .qk-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }

  .qk-option {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--card);
    /* 1px @ #63687a = 3,07:1 mot sidebakgrunnen #1a1c23 (WCAG 1.4.11). Den
       gamle kanten (0,5px @ #2a2d38) lå på 1,24:1 og var i praksis usynlig —
       hover-regelen under er eneste avgrensning, og den finnes ikke på mobil.
       min-height rommer TO tekstlinjer (2 × 22,4px + 27px padding + 2px kant)
       slik at rutehøyden ikke endrer seg mellom spørsmål — et 8-tegns og et
       25-tegns svar gir samme høyde. Kun svar som brekker til 3+ linjer
       (7 av 792 i banken er over 25 tegn) lar raden vokse utover dette. */
    border: 1px solid #63687a;
    border-radius: var(--rcard);
    min-height: 74px;
    padding: 13.5px 16px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, transform 0.12s;
    text-align: left;
    width: 100%;
  }

  /* ── Mobile touch targets ──────────────────────────────────────────── */
  @media (max-width: 640px) {
    .qk-options { gap: 12px; }
    /* Ved 375px viewport er en rute 161,5px bred. Innermålene er strammet
       (padding/gap her, sirkel/tekst i egne media-blokker etter basereglene)
       for at et 25-tegns svar skal holde seg innenfor to linjer:
       161,5 − 2 kant − 24 padding − 26 sirkel − 10 gap = 99,5px tekstfelt
       ≈ 13–14 tegn per linje @ 15px. To tekstlinjer + padding + kant er
       64px; min-height 84 legger 20px luft på det — rutene er BREDDE-
       begrenset, så frigjort skjermhøyde tas ut som luft, ikke som større
       tekst (15→16px ville krympet tekstfeltet og brukket 25-tegns svar
       til tre linjer igjen). */
    .qk-option  { min-height: 84px; padding: 10px 12px; gap: 10px; }
  }

  /* Sticky Neste-knapp når innholdet kan gå forbi folden: smal skjerm ELLER
     lav skjerm. Høydebetingelsen finnes for mobil i landskap (f.eks. 844×390)
     — som er bredere enn 640px, men den eneste geometrien som faktisk
     scroller. Uten den lå knappen ~150px under folden uten sticky. Slår også
     inn i svært lave desktop-vinduer (<500px) — der scroller innholdet
     også, så sticky er riktig, ikke en bivirkning. */
  @media (max-width: 640px), (max-height: 500px) {
    .qk-next-btn-wrap {
      position: sticky;
      bottom: 0;
      padding: 12px 0 8px;
      /* Fade so content behind the button is legible while scrolling */
      background: linear-gradient(transparent, var(--bg) 28%);
      z-index: 10;
      margin-top: 2px;
    }
  }

  @media (hover: hover) and (pointer: fine) {
    /* var(--pos-bg): posisjonsfargede ruter beholder tonen sin under hover
       (kanten lysnes — det er hover-responsen); #262930 er fallback for
       ruter uten posisjonsfarge. Uten denne ville hover grået ut flaten og
       sett ut som deaktivert. */
    .qk-option:hover:not(:disabled) { border-color: #918f8a; background: var(--pos-bg, #262930); }
  }
  /* Trykk-respons. transform — IKKE bredde/padding/margin — slik at
     naboalternativene ikke flytter seg. Speiler .qk-btn-primary:active. */
  .qk-option:active:not(:disabled) { transform: scale(0.985); border-color: #918f8a; }
  /* Alternativene arvet tidligere nettleserens standard fokusring. #918f8a
     framfor gull: gull ville kollidert med alternativet som allerede er
     markert som riktig. outline påvirker ikke layout. */
  .qk-option:focus-visible { outline: 2px solid #918f8a; outline-offset: 2px; }
  .qk-option:disabled { cursor: default; }
  @keyframes qkButtonPop {
    0%   { transform: scale(1); }
    40%  { transform: scale(1.05); }
    70%  { transform: scale(0.98); }
    100% { transform: scale(1); }
  }

  @keyframes qkShake {
    0%, 100% { transform: translateX(0); }
    20%      { transform: translateX(-5px); }
    40%      { transform: translateX(5px); }
    60%      { transform: translateX(-5px); }
    80%      { transform: translateX(5px); }
  }

  @keyframes qkScorePop {
    0%   { transform: translate(-50%, -50%) scale(0.7); opacity: 1; }
    40%  { transform: translate(-50%, calc(-50% - 40px)) scale(1.3); opacity: 1; }
    100% { transform: translate(-50%, calc(-50% - 80px)) scale(0.9); opacity: 0; }
  }

  @keyframes qkStreakMsg {
    0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
    25%  { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
    70%  { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
  }

  /* ── Posisjonsfarger (kun FØR svar) ─────────────────────────────────
     Dempet tonet flate + kant per visnings-POSISJON (etter stokking),
     så alternativene kan skilles fra hverandre. Klassene settes bare
     mens spørsmålet er ubesvart — JSX fjerner dem i det svaret avgis,
     slik at correct/correct-self/wrong/idle under overtar uimotsagt.
     Hvit tekst mot flatene: A 14,1:1 · B 14,0:1 · C 14,5:1 · D 15,3:1.
     Sirkeltekst #12141a mot sirklene: 4,7–6,0:1. Alle ≥ 4,5:1. */
  .qk-option.qk-pos-a { --pos-bg: #252b3d; background: var(--pos-bg); border-color: #6f7fb5; }
  .qk-option.qk-pos-b { --pos-bg: #1f2f2c; background: var(--pos-bg); border-color: #5f9c8e; }
  .qk-option.qk-pos-c { --pos-bg: #32271f; background: var(--pos-bg); border-color: #b58a6f; }
  .qk-option.qk-pos-d { --pos-bg: #2a2231; background: var(--pos-bg); border-color: #9b7fa8; }
  .qk-option.qk-pos-a .qk-opt-letter { background: #6f7fb5; border-color: #6f7fb5; color: #12141a; }
  .qk-option.qk-pos-b .qk-opt-letter { background: #5f9c8e; border-color: #5f9c8e; color: #12141a; }
  .qk-option.qk-pos-c .qk-opt-letter { background: #b58a6f; border-color: #b58a6f; color: #12141a; }
  .qk-option.qk-pos-d .qk-opt-letter { background: #9b7fa8; border-color: #9b7fa8; color: #12141a; }

  /* Én grønn i hele tilstanden — kant, fyll og bokstavsirkel. Fram til
     3. august 2026 var kanten #3B6D11 (B2B-sidens merkegrønn) mens sirkelen
     var var(--green): to grønne i samme tilstand. #3B6D11 klarte dessuten
     ikke WCAG 1.4.11 som kant — 2,74:1 mot bakgrunnen og 2,50:1 mot sitt eget
     fyll, begge under 3:1. var(--green) gir 9,76:1 og 7,65:1. Samme form som
     .qk-option.wrong under: literal rgba på fyllet, var() på kanten. */
  .qk-option.correct { background: rgba(74,222,128,0.12); border-color: var(--green); }
  /* Bokstavsirkelen for denne tilstanden står bevisst IKKE her, men etter
     .qk-opt-letter-basen lenger ned (søk «Mørk tekst på grønt»): den må vinne
     over basens egen bakgrunn, og med lik spesifisitet er det rekkefølgen som
     avgjør. En .qk-option.correct .qk-opt-letter lagt inn her ville vært død
     ved fødselen — det var nettopp en slik regel som sto her til 3. august
     2026, og som ville reversert kontrastfiksen stille hvis noen slettet
     regelen lenger ned i den tro at DEN var duplikatet. */

  .qk-option.correct-self { background: rgba(201,168,76,0.1); border-color: #c9a84c; animation: qkButtonPop 0.4s ease-out; }
  .qk-option.correct-self .qk-opt-letter { background: #c9a84c; border-color: #c9a84c; color: #1a1c23; transform: scale(1.2); transition: transform 0.15s; }
  .qk-option.correct-self .qk-opt-text { color: #c9a84c; font-weight: 600; }

  .qk-option.wrong { background: rgba(201,76,76,0.1); border-color: var(--red); opacity: 0.7; }
  .qk-option.idle { opacity: 0.4; }

  .qk-opt-letter {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #2a2d38;
    border: 1.5px solid #2a2d38;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    color: #e8e4dd;
    flex-shrink: 0;
    transition: all 0.15s;
  }

  /* Mørk tekst på grønt: hvit på #4ade80 er 1,74:1, #1a1c23 gir 9,76:1.
     Denne tilstanden vises hver gang spilleren svarer feil. */
  .qk-option.correct .qk-opt-letter { background: var(--green); border-color: var(--green); color: #1a1c23; }
  .qk-option.wrong .qk-opt-letter { background: var(--red); border-color: var(--red); color: #fff; }

  /* min-width: 0 lar tekstfeltet krympe under innholdsbredden sin i den
     smale ruta (flex-barn har ellers min-width: auto), og break-word
     brekker enkeltord bredere enn ruta i stedet for å la dem flyte ut. */
  .qk-opt-text { font-size: 16px; font-weight: 500; color: var(--white); line-height: 1.4; min-width: 0; overflow-wrap: break-word; }

  /* Må stå ETTER basereglene over for å vinne kaskaden (lik spesifisitet).
     Regnestykket bak målene står i mobilblokken lenger opp. */
  @media (max-width: 640px) {
    .qk-opt-text { font-size: 15px; }
  }

  /* Sirkelen beholder basens 30px ned til 390px viewport. Under det koster
     de 4 ekstra pikslene akkurat nok tekstbredde til at et 25-tegns svar
     brekker til tre linjer — så 26px kun der. */
  @media (max-width: 389.98px) {
    .qk-opt-letter { width: 26px; height: 26px; font-size: 12px; }
  }

  .qk-explanation {
    background: rgba(201,168,76,0.06);
    border: 1px solid rgba(201,168,76,0.15);
    border-radius: var(--rbtn);
    padding: 12px 16px;
    font-size: 13px;
    color: var(--body);
    line-height: 1.6;
    margin-bottom: 12px;
  }

  /* RESULT */
  .qk-result-icon { font-size: 52px; margin-bottom: 16px; display: block; text-align: center; }

  .qk-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }

  .qk-stat {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 16px 14px;
    text-align: center;
  }

  .qk-stat-value {
    font-family: 'Libre Baskerville', serif;
    font-size: 24px;
    font-weight: 700;
    color: #c9a84c;
    line-height: 1;
    margin-bottom: 5px;
  }

  .qk-stat-label { font-size: 11px; color: #918f8a; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 400; }

  @keyframes qkstreakfade {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .qk-streak-badge {
    font-size: 13px;
    font-weight: 700;
    color: #c9a84c;
    text-align: center;
    margin-bottom: 10px;
    animation: qkstreakfade 300ms ease-out;
  }

  /* ANIMATION: question slide-in */
  @keyframes questionIn {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .qk-animate-in {
    animation: questionIn 200ms ease-out both;
  }

  /* ANIMATION: timer — 3 eskaleringsnivåer */
  /* Rolig (10-7s): grønn, ingen puls */
  .qk-timer--calm { color: #4ade80; }

  /* Advarsel (6-4s): gul, svak puls */
  @keyframes timerPulseWarning {
    0%, 100% { transform: scale(1.0); }
    50%       { transform: scale(1.1); }
  }
  .qk-timer--warning {
    color: #EF9F27;
    animation: timerPulseWarning 600ms ease-in-out infinite;
  }

  /* Kritisk (3-1s): rød, aggressiv puls */
  @keyframes timerPulseCritical {
    0%, 100% { transform: scale(1.0); }
    50%       { transform: scale(1.2); }
  }
  .qk-timer--critical {
    color: #E24B4A;
    animation: timerPulseCritical 400ms ease-in-out infinite;
  }

  /* Kritisk bakgrunnsglød — pulserer inn og ut på spillskjermen */
  @keyframes qkRedGlow {
    0%, 100% { background-color: rgba(226,75,74,0); }
    50%       { background-color: rgba(226,75,74,0.06); }
  }
  .qk-play-shell--critical { animation: qkRedGlow 400ms ease-in-out infinite; }

  /* ANIMATION: intermediate screen fade */
  @keyframes qkFadeIn  { from { opacity: 0; } to { opacity: 1; } }
  @keyframes qkFadeOut { from { opacity: 1; } to { opacity: 0; } }
  .qk-intermediate-in  { animation: qkFadeIn  150ms ease-out both; }
  .qk-intermediate-out { animation: qkFadeOut 250ms ease-in  both; }

  /* SOCIAL PROOF */
  .qk-social-proof-wrap {
    background: rgba(201,168,76,0.04);
    border: 0.5px solid rgba(201,168,76,0.15);
    border-radius: 12px;
    padding: 12px 16px;
    margin: 16px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .qk-social-proof-dot {
    width: 6px;
    height: 6px;
    background: var(--gold);
    border-radius: 50%;
    flex-shrink: 0;
    animation: qkpulse 2s ease-in-out infinite;
  }

  .qk-social-proof-pills {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  @media (max-width: 480px) {
    .qk-social-proof-wrap { flex-direction: column; gap: 8px; }
  }

  /* LOADING */
  .qk-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .qk-loading-dot {
    width: 6px; height: 6px; background: var(--gold); border-radius: 50%;
    animation: qkpulse 1.2s ease-in-out infinite; margin: 0 3px; display: inline-block;
  }
  .qk-loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .qk-loading-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes qkpulse {
    0%, 100% { opacity: 0.2; transform: scale(0.8); }
    50%       { opacity: 1;   transform: scale(1.2); }
  }

  /* ANSWER ANIMATIONS */
  @keyframes qkFlash {
    0%   { opacity: 1; }
    100% { opacity: 0; }
  }
  .qk-flash-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 9997;
    background: rgba(201,168,76,0.08);
  }

  @keyframes qkRingPulse {
    0%   { transform: translate(-50%,-50%) scale(0.5); opacity: 0.9; }
    100% { transform: translate(-50%,-50%) scale(2.5); opacity: 0; }
  }
  .qk-ring-el {
    position: fixed;
    width: 80px; height: 80px;
    border-radius: 50%;
    border: 2px solid rgba(201,168,76,0.6);
    pointer-events: none; z-index: 10001;
  }

  .qk-score-pop-el {
    position: fixed;
    pointer-events: none; z-index: 10002;
    font-family: 'Libre Baskerville', serif;
    font-size: 32px; font-weight: 700;
    color: #c9a84c;
    text-shadow: 0 0 20px rgba(201,168,76,0.5);
  }

  .qk-streak-msg-el {
    position: fixed;
    left: 50%; top: 40%;
    pointer-events: none; z-index: 10003;
    font-family: 'Libre Baskerville', serif;
    font-size: 24px; font-weight: 700;
    color: #c9a84c;
    text-shadow: 0 0 30px rgba(201,168,76,0.6);
    white-space: nowrap;
  }

  /* ── Desktop ── */
  @media (min-width: 769px) {
    .qk-panel          { padding: 44px 40px; }
    .qk-question-text  { font-size: 22px; }
  }

  /* ── Desktop side panels (1100px+) ── */
  .qk-side { display: none; }
  .qk-side-card {
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 16px;
    padding: 20px 18px;
  }
  .qk-side-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #918f8a;
    margin-bottom: 14px;
    font-family: 'Instrument Sans', sans-serif;
  }
  @media (min-width: 1100px) {
    .qk-game-wrap {
      display: grid;
      grid-template-columns: 180px minmax(0, 560px) 180px;
      gap: 24px;
      align-items: start;
      justify-content: center;
      /* align-content sentrerer RADEN (alle tre kolonner samlet) vertikalt i
         ledig høyde — align-items: start beholdes, sidepanelene topper
         fortsatt raden. min-height (ikke height) gjør sentreringen trygg:
         er innholdet høyere enn viewporten vokser containeren og siden
         scroller — ingen uscrollbar topp. */
      align-content: center;
      min-height: 100vh;
      max-width: 980px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .qk-game-wrap .qk-play-shell {
      min-height: 0;
      padding-top: 0;
      padding-left: 0;
      padding-right: 0;
      max-width: none;
      margin: 0;
    }
    .qk-side { display: block; }
    /* Juster global footer til å matche game-wrap-bredden på quiz-siden.
       !important nødvendig for å vinne over Tailwinds .max-w-5xl (klasse-selektors høyere spesifisitet) */
    footer > div { max-width: 980px !important; }
  }

  /* ── Kompaktmodus for lav viewport-HØYDE (mobil i landskap, lave vinduer) ──
     844×390 er bredere enn 640px og treffes ikke av noen width-basert regel —
     innholdet (564px målt) scrollet i det som skal være ett blikk. Samme
     grense som sticky-medien (500px): ingen portrettmobil er under 667px høy,
     så kompaktmodus kan ikke lekke dit, og i lave desktop-vinduer FJERNER den
     scrollingen i stedet for å bare sticky-plastre den.

     Budsjett mot 390px (normaltilfelle, 2-linjers spørsmål, korte svar):
     8 shell + 26,7 header + ~22 timer + 10 bar + ~30 poengrad + ~103 kort
     + 114 ruter + ~44 knappefelt + 8 shell ≈ 365px — også med streak-badge
     (+21,6) holder det seg under 390. Spørsmålstekst 16px er samme verdi som
     ≤400px-nivået i portrett; rute-min-height 48px er anbefalt minste
     touchflate. MÅ stå ETTER 769px- og 1100px-blokkene: lik spesifisitet,
     kildeorden avgjør. */
  @media (max-height: 500px) {
    .qk-play-shell    { padding-top: 8px; padding-bottom: 8px; }
    .qk-play-header   { padding-top: 0; margin-bottom: 4px; }
    .qk-timer         { font-size: 16px; margin-bottom: 2px; }
    .qk-timer-bar-wrap { margin-bottom: 6px; }
    .qk-score-row     { margin-bottom: 4px; }
    .qk-question-card { padding: 10px 18px; margin-bottom: 8px; }
    .qk-question-text { font-size: 16px; }
    .qk-streak-badge  { margin-bottom: 6px; }
    .qk-options       { margin-bottom: 8px; }
    /* 48px rommer én tekstlinje med god luft; 2+-linjers svar vokser raden
       som ellers (min-height er gulv, ikke tak). */
    .qk-option        { min-height: 48px; padding: 8px 14px; }
    .qk-opt-letter    { width: 26px; height: 26px; font-size: 12px; }
    .qk-explanation   { padding: 8px 12px; margin-bottom: 8px; }
    .qk-next-btn-wrap { padding: 6px 0 4px; }
    .qk-next-btn-wrap .qk-btn-primary { padding: 7px; }
  }
  /* Grid-varianten (≥1100px) har egen ytterpadding som også må strammes —
     egen medie fordi .qk-game-wrap under 1100px er en ren div uten padding,
     og en generell regel ville lagt NY padding på landskap-mobil. */
  @media (max-height: 500px) and (min-width: 1100px) {
    .qk-game-wrap { padding-top: 12px; padding-bottom: 12px; }
  }
`

export default function QuizPage() {
  const params = useParams()
  const quizId = params.id as string

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  // Spørsmål lastes inkrementelt (ett om gangen) for å skjule fasiten. questions
  // inneholder kun spørsmålene som er vist så langt; totalQuestions er fasiten på
  // hvor mange det er totalt (brukes til progresjon, «siste spørsmål», resultat).
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [phase, setPhase] = useState<'register' | 'playing' | 'finished' | 'already_played'>('register')
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo>({ name: '', ageConfirmed: false })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [answered, setAnswered] = useState(false)
  const [timeLeft, setTimeLeft] = useState(30)
  const [questionStartTime, setQuestionStartTime] = useState(0)
  const [totalTimeMs, setTotalTimeMs] = useState(0)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  // Signert token fra start-attempt. Kreves av /questions og /submit. Holdes kun
  // i minnet — aldri localStorage: gjenopptakelse etter reload kaller
  // start-attempt på nytt (reused-stien) og får et ferskt token derfra.
  const [attemptToken, setAttemptToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Uinnlogget besøkende. Fram til 24. august 2026 sto det en hard redirect til
  // /login her i stedet; se sesjons-effekten under for hvorfor den ble byttet
  // mot et panel med innlogging PÅ SIDEN. Starter false og settes kun av
  // sesjons-sjekken (og av 401 fra start-attempt) — `loading` dekker
  // «ikke avgjort ennå», så panelet kan aldri blinke forbi før svaret er inne.
  const [needsLogin, setNeedsLogin] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [, setAgeConfirmed] = useState(false)
  // Rank-pillen ved siden av poengsummen. Bærer BÅDE det eksakte tallet og
  // spennet, fordi serveren nå avgjør hvilket av dem kalleren får (P-2,
  // 23. august 2026): `exact` er null for alle som ikke er Premium, og pillen
  // viser da «#31–35» i stedet for «#33». Fram til nå leste pillen `rank` rått
  // og hadde ingen premium-sjekk i det hele tatt — 46 av 67 spillere
  // 21. august så et eksakt tall de ikke hadde betalt for.
  const [liveRank, setLiveRank] = useState<{ exact: number | null; low: number; high: number } | null>(null)
  const [resumeData, setResumeData] = useState<{ index: number; answers: AnswerRecord[]; totalTime: number } | null>(null)
  const [nextQuizAt, setNextQuizAt] = useState<string | null>(null)
  // `rank` er nullbar: /standings sender eksakt plassering kun til Premium
  // (P-2). decideResultPlacementView faller til gratis-kortet når den mangler.
  const [estimatedPlacement, setEstimatedPlacement] = useState<{ rank: number | null; low: number; high: number; total: number } | null>(null)
  // Intern plassering (org-rommet) fra /api/leaderboard/[id]?org= — hentes i en
  // egen effekt når resultatskjermen vises og spilleren er org-medlem (se
  // lib/placement-visibility.ts for hvem som ser hva). exactRank er null for
  // gratis (samme Premium-gate som globalt — ruten sender kun 10-båndets start
  // i userEntry.rank).
  const [internalPlacement, setInternalPlacement] = useState<{ exactRank: number | null; bandStart: number | null; total: number } | null>(null)
  const [serverScore, setServerScore] = useState<{ correctAnswers: number; totalTimeMs: number; correctStreak: number } | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [, setLoggedInUserId] = useState<string | null>(null)
  const [loggedInDisplayName, setLoggedInDisplayName] = useState<string | null>(null)
  const [, setAgeAlreadyConfirmed] = useState(false)
  const [ligaBox, setLigaBox] = useState<{ type: 'liga'; name: string; slug: string } | { type: 'multi' } | { type: 'cta' } | null>(null)
  const [orgBox, setOrgBox] = useState<{ orgName: string; orgSlug: string; userRank: number | null } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  // Premium vises via delt context (ProfileProvider). refreshProfile() brukes
  // til de to bevisste resjekkene (quiz-start + innsending) der founders kan ha
  // aktivert midt i økta. myOrgs brukes til season-summary-boksen under —
  // unngår et eget POST /api/org/my-orgs-kall (speiler OrgCard.tsx, df99071).
  // userId/myOrgsLoaded mater decidePlacementDisplay — samme kilde som myOrgs,
  // så «hvem er du» og «hvilke orger» aldri kommer fra to usynkrone svar.
  // myOrgsError/refreshMyOrgs er utveien når org-svaret har FEILET og
  // 'unknown' derfor aldri retter seg selv — se shouldOfferPlacementRetry.
  const {
    isPremium, refreshProfile, myOrgs, myOrgsLoaded, userId: profileUserId,
    myOrgsError, myOrgsRefreshing, refreshMyOrgs,
  } = useProfile()
  // Hvilken plassering denne spilleren skal se på resultatskjermen — se
  // lib/placement-visibility.ts. 'internal-only' (blokkert org/eget opt-out)
  // undertrykker det offentlige tallet i BÅDE plasseringskortet og begge
  // delingstekstene; 'both' legger det interne tallet til; 'unknown' (org-svar
  // ikke landet ennå) viser ingen plassering framfor å gjette 'public'.
  const placementDisplay = decidePlacementDisplay({
    userId: profileUserId,
    orgsLoaded: myOrgsLoaded,
    orgs: myOrgs,
  })
  const [shareResultCopied, setShareResultCopied] = useState(false)
  const [challengeResultCopied, setChallengeResultCopied] = useState(false)
  const [cardShareState, setCardShareState] = useState<'idle' | 'loading' | 'done'>('idle')
  // Prøveperiode-tilbudet i upsell-kortet nederst på resultatskjermen. Hentes
  // først når kortet faktisk kan vises (finished + innlogget + ikke Premium) —
  // spillestien skal ikke betale for et kall den aldri bruker. `null` = ikke
  // hentet ennå → kortet viser sin vanlige Premium-tekst.
  const [trialOffer, setTrialOffer] = useState<TrialOffer | null>(null)
  const [questionKey, setQuestionKey] = useState(0)
  const [interPhase, setInterPhase] = useState<'hidden' | 'in' | 'out'>('hidden')
  const [interLow, setInterLow] = useState<number | null>(null)
  const [interHigh, setInterHigh] = useState<number | null>(null)
  // Del 5: premium-blokken i mellomskjermen. Hentes i goToNext i SAMME kall som
  // gir low/high, i stedet for at QuizInterlude gjør sitt eget fetch mot samme
  // snapshot.
  const [interLiveRanking, setInterLiveRanking] = useState<{
    totalPlayers: number
    userRank: number
    above: { name: string; correct: number } | null
    below: { name: string; correct: number } | null
  } | null>(null)
  const [, setInterQLeft] = useState(0)
  const [interLastCorrect, setInterLastCorrect] = useState<boolean | null>(null)
  const [interCorrectAnswerText, setInterCorrectAnswerText] = useState<string | null>(null)
  const [interExplanation, setInterExplanation] = useState<string | null>(null)
  const [interScore, setInterScore] = useState(0)
  const [interStreak, setInterStreak] = useState(0)
  const [interWrongInARow, setInterWrongInARow] = useState(0)
  const [interNextQNum, setInterNextQNum] = useState(1)
  // Kategorien til spørsmålet som nettopp ble besvart riktig, når spilleren har
  // min. 3 riktige i den totalt («Diverse» ekskludert) — utledet i goToNext via
  // computeStrongCategory, ren lokal beregning.
  const [interStrongCategory, setInterStrongCategory] = useState<string | null>(null)
  const [pendingNextIndex, setPendingNextIndex] = useState<number | null>(null)
  const [shuffledDisplayOrder, setShuffledDisplayOrder] = useState<string[]>(['A', 'B', 'C', 'D'])
  const [rivalData, setRivalData] = useState<{ name: string; avatarColor: string; score: number } | null>(null)
  const [rankingSnapshot, setRankingSnapshot] = useState<{ top10MinCorrect: number; leaderName: string; leaderCorrect: number; totalPlayers: number } | null>(null)
  // Duell-forslag på resultatskjermen — «oppdag noen nye å utfordre», IKKE
  // rivalen (som allerede vises i eget kort). Hentet sammen med rivalData ved
  // quiz-start (samme /api/quiz/rival-kall, se startQuiz), klar til bruk når
  // 'finished' vises uten en ekstra runde-tripp.
  const [duelSuggestions, setDuelSuggestions] = useState<{ userId: string; name: string; avatarColor: string; score: number }[]>([])
  // Duell-status — samme datakilde/mønster som app/leaderboard/[id]/page.tsx
  // sin loadDuelStatus(): activeDuelExists speiler regelen «kun én aktiv/
  // ventende duell per måned» i /api/rivalries (POST), duelInvolvedSet er
  // motstandere brukeren allerede er engasjert med og derfor ikke skal
  // foreslås på nytt.
  const [activeDuelExists, setActiveDuelExists] = useState(false)
  const [duelInvolvedSet, setDuelInvolvedSet] = useState<Set<string>>(new Set())
  const [pendingChallenge, setPendingChallenge] = useState<{ id: string; name: string } | null>(null)
  const [challengeLoadingId, setChallengeLoadingId] = useState<string | null>(null)
  const [challengeError, setChallengeError] = useState<{ rivalId: string; message: string } | null>(null)
  const [challengeSentSet, setChallengeSentSet] = useState<Set<string>>(new Set())
  const [top3, setTop3] = useState<Array<{ id: string; player_name: string; correct_answers: number; total_time_ms: number; nickname?: string | null }>>([])
  const [socialProof, setSocialProof] = useState<{ totalPlayers: number; sampleNames: string[]; timeLimitLabel?: string | null } | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [isSuspended, setIsSuspended] = useState(false)
  const [finishSaveError, setFinishSaveError] = useState<string | null>(null)
  // Submit ved målstreken svarte ikke innen fristen. Holdes BEVISST atskilt fra
  // finishSaveError: en timeout gir oss ingen kunnskap om hvorvidt serveren
  // rakk å lagre resultatet, og da kan vi ikke påstå at det ikke ble lagret.
  const [finishTimedOut, setFinishTimedOut] = useState(false)
  // Har vi timet ut minst én gang i dette forsøket? Styrer teksten hvis et
  // senere forsøk feiler: submit er ikke idempotent — et nytt kall etter at det
  // første faktisk landet svarer 403 «Forsøket er allerede levert» — så
  // «Resultatet ble ikke lagret» ville da vært en direkte usann påstand.
  const finishTimedOutOnceRef = useRef(false)
  const [nextLoadFailed, setNextLoadFailed] = useState<NextLoadFailure>(null)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  // Re-entry-guard for goToNext: ref leses synkront (state-oppdatering er asynkron
  // og rekker ikke å blokkere et raskt andre-klikk i samme tick).
  const advancingRef = useRef(false)
  // Re-entry-guard for startQuiz — samme mønster som advancingRef/isAdvancing i
  // goToNext. startQuiz gjør tre nettverksrunder (getSession, start-attempt,
  // questions) før phase blir 'playing', og start-skjermen med knappen stod
  // enabled hele veien. Et dobbelttrykk kjørte dermed hele oppstarten to ganger.
  const startingRef = useRef(false)
  // Synkron guard for svar-registrering. `answered`-state beholdes for visning og
  // disabling av knappene, men state oppdateres asynkront: to trykk innenfor samme
  // tick (to fingre, eller ett trykk som treffer to nabo-knapper) leser begge
  // answered === false, og disabled={answered} trer først i kraft ved neste render.
  // Begge handlerne kjørte da videre, begge bygget [...answers, record] fra samme
  // utdaterte array, og siste setAnswers vant — brukerens tiltenkte svar kunne bli
  // overskrevet uten spor. Ref-en leses og settes synkront og lukker det vinduet.
  const answeredRef = useRef(false)
  // Speiler `phase` synkront. En closure fanger phase-verdien fra da funksjonen
  // ble kalt — ved to samtidige startQuiz-kall så BEGGE 'register', så en sjekk
  // på selve state-variabelen ville ikke fanget re-kjøringen. Ref-en leses på
  // det tidspunktet oppdateringen faktisk skjer.
  const phaseRef = useRef<typeof phase>('register')
  const [orgQuizOpensAt, setOrgQuizOpensAt] = useState<string | null>(null)
  const [orgQuizClosesAt, setOrgQuizClosesAt] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const questionCardRef      = useRef<HTMLDivElement | null>(null)
  const scoreBadgeRef        = useRef<HTMLSpanElement | null>(null)
  const streakBadgeRef       = useRef<HTMLDivElement | null>(null)
  const timerRef             = useRef<HTMLSpanElement | null>(null)
  const playShellRef         = useRef<HTMLDivElement | null>(null)
  const animationTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const canvasRef            = useRef<HTMLCanvasElement | null>(null)
  const confettiRafRef       = useRef<number | null>(null)
  const flashRef             = useRef<HTMLDivElement | null>(null)
  const ringRefs             = useRef<(HTMLDivElement | null)[]>([null, null, null])
  const scorePopRef          = useRef<HTMLDivElement | null>(null)
  const streakMsgRef         = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        // Fram til 24. august 2026 sto det en hard redirect hit:
        //   window.location.href = `/login?next=/quiz/${quizId}`
        // Den fungerte, men kastet besøkeren ut av quizen for å hente ham
        // tilbake etterpå. Publikum kommer fra en Facebook-gruppe, og i
        // Facebooks innebygde nettleser er et sidebytte det dyreste vi kan
        // be om: Google-OAuth er blokkert der (se InAppBrowserWarning), så
        // brukeren må uansett gjennom passord eller magic link, og hvert hopp
        // er en ny sjanse til å falle ut.
        //
        // Nå blir vi stående: panelet under viser quizens tittel og et
        // innloggingsvindu (AuthModal → AuthForm, samme skjema som /login og
        // toppnavigasjonen). `next` peker tilbake hit, så både Google-runden
        // via /auth/callback og passordinnlogging lander på riktig quiz.
        setNeedsLogin(true)
        setLoading(false)
        return
      }
      setIsLoggedIn(true)
      setLoggedInUserId(session.user.id)
      const { data: prof } = await supabaseData
        .from('profiles')
        .select('display_name, age_confirmed_at, suspended_until')
        .eq('id', session.user.id)
        .maybeSingle()
      if (prof?.suspended_until && new Date(prof.suspended_until) > new Date()) {
        setIsSuspended(true)
        setLoading(false)
        return
      }
      const name = prof?.display_name ?? session.user.email?.split('@')[0] ?? ''
      // Kun ÉN mottaker igjen: `nameInput` (fritekstfeltet) er fjernet sammen
      // med gjeste-veien 24. august 2026.
      if (name) setLoggedInDisplayName(name)
      // Premium-VISNING styres av delt context (ProfileProvider), som selv
      // hydrerer fra sessionStorage og bekrefter mot serveren.
      //
      // Her lå tidligere et definitivt server-svar (fetchPremiumStatus) hvis
      // ENESTE formål var å avgjøre om founders-CTA-en skulle forhåndslastes,
      // pluss selve hentingen av /api/founders/count. Begge falt bort da
      // Founders-promoteringen ble avviklet 12. august 2026 — upsell-kortet
      // under er nå statisk Premium-tekst uten dag-/plasstall å hente.
      if (prof?.age_confirmed_at) {
        setAgeAlreadyConfirmed(true)
        setAgeConfirmed(true)
      }
      // Hent org-spesifikke quiz-tidspunkter
      try {
        const timesRes = await fetch(`/api/org/my-quiz-times?quizId=${quizId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (timesRes.ok) {
          const timesData = await timesRes.json()
          if (timesData.orgOpensAt) setOrgQuizOpensAt(timesData.orgOpensAt)
          if (timesData.orgClosesAt) setOrgQuizClosesAt(timesData.orgClosesAt)
          if (timesData.orgName) setOrgName(timesData.orgName)
        }
      } catch { /* org-tider er valgfrie */ }
    })
  }, [quizId])

  // NameRequiredModal (root layout) kan sette visningsnavnet MENS denne siden
  // står åpen. Uten denne lytteren ble `loggedInDisplayName` stående null her,
  // og «Start quiz» forble disabled rett etter at brukeren hadde fylt inn
  // navnet sitt. Blindveien oppsto i det øyeblikket navnefeltet på denne siden
  // ble fjernet (24. august 2026) — før det kunne brukeren skrive seg forbi.
  useEffect(() => {
    const onProfileUpdated = (e: Event) => {
      const name = (e as CustomEvent<{ display_name?: string }>).detail?.display_name
      if (name) setLoggedInDisplayName(name)
    }
    window.addEventListener('qk:profile-updated', onProfileUpdated)
    return () => window.removeEventListener('qk:profile-updated', onProfileUpdated)
  }, [])

  // Intern plassering for org-medlemmer — hentes når resultatskjermen vises.
  // Egen effekt (ikke i finishQuiz) med vilje: myOrgs lastes asynkront, og
  // hadde hentingen ligget i finishQuiz ville en spiller hvis org-svar landet
  // ETTER innsending aldri fått det interne tallet. Effekten re-kjører når
  // placementDisplay endres og henter da det som mangler. Ref-vakten hindrer
  // dobbelthenting (StrictMode/re-render) uten å blokkere en NY org-slug.
  const internalPlacementFetchedFor = useRef<string | null>(null)
  useEffect(() => {
    if (phase !== 'finished') return
    if (placementDisplay.mode !== 'internal-only' && placementDisplay.mode !== 'both') return
    const orgSlug = placementDisplay.org.orgSlug
    if (internalPlacementFetchedFor.current === orgSlug) return
    internalPlacementFetchedFor.current = orgSlug
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return
        // Samme rute og samme medlemskaps-gate som org-visningen på
        // /leaderboard/[id]?org= — ingen ny kodesti. limit=1: vi trenger kun
        // userRank/userEntry/totalCount, ikke listen.
        const res = await fetch(
          `/api/leaderboard/${quizId}?is_team=false&limit=1&org=${encodeURIComponent(orgSlug)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        )
        if (!res.ok) return
        const j: { userRank?: number | null; userEntry?: { rank: number } | null; totalCount?: number } = await res.json()
        if (j?.userEntry) {
          setInternalPlacement({
            exactRank: j.userRank ?? null,
            bandStart: j.userEntry.rank ?? null,
            total: j.totalCount ?? 0,
          })
        }
      } catch { /* intern plassering er et tillegg — resultatskjermen skal ikke feile på den */ }
    })()
  }, [phase, placementDisplay, quizId])

  useEffect(() => {
    async function fetchData() {
      // Social proof hentes parallelt — ikke-blokkerende
      fetch(`/api/quiz/social-proof?quizId=${quizId}`)
        .then(r => r.ok ? r.json() : { totalPlayers: 0, sampleNames: [] })
        .then(d => setSocialProof(d))
        .catch(() => {})

      const { data: quizData, error: quizError } = await supabaseData.from('quizzes').select('*').eq('id', quizId).single()
      if (quizError) console.error('Quiz fetch feilet:', quizError)
      // Innloggede: kun bruker-ID (verifisert token) avgjør om quizen er spilt.
      // played_log (enhetsbasert) sjekkes IKKE for innloggede — den er enhet-agnostisk
      // og vil feilaktig blokkere en annen konto som deler samme nettleser.
      //
      // Uinnloggede: ingen sjekk i det hele tatt (endret 24. august 2026). Her
      // lå en enhetsbasert oppslag mot played_log, arvet fra den gang gjester
      // kunne spille. Etter at gjeste-veien er stengt, kan en uinnlogget
      // besøkende ikke starte noe uansett — han skal se innloggingspanelet,
      // ikke «du har allerede spilt» fordi en ANNEN person spilte på samme
      // enhet. Skrivingen til played_log i submit er urørt (den brukes av
      // admin sin quiz-reset); det er kun LESINGEN som er meningsløs her.
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      let alreadyPlayed = false
      if (currentSession?.access_token) {
        // Innlogget → bruker-basert sjekk via service_role
        try {
          const r = await fetch(`/api/quiz/${quizId}/my-attempt`, {
            headers: { Authorization: `Bearer ${currentSession.access_token}` },
          })
          if (r.ok) {
            const j = await r.json()
            alreadyPlayed = j.played === true
          }
        } catch { /* nettverksfeil — la brukeren forsøke å spille */ }
      }

      if (alreadyPlayed) {
        setPhase('already_played')
        setQuiz(quizData)
        const { data: setting, error: settingError } = await supabaseData.from('site_settings').select('value').eq('key', 'next_quiz_at').single()
        if (settingError && settingError.code !== 'PGRST116') console.error('site_settings fetch feilet:', settingError)
        if (setting?.value) setNextQuizAt(setting.value)
        // Hent topp 3 direkte her — phase-useEffect kan miste fase-endringen i
        // already_played-stien pga. timing med loading-state. Samme delte
        // /standings-liste som resultatskjermen bruker (kun topp-3 vises her).
        // Tidsgrense: dette kallet ligger FØR setLoading(false), så et fetch som
        // stopper opp på klienten ville låst hele siden på lasteskjermen. Topp-3
        // er pynt her — ved timeout viser vi resten av skjermen uten den, i
        // stedet for ikke å vise noe i det hele tatt.
        const t3Controller = new AbortController()
        const t3json = await withTimeoutOrNull(
          (async () => {
            const t3res = await fetch(`/api/quiz/${quizId}/standings`, { signal: t3Controller.signal })
            return t3res.ok ? (await t3res.json()) as { top3?: typeof top3 } : null
          })(),
          { ms: FINISH_TIMEOUT_MS, onTimeout: () => t3Controller.abort() },
        )
        if (t3json && Array.isArray(t3json.top3)) setTop3(t3json.top3)
        setLoading(false)
        return
      }

      const savedProgress = localStorage.getItem(`qk_progress_${quizId}`)
      if (savedProgress) { try { setResumeData(JSON.parse(savedProgress)) } catch {} }

      // Spørsmål lastes IKKE her lenger — de hentes ett om gangen via
      // /api/quiz/[id]/questions når spillet starter (skjuler fasiten).
      setQuiz(quizData); setLoading(false)
    }
    fetchData()
  }, [quizId])

  // Henter ett spørsmål (med kun sin egen fasit) fra server-ruten. aId trengs for
  // stabil, per-attempt randomisert rekkefølge.
  // Tokenet tas som argument (ikke fra state) fordi startQuiz kaller denne i
  // samme tick som tokenet mottas — state er ikke oppdatert ennå der.
  const fetchQuestionAt = useCallback(
    async (index: number, aId: string | null, token: string | null, signal?: AbortSignal): Promise<{ question: Question; total: number }> => {
      const sp = new URLSearchParams({ index: String(index) })
      if (aId) sp.set('attemptId', aId)
      const res = await fetch(`/api/quiz/${quizId}/questions?${sp.toString()}`, {
        headers: token ? { 'x-attempt-token': token } : {},
        signal,
      })
      if (!res.ok) throw new Error(`questions ${res.status}`)
      return res.json()
    },
    [quizId],
  )

  useEffect(() => {
    if (phase !== 'finished' && phase !== 'already_played') return
    supabaseData.from('site_settings').select('value').eq('key', 'next_quiz_at').single()
      .then(({ data: setting }) => { if (setting?.value) setNextQuizAt(setting.value) })
    // Topp 3: på 'finished' hentes den sammen med plasseringen i finishQuiz
    // (samme /standings-liste, samme øyeblikk — kan ikke divergere). Her henter
    // vi kun for 'already_played', der plasseringskortet ikke vises.
    if (phase === 'already_played') {
      // Ingen fryserisiko her (ingenting venter på dette kallet), men det får
      // samme grense som de øvrige standings-kallene — et hengende kall skal
      // ikke bli liggende og lande midt i en senere fase.
      const t3Controller = new AbortController()
      withTimeoutOrNull(
        fetch(`/api/quiz/${quizId}/standings`, { signal: t3Controller.signal })
          .then(r => r.ok ? r.json() as Promise<{ top3?: typeof top3 }> : null),
        { ms: FINISH_TIMEOUT_MS, onTimeout: () => t3Controller.abort() },
      ).then(j => { if (j && Array.isArray(j.top3)) setTop3(j.top3) })
    }
  }, [phase, quizId])

  useEffect(() => {
    if (phase !== 'finished' || !isLoggedIn) return
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) return
      try {
        const res = await fetch('/api/leagues', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const json = await res.json()
        const leagues: { name: string; slug: string }[] = json.leagues ?? []
        if (leagues.length === 0) {
          setLigaBox({ type: 'cta' })
        } else if (leagues.length === 1) {
          setLigaBox({ type: 'liga', name: leagues[0].name, slug: leagues[0].slug })
        } else {
          setLigaBox({ type: 'multi' })
        }
      } catch { /* ikke kritisk */ }
    })
  }, [phase, isLoggedIn])

  // Samme betingelse som upsell-kortet selv rendres på, pluss `finished`.
  useEffect(() => {
    if (phase !== 'finished' || !isLoggedIn || isPremium) return
    let cancelled = false
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const offer = await fetchTrialOffer(session?.access_token)
      if (!cancelled) setTrialOffer(offer)
    })
    return () => { cancelled = true }
  }, [phase, isLoggedIn, isPremium])

  useEffect(() => {
    if (phase !== 'finished' || !isLoggedIn) return
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) return
      try {
        const res = await fetch('/api/rivalries/my', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const json = await res.json()
        const rows: { status: string; isChallenger: boolean; opponentId: string; isExpired: boolean }[] = json.rivalries ?? []
        // Samme regel som leaderboard/[id]: kun ikke-utløpte, ikke-avslåtte
        // rader teller som et engasjement som blokkerer nye utfordringer.
        const engagedRows = rows.filter(r => !r.isExpired && r.status !== 'declined')
        setActiveDuelExists(engagedRows.length > 0)
        setDuelInvolvedSet(new Set(engagedRows.map(r => r.opponentId)))
      } catch { /* ikke kritisk */ }
    })
  }, [phase, isLoggedIn])

  useEffect(() => {
    if (phase !== 'finished' || !isLoggedIn) return
    const first = myOrgs[0]
    if (!first) return
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) return
      try {
        const summaryRes = await fetch(`/api/org/${first.orgSlug}/season-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: session.access_token }),
        })
        if (!summaryRes.ok) return
        const summary = await summaryRes.json()
        setOrgBox({ orgName: first.orgName, orgSlug: first.orgSlug, userRank: summary.userRank ?? null })
      } catch { /* ikke kritisk */ }
    })
  }, [phase, isLoggedIn, myOrgs])

  useEffect(() => {
    return () => {
      animationTimeoutsRef.current.forEach(clearTimeout)
      document.body.style.backgroundColor = ''
      document.body.style.transition = ''
      document.getElementById('qk-glow-overlay')?.remove()
      document.querySelectorAll('.qk-spark').forEach(s => s.remove())
    }
  }, [])

  // `question` tas som muligens undefined med vilje: kallerne slår opp i
  // questions-arrayet (questions[currentIndex], questions[ni]), og arrayet
  // fylles ut ett spørsmål av gangen — en hull-indeks er ikke utenkelig. Uten
  // ?. ville et slikt oppslag kastet TypeError midt i spilling og tatt hele
  // skjermen, i stedet for å falle tilbake på quiz-nivå-grensen.
  const getTimeLimit = useCallback((question: Question | undefined) =>
    question?.time_limit_seconds || quiz?.time_limit_seconds || 30, [quiz])

  // Visningsrekkefølgen for svaralternativene kommer nå ferdig stokket fra
  // /api/quiz/[id]/questions (deterministisk av attemptId + question.id).
  // Tidligere stokket klienten selv med Math.random() ved hvert kall — kjørte
  // oppstarten to ganger, byttet alternativene plass mens spørsmålet allerede
  // var synlig, og brukeren traff en annen rad enn den de siktet på.
  // Denne funksjonen er ren og idempotent: samme spørsmål gir alltid samme
  // rekkefølge, uansett hvor mange ganger den kalles.
  const displayOrderFor = useCallback((
    question: Question | undefined,
    aId: string | null,
  ): string[] => {
    const baseOpts = ALL_OPTION_LETTERS.slice(0, quiz?.num_options ?? 4)
    if (!question?.shuffle_options) return baseOpts
    // Normalt kommer rekkefølgen ferdig utledet fra serveren. Skulle den mangle,
    // utleder vi den lokalt av SAMME seed og SAMME algoritme — ikke usortert.
    // Usortert ville vært direkte skadelig: alle spørsmål med shuffle_options
    // har fasit på A i dag, så en usortert liste ville plassert riktig svar
    // øverst hver gang.
    const order = Array.isArray(question.option_order)
      ? question.option_order
      : seededShuffle(ALL_OPTION_LETTERS, optionOrderSeed(aId, question.id))
    return order.filter(o => baseOpts.includes(o))
  }, [quiz])

  useEffect(() => { phaseRef.current = phase }, [phase])

  const saveProgress = useCallback((index: number, currentAnswers: AnswerRecord[], time: number) => {
    localStorage.setItem(`qk_progress_${quizId}`, JSON.stringify({ index, answers: currentAnswers, totalTime: time }))
  }, [quizId])

  const handleTimeout = useCallback(() => {
    // Samme synkrone guard som handleAnswer. Timer-effekten som kaller hit er
    // gatet på `answered`-state, altså med samme forsinkelse — svarer brukeren i
    // samme tick som tiden løper ut, kunne begge kjørt og registrert hvert sitt
    // svar. Nå vinner den som kommer først, og den andre avbryter.
    if (answeredRef.current) return
    answeredRef.current = true
    const question = questions[currentIndex]
    const { newAnswers, newTimeMs } = buildTimeoutAnswer({
      questionId: question.id,
      timeLimitSeconds: getTimeLimit(question),
      answers,
    })
    setAnswers(newAnswers); setTotalTimeMs(newTimeMs)
    setAnswered(true); saveProgress(currentIndex, newAnswers, newTimeMs)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(200)
  }, [questions, currentIndex, getTimeLimit, answers, saveProgress])

  // ── Hvorfor handleTimeout leses via ref, ikke via deps (5. august 2026) ──────
  // Timer-effekten under kaller handleTimeout, men har den bevisst IKKE i sin
  // dependency-liste. handleTimeout lukker over `answers` — altså scoringen.
  //
  // Hvorfor ikke bare legge den i deps: hver gang handleTimeout bytter identitet
  // ville effekten kjørt på nytt, og en re-kjøring RYDDER og re-armerer
  // setTimeout-en under. Nedtellingen ville da startet sekundet på nytt ved
  // enhver re-render som rører answers/quiz/questions, og drevet saktere enn
  // veggklokka. Det er en spillopplevelse-endring vi ikke vil ha.
  //
  // Hvorfor det likevel er trygt i dag: kallet skjer SYNKRONT i effekt-kroppen,
  // og React kjører aldri en utdatert effekt-closure. Men det er et strukturelt
  // sammentreff, ikke et design — flytter noen kallet inn i en utsatt callback
  // (pause-funksjon, setInterval, annen timer-implementasjon), kaller den
  // beholdte closuren handleTimeout med et gammelt `answers`, og withAnswer
  // ville da DROPPE hvert svar registrert siden effekten sist kjørte. Ikke feil
  // tid — et helt svar borte fra payloaden til /submit.
  //
  // Ref-en fjerner den avhengigheten: den er fersk uansett hvor kallet står.
  // Sync-effekten MÅ være deklarert FØR timer-effekten — React kjører passive
  // effekter i deklarasjonsrekkefølge, så motsatt rekkefølge ville gitt
  // timer-effekten en ref som er én commit på etterskudd. Se
  // lib/quiz-timeout-answer.test.ts for mutasjonsbeviset.
  const handleTimeoutRef = useRef(handleTimeout)
  useEffect(() => { handleTimeoutRef.current = handleTimeout }, [handleTimeout])

  useEffect(() => {
    if (phase !== 'playing' || answered || questions.length === 0) return
    if (timeLeft <= 0) { handleTimeoutRef.current(); return }
    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, answered, timeLeft, currentIndex, questions])

  // Timer-eskalering via CSS-klasser — ingen JS-animasjonslogikk
  useEffect(() => {
    const el = timerRef.current
    const shell = playShellRef.current
    if (!el) return

    el.classList.remove('qk-timer--calm', 'qk-timer--warning', 'qk-timer--critical')
    shell?.classList.remove('qk-play-shell--critical')

    if (answered) return  // stopp eskalering når svart

    if (timeLeft <= 3) {
      el.classList.add('qk-timer--critical')
      shell?.classList.add('qk-play-shell--critical')
    } else if (timeLeft <= 6) {
      el.classList.add('qk-timer--warning')
    } else {
      el.classList.add('qk-timer--calm')
    }
  }, [timeLeft, answered])

  // `answeredSoFar` sendes med slik at serveren kan skalere delsummen opp til
  // samme skala som de ferdige forsøkene den rangeres mot (Del 1+2). Under
  // MIN_ANSWERED_FOR_PLACEMENT hopper vi over kallet helt — anslaget ville
  // uansett ikke blitt vist (Del 3), så det er en request spart per spiller.
  // attemptId + x-attempt-token sendes med på alle tre rangeringskallene, så
  // serveren kan rate-limite per FORSØK i stedet for per IP (Elkjøp-nettet, se
  // lib/live-rate-limit.ts). Begge er VALGFRIE hos serveren: en gammel fane
  // midt i quizen under deploy (eller en tom attemptToken fra start-attempt)
  // faller til anon:<ip> og spiller videre uten å merke noe — samme
  // valgfrihets-mønster som answered/total-parameterne.
  const fetchLiveRank = useCallback(async (
    correctSoFar: number,
    timeSoFar: number,
    answeredSoFar: number
  ) => {
    if (!quiz?.show_live_placement) return
    if (answeredSoFar < MIN_ANSWERED_FOR_PLACEMENT) { setLiveRank(null); return }
    try {
      const res = await fetch(
        `/api/quiz/${quizId}/ranking-snapshot?question=${currentIndex}&correct=${correctSoFar}&time=${timeSoFar}&answered=${answeredSoFar}&total=${totalQuestions}${attemptId ? `&attemptId=${attemptId}` : ''}`,
        attemptToken ? { headers: { 'x-attempt-token': attemptToken } } : undefined
      )
      if (!res.ok) return
      const data: { rank: number | null; low: number; high: number } = await res.json()
      // Tegner det vi FIKK, ikke det vi trodde vi ville få — samme
      // paritetsregel som decideResultPlacementView. Klientens egen isPremium
      // konsulteres bevisst ikke her: da kan de to ikke bli uenige.
      setLiveRank({ exact: data.rank ?? null, low: data.low, high: data.high })
    } catch { /* ikke kritisk */ }
  }, [quiz, quizId, currentIndex, totalQuestions, attemptId, attemptToken])

  const fetchRankingSnapshot = useCallback(async (
    questionIndex: number,
    correctSoFar: number,
    timeSoFar: number,
    answeredSoFar: number,
    signal?: AbortSignal
  ): Promise<{ rank: number | null; total: number; low: number; high: number } | null> => {
    try {
      const res = await fetch(
        `/api/quiz/${quizId}/ranking-snapshot?question=${questionIndex}&correct=${correctSoFar}&time=${timeSoFar}&answered=${answeredSoFar}&total=${totalQuestions}${attemptId ? `&attemptId=${attemptId}` : ''}`,
        {
          signal,
          ...(attemptToken ? { headers: { 'x-attempt-token': attemptToken } } : {}),
        }
      )
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }, [quizId, totalQuestions, attemptId, attemptToken])

  // Del 5: premium-stien. /api/quiz/live-ranking returnerer nå BÅDE low/high og
  // userRank/above/below fra samme snapshot og samme computePlacement, så ett
  // kall dekker både spennet og premium-blokken i mellomskjermen. low/high er
  // identiske med det fetchRankingSnapshot ville gitt.
  const fetchLiveRankingFull = useCallback(async (
    correctSoFar: number,
    timeSoFar: number,
    answeredSoFar: number,
    signal?: AbortSignal
  ): Promise<{
    totalPlayers: number
    // null når serveren ikke ga eksakt plassering (ikke-Premium kaller).
    userRank: number | null
    low: number
    high: number
    above: { name: string; correct: number } | null
    below: { name: string; correct: number } | null
  } | null> => {
    try {
      const params = new URLSearchParams({
        quiz_id: quizId,
        current_correct: String(correctSoFar),
        current_time_ms: String(timeSoFar),
        answered: String(answeredSoFar),
        total: String(totalQuestions),
      })
      if (attemptId) params.set('attemptId', attemptId)
      const res = await fetch(`/api/quiz/live-ranking?${params.toString()}`, {
        signal,
        ...(attemptToken ? { headers: { 'x-attempt-token': attemptToken } } : {}),
      })
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }, [quizId, totalQuestions, attemptId, attemptToken])

  const startQuiz = async () => {
    // Navnet kommer utelukkende fra profilen (24. august 2026). Fritekstfeltet
    // som tidligere fylte dette for uinnloggede er fjernet sammen med
    // gjeste-veien; er navnet ikke lastet ennå, er knappen disabled.
    const effectiveName = loggedInDisplayName ?? ''
    if (!effectiveName) return

    // Re-entry-guard: ignorer dobbelttrykk (og Enter-auto-repeat) mens oppstarten
    // allerede pågår. Uten denne kjørte hele startQuiz-kroppen to ganger, og den
    // andre kjøringen stokket om alternativene mens spørsmål 1 alt var synlig.
    // Ref-en er synkron — en state-sjekk alene ville sluppet gjennom to trykk
    // innenfor samme render.
    if (startingRef.current) return
    startingRef.current = true
    setIsStarting(true)

    setStartError(null)
    const info: PlayerInfo = { name: effectiveName, ageConfirmed: true }
    setPlayerInfo(info)

    try {
      // ── Steg 1: opprett forsøket, med øvre tidsgrense (6. august 2026) ──────
      // getSession, selve POST-en og json-parsingen ligger inne i SAMME
      // withTimeout — samme form som submit-blokken i finishQuiz: alle tre er
      // await-punkter uten egen grense, og et hvilket som helst av dem kunne
      // holde startQuiz åpen for alltid. Da kjørte aldri finally, isStarting
      // ble stående true, og knappen sto disabled i «Laster…» til siden ble
      // lastet på nytt. Utfallene klassifiseres INNE i blokken (suspendert /
      // avvist-med-tekst / opprettet) og håndteres utenfor — ingen setState i
      // den innpakkede funksjonen, så et abortert etterslep ikke kan lande
      // midt i et nytt forsøk. Selve oppstartslogikken er uendret; dette er
      // kun en vakt rundt kallene.
      //
      // Attempt opprettes server-side (service-role) via /api/quiz/start-attempt.
      // Klienten kan ikke lenger skrive til attempts direkte (RLS låst til service_role).
      const startController = new AbortController()
      const startOutcome = await withTimeout(
        (async () => {
          const { data: { session } } = await supabase.auth.getSession()
          const res = await fetch('/api/quiz/start-attempt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({
              quizId,
              playerName: info.name,
            }),
            signal: startController.signal,
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            // Suspendert konto — vis suspensjons-skjermen istedenfor generisk feil.
            if (res.status === 403 && err.suspended) return { kind: 'suspended' as const }
            // 401 = serveren fant ingen gyldig sesjon. Den vanligste veien hit
            // er IKKE en angriper, men en fane som har stått åpen til
            // refresh-tokenet ga opp — eller en sesjon som er død på serveren
            // mens klienten fortsatt tror den er innlogget (`getSession()`
            // leverer et signert, ikke-utløpt token GoTrue ikke kjenner igjen;
            // se lib/auth.ts). Før 24. august 2026 fikk den spilleren en
            // gjeste-rad ved start og 403 ved MÅLSTREKEN — hele quizen spilt,
            // ingenting lagret. Nå stanser vi ham før første spørsmål og gir
            // ham veien tilbake inn.
            if (res.status === 401) return { kind: 'needs-login' as const }
            return { kind: 'rejected' as const, message: (err.error as string | undefined) ?? 'Noe gikk galt. Prøv å laste siden på nytt.' }
          }
          const { attemptId: newAttemptId, attemptToken: newAttemptToken } = await res.json()
          return {
            kind: 'created' as const,
            attemptId: (newAttemptId || null) as string | null,
            attemptToken: (newAttemptToken || null) as string | null,
            session,
          }
        })(),
        { ms: START_TIMEOUT_MS, onTimeout: () => startController.abort() },
      )
      if (!startOutcome.ok) {
        // Timeout og feil skilles som i goToNext. Utveien er synlig begge
        // veier: feilteksten vises under knappen, og finally under frigir
        // isStarting, så «Start quiz»-knappen er aktiv igjen — å trykke den er
        // selve «prøv igjen» (start-attempt gjenbruker et påbegynt forsøk
        // server-side, så et nytt trykk er trygt).
        if (startOutcome.timedOut) {
          console.warn(`[quiz] start-attempt svarte ikke innen ${START_TIMEOUT_MS} ms`, { quizId })
        }
        setPlayerInfo({ name: '', ageConfirmed: false })
        setStartError(startOutcome.timedOut
          ? 'Det tok for lang tid å starte quizen. Sjekk internettforbindelsen og prøv igjen.'
          : 'Noe gikk galt. Prøv å laste siden på nytt.')
        return
      }
      const started = startOutcome.value
      if (started.kind === 'suspended') {
        setIsSuspended(true)
        return
      }
      if (started.kind === 'needs-login') {
        setPlayerInfo({ name: '', ageConfirmed: false })
        setNeedsLogin(true)
        setAuthModalOpen(true)
        return
      }
      if (started.kind === 'rejected') {
        setPlayerInfo({ name: '', ageConfirmed: false })
        setStartError(started.message)
        return
      }
      const session = started.session
      setAttemptId(started.attemptId)
      setAttemptToken(started.attemptToken)

      // ── Steg 2: hent spørsmålene, med eget budsjett ─────────────────────────
      // Hent spørsmålene som trengs for å starte: fersk start → kun index 0,
      // resume → 0..resumeData.index. Resten hentes underveis i goToNext.
      // Samme form som spørsmålshentingen i goToNext: withTimeout + abort, så
      // et hengende kall ikke kan holde oppstarten åpen. Resume-stien henter
      // parallelt og deler derfor ett budsjett, som Promise.all i goToNext.
      const firstIdx = resumeData ? resumeData.index : 0
      const questionController = new AbortController()
      const questionsOutcome = await withTimeout(
        (async () => {
          if (resumeData) {
            const results = await Promise.all(
              Array.from({ length: resumeData.index + 1 }, (_, i) =>
                fetchQuestionAt(i, started.attemptId, started.attemptToken, questionController.signal),
              ),
            )
            const loaded = results.map(r => r.question)
            return { loadedQuestions: loaded, total: results[0]?.total ?? loaded.length }
          }
          const r0 = await fetchQuestionAt(0, started.attemptId, started.attemptToken, questionController.signal)
          return { loadedQuestions: [r0.question], total: r0.total }
        })(),
        { ms: START_TIMEOUT_MS, onTimeout: () => questionController.abort() },
      )
      if (!questionsOutcome.ok) {
        if (questionsOutcome.timedOut) {
          console.warn(`[quiz] spørsmålene svarte ikke innen ${START_TIMEOUT_MS} ms ved oppstart`, { quizId })
        }
        setPlayerInfo({ name: '', ageConfirmed: false })
        setStartError(questionsOutcome.timedOut
          ? 'Det tok for lang tid å laste spørsmålene. Sjekk internettforbindelsen og prøv igjen.'
          : 'Kunne ikke laste spørsmålene. Prøv å laste siden på nytt.')
        return
      }
      const { loadedQuestions, total } = questionsOutcome.value
      setQuestions(loadedQuestions)
      setTotalQuestions(total)

      const firstQ = loadedQuestions[firstIdx]
      setShuffledDisplayOrder(displayOrderFor(firstQ, started.attemptId))
      // Kun ved FAKTISK første oppstart. En re-kjøring (nå forhindret av
      // re-entry-guarden over, men dette er andre forsvarslinje) skal verken
      // nullstille klokken — total_time_ms er tiebreaker på topplista, så en
      // nullstilling gir utilsiktet fordel — eller kaste bort svar som allerede
      // er avgitt ved å re-anvende resumeData.
      if (phaseRef.current !== 'playing') {
        if (resumeData) {
          setCurrentIndex(resumeData.index); setAnswers(resumeData.answers)
          setTotalTimeMs(resumeData.totalTime); setTimeLeft(getTimeLimit(firstQ))
        } else {
          setTimeLeft(getTimeLimit(loadedQuestions[0]))
        }
        setQuestionStartTime(Date.now())
        phaseRef.current = 'playing'
        setPhase('playing')
      }

      // Parallel: fetch rival data (non-blocking)
      const accessToken = session?.access_token
      if (accessToken) {
        fetch(`/api/quiz/rival?quizId=${quizId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
          .then(r => r.ok ? r.json() : { rival: null, rankingSnapshot: null, suggestions: [] })
          .then(j => {
            if (j.rival) setRivalData(j.rival)
            if (j.rankingSnapshot) setRankingSnapshot(j.rankingSnapshot)
            if (Array.isArray(j.suggestions)) setDuelSuggestions(j.suggestions)
          })
          .catch(() => {})

        // Bevisst resjekk ved quiz-start — founders kan ha aktivert etter at
        // quiz-siden mountet. Rutes gjennom context sin refreshProfile()
        // (tvungen fersk server-sjekk, null-safe). Fire-and-forget: IKKE await —
        // blokkerer ikke quiz-starten.
        refreshProfile()
      }
      // Her lå en henting av persentil-fordelingen fram til 2. august 2026, kun
      // for hintet på mellomskjermen. Hintet er fjernet (delsum slått opp i en
      // fordeling av sluttsummer — se QuizInterlude.tsx), og ruten den hentet
      // fra er slettet i samme slengen. Ett kall mindre per quiz-start.
    } catch {
      setPlayerInfo({ name: '', ageConfirmed: false })
      setStartError('Noe gikk galt. Prøv å laste siden på nytt.')
    } finally {
      // Frigi guarden på ALLE utgangsveier — også de tidlige return-ene over
      // (suspendert konto, feilet start-attempt, feilet spørsmålshenting), slik
      // at brukeren kan prøve igjen. På suksess er start-skjermen uansett borte
      // (phase = 'playing'), så frigivelsen er da uten synlig effekt.
      startingRef.current = false
      setIsStarting(false)
    }
  }

  const handleAnswer = async (answer: string, buttonEl?: HTMLButtonElement) => {
    // Guard og claim skjer synkront, før ALT annet — ingen await, ingen state-lesing
    // imellom. Et andre trykk i samme tick ser ref-en satt og avbryter.
    if (answeredRef.current) return
    answeredRef.current = true
    const question = questions[currentIndex]
    const timeMs = Date.now() - questionStartTime
    const isCorrect = question.correct_answers && question.correct_answers.length > 0
      ? question.correct_answers.includes(answer)
      : answer === question.correct_answer

    // ANIMASJON FØRST — direkte via refs, ingen React, ingen delay
    if (isCorrect) {
      let currentStreak = 1
      for (let i = answers.length - 1; i >= 0; i--) {
        if (answers[i].isCorrect) currentStreak++; else break
      }
      fireCorrectAnswer(buttonEl, currentStreak)
    } else {
      fireWrongAnswer(buttonEl)
    }

    // REACT STATE ETTERPÅ — re-render skjer etter animasjon er startet
    const record: AnswerRecord = { questionId: question.id, selectedAnswer: answer, isCorrect, timeMs }
    const newAnswers = withAnswer(answers, record)
    // Summert fra newAnswers, ikke inkrementert fra forrige totalTimeMs — se
    // samme begrunnelse i handleTimeout. Reflekterer nøyaktig én tid per
    // spørsmål selv om dette spørsmålet allerede hadde et svar fra før
    // (gjenopptatt midt i quiz).
    const newTime = newAnswers.reduce((sum, a) => sum + a.timeMs, 0)
    setAnswers(newAnswers); setTotalTimeMs(newTime)
    setSelectedAnswer(answer); setAnswered(true)
    saveProgress(currentIndex, newAnswers, newTime)
    if (quiz?.show_live_placement) {
      await fetchLiveRank(newAnswers.filter(a => a.isCorrect).length, newTime, newAnswers.length)
    }
  }

  function startConfettiCanvas(cx: number, cy: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (confettiRafRef.current) cancelAnimationFrame(confettiRafRef.current)

    type P = { x: number; y: number; vx: number; vy: number; size: number; color: string; round: boolean; rot: number; rotV: number; opacity: number }
    const COLORS = ['#c9a84c', '#e8c96a', '#f0d878', '#ffffff', '#d4b45a']
    const particles: P[] = []
    for (let i = 0; i < 150; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 3 + Math.random() * 9
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 5,
        size: 3 + Math.random() * 10,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        round: Math.random() > 0.5,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.25,
        opacity: 0.9,
      })
    }

    const GRAVITY = 0.18
    const DECAY = 0.013

    function loop() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      let alive = false
      for (const p of particles) {
        p.vy += GRAVITY
        p.x += p.vx
        p.y += p.vy
        p.rot += p.rotV
        p.opacity -= DECAY
        if (p.opacity <= 0) continue
        alive = true
        ctx.save()
        ctx.globalAlpha = Math.max(0, p.opacity)
        ctx.fillStyle = p.color
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        if (p.round) {
          ctx.beginPath()
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        }
        ctx.restore()
      }
      if (alive) {
        confettiRafRef.current = requestAnimationFrame(loop)
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        confettiRafRef.current = null
      }
    }
    confettiRafRef.current = requestAnimationFrame(loop)
  }

  function triggerEl(el: HTMLDivElement | null, animation: string, hideAfterMs: number, t: (ms: number, fn: () => void) => void) {
    if (!el) return
    el.style.display = 'block'
    el.style.animation = 'none'
    void el.offsetWidth // force reflow — restarter CSS-animasjon
    el.style.animation = animation
    t(hideAfterMs, () => { el.style.display = 'none'; el.style.animation = 'none' })
  }

  function fireCorrectAnswer(buttonEl: HTMLButtonElement | undefined, streak = 0) {
    animationTimeoutsRef.current.forEach(clearTimeout)
    animationTimeoutsRef.current = []

    if (confettiRafRef.current) { cancelAnimationFrame(confettiRafRef.current); confettiRafRef.current = null }
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(50)

    const rect = buttonEl?.getBoundingClientRect()
    const cx = rect ? rect.left + rect.width / 2 : (typeof window !== 'undefined' ? window.innerWidth / 2 : 0)
    const cy = rect ? rect.top + rect.height / 2 : (typeof window !== 'undefined' ? window.innerHeight / 2 : 0)

    const t = (ms: number, fn: () => void) => { const id = setTimeout(fn, ms); animationTimeoutsRef.current.push(id) }

    // 1. Bakgrunns-flash — direkte DOM
    triggerEl(flashRef.current, 'qkFlash 0.6s ease-out forwards', 680, t)

    // 2. Tre ringer — direkte DOM, ingen React-render
    ringRefs.current.forEach((ring, i) => {
      if (!ring) return
      ring.style.left = cx + 'px'
      ring.style.top = cy + 'px'
      triggerEl(ring, `qkRingPulse 0.7s cubic-bezier(0.2,0,0.4,1) ${i * 150}ms forwards`, i * 150 + 750, t)
    })

    // 3. Score pop — direkte DOM
    const pop = scorePopRef.current
    if (pop) {
      pop.style.left = cx + 'px'
      pop.style.top = cy + 'px'
      triggerEl(pop, 'qkScorePop 0.9s ease-out forwards', 950, t)
    }

    // 4. Canvas konfetti — starter i samme frame som klikket
    startConfettiCanvas(cx, cy)

    // 5. Streak-melding — direkte DOM
    if (streak >= 2) {
      const msgs: Record<number, string> = { 2: '2 på rad!', 3: '3 på rad!', 4: 'Ustoppelig!' }
      const msg = streak >= 5 ? 'Perfekt!' : (msgs[streak] ?? `${streak} på rad!`)
      const smEl = streakMsgRef.current
      if (smEl) {
        smEl.textContent = msg
        triggerEl(smEl, 'qkStreakMsg 1.1s ease-out forwards', 1200, t)
      }
    }

    // 6. Streak-badge i React-treet fader inn
    const streakBadge = streakBadgeRef.current
    if (streakBadge) {
      streakBadge.style.transition = 'none'
      streakBadge.style.opacity = '0'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        streakBadge.style.transition = 'opacity 400ms cubic-bezier(0.4,0,0.2,1)'
        streakBadge.style.opacity = '1'
      }))
    }
  }

  function fireWrongAnswer(buttonEl?: HTMLButtonElement) {
    if (!buttonEl) return
    buttonEl.style.animation = 'none'
    requestAnimationFrame(() => { buttonEl.style.animation = 'qkShake 0.4s ease-in-out' })
    const id = setTimeout(() => { buttonEl.style.animation = '' }, 450)
    animationTimeoutsRef.current.push(id)
  }

  const goToNext = async () => {
    // Re-entry-guard: ignorer raske dobbeltklikk mens et forsøk allerede pågår.
    if (advancingRef.current) return
    advancingRef.current = true
    setIsAdvancing(true)

    // Rydd opp alle løpende animasjonstimere og inline-stiler
    animationTimeoutsRef.current.forEach(clearTimeout)
    animationTimeoutsRef.current = []
    if (confettiRafRef.current) { cancelAnimationFrame(confettiRafRef.current); confettiRafRef.current = null }
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    // Skjul alle overlay-elementer direkte via refs — ingen React re-render nødvendig
    if (flashRef.current) { flashRef.current.style.display = 'none'; flashRef.current.style.animation = 'none' }
    ringRefs.current.forEach(r => { if (r) { r.style.display = 'none'; r.style.animation = 'none' } })
    if (scorePopRef.current) { scorePopRef.current.style.display = 'none'; scorePopRef.current.style.animation = 'none' }
    if (streakMsgRef.current) { streakMsgRef.current.style.display = 'none'; streakMsgRef.current.style.animation = 'none' }
    if (streakBadgeRef.current) {
      streakBadgeRef.current.style.animation = ''
      streakBadgeRef.current.style.transition = ''
      streakBadgeRef.current.style.opacity = ''
    }

    const isLast = currentIndex === totalQuestions - 1
    if (isLast) {
      await finishQuiz()
      advancingRef.current = false
      setIsAdvancing(false)
      return
    }

    const nextIndex = currentIndex + 1
    const qLeft = totalQuestions - nextIndex
    const correctSoFar = answers.filter(a => a.isCorrect).length
    // answers inneholder alltid spørsmålet som nettopp ble besvart, så lengden
    // ER antall besvarte spørsmål. Grunnlaget serveren skalerer delsummen med.
    const answeredSoFar = answers.length
    const placementReady = answeredSoFar >= MIN_ANSWERED_FOR_PLACEMENT

    // ── De to nettverkskallene startes SAMTIDIG, ikke i serie ─────────────────
    // Fram til 28. juli ventet vi ferdig på spørsmålshentingen før rangeringen
    // i det hele tatt ble sendt. De to deler ingen input: fetchQuestionAt
    // trenger (nextIndex, attemptId, attemptToken), rangeringskallene trenger
    // (correctSoFar, totalTimeMs, answeredSoFar) — og alle fem er kjent her,
    // før noen av kallene går ut. Rangeringen leser heller ingenting fra
    // spørsmålssvaret; `total` derfra brukes kun ved oppstart (startQuiz), ikke
    // i denne stien. Serieformen kostet altså full ventetid på begge, 15 ganger
    // per quiz, uten at rekkefølgen ga noe.
    //
    // Vi lager promisene her og venter på dem lenger nede. Ingen av
    // fetchLiveRankingFull/fetchRankingSnapshot kan rejecte (begge fanger selv
    // og returnerer null), så kun questionPromise trenger try/catch.
    //
    // ── Alle tre har en øvre tidsgrense (1. august 2026) ──────────────────────
    // Fram til nå hadde Promise.all under ingen grense i det hele tatt. Et
    // fetch som stopper opp på klienten — serveren kan ha logget 200 OK —
    // settles aldri, og da venter Promise.all for alltid: knappen sto i
    // «Laster…», og eneste vei videre var å laste siden på nytt. Én ekte
    // spiller frøs slik to ganger i overgangen 14→15.
    //
    // Grensen må ligge på ALLE tre, ikke bare spørsmålshentingen: de venter i
    // samme Promise.all, så et hengende rangeringskall ville frosset skjermen
    // like effektivt. Hvert kall har sin egen AbortController, slik at en
    // timeout i det ene ikke river ned det andre.
    const questionController = new AbortController()
    const rankingController = new AbortController()

    const questionPromise = questions[nextIndex]
      ? null
      : withTimeout(
          fetchQuestionAt(nextIndex, attemptId, attemptToken, questionController.signal),
          { ms: NEXT_STEP_TIMEOUT_MS, onTimeout: () => questionController.abort() },
        )

    // Hent snapshot-rangering kun for innloggede — ikke blokker quizen ved feil.
    // Del 5: premium henter alt i ETT kall (spenn + plassering + naboer);
    // ikke-premium trenger kun spennet og bruker den lettere ruten som før.
    // Del 3: under terskelen hopper vi over kallet — mellomskjermen sier da at
    // plasseringen vises fra tredje svar, i stedet for å vise et anslag bygget
    // på ett–to svar.
    // Rangeringen er allerede «ikke kritisk» ved feil (begge helperne fanger og
    // returnerer null). En timeout behandles likt: mellomskjermen vises uten
    // plassering i stedet for ikke å vises i det hele tatt.
    const premiumRankingPromise = isLoggedIn && isPremium && placementReady
      ? withTimeoutOrNull(
          fetchLiveRankingFull(correctSoFar, totalTimeMs, answeredSoFar, rankingController.signal),
          { ms: NEXT_STEP_TIMEOUT_MS, onTimeout: () => rankingController.abort() },
        )
      : null
    const spanRankingPromise = !isPremium && isLoggedIn && placementReady
      ? withTimeoutOrNull(
          fetchRankingSnapshot(currentIndex, correctSoFar, totalTimeMs, answeredSoFar, rankingController.signal),
          { ms: NEXT_STEP_TIMEOUT_MS, onTimeout: () => rankingController.abort() },
        )
      : null

    // ── Vent på ALLE utestående kall før noe vises ────────────────────────────
    // Bevisst: mellomskjermen skal aldri rendres med halve datagrunnlaget klar.
    // Vi venter derfor på begge også når spørsmålshentingen feiler — ellers
    // ville setInterLiveRanking under landet ETTER at «Prøv igjen»-skjermen sto
    // framme, og blandet seg inn i neste forsøk.
    // Med timeout-vakten på plass settles alle tre innen NEXT_STEP_TIMEOUT_MS,
    // uansett hva nettverket gjør — dette awaitet kan ikke lenger bli stående.
    const [questionOutcome, premiumRanking, spanRanking] = await Promise.all([
      questionPromise ?? Promise.resolve(null),
      premiumRankingPromise ?? Promise.resolve(null),
      spanRankingPromise ?? Promise.resolve(null),
    ])

    // Ved feil ELLER timeout: behold fremgang og tilby "Prøv igjen" (kaller
    // goToNext på nytt) i stedet for å la brukeren bli stående uten vei videre.
    // Bevisst manuell retry, ikke automatisk: symptomet spilleren opplever er
    // nettopp at "ingenting skjer", og et stille nytt forsøk ville doblet den
    // tiden før noe som helst vises på skjermen.
    if (questionOutcome && !questionOutcome.ok) {
      if (questionOutcome.timedOut) {
        console.warn(`[quiz] neste spørsmål (${nextIndex}) svarte ikke innen ${NEXT_STEP_TIMEOUT_MS} ms`)
      }
      setNextLoadFailed(questionOutcome.timedOut ? 'timeout' : 'error')
      // Frigi guarden slik at "Prøv igjen"-knappen kan kalle goToNext på nytt.
      advancingRef.current = false
      setIsAdvancing(false)
      return
    }
    if (questionOutcome?.ok) {
      const loaded = questionOutcome.value
      setQuestions(prev => {
        const copy = [...prev]
        copy[nextIndex] = loaded.question
        return copy
      })
      setNextLoadFailed(null)
    }

    let low: number | null = null
    let high: number | null = null
    if (premiumRankingPromise) {
      if (premiumRanking && premiumRanking.totalPlayers > 1) {
        low = premiumRanking.low
        high = premiumRanking.high
      }
      // `userRank !== null` er paritetsvakten: serveren kan ha gatet svaret selv
      // om klienten tror den er Premium (kjøp midt i quiz — tokenet er utstedt
      // ved start). Da settes ingen eksakt-blokk, og mellomskjermen faller til
      // spennet, som allerede er satt fra low/high over. Uten vakten ville
      // QuizInterlude rendret «. plass» uten tall.
      setInterLiveRanking(premiumRanking && premiumRanking.userRank !== null
        ? {
            totalPlayers: premiumRanking.totalPlayers,
            userRank: premiumRanking.userRank,
            above: premiumRanking.above,
            below: premiumRanking.below,
          }
        : null)
    } else if (isLoggedIn && isPremium) {
      setInterLiveRanking(null)
    } else if (spanRanking && spanRanking.total > 1) {
      low = spanRanking.low
      high = spanRanking.high
    }

    const lastAns = answers[answers.length - 1]
    const optMap: Record<string, keyof Question> = { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' }
    const q = questions[currentIndex]
    const correctKeys = q?.correct_answers && q.correct_answers.length > 0 ? q.correct_answers : [q?.correct_answer]
    const correctText = q
      ? correctKeys.map(k => k ? (q[optMap[k]] as string) || k : '').filter(Boolean).join(' / ')
      : ''
    const streak = (() => {
      let s = 0
      for (let i = answers.length - 1; i >= 0; i--) {
        if (answers[i].isCorrect) s++; else break
      }
      return s
    })()
    const wrongInARow = (() => {
      let s = 0
      for (let i = answers.length - 1; i >= 0; i--) {
        if (!answers[i].isCorrect) s++; else break
      }
      return s
    })()

    setInterLastCorrect(lastAns?.isCorrect ?? null)
    setInterCorrectAnswerText(correctText)
    setInterExplanation(q?.explanation ?? null)
    setInterScore(correctSoFar)
    setInterStreak(streak)
    setInterWrongInARow(wrongInARow)
    // Koblet på questionId → question.id inne i computeStrongCategory — IKKE på
    // indeks. answers kan avvike fra questions-rekkefølgen etter gjenopptakelse
    // (withAnswer flytter et re-besvart spørsmål bakerst).
    setInterStrongCategory(computeStrongCategory(answers, questions))
    setInterNextQNum(nextIndex + 1)
    setInterLow(low)
    setInterHigh(high)
    setInterQLeft(qLeft)
    setPendingNextIndex(nextIndex)
    setInterPhase('in')
    // Mellomskjermen vises nå (overlay over svarkortet) — frigi guarden slik at
    // neste spørsmåls "Neste"-knapp ikke står låst.
    advancingRef.current = false
    setIsAdvancing(false)
  }

  const handleInterludeNext = useCallback(() => {
    if (pendingNextIndex === null) return
    const ni = pendingNextIndex
    const nextQ = questions[ni]
    setShuffledDisplayOrder(displayOrderFor(nextQ, attemptId))
    setCurrentIndex(ni)
    // Ref-en må frigis her sammen med state-en, ellers ville første svar på
    // spørsmål 2 blitt avvist av guarden fra spørsmål 1.
    answeredRef.current = false
    setAnswered(false)
    setSelectedAnswer(null)
    setTimeLeft(getTimeLimit(questions[ni]))
    setQuestionStartTime(Date.now())
    setQuestionKey(k => k + 1)
    setPendingNextIndex(null)
    setInterPhase('out')
    setTimeout(() => setInterPhase('hidden'), 250)
    // `quiz` sto her, men brukes ikke i kroppen. Den var heller ikke et skjult
    // ferskhets-behov: både getTimeLimit og displayOrderFor har quiz i SINE
    // deps, så en quiz-endring bytter identitet på dem og dermed på denne
    // callbacken uansett. Fjernet 5. august 2026 — siste exhaustive-deps-
    // advarsel i spillestien.
  }, [pendingNextIndex, questions, getTimeLimit, displayOrderFor, attemptId])

  const finishQuiz = async () => {
    const deviceId = getDeviceId()
    // Siste sikkerhetsnett: dedupliser på questionId rett før bruk, selv om
    // withAnswer over allerede skal ha forhindret duplikater i selve
    // answers-state. Se dedupeAnswers.
    const finalAnswers = dedupeAnswers(answers)
    // Klient-beregning brukes kun som fallback hvis submit-ruten ikke svarer.
    // Server-ruten er fasit: den slår opp riktige svar og beregner score selv.
    let correct = finalAnswers.filter(a => a.isCorrect).length
    let finalTimeMs = finalAnswers.reduce((sum, a) => sum + a.timeMs, 0)
    setFinishTimedOut(false)
    try {
      if (attemptId) {
        // ── Øvre tidsgrense på innsendingen (5. august 2026) ──────────────────
        // getSession, selve POST-en og json-parsingen ligger inne i SAMME
        // withTimeout: alle tre er await-punkter uten egen grense, og et hvilket
        // som helst av dem kunne holde finishQuiz åpen for alltid. Da nås aldri
        // setPhase('finished') nederst — og goToNext rekker aldri å frigi
        // advancingRef heller, så knappen ble stående disabled i «Laster…».
        // Samme fareklasse som mellomskjermen hadde 31. juli, bare ved
        // målstreken. Selve scoring-/submit-logikken er uendret; dette er kun
        // en vakt rundt kallet.
        const submitController = new AbortController()
        const submitOutcome = await withTimeout(
          (async () => {
            const { data: { session } } = await supabase.auth.getSession()
            const res = await fetch(`/api/quiz/${quizId}/submit`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                ...(attemptToken ? { 'x-attempt-token': attemptToken } : {}),
              },
              body: JSON.stringify({
                attemptId,
                deviceId,
                answers: finalAnswers.map(ans => ({
                  questionId: ans.questionId,
                  selectedAnswer: ans.selectedAnswer,
                  timeMs: ans.timeMs,
                })),
              }),
              signal: submitController.signal,
            })
            // Statusen må OVERLEVE hit. Kastet vi på !res.ok, gjorde withTimeout
            // rejection om til et utfall uten status, og en 403 «allerede
            // levert» — som er en BEKREFTELSE på at forsøket ligger lagret —
            // ble umulig å skille fra en ekte feil. Derfor klassifiseres svaret
            // her, og kun ekte feil kastes.
            const body = await res.json().catch(() => null) as
              | { correctAnswers?: number; totalTimeMs?: number; correctStreak?: number; error?: string }
              | null
            const verdict = classifySubmitResponse({
              status: res.status,
              ok: res.ok,
              errorMessage: body?.error ?? null,
              hasTimedOutOnce: finishTimedOutOnceRef.current,
            })
            if (verdict.kind === 'error') throw new Error(`submit returnerte ${res.status}`)
            if (verdict.kind === 'retryable') return { retryable: true as const }
            if (verdict.kind === 'already-stored') return { alreadyStored: true as const }
            return {
              alreadyStored: false as const,
              score: body as { correctAnswers: number; totalTimeMs: number; correctStreak: number },
            }
          })(),
          { ms: FINISH_TIMEOUT_MS, onTimeout: () => submitController.abort() },
        )
        if (!submitOutcome.ok) {
          // Timeout og feil skilles her, som i goToNext — men konsekvensen er en
          // annen: ved en ren feil VET vi at innsendingen ikke gikk gjennom, ved
          // en timeout vet vi ingenting. Timeout får derfor sin egen skjerm med
          // valg, ikke feilmeldingen som påstår at ingenting ble lagret.
          if (submitOutcome.timedOut) {
            console.warn(`[quiz] submit svarte ikke innen ${FINISH_TIMEOUT_MS} ms`, { quizId, attemptId })
            finishTimedOutOnceRef.current = true
            setFinishTimedOut(true)
            return
          }
          throw new Error('submit feilet')
        }
        // 503: transient serverfeil, samme retry-skjerm som timeout. Ref-en er
        // ikke kosmetikk: vinnerrad-503-en kommer ETTER at resultatet er lagret,
        // og retryen svarer da 403 «allerede levert» — ref-en er det som får
        // klassifisereren til å tolke det som bekreftelse, ikke feil.
        if ('retryable' in submitOutcome.value) {
          finishTimedOutOnceRef.current = true
          setFinishTimedOut(true)
          return
        }
        // «Allerede lagret»: vårt eget første kall rakk fram etter at vi hadde
        // gitt opp å vente. Serveren sender ingen score tilbake i det svaret —
        // men den trengs heller ikke: den lagrede raden ble skrevet av NØYAKTIG
        // samme kropp som dette kallet sendte, så de klientberegnede tallene
        // over er de samme tallene. Vi lar dem stå, hopper over setServerScore
        // (vi har ingen serverbekreftede tall å sette), og faller BEVISST
        // videre ned i resten av try-blokken: localStorage skal ryddes/skrives
        // og topp-3 + plasseringskort hentes, akkurat som på happy path.
        if (!submitOutcome.value.alreadyStored) {
          const result = submitOutcome.value.score
          correct = result.correctAnswers
          finalTimeMs = result.totalTimeMs
          setServerScore(result)
          setTotalTimeMs(finalTimeMs)
        } else {
          console.warn('[quiz] submit svarte «allerede levert» etter timeout — forsøket ligger lagret', { quizId, attemptId })
          setTotalTimeMs(finalTimeMs)
        }
      }
      localStorage.removeItem(`qk_progress_${quizId}`)
      localStorage.setItem(`qk_result_${quizId}`, JSON.stringify({ correct_answers: correct, total_time_ms: finalTimeMs }))
      // Bevisst resjekk parallelt med snapshot-fetchen — founders-aktivering kan
      // ha skjedd etter quiz-start. Rutes gjennom context sin refreshProfile()
      // (tvungen fersk server-sjekk, null-safe). Fire-and-forget: IKKE await —
      // blokkerer ikke innsendings-/resultatflyten (samme non-blocking oppførsel
      // som det tidligere fetchPremiumStatus(...).then(...)-mønsteret).
      refreshProfile()
      // Hent topp-3 OG plassering fra ETT felles endepunkt (samme rangerte liste,
      // samme øyeblikk) — så "Topp 3" og "Din plassering" aldri kan divergere.
      // attemptId sikrer at spilleren selv er med i lista (rebuild om nødvendig).
      // ── Alt herfra er pynt: topp-3 og plassering ──────────────────────────
      // Resultatet er lagret; det som gjenstår er en sesjonsoppslag og opptil to
      // fetch-kall i serie. ETT felles 9-sekunders budsjett for hele blokken, ikke
      // ett per kall: spilleren skal aldri vente mer enn én grense på å få se
      // resultatskjermen, uansett hvor mange av kallene som henger. Utfallet
      // forkastes ved timeout (withTimeoutOrNull) — resultatskjermen vises da
      // uten plassering i stedet for ikke i det hele tatt, samme degradering som
      // rangeringskallene i goToNext har.
      const extrasController = new AbortController()
      await withTimeoutOrNull(
        (async () => {
          // finishSess brukes også av fallback-leaderboard-fetchen lenger nede.
          const { data: { session: finishSess } } = await supabase.auth.getSession()
          let placementSet = false
          try {
            const stParams = new URLSearchParams({
              question: String(totalQuestions - 1),
              correct: String(correct),
              time: String(finalTimeMs),
            })
            if (attemptId) stParams.set('attemptId', attemptId)
            // x-attempt-token er det som gjør kallet PERSONLIG i serverens
            // øyne: uten det får svaret ingen eksakt plassering, kun spennet
            // (P-2). Samme token submit-kallet under bruker — ingen ny
            // mekanisme, og ingen ekstra auth-rundtur.
            const stRes = await fetch(`/api/quiz/${quizId}/standings?${stParams.toString()}`, {
              signal: extrasController.signal,
              ...(attemptToken ? { headers: { 'x-attempt-token': attemptToken } } : {}),
            })
            if (stRes.ok) {
              const st: {
                top3?: typeof top3
                placement?: { rank: number | null; total: number; low: number; high: number } | null
              } = await stRes.json()
              if (Array.isArray(st.top3)) setTop3(st.top3)
              // Ingen total-terskel her: hva som skal VISES (også for en spiller
              // som er alene i feltet) avgjøres av decideResultPlacementView i
              // render. `total > 1`-guarden som lå her gjorde at spiller nr. 1
              // fikk et helt tomt felt — se lib/result-placement.ts.
              if (st.placement) {
                setEstimatedPlacement({
                  rank: st.placement.rank,
                  low: st.placement.low,
                  high: st.placement.high,
                  total: st.placement.total,
                })
                placementSet = true
              }
            }
          } catch { /* standings feilet — fall through til fallback */ }
          if (!placementSet) {
            // Fallback via leaderboard-API-et (samme delte rangerings-helper) i stedet
            // for en usortert/udedupert anon-spørring. Anon-klienten kan uansett ikke
            // lese user_id lenger (kolonne-lås), så server-ruten er eneste korrekte vei.
            try {
              const params = new URLSearchParams()
              if (!finishSess?.access_token) {
                params.set('my_correct', String(correct))
                params.set('my_time', String(finalTimeMs))
              }
              const lbRes = await fetch(`/api/leaderboard/${quizId}?${params.toString()}`, {
                headers: finishSess?.access_token ? { Authorization: `Bearer ${finishSess.access_token}` } : {},
                signal: extrasController.signal,
              })
              if (lbRes.ok) {
                // `userRank` (eksakt) sendes kun til Premium. Gratisbrukere får raden
                // sin med en grovmalt `rank` (starten av 10-båndet) — som er alt
                // gratis-visningen under uansett bruker, siden den regner seg fram til
                // «et sted mellom plass X og Y» fra `low`.
                const lb: { userRank?: number | null; userEntry?: { rank: number } | null; guestRank?: number | null; totalCount?: number } = await lbRes.json()
                const rank = lb.userRank ?? lb.userEntry?.rank ?? lb.guestRank ?? null
                const total = lb.totalCount ?? 0
                // total >= 1, ikke > 1: visningsbeslutningen (også for en
                // spiller alene i feltet) bor i decideResultPlacementView.
                if (rank && total >= 1) setEstimatedPlacement({ rank, low: rank, high: rank, total })
              }
            } catch { /* fallback feilet — la plassering være uoppgitt */ }
          }
          return true
        })(),
        { ms: FINISH_TIMEOUT_MS, onTimeout: () => extrasController.abort() },
      )
    } catch {
      const isLate = quiz?.closes_at && new Date(quiz.closes_at) < new Date()
      // Rekkefølgen er bevisst. Har vi allerede timet ut én gang, kan vi ikke si
      // «ble ikke lagret»: submit er ikke idempotent, så et nytt forsøk etter at
      // det første faktisk landet svarer 403 «Forsøket er allerede levert» — det
      // ser ut som en feil her, men betyr det motsatte. Vi sier derfor kun det vi
      // faktisk vet, nemlig at vi ikke fikk bekreftelse.
      setFinishSaveError(
        isLate
          ? 'Quizen stengte mens du spilte — svaret ditt ble ikke lagret. Sesong-poeng gjelder ikke for sente innleveringer.'
          : finishTimedOutOnceRef.current
            ? 'Vi fikk ikke bekreftet om resultatet ble lagret. Sjekk topplisten om litt.'
            : 'Resultatet ble ikke lagret — sjekk internettforbindelsen din'
      )
      setTimeout(() => {
        setFinishSaveError(null)
        setPhase('finished')
      }, 5000)
      return
    }
    setPhase('finished')
  }

  // Nytt forsøk etter en submit-timeout. Speiler guard-håndteringen i goToNext
  // (som er den som normalt setter og frigir dem rundt finishQuiz), slik at
  // knappen under overlayet ikke kan trykkes mens forsøket pågår.
  const retryFinishQuiz = async () => {
    if (advancingRef.current) return
    setFinishTimedOut(false)
    advancingRef.current = true
    setIsAdvancing(true)
    await finishQuiz()
    advancingRef.current = false
    setIsAdvancing(false)
  }

  const formatTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`

  // Samme utfordre-kall som app/leaderboard/[id]/page.tsx sin handleChallenge —
  // duplisert her fordi de to sidene har ulik lokal state å oppdatere etterpå,
  // men POST-et og feilhåndteringen er identiske. Trigges av DuelChallengeModal
  // (samme bekreftelsesflyt som leaderboardet).
  const handleChallenge = async (rivalId: string) => {
    setChallengeLoadingId(rivalId)
    setChallengeError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setChallengeLoadingId(null); return }
      const res = await fetch('/api/rivalries', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rival_id: rivalId }),
      })
      if (res.ok) {
        setChallengeSentSet(prev => new Set([...prev, rivalId]))
        setDuelInvolvedSet(prev => new Set([...prev, rivalId]))
        setActiveDuelExists(true)
      } else {
        const json = await res.json().catch(() => ({}))
        setChallengeError({ rivalId, message: json.error ?? 'Noe gikk galt.' })
        setTimeout(() => setChallengeError(null), 3000)
      }
    } catch {
      setChallengeError({ rivalId, message: 'Noe gikk galt.' })
      setTimeout(() => setChallengeError(null), 3000)
    }
    setChallengeLoadingId(null)
  }

  const generateAndShareCard = async () => {
    if (cardShareState === 'loading') return
    setCardShareState('loading')
    try {
      await document.fonts.ready

      const cCount = serverScore?.correctAnswers ?? answers.filter(a => a.isCorrect).length

      const W = 800, H = 420
      const canvas = document.createElement('canvas')
      canvas.width = W * 2
      canvas.height = H * 2
      const ctx = canvas.getContext('2d')!
      ctx.scale(2, 2)

      // Rounded rect path helper
      const rr = (x: number, y: number, w: number, h: number, rad: number) => {
        ctx.beginPath()
        ctx.moveTo(x + rad, y)
        ctx.lineTo(x + w - rad, y)
        ctx.arcTo(x + w, y, x + w, y + rad, rad)
        ctx.lineTo(x + w, y + h - rad)
        ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad)
        ctx.lineTo(x + rad, y + h)
        ctx.arcTo(x, y + h, x, y + h - rad, rad)
        ctx.lineTo(x, y + rad)
        ctx.arcTo(x, y, x + rad, y, rad)
        ctx.closePath()
      }

      // Background
      ctx.fillStyle = '#1a1c23'
      ctx.fillRect(0, 0, W, H)

      // Card
      const pad = 20, r = 16
      const cX = pad, cY = pad, cW = W - pad * 2, cH = H - pad * 2
      ctx.fillStyle = '#21242e'
      rr(cX, cY, cW, cH, r)
      ctx.fill()
      ctx.strokeStyle = 'rgba(201, 168, 76, 0.2)'
      ctx.lineWidth = 1
      rr(cX, cY, cW, cH, r)
      ctx.stroke()

      // Gold top bar (clip to card shape)
      ctx.save()
      rr(cX, cY, cW, cH, r)
      ctx.clip()
      ctx.fillStyle = '#c9a84c'
      ctx.fillRect(cX, cY, cW, 4)
      ctx.restore()

      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      const cx = W / 2

      // Eyebrow
      ctx.font = '600 11px "Instrument Sans", sans-serif'
      ctx.fillStyle = '#c9a84c'
      ctx.fillText('QUIZKANONEN', cx, cY + 40)

      // Player name
      const rawName = playerInfo.name
      const displayName = rawName.length > 26 ? rawName.slice(0, 26) + '…' : rawName
      ctx.font = '700 38px "Libre Baskerville", serif'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(displayName, cx, cY + 90)

      // Quiz title
      const rawTitle = quiz?.title ?? ''
      const displayTitle = rawTitle.length > 50 ? rawTitle.slice(0, 50) + '…' : rawTitle
      ctx.font = '400 13px "Instrument Sans", sans-serif'
      ctx.fillStyle = '#918f8a'
      ctx.fillText(displayTitle, cx, cY + 116)

      // Divider
      ctx.strokeStyle = '#2a2d38'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cX + 48, cY + 134)
      ctx.lineTo(cX + cW - 48, cY + 134)
      ctx.stroke()

      // Stats — kun score, sentrert, for alle spillere.
      //
      // Fram til 2. august 2026 hadde kortet to kolonner for Premium: score og
      // «Topp X %» under etiketten PLASSERING. Kolonnen er fjernet sammen med
      // «Topp X %» på resultatskjermen, av to grunner — den andre var en bug:
      //   • Samme begrunnelse som på skjermen: tallet var plasseringen pakket
      //     om, og «topp 2 %» i et felt på 55 er en oppblåst måte å si «du vant».
      //   • Kortet regnet (antall − rang)/antall og tegnet det som «Topp X %»
      //     UTEN inverteringen skjermen hadde. Vinneren av 55 fikk «Topp 2 %»
      //     på skjermen og «Topp 98 %» på bildet hun delte. Ved å fjerne tallet
      //     forsvinner motsigelsen i stedet for å måtte holdes i sync.
      // Den sentrerte varianten er ikke ny — den ble allerede brukt for alle
      // ikke-Premium-spillere, så dette er én kjent utforming for alle.
      const statY = cY + 212
      ctx.font = '700 58px "Libre Baskerville", serif'
      ctx.fillStyle = '#c9a84c'
      ctx.fillText(`${cCount}/${totalQuestions}`, cx, statY)
      ctx.font = '500 16px "Instrument Sans", sans-serif'
      ctx.fillStyle = '#e8e4dd'
      ctx.fillText('riktige svar', cx, statY + 36)

      // Branding
      ctx.font = '400 11px "Instrument Sans", sans-serif'
      ctx.fillStyle = 'rgba(122, 120, 115, 0.45)'
      ctx.textAlign = 'right'
      ctx.fillText('quizkanonen.no', cX + cW - 20, cY + cH - 16)

      // Export
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
      if (!blob) { setCardShareState('idle'); return }

      const file = new File([blob], 'quizkanonen-resultat.png', { type: 'image/png' })
      // Direkte utfordring i delingsteksten i stedet for nøytral resultattekst.
      // Eksakt plassering tas kun med for Premium, ellers overclaimer vi noe
      // gratis-spillere faktisk ikke har fått vist.
      //
      // Betingelsene sto tidligere implisitt i `topp !== null` (variabelen som
      // matet plasserings-kolonnen på kortet). Da kolonnen ble fjernet 2. august
      // 2026 måtte gaten skrives ut — den er BEVISST identisk med den gamle,
      // sisteplass-unntaket inkludert, så delingsteksten er uendret.
      // 'internal-only' (blokkert org/eget opt-out): delingsteksten skal ikke
      // bære NOEN plassering — intern («3. av 29») er meningsløs utad og røper
      // org-tilhørighet, offentlig motsier at spilleren står utenfor den åpne
      // konkurransen. 'unknown': org-svaret har ikke landet, ikke gjett.
      const visPlassering =
        isPremium &&
        placementDisplay.mode !== 'internal-only' &&
        placementDisplay.mode !== 'unknown' &&
        !!estimatedPlacement &&
        estimatedPlacement.total > 1 &&
        estimatedPlacement.rank !== estimatedPlacement.total
      const placementText = visPlassering && estimatedPlacement
        ? ` og havnet på ${estimatedPlacement.rank}. plass`
        : ''
      const shareChallengeText = `Jeg fikk ${cCount} av ${totalQuestions}${placementText}. Klarer du å slå meg neste fredag?`
      const sharePayload = { files: [file], title: 'Quizkanonen', text: shareChallengeText }

      if (navigator.share && navigator.canShare && navigator.canShare(sharePayload)) {
        await navigator.share(sharePayload)
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'quizkanonen-resultat.png'
        a.click()
        URL.revokeObjectURL(url)
      }

      setCardShareState('done')
      setTimeout(() => setCardShareState('idle'), 3000)
    } catch {
      setCardShareState('idle')
    }
  }

  const optionKeys: Record<string, keyof Question> = { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' }

  if (loading) return (
    <><style>{styles}</style>
    <div className="qk-loading">
      <span className="qk-loading-dot"/><span className="qk-loading-dot"/><span className="qk-loading-dot"/>
    </div></>
  )

  if (isSuspended) return (
    <><style>{styles}</style>
    <div className="qk-shell"><div className="qk-box"><div className="qk-panel" style={{textAlign:'center'}}>
      <p style={{fontFamily:"'Libre Baskerville', serif", fontSize:20, fontWeight:700, color:'#ffffff', marginBottom:12}}>Kontoen er midlertidig suspendert</p>
      <p style={{color:'#e8e4dd', fontSize:14, lineHeight:1.6}}>Kontakt oss på <a href="mailto:support@quizkanonen.no" style={{color:'#e8e4dd'}}>support@quizkanonen.no</a> for mer informasjon.</p>
    </div></div></div></>
  )

  // INNLOGGING KREVES — panelet som erstattet redirecten til /login
  //
  // Står BEVISST foran `!quiz`: en uinnlogget besøkende skal møte «logg inn»,
  // ikke «fant ikke quizen», også når anon-lesingen ikke ser quiz-raden (en
  // skjult quiz har `is_active = false` og er usynlig for anon-nøkkelen).
  // Bonus: vi bekrefter ikke for en uinnlogget hvilke quiz-id-er som finnes.
  //
  // Teksten lover kun det som holder for en GRATIS konto — resultatet lagres,
  // du står på topplisten, poengene teller i sesongen. Nøyaktig plassering er
  // Premium og nevnes derfor ikke her; se `66007ee` (leaderboard-tekstene som
  // lovet en utlogget besøkende ting han ikke ville fått).
  if (needsLogin) return (
    <><style>{styles}</style>
    <SiteNav />
    <div className="qk-shell"><div className="qk-box"><div className="qk-panel">
      <p className="qk-eyebrow">Quizkanonen</p>
      <h1 className="qk-heading">{quiz?.title ?? 'Ukens quiz'}</h1>
      <p className="qk-sub">
        Logg inn for å spille. Da lagres resultatet ditt, du kommer på topplisten,
        og poengene teller i sesongen.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
        <button
          onClick={() => setAuthModalOpen(true)}
          className="qk-btn-primary"
          style={{ width: 'auto', padding: '10px 28px', background: '#c9a84c', color: '#1a1c23' }}
        >
          Logg inn for å spille
        </button>
      </div>
      <p className="qk-hint" style={{ textAlign: 'center', marginTop: 14 }}>
        Har du ikke konto? Du kan opprette en i samme vindu.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
        {/* Bevisst hard navigasjon, ikke <Link>: samme begrunnelse som de
            øvrige utgangene på denne siden — full sidelast gir fersk
            server-data i stedet for Next sin router-cache. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="qk-btn-ghost">← Tilbake til forsiden</a>
      </div>
    </div></div></div>
    {/* `next` peker tilbake hit. Passordinnlogging går via AuthModal sin
        onSuccess → window.location.assign(next); Google-runden går via
        /auth/callback?next=… . Begge lander på RIKTIG quiz, ikke på forsiden.
        InAppBrowserWarning ligger inne i AuthForm — ikke dupliser den her. */}
    <AuthModal
      open={authModalOpen}
      onClose={() => setAuthModalOpen(false)}
      next={`/quiz/${quizId}`}
      description="Logg inn for å spille ukens quiz. Resultatet lagres på deg, og poengene teller i sesongen."
    />
    </>
  )

  if (!quiz) return (
    <><style>{styles}</style>
    <div className="qk-shell"><div className="qk-box"><div className="qk-panel" style={{textAlign:'center'}}>
      <p style={{color:'#e8e4dd',fontSize:14}}>Fant ikke quizen.</p>
      {/* Bevisst hard navigasjon, ikke <Link>: dette er UTGANGEN fra et spilt
          quiz. Full sidelast garanterer fersk server-data (aktiv quiz,
          deltakerantall, ligastatus) i stedet for Next sin router-cache, som
          kan være opptil 30 s gammel og dermed vise tall fra før innsendingen.
          Rydder samtidig all quiz-tilstand i klienten. Ikke en forglemmelse —
          se lint-oppryddingen 5. august 2026. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" style={{color:'var(--gold)',fontSize:13,marginTop:16,display:'block'}}>← Tilbake</a>
    </div></div></div></>
  )

  // ALLEREDE SPILT
  if (phase === 'already_played') {
    // Samme delte kilde som resultatskjermen lenger nede. Fram til 19. august
    // 2026 sto det en rå new Date(nextQuizAt) her — uten fremtidsvakt og uten
    // timeZone — mens resultatskjermen hadde begge deler. Se lib/next-quiz-label.ts.
    const nextDateStr = nextQuizLabel(nextQuizAt)
    return (
      <><style>{styles}</style>
      <SiteNav />
      <div className="qk-shell"><div className="qk-box"><div className="qk-panel" style={{textAlign:'center'}}>
        <span className="qk-result-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#918f8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </span>
        <p className="qk-eyebrow" style={{textAlign:'center'}}>Allerede fullført</p>
        <h1 className="qk-heading" style={{textAlign:'center',marginBottom:8}}>Du har spilt denne quizen</h1>
        <p className="qk-sub" style={{textAlign:'center'}}>Én gjennomspilling per quiz.</p>
        <div style={{
          margin:'16px 0 0',
          padding:'12px 16px',
          background:'rgba(201,168,76,0.08)',
          border:'1px solid rgba(201,168,76,0.2)',
          borderRadius:10,
          fontSize:13,
          color:'var(--gold)',
        }}>
          Neste quiz: <strong>{nextDateStr}</strong>
        </div>
        {top3.length > 0 && (
          <div style={{ marginTop: 20, textAlign: 'left' }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 10 }}>
              Topp 3 denne uken
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {top3.map((row, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
                return (
                  <div key={row.id} style={{
                    background: '#1a1c23',
                    border: '1px solid #2a2d38',
                    borderRadius: 12,
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}>
                    <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{medal}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {row.nickname?.trim() ? (
                        <>
                          <span style={{ display: 'block', fontSize: 15, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.nickname.trim()}
                          </span>
                          <span style={{ display: 'block', fontSize: 12, color: '#918f8a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.player_name}
                          </span>
                        </>
                      ) : (
                        <span style={{ display: 'block', fontSize: 15, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.player_name}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 13, color: '#918f8a', flexShrink: 0 }}>
                      {row.correct_answers} {pluralNo(row.correct_answers, 'riktig', 'riktige')} · {(row.total_time_ms / 1000).toFixed(1)}s
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div className="qk-divider"/>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {quiz.show_leaderboard && (
            <a href={`/leaderboard/${quizId}`} className="qk-btn-primary">Se ukens resultater</a>
          )}
          {/* Bevisst hard navigasjon, ikke <Link>: dette er UTGANGEN fra et spilt
              quiz. Full sidelast garanterer fersk server-data (aktiv quiz,
              deltakerantall, ligastatus) i stedet for Next sin router-cache, som
              kan være opptil 30 s gammel og dermed vise tall fra før innsendingen.
              Rydder samtidig all quiz-tilstand i klienten. Ikke en forglemmelse —
              se lint-oppryddingen 5. august 2026. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="qk-btn-ghost">← Tilbake til forsiden</a>
        </div>
      </div></div></div></>
    )
  }

  // REGISTRERING
  if (phase === 'register') return (
    <><style>{styles}</style>
    <SiteNav />
    <div className="qk-shell"><div className="qk-box">
      <div className="qk-panel">
      <p className="qk-eyebrow">Quizkanonen</p>
      <h1 className="qk-heading">{quiz.title}</h1>
      {quiz.category && (
        <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#918f8a', marginBottom: 16 }}>{quiz.category}</p>
      )}
      {/* Navne-FELTET er fjernet (24. august 2026). Det var siste rest av
          gjeste-veien: en uinnlogget kunne skrive hva som helst her, og
          start-attempt opprettet en rad med `user_id: null`. Den som er kommet
          hit er per definisjon innlogget (se needsLogin-panelet lenger oppe),
          så navnet skal komme fra profilen — ikke fra fritekst.
          Mangler navnet likevel, er NameRequiredModal (root layout) allerede
          oppe og spør; lytteren på `qk:profile-updated` over fanger svaret. */}
      {loggedInDisplayName
        ? <p className="qk-sub">Spiller som <strong style={{ color: '#e8e4dd' }}>{loggedInDisplayName}</strong>. Lykke til!</p>
        : <p className="qk-sub">Henter profilnavnet ditt …</p>
      }

      {resumeData && (
        <div className="qk-banner">🔄 Vi fant en påbegynt quiz — du fortsetter der du slapp.</div>
      )}

      {socialProof && socialProof.totalPlayers >= 1 && (
        <div className="qk-social-proof-wrap">
          <span className="qk-social-proof-dot" />
          <span style={{
            fontSize: 14, color: '#e8e4dd',
            fontFamily: "'Instrument Sans', sans-serif",
            whiteSpace: 'nowrap',
          }}>
            <span style={{ color: '#e8e4dd', fontWeight: 600 }}>{socialProof.totalPlayers}</span>
            {' '}
            {socialProof.totalPlayers <= 2 ? 'har allerede spilt denne uken' : 'spiller denne uken'}
          </span>
          {socialProof.totalPlayers >= 3 && socialProof.sampleNames.length > 0 && (
            <div className="qk-social-proof-pills">
              {socialProof.sampleNames.map(name => (
                <span key={name} style={{
                  background: '#21242e',
                  border: '0.5px solid #2a2d38',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: 11,
                  color: '#e8e4dd',
                  fontFamily: "'Instrument Sans', sans-serif",
                  whiteSpace: 'nowrap',
                }}>
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}


      {(() => {
        const now = new Date()
        const beforeOrgOpen = orgQuizOpensAt && new Date(orgQuizOpensAt) > now
        const afterOrgClose = orgQuizClosesAt && new Date(orgQuizClosesAt) < now
        // Eksplisitt Europe/Oslo — uten dette leser toLocaleTimeString besøkerens
        // EGEN nettleser-tidssone, som er tvetydig for alle utenfor Norge.
        const osloTime = (iso: string) =>
          new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
        if (beforeOrgOpen) {
          const t = osloTime(orgQuizOpensAt!)
          return (
            <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, textAlign: 'center' }}>
              Quizen åpner kl. {t} (norsk tid) for {orgName ?? 'din bedrift'}.
            </div>
          )
        }
        if (afterOrgClose) {
          const t = osloTime(orgQuizClosesAt!)
          return (
            <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, textAlign: 'center' }}>
              Fristen for {orgName ?? 'din bedrift'} gikk ut kl. {t} (norsk tid). Sesong-poeng gjelder ikke for sene innleveringer.
            </div>
          )
        }
        if (orgQuizClosesAt) {
          const t = osloTime(orgQuizClosesAt)
          return (
            <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, textAlign: 'center' }}>
              Frist for {orgName ?? 'din bedrift'}: kl. {t} (norsk tid)
            </div>
          )
        }
        // Ingen org-spesifikk frist — vis quizens ordinære (offentlige) stengetid,
        // som tidligere ikke ble kommunisert noe sted på start-skjermen.
        if (quiz?.closes_at) {
          const t = osloTime(quiz.closes_at)
          return (
            <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, textAlign: 'center' }}>
              Quizen stenger kl. {t} (norsk tid)
            </div>
          )
        }
        return null
      })()}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {(() => {
          const now = new Date()
          const blocked = (orgQuizOpensAt && new Date(orgQuizOpensAt) > now)
          const baseDisabled = !loggedInDisplayName
          return (
            <button onClick={startQuiz} disabled={!!blocked || baseDisabled || isStarting} className="qk-btn-primary"
              style={{ width: 'auto', padding: '10px 28px', background: '#c9a84c', color: '#1a1c23' }}>
              {isStarting ? (
                <>
                  Laster…
                  <span className="qk-spinner" aria-hidden="true" />
                </>
              ) : (
                <>
                  {resumeData ? 'Fortsett quiz' : 'Start quiz'}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7 3 12V2Z"/></svg>
                </>
              )}
            </button>
          )
        })()}
      </div>
      {startError && (
        <p style={{ textAlign: 'center', fontSize: 13, color: '#e8e4dd', marginTop: 12, lineHeight: 1.5 }}>
          {startError}
        </p>
      )}
      {!resumeData && (
        <p style={{ textAlign: 'center', marginTop: 10, fontSize: 13, color: '#e8e4dd' }}>
          Rangering: flest riktige vinner — ved likt, raskest tid.
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
        <button onClick={() => {
          navigator.clipboard.writeText(window.location.href).then(() => {
            setLinkCopied(true)
            setTimeout(() => setLinkCopied(false), 2000)
          }).catch(() => {})
        }} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif",
          padding: '4px 0',
        }}>
          {linkCopied ? 'Lenke kopiert!' : 'Utfordre en venn →'}
        </button>
      </div>

      {/* Tidsgrensen leses fra SPØRSMÅLENE (via social-proof-ruten), ikke fra
          quiz-raden: `getTimeLimit` lar spørsmål-nivået vinne, og de to
          nivåene har divergert i prod. Landet ikke ruten ennå — eller feilet
          den — faller vi tilbake på quiz-nivået, som er tallet flaten viste
          før 7. august 2026. `describeQuestionTimeLimit` returnerer null når
          ingen av kildene gir et tall; da utelates hele setningen i stedet for
          å rendre «s per spørsmål» uten tall. */}
      {(() => {
        const label = socialProof?.timeLimitLabel
          ?? describeQuestionTimeLimit([], quiz.time_limit_seconds)
        return <p className="qk-hint">{label ? `${label} per spørsmål · ` : ''}Kun én gjennomspilling</p>
      })()}
    </div></div></div></>
  )

  // SPILL
  if (phase === 'playing') {
    const question = questions[currentIndex]
    const limit = getTimeLimit(question)
    const timerPercent = (timeLeft / limit) * 100
    const timerBarColor = timerPercent > 60 ? '#4ade80' : timerPercent > 40 ? 'var(--gold)' : '#E24B4A'
    const correctSoFar = answers.filter(a => a.isCorrect).length
    // Render kun FAKTISK utfylte alternativer — ikke slice(0, num_options).
    // num_options er quiz-nivå; et Ja/Nei-spørsmål i en 4-alternativers quiz
    // (kun A/B utfylt, C/D null) ville ellers gitt to tomme, klikkbare knapper.
    // `opt` er fortsatt DB-bokstaven som brukes til scoring/fasit — kun antall
    // rendrede slots endres. Defensiv fallback til num_options hvis noe skulle
    // gi tom liste (skal aldri skje: alle spørsmål har minst A/B).
    const filledLetters = ['A','B','C','D'].filter(L => {
      const v = question?.[optionKeys[L]]
      return v != null && String(v).trim() !== ''
    })
    const optionLetters = filledLetters.length > 0
      ? filledLetters
      : ['A','B','C','D'].slice(0, quiz.num_options)
    const availableOptions = question?.shuffle_options
      ? shuffledDisplayOrder.filter(o => optionLetters.includes(o))
      : optionLetters

    const getOptionClass = (opt: string) => {
      if (!answered) return ''
      const correctSet = question?.correct_answers && question.correct_answers.length > 0
        ? question.correct_answers
        : [question?.correct_answer]
      const isCorrectOpt = correctSet.includes(opt)
      const isSelected = opt === selectedAnswer
      if (isCorrectOpt && isSelected) return ' correct-self'
      if (isCorrectOpt) return ' correct'
      if (isSelected) return ' wrong'
      return ' idle'
    }

    // Etter at svaret er avgitt skilles riktig og feil i dag UTELUKKENDE av
    // grønn mot rød — ingen ikon, ingen mønster. For en deuteranop er eneste
    // skille opacity 0,7 mot 1,0. ✓/✗ i bokstavsirkelen gir et
    // fargeuavhengig skille, samme konvensjon som app/historikk/[attemptId].
    // Ubesvarte/øvrige alternativer beholder bokstaven.
    const getOptionMarker = (opt: string, i: number) => {
      const cls = getOptionClass(opt)
      if (cls === ' correct' || cls === ' correct-self') return '✓'
      if (cls === ' wrong') return '✗'
      return ['A', 'B', 'C', 'D'][i]
    }

    const currentStreak = (() => {
      let s = 0
      for (let i = answers.length - 1; i >= 0; i--) {
        if (answers[i].isCorrect) s++
        else break
      }
      return s
    })()

    return (
      <><style>{styles}</style>

      {/* Canvas konfetti-overlay */}
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10000 }} />

      {/* Lagrings-feil ved finishQuiz */}
      {finishSaveError && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, padding: '12px 20px', fontSize: 13, color: '#e8e4dd', zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          {finishSaveError}
        </div>
      )}

      {/* Innsendingen svarte ikke i tide — spilleren skal ALDRI bli stående her.
          Teksten påstår med vilje ingenting om lagringen: vi har ikke fått svar,
          og vet derfor ikke om resultatet rakk fram. To veier videre, aldri null. */}
      {finishTimedOut && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 12, padding: '16px 20px', zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: 'calc(100% - 32px)' }}>
          <p style={{ fontSize: 14, color: '#e8e4dd', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
            Nettverket svarte ikke i tide. Vi vet ikke om resultatet ditt rakk å bli lagret.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={retryFinishQuiz}
              disabled={isAdvancing}
              style={{ width: 'auto', padding: '10px 28px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: isAdvancing ? 'default' : 'pointer', opacity: isAdvancing ? 0.6 : 1 }}
            >
              {isAdvancing ? 'Prøver…' : 'Prøv igjen'}
            </button>
            <button
              onClick={() => { setFinishTimedOut(false); setPhase('finished') }}
              style={{ width: 'auto', padding: '10px 28px', background: 'transparent', color: '#e8e4dd', border: '1px solid #2a2d38', borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' }}
            >
              Vis resultatet
            </button>
          </div>
        </div>
      )}

      {/* Kunne ikke laste neste spørsmål — tilby retry uten å miste fremgang */}
      {nextLoadFailed && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 12, padding: '16px 20px', zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: 'calc(100% - 32px)' }}>
          <p style={{ fontSize: 14, color: '#e8e4dd', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
            {nextLoadFailed === 'timeout'
              ? 'Nettverket svarte ikke i tide. Fremgangen din er trygg.'
              : 'Kunne ikke laste neste spørsmål. Fremgangen din er trygg.'}
          </p>
          <button
            onClick={() => { setNextLoadFailed(null); goToNext() }}
            style={{ width: 'auto', padding: '10px 28px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' }}
          >
            Prøv igjen
          </button>
        </div>
      )}

      {/* Overlay-elementer — alltid i DOM, vises/skjules via ref.style.display (ingen React re-render) */}
      <div ref={flashRef} className="qk-flash-overlay" style={{ display: 'none' }} />
      <div ref={el => { ringRefs.current[0] = el }} className="qk-ring-el" style={{ display: 'none' }} />
      <div ref={el => { ringRefs.current[1] = el }} className="qk-ring-el" style={{ display: 'none' }} />
      <div ref={el => { ringRefs.current[2] = el }} className="qk-ring-el" style={{ display: 'none' }} />
      <div ref={scorePopRef} className="qk-score-pop-el" style={{ display: 'none' }}>+1</div>
      <div ref={streakMsgRef} className="qk-streak-msg-el" style={{ display: 'none' }} />

      {/* Intermediate screen */}
      {interPhase !== 'hidden' && (
        <ErrorBoundary>
          <QuizInterlude
            phase={interPhase}
            lastCorrect={interLastCorrect}
            correctAnswerText={interCorrectAnswerText}
            explanation={interExplanation}
            score={interScore}
            totalQuestions={totalQuestions}
            streak={interStreak}
            wrongInARow={interWrongInARow}
            questionIndex={interNextQNum - 2}
            attemptId={attemptId}
            strongCategory={interStrongCategory}
            low={interLow}
            high={interHigh}
            rival={rivalData}
            rankingSnapshot={rankingSnapshot ?? undefined}
            isLoggedIn={isLoggedIn}
            liveRanking={interLiveRanking ?? undefined}
            onNext={handleInterludeNext}
          />
        </ErrorBoundary>
      )}
      <div className="qk-game-wrap">

      {/* Venstre panel — Din rival (kun desktop 1100px+) */}
      <div className="qk-side">
        {rivalData && (
          <div className="qk-side-card">
            <p className="qk-side-label">Din rival</p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: rivalData.avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#1a1c23', flexShrink: 0 }}>
                {getAvatarInitial(rivalData.name)}
              </div>
              {/* maxWidth + break-word: display_name kan være 40 tegn uten
                  mellomrom — kortet er bare 180px bredt. */}
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", textAlign: 'center', lineHeight: 1.3, maxWidth: '100%', overflowWrap: 'break-word' }}>{rivalData.name}</span>
            </div>
            {/* Rivalens tall er en SLUTTSUM (findRival teller kun leverte
                forsøk) — vises som et mål å slå, aldri side om side med
                spillerens delsum. «Du: X riktige»-raden ble fjernet 2. aug
                2026: delsum-mot-sluttsum er ikke en reell kappestrid, og
                spillerens løpende score står allerede i poeng-pillen i
                headeren på samme skjerm. */}
            <p style={{ fontSize: 12, fontWeight: 600, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", textAlign: 'center', margin: 0 }}>
              Ferdig med {rivalData.score} {pluralNo(rivalData.score, 'riktig', 'riktige')}
            </p>
            <p style={{ fontSize: 11, color: '#918f8a', fontFamily: "'Instrument Sans', sans-serif", textAlign: 'center', margin: '4px 0 0' }}>
              Kan du slå det?
            </p>
          </div>
        )}
      </div>

      <div ref={playShellRef} className="qk-play-shell">
        <div className="qk-play-header">
          <span className="qk-progress-text">{currentIndex + 1} / {totalQuestions}</span>
          {quiz.category && (
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#918f8a' }}>{quiz.category}</span>
          )}
        </div>

        <span ref={timerRef} className="qk-timer">{timeLeft}s</span>
        <div className="qk-timer-bar-wrap">
          <div className="qk-timer-bar" style={{width:`${timerPercent}%`,background:timerBarColor}}/>
        </div>

        <div className="qk-score-row">
          {/* Null-tilstanden har INGEN glyf \u2014 med vilje. Fram til 13. august
              2026 sto det en tankestrek (\u2013) som plassholder for haken,
              men en strek foran et tall i en gr\u00f8nn pille leses som FORTEGN:
              \u00ab\u2212 0 riktige\u00bb (VINDU D). Ikke legg streken tilbake som
              \u00abmanglende symmetri\u00bb \u2014 og ikke bytt den mot haken: \u2713 foran null
              antyder noe oppn\u00e5dd som ikke er det. */}
          <span ref={scoreBadgeRef} className="qk-score-pill">{correctSoFar > 0 ? '\u2713 ' : ''}{correctSoFar} {pluralNo(correctSoFar, 'riktig', 'riktige')}</span>
          {quiz.show_live_placement && liveRank && (
            <span className="qk-rank-pill">
              {liveRank.exact !== null ? `#${liveRank.exact}` : `#${liveRank.low}–${liveRank.high}`}
            </span>
          )}
        </div>

        {/* Scenen er topp-justert uten fast høyde. Fram til 3. aug 2026 sto her
            minHeight: 420 + justifyContent: center — riktig for den gamle
            vertikale alternativ-listen (~413px innhold), men etter 2×2-
            omleggingen (295px) sentrerte den kortet i 125px død luft og fikk
            det til å hoppe 31px opp i det spilleren svarte. Høyden holdes nå
            konstant gjennom svar-øyeblikket ved at forklaring + Neste-knapp
            alltid rendres med reservert plass (visibility: hidden) — se under.
            margin-bottom: auto er motstykket til margin-top: auto på
            .qk-play-header (A-sentreringen). */}
        <div ref={questionCardRef} style={{
          display: 'flex', flexDirection: 'column', marginBottom: 'auto',
        }}>
          <div key={questionKey} className="qk-question-card qk-animate-in">
            {question?.category && (
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#918f8a', fontFamily: "'Instrument Sans', sans-serif", marginBottom: 8 }}>
                {question.category}
              </p>
            )}
            <p className="qk-question-text">{question?.question_text}</p>
          </div>

          {currentStreak >= 2 && (
            <div ref={streakBadgeRef} className="qk-streak-badge">{currentStreak} på rad!</div>
          )}

          {answered && selectedAnswer === null && (
            <div style={{
              background: 'rgba(201,76,76,0.12)', border: '1px solid var(--red)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 12,
              fontSize: 13, fontWeight: 600, color: '#f87171', textAlign: 'center',
            }}>
              Tiden er ute
            </div>
          )}

          <div className="qk-options">
            {availableOptions.map((opt, i) => (
              <button
                key={`${questionKey}-${opt}`}
                onClick={e => handleAnswer(opt, e.currentTarget as HTMLButtonElement)}
                disabled={answered}
                style={{ animationDelay: `${i * 50}ms` }}
                className={`qk-option qk-animate-in${answered ? '' : ` qk-pos-${'abcd'[i]}`}${getOptionClass(opt)}`}
              >
                {/* Vist bokstav OG posisjonsfarge (qk-pos-*) følger visnings-
                    POSISJONEN (0→A, 1→B ...), ikke DB-kolonnen. `opt` er fortsatt
                    DB-bokstaven og brukes til klikk, scoring, tekst-oppslag og
                    highlight — så fasiten kan ikke lenger utledes fra bokstaven
                    når svaralternativene stokkes. Posisjonsklassen settes kun
                    FØR svar; etter svar overtar correct/wrong/idle alene. */}
                <span className="qk-opt-letter">{getOptionMarker(opt, i)}</span>
                <span className="qk-opt-text">{question?.[optionKeys[opt]] as string}</span>
              </button>
            ))}
          </div>

          {/* Alltid i layout, usynlige før svar: reserverer EKSAKT plassen
              forklaringen og Neste-knappen kommer til å ta, slik at hverken
              kortet eller sentreringen flytter seg når spilleren svarer.
              Forklaringsteksten er allerede i klienten før svar (questions-
              ruten sender den bevisst med spørsmålet), så dette lekker
              ingenting nytt. visibility — ikke display — fordi plassen er
              poenget; hidden fjerner også klikk- og fokusflaten.

              Begge ligger FLATT som direktebarn av scenen, uten felles
              wrapper: en wrapper ville vært containing block for sticky-
              knappen, og siden den ikke er høyere enn knappen selv får
              sticky null slakk og pinner aldri (målt: knapp på 544 i stedet
              for 390 i 844×390). Med scenen som containing block virker
              bottom: 0 som ment. */}
              {quiz.show_answer_explanation && question?.explanation && (
                <div
                  className="qk-explanation"
                  style={{ visibility: answered ? 'visible' : 'hidden' }}
                  aria-hidden={!answered}
                >{question.explanation}</div>
              )}
              <div
                className="qk-next-btn-wrap"
                style={{ visibility: answered ? 'visible' : 'hidden' }}
                aria-hidden={!answered}
              >
                <button onClick={goToNext} disabled={isAdvancing} className="qk-btn-primary">
                  {isAdvancing ? (
                    <>
                      Laster…
                      <span className="qk-spinner" aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      {currentIndex === totalQuestions - 1 ? 'Se resultatet' : 'Neste spørsmål'}
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7 3 12V2Z"/></svg>
                    </>
                  )}
                </button>
              </div>
        </div>
      </div>

      {/* Høyre panel — Akkurat nå (kun desktop 1100px+) */}
      <div className="qk-side">
        <div className="qk-side-card">
          <p className="qk-side-label">Akkurat nå</p>
          {/* totalPlayers > 0: serveren teller nå kun LEVERTE forsøk (rival-
              rutens buildRankingSnapshot), så 0 betyr «ingen har levert» —
              da finnes ingen leder, og blokken skjules i stedet for å vise
              «Ukjent / 0 riktige». Klientsjekk framfor endret svarform:
              responsens fasong er uendret, så en gammel fane under deploy
              møter aldri et felt den ikke kjenner. */}
          {rankingSnapshot && rankingSnapshot.totalPlayers > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#918f8a', fontFamily: "'Instrument Sans', sans-serif", marginBottom: 6 }}>I tet</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#c9a84c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#1a1c23', fontFamily: "'Libre Baskerville', serif", flexShrink: 0 }}>
                  {getAvatarInitial(rankingSnapshot.leaderName)}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif" }}>{rankingSnapshot.leaderName}</div>
                  <div style={{ fontSize: 11, color: '#918f8a', fontFamily: "'Instrument Sans', sans-serif" }}>{rankingSnapshot.leaderCorrect} {pluralNo(rankingSnapshot.leaderCorrect, 'riktig', 'riktige')}</div>
                </div>
              </div>
            </div>
          )}
          <div style={{ borderTop: rankingSnapshot && rankingSnapshot.totalPlayers > 0 ? '1px solid #2a2d38' : 'none', paddingTop: rankingSnapshot && rankingSnapshot.totalPlayers > 0 ? 14 : 0 }}>
            {interLow !== null && interHigh !== null ? (
              <>
                <div style={{ fontSize: 11, color: '#918f8a', fontFamily: "'Instrument Sans', sans-serif", marginBottom: 4 }}>Din plass</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#c9a84c', fontFamily: "'Libre Baskerville', serif", letterSpacing: '-0.02em' }}>
                  #{interLow}–{interHigh}
                </div>
                <div style={{ fontSize: 11, color: '#918f8a', fontFamily: "'Instrument Sans', sans-serif", marginTop: 2 }}>estimert</div>
              </>
            ) : answers.length < MIN_ANSWERED_FOR_PLACEMENT ? (
              // Under terskelen: sant — det er faktisk antall besvarte som
              // mangler. Nøklet på answers.length (antall besvarte), IKKE på
              // interLow: interLow er null også over terskelen når spennet
              // uteble (én spiller i feltet, eller feilet kall), og da var
              // «Svar på minst 3» en usann forklaring til en som hadde svart
              // på fire (VINDU D, 13. august 2026).
              <div style={{ fontSize: 12, color: '#918f8a', fontFamily: "'Instrument Sans', sans-serif", lineHeight: 1.5 }}>
                Svar på minst {MIN_ANSWERED_FOR_PLACEMENT} spørsmål for å se din estimerte plass.
              </div>
            ) : (
              // Over terskelen uten spenn. Årsaken kan ikke skilles her uten
              // å røre goToNext (der low/high settes): «for få har levert» og
              // «kallet feilet» ender i samme tilstand. Ordlyden er derfor
              // årsaksnøytral — sann i begge — i stedet for å påstå en av dem.
              <div style={{ fontSize: 12, color: '#918f8a', fontFamily: "'Instrument Sans', sans-serif", lineHeight: 1.5 }}>
                Ingen estimert plass ennå.
              </div>
            )}
          </div>
        </div>
      </div>

      </div>{/* end qk-game-wrap */}</>
    )
  }

  // RESULTAT — server-beregnet score foretrekkes; klient kun fallback
  const correctCount = serverScore?.correctAnswers ?? answers.filter(a => a.isCorrect).length
  const percentage = Math.round((correctCount / totalQuestions) * 100)
  const streak = serverScore?.correctStreak ?? calculateStreak(answers.map(a => ({ is_correct: a.isCorrect })))
  // Prosenten i delingsteksten («Del resultatet»-knappen lenger nede) — samme
  // tall, fra samme funksjon, som persentillinja på resultatskjermen. Da kan
  // det spilleren DELER aldri avvike fra det hun SER.
  //
  // Her lå fram til 2. august 2026 `toppPercent`/`shareResultText`, som delte
  // «Jeg er topp X%» med den omvendte formelen (antall − rang)/antall:
  // vinneren av 55 delte «topp 98%». `shareResultText` var i tillegg dødkode
  // (ESLint meldte den ubrukt), men `toppPercent` matet også den LEVENDE
  // delingsknappen — derfor er dette rettet, ikke bare slettet.
  //
  // KUN Premium: gratis-visningen viser bevisst et grovt spenn, og en presis
  // prosent i delingsteksten ville omgått den gatingen. Gratis-varianten brukte
  // tidligere spennets `low`, som både var omvendt OG mer presist enn det
  // spilleren selv fikk se.
  // Samme gate som visPlassering i delingskortet: blokkerte (internal-only)
  // og uavklarte (unknown) deler uten plasseringspåstand — den nøytrale
  // «Jeg spilte…»-varianten finnes allerede som fallback.
  // `rank !== null` er ikke bare TypeScript-blidgjøring: uten eksakt
  // plassering fra serveren finnes det ikke noe tall å regne en prosent av, og
  // spennets `low` skal IKKE brukes som erstatning (se kommentaren over — det
  // var nettopp den feilen som ble ryddet 2. august). Ingen påstand er riktig
  // her; den nøytrale delingsteksten finnes allerede som fallback.
  const deltProsent = isPremium
    && placementDisplay.mode !== 'internal-only'
    && placementDisplay.mode !== 'unknown'
    && estimatedPlacement
    && estimatedPlacement.rank !== null
    ? placementPercentLine(estimatedPlacement.rank, estimatedPlacement.total)
    : null

  return (
    <><style>{styles}</style>
    <DuelChallengeModal
      pending={pendingChallenge}
      onCancel={() => setPendingChallenge(null)}
      onConfirm={id => { setPendingChallenge(null); handleChallenge(id) }}
    />
    <SiteNav />
    <div className="qk-shell qk-shell--result"><div className="qk-box"><div className="qk-panel qk-panel--result" style={{textAlign:'center'}}>
      <p className="qk-eyebrow" style={{textAlign:'center'}}>Bra jobbet, {playerInfo.name.split(' ')[0]}!</p>
      <h1 className="qk-heading" style={{textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
        {playerInfo.name.length > 20 ? playerInfo.name.slice(0, 20) + '…' : playerInfo.name}
      </h1>
      <p className="qk-rsec" style={{fontSize:13,color:'#e8e4dd',marginBottom:24}}>{quiz.title}</p>

      {/* Riktige svar — stor hero-visning */}
      <div style={{background:'#21242e',border:'0.5px solid #2a2d38',borderRadius:12,padding:'16px 12px 12px',textAlign:'center',marginBottom:8}}>
        <div style={{fontFamily:"'Libre Baskerville', serif",fontSize:40,fontWeight:700,color:'#ffffff',lineHeight:1}}>
          {correctCount}<span style={{fontSize:22,color:'#918f8a',fontWeight:400}}>/{totalQuestions}</span>
        </div>
        <div style={{fontSize:10,color:'#918f8a',textTransform:'uppercase',letterSpacing:'0.1em',fontWeight:600,marginTop:6}}>Riktige svar</div>
      </div>
      {/* Tre støtte-stats */}
      <div className="qk-rsec" style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:6,marginBottom:10}}>
        {[
          { val: `${percentage}%`, label: 'Score' },
          { val: formatTime(totalTimeMs), label: 'Tid' },
          { val: String(streak), label: 'Streak' },
        ].map(({ val, label }) => (
          <div key={label} style={{background:'#21242e',border:'0.5px solid #2a2d38',borderRadius:10,padding:'8px 4px',textAlign:'center'}}>
            <div style={{fontSize:14,fontWeight:500,color:'#c9a84c',lineHeight:1.2}}>{val}</div>
            <div style={{fontSize:8,color:'#918f8a',textTransform:'uppercase',letterSpacing:'0.06em',marginTop:3}}>{label}</div>
          </div>
        ))}
      </div>

      <div className="qk-divider"/>

      {(() => {
        // Ren beregning i lib/category-stats.ts — sørger for at summen av
        // radene alltid er antall besvarte spørsmål (svar uten kategori samles
        // i en egen «Uten kategori»-rad nederst i stedet for å droppes), og at
        // «Historie » og «historie» havner i samme rad.
        const cats = computeCategoryStats(answers, questions)
        if (cats.length === 0) return null
        return (
          <div className="qk-rsec" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 10, textAlign: 'left' }}>
              Kategorier
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cats.map(({ category: cat, correct, total }) => {
                const pct = Math.round((correct / total) * 100)
                const isGood = pct >= 60
                return (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: '#e8e4dd', flex: 1, textAlign: 'left' }}>{cat}</span>
                    <div style={{ width: 100, height: 4, background: '#2a2d38', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: isGood ? '#4ade80' : '#c94c4c', borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, color: isGood ? '#4ade80' : '#c94c4c', fontWeight: 600, width: 36, textAlign: 'right', flexShrink: 0 }}>
                      {correct}/{total}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── Topp 3 denne uken — for alle brukere ── */}
      {top3.length > 0 && (
        <div className="qk-rsec" style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 10, textAlign: 'left' }}>
            Topp 3 denne uken
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {top3.map((row, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
              const isMe = !!attemptId && row.id === attemptId
              return (
                <div key={row.id} style={{
                  background: '#21242e',
                  border: isMe ? '1px solid rgba(201,168,76,0.3)' : '1px solid #2a2d38',
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}>
                  <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{medal}</span>
                  <span style={{ fontSize: 15, color: '#ffffff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                    {row.player_name}
                  </span>
                  <span style={{ fontSize: 13, color: '#918f8a', flexShrink: 0 }}>
                    {row.correct_answers} {pluralNo(row.correct_answers, 'riktig', 'riktige')} · {(row.total_time_ms / 1000).toFixed(1)}s
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Blokkerte org-medlemmer (stengt org eller eget opt-out) ser KUN sin
          interne plassering. Det offentlige tallet er svaret på et spørsmål
          bedriften/den ansatte har sagt de ikke stiller — se
          lib/placement-visibility.ts. Data fra /api/leaderboard/[id]?org=
          (samme rute og Premium-gate som org-visningen av leaderboardet). ── */}
      {/* Ingen total > 1-ytterguard — med vilje (13. august 2026). Den var
          kopiert fra den globale resultatskjermens guard, som 16e8539 fjernet
          7. august fordi den ga førstemann et helt tomt felt (fossil fra den
          slettede prosentformelen). Dette kortet var søsknet fiksen glemte:
          førstemann i bedriften så ingenting. total = 1 håndteres nå av
          grenene under — Premium får plasseringen med «først ute»-kontekst,
          gratis faller i den eksisterende venteteksten (showSpan-terskelen
          på 10 står urørt). */}
      {placementDisplay.mode === 'internal-only' && internalPlacement && (() => {
        const orgName = placementDisplay.org.orgName
        if (isPremium && internalPlacement.exactRank != null) {
          return (
            <div className="qk-rsec" style={{
              background: '#1e1a0e',
              border: '0.5px solid rgba(201,168,76,0.3)',
              borderRadius: 16,
              padding: '20px 16px',
              textAlign: 'center',
              marginBottom: 14,
            }}>
              <div style={{ fontSize: 10, color: '#918f8a', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600, marginBottom: 6 }}>
                Din plassering hos {orgName}
              </div>
              <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 34, fontWeight: 700, color: '#c9a84c', lineHeight: 1 }}>
                {internalPlacement.exactRank}.<span style={{ fontSize: 18, color: '#918f8a', fontWeight: 400 }}> plass</span>
              </div>
              {internalPlacement.total === 1 ? (
                // Alene i org-rommet: «av 1 deltakere» er hult — samme
                // 'premium-first'-grep som 16e8539 på den globale varianten.
                // Org-navnet står allerede i etiketten over, gjentas ikke.
                <div style={{ fontSize: 14, color: '#e8e4dd', marginTop: 8 }}>
                  Foreløpig — du er først ute denne uken
                </div>
              ) : (
                <div style={{ fontSize: 14, color: '#e8e4dd', marginTop: 8 }}>
                  av {internalPlacement.total} deltakere
                </div>
              )}
            </div>
          )
        }
        // Gratis: samme 10-bånd og samme «for få har levert»-terskel som den
        // globale gratis-varianten under — bare mot org-rommet. bandStart er
        // allerede båndets start (serveren grovmaler), utregningen er idempotent.
        const low = internalPlacement.bandStart ?? 1
        const tierStart = internalPlacement.total <= 10 ? 1 : Math.max(1, Math.floor((low - 1) / 10) * 10 + 1)
        const rangeY = internalPlacement.total <= 10 ? internalPlacement.total : Math.min(internalPlacement.total, tierStart + 9)
        const showSpan = internalPlacement.total >= 10
        return (
          <div className="qk-rsec" style={{
            background: '#21242e',
            border: '0.5px solid #2a2d38',
            borderRadius: 16,
            padding: 16,
            textAlign: 'center',
            marginBottom: 14,
          }}>
            {showSpan ? (
              <>
                <div style={{ fontSize: 15, color: '#e8e4dd', marginBottom: 8 }}>
                  Du er et sted mellom plass {tierStart} og {rangeY}
                </div>
                <div style={{ fontSize: 11, color: '#e8e4dd', marginBottom: 12 }}>
                  av {internalPlacement.total} deltakere hos {orgName}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 15, color: '#e8e4dd', marginBottom: 12, lineHeight: 1.5 }}>
                Plasseringen din hos {orgName} vises når flere av dere har levert.
              </div>
            )}
            <a href="/premium" style={{
              display: 'inline-block',
              fontSize: 13, fontWeight: 600, color: '#c9a84c',
              textDecoration: 'none',
            }}>
              Oppgrader til Premium for å se nøyaktig plassering →
            </a>
          </div>
        )
      })()}

      {/* ── Hvorfor spilleren ikke finnes på den åpne topplisten ───────────────
          Fram til nå sto det ingenting: den blokkerte fikk et internt tall (eller
          ingenting, når orgen er for liten), og måtte selv gjette hvorfor hun
          ikke er på den nasjonale lista. Blokkeringen er bevisst, og da er det
          fraværet av forklaring — ikke oppførselen — som er feilen.

          Vilkåret er KUN moduset, ikke `internalPlacement`: kortet over vises
          først når org-rommet har mer enn én deltaker, og den første ansatte som
          spiller fredag morgen er nettopp den som ser minst og forstår minst.

          Årsaken avgjøres av globalExclusionReason() (ren, testdekket), ikke av
          en betingelse her — teksten skal aldri kunne påstå feil årsak.
          Diskret hint-farge, ingen gull: dette er en forklaring, ikke en
          handling, og skjermen har allerede sin ene gule flate. ── */}
      {placementDisplay.mode === 'internal-only' && (() => {
        const org = placementDisplay.org
        const grunn = globalExclusionReason(org)
        // De to grenene skal IKKE se like ut, og det er ikke en inkonsekvens.
        // 'org-policy' er ren forklaring uten noe å trykke på — den ER unntaket
        // CLAUDE.md beskriver, og blir stående som metadata. Den andre grenen
        // inneholder en lenke til profilen, og tekst du skal kunne klikke i
        // skal ikke være farget som tekst du ikke skal klikke i.
        const klikkbar = grunn !== 'org-policy'
        return (
          <p className="qk-rsec" style={{
            fontSize: klikkbar ? 14 : 12,
            color: klikkbar ? '#e8e4dd' : '#918f8a',
            lineHeight: 1.6, marginBottom: 14, textAlign: 'center',
          }}>
            {grunn === 'org-policy' ? (
              <>Du konkurrerer internt hos {org.orgName} og vises ikke på den åpne topplisten.</>
            ) : (
              <>
                Du har valgt å ikke vises på den åpne topplisten — du konkurrerer internt hos {org.orgName}.{' '}
                {/* Understrek er PÅKREVD nå: setningen rundt er #e8e4dd, så
                    lenken kan ikke lenger skille seg ut på farge alene. Uten
                    den ville brightningen gjort lenken usynlig som lenke —
                    samme understrek som de tre retry-knappene bruker. */}
                <a href="/profil" style={{ color: '#e8e4dd', textDecoration: 'underline' }}>Endre i profilen</a>
              </>
            )}
          </p>
        )
      })()}

      {/* ── Org-svaret feilet: plasseringen er ikke borte, den er uavklart ────
          'unknown' skjuler plasseringen med rette mens svaret er underveis,
          men et FEILET svar retter seg aldri selv (ProfileProvider setter
          bevisst ikke myOrgsLoaded på feil). Uten denne knappen forsvant
          spillerens egen plassering for resten av økta — se
          shouldOfferPlacementRetry i lib/placement-visibility.ts. Dempet og
          uten gull: skjermen har allerede sin ene gule flate. ── */}
      {(() => {
        // describeRetry gir mellomtilstanden et navn. Uten den forsvant HELE
        // dette avsnittet i klikkøyeblikket (19. august 2026) — se
        // lib/retry-affordance.ts.
        const retry = shouldOfferPlacementRetry({ mode: placementDisplay.mode, myOrgsError })
          ? describeRetry({ failed: myOrgsError, refreshing: myOrgsRefreshing })
          : 'hidden'
        if (retry === 'hidden') return null
        return (
        <p className="qk-rsec" style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 14, textAlign: 'center' }}>
          Vi fikk ikke hentet plasseringen din akkurat nå.{' '}
          <button
            onClick={() => { void refreshMyOrgs() }}
            disabled={retry === 'pending'}
            style={{
              background: 'none', border: 'none', padding: 0,
              cursor: retry === 'pending' ? 'default' : 'pointer',
              font: 'inherit', color: '#e8e4dd',
              textDecoration: retry === 'pending' ? 'none' : 'underline',
            }}
          >
            {retry === 'pending' ? 'Prøver igjen …' : 'Prøv igjen'}
          </button>
        </p>
        )
      })()}

      {(() => {
        // Hvem ser hva avgjøres av decideResultPlacementView (ren, testdekket —
        // lib/result-placement.ts). Fram til 7. august 2026 lå det en
        // `total > 1`-guard her OG ved begge fetch-stedene, så den aller første
        // som leverte så et helt tomt felt — ikke engang venteteksten.
        const placementView = decideResultPlacementView({
          mode: placementDisplay.mode,
          isPremium,
          placement: estimatedPlacement,
        })
        if (placementView === 'hidden' || !estimatedPlacement) return null
        // Her lå `prosent`/`toppX` — samme feil nevner som premium-grenen under
        // (spilleren selv talt med i feltet hun sammenlignes mot), men utledet
        // av spennets `low`. De ble aldri vist noe sted: gratis-grenen viser
        // «mellom plass X og Y», ikke en prosent. Fjernet 2. august 2026 i
        // stedet for å rettes, så feilen ikke kan arves av en framtidig
        // visning. Trenger gratis-grenen en prosent senere, finnes
        // placementPercentLine() i lib/placement-percent.ts.
        const tierStart = estimatedPlacement.total <= 10
          ? 1
          : Math.max(1, Math.floor((estimatedPlacement.low - 1) / 10) * 10 + 1)
        const rangeY = estimatedPlacement.total <= 10
          ? estimatedPlacement.total
          : Math.min(estimatedPlacement.total, tierStart + 9)
        if (placementView === 'premium-first' || placementView === 'premium-exact') {
          // Premium = EKSAKT plassering: bruk `rank` fra den delte lista (identisk
          // med Topp 3), ikke spennets `low`. Dette var Kevin-symptomet — en rang-2-
          // spiller viste "1. plass" fordi low = rank-2 ble vist som eksakt.
          // «Topp X %» og «bedre enn Y %» er TO størrelser med ULIKE nevnere,
          // ikke hverandres komplement — se lib/placement-percent.ts. Fram til
          // 2. august 2026 ble «bedre enn» regnet med spilleren selv i nevneren,
          // så vinneren av en tospillerquiz fikk «bedre enn 50 %».
          // Vakten mot sisteplass og «alene i quizen» ligger i lib-et, ikke her
          // — se placementPercentLine().
          // `rank` er non-null her fordi placementView kun blir 'premium-*'
          // når den er det (decideResultPlacementView) — men vi leser den ikke
          // ubetinget likevel: én guard på stedet er billigere enn en antakelse
          // om en beslutning tatt 60 linjer unna.
          const exactRank = estimatedPlacement.rank
          const prosentLinje = exactRank !== null
            ? placementPercentLine(exactRank, estimatedPlacement.total)
            : null
          return (
            <div className="qk-rsec" style={{
              background: '#1e1a0e',
              border: '0.5px solid rgba(201,168,76,0.3)',
              borderRadius: 16,
              padding: '20px 16px',
              textAlign: 'center',
              marginBottom: 14,
            }}>
              <div style={{ fontSize: 10, color: '#918f8a', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600, marginBottom: 6 }}>
                Din plassering
              </div>
              <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 34, fontWeight: 700, color: '#c9a84c', lineHeight: 1 }}>
                {exactRank}.<span style={{ fontSize: 18, color: '#918f8a', fontWeight: 400 }}> plass</span>
              </div>
              {placementView === 'premium-first' ? (
                // Alene i feltet: «av 1 deltakere» er hult. Konteksten er sann
                // og forklarer hvorfor tallet er magert — og ingen spenn eller
                // påstand om et felt som ikke finnes.
                <div style={{ fontSize: 14, color: '#e8e4dd', marginTop: 8 }}>
                  Foreløpig — du er først ute denne uken
                </div>
              ) : (
                <div style={{ fontSize: 14, color: '#e8e4dd', marginTop: 8 }}>
                  av {estimatedPlacement.total} deltakere
                </div>
              )}
              {/* Org-medlemmer i en org som deltar åpent ser BEGGE tall —
                  det interne i tillegg til (aldri i stedet for) det totale. */}
              {placementDisplay.mode === 'both' && internalPlacement != null
                && internalPlacement.exactRank != null && internalPlacement.total > 1 && (
                <div style={{ fontSize: 13, color: '#e8e4dd', marginTop: 8 }}>
                  {internalPlacement.exactRank}. av {internalPlacement.total} hos {placementDisplay.org.orgName}
                </div>
              )}
              {/* «Topp X %» sto her fram til 2. august 2026, men de to tallene
                  har ulike nevnere og sluttet å summere til 100 da nevneren ble
                  rettet — «Topp 51 % · bedre enn 50 %» leste som en regnefeil.
                  Plasseringen står allerede i stort format rett over, så tallet
                  var samme informasjon pakket om.

                  Skjules helt ved sisteplass og når spilleren er alene — begge
                  avgjort av placementPercentLine(), ikke av en betingelse her. */}
              {prosentLinje !== null && (
                <div style={{ fontSize: 12, color: '#918f8a', marginTop: 8 }}>
                  Bedre enn {prosentLinje}% av deltakerne
                </div>
              )}
            </div>
          )
        }
        // Spennet vises kun når datagrunnlaget er stort nok til at det betyr
        // noe (samme brytningspunkt som tier-logikken over: total <= 10 gir
        // tierStart=1/rangeY=total, altså «mellom plass 1 og N av N»). Tidlig
        // fredag — de første 30–60 minuttene, når Facebook-trafikken er størst
        // — er totalen under 10, og et «estimat» som spenner hele feltet leser
        // som en ødelagt funksjon. Under grensen: ærlig ventetekst i stedet.
        // Premium-grenen over er upåvirket — eksakt plassering er korrekt
        // uansett antall. Siden 7. august 2026 lander også total = 1 (spiller
        // nr. 1, tidligere et helt tomt felt) i venteteksten her.
        const showSpan = estimatedPlacement.total >= 10
        return (
          <div className="qk-rsec" style={{
            background: '#21242e',
            border: '0.5px solid #2a2d38',
            borderRadius: 16,
            padding: 16,
            textAlign: 'center',
            marginBottom: 14,
          }}>
            {showSpan ? (
              <>
                <div style={{ fontSize: 15, color: '#e8e4dd', marginBottom: 8 }}>
                  Du er et sted mellom plass {tierStart} og {rangeY}
                </div>
                <div style={{ fontSize: 11, color: '#e8e4dd', marginBottom: 12 }}>
                  av {estimatedPlacement.total} deltakere
                </div>
                {/* Begge tall også for gratis — men kun når org-rommet er stort
                    nok til at et 10-bånd betyr noe (samme terskel som showSpan
                    for det globale spennet). Små org-felt tidlig på fredagen
                    ville gitt «mellom plass 1 og N av N hos dere». */}
                {placementDisplay.mode === 'both' && internalPlacement != null
                  && internalPlacement.bandStart != null && internalPlacement.total >= 10 && (
                  <div style={{ fontSize: 11, color: '#e8e4dd', marginBottom: 12 }}>
                    Hos {placementDisplay.org.orgName}: mellom plass {internalPlacement.bandStart} og {Math.min(internalPlacement.total, internalPlacement.bandStart + 9)} av {internalPlacement.total}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 15, color: '#e8e4dd', marginBottom: 12, lineHeight: 1.5 }}>
                Du er blant de første som har spilt denne uken — plasseringen din vises når flere har levert.
              </div>
            )}
            <a href="/premium" style={{
              display: 'inline-block',
              fontSize: 13, fontWeight: 600, color: '#c9a84c',
              textDecoration: 'none',
            }}>
              Oppgrader til Premium for å se nøyaktig plassering →
            </a>
          </div>
        )
      })()}

      {/* ── Rival-kort ── */}
      {isLoggedIn && rivalData && (() => {
        const rivalScore = rivalData.score
        const outcome: 'won' | 'lost' | 'tied' =
          correctCount > rivalScore ? 'won' : correctCount < rivalScore ? 'lost' : 'tied'
        const name = rivalData.name

        const borderColor = outcome === 'won'
          ? 'rgba(76,175,125,0.3)'
          : outcome === 'lost'
            ? 'rgba(201,76,76,0.3)'
            : 'rgba(201,168,76,0.25)'

        const outcomeLabel = outcome === 'won' ? 'Du vant' : outcome === 'lost' ? 'Du tapte' : 'Likt'
        const outcomeLabelColor = outcome === 'won' ? '#4ade80' : outcome === 'lost' ? '#c94c4c' : '#c9a84c'

        const outcomeText = outcome === 'won'
          ? <>Du slo <span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> denne uken — <span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> fikk {rivalScore} {pluralNo(rivalScore, 'riktig', 'riktige')}.</>
          : outcome === 'lost'
            ? <><span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> slo deg denne uken — <span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> fikk {rivalScore} {pluralNo(rivalScore, 'riktig', 'riktige')}.</>
            : <>Likt med <span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> — begge fikk {rivalScore} {pluralNo(rivalScore, 'riktig', 'riktige')}. Tiden avgjør.</>

        return (
          <div className="qk-rsec" style={{
            background: '#21242e',
            border: `0.5px solid ${borderColor}`,
            borderRadius: 16,
            padding: '14px 16px',
            textAlign: 'left',
            marginBottom: 14,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
                textTransform: 'uppercase' as const, color: '#918f8a',
              }}>
                Rival
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase' as const, color: outcomeLabelColor,
              }}>
                {outcomeLabel}
              </span>
            </div>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.5, margin: 0 }}>
              {outcomeText}
            </p>
          </div>
        )
      })()}

      {/* ── Utfordre noen andre — nye motstandere fra samme quiz, IKKE rivalen
          over (poenget er å oppdage nye folk). Skjult helt hvis brukeren
          allerede har en aktiv/ventende duell denne måneden (samme regel
          som /api/rivalries POST håndhever) — å vise «Utfordre»-knapper som
          uansett ville feilet med 409 ville bare vært forvirrende. ── */}
      {isLoggedIn && !activeDuelExists && (() => {
        const visible = duelSuggestions.filter(c => !duelInvolvedSet.has(c.userId))
        if (visible.length === 0) return null
        return (
          <div className="qk-rsec" style={{
            background: '#21242e',
            border: '0.5px solid #2a2d38',
            borderRadius: 16,
            padding: '14px 16px',
            textAlign: 'left',
            marginBottom: 14,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase' as const, color: '#918f8a',
              display: 'block', marginBottom: 10,
            }}>
              Utfordre noen andre
            </span>
            {visible.map((c, i) => {
              const sent = challengeSentSet.has(c.userId)
              const loading = challengeLoadingId === c.userId
              const err = challengeError?.rivalId === c.userId ? challengeError.message : null
              const rowClickable = !sent && !loading
              return (
                <div key={c.userId}>
                  <div
                    role={rowClickable ? 'button' : undefined}
                    tabIndex={rowClickable ? 0 : undefined}
                    aria-label={rowClickable ? `Utfordre ${c.name} til duell` : undefined}
                    onClick={rowClickable ? () => setPendingChallenge({ id: c.userId, name: c.name }) : undefined}
                    onKeyDown={rowClickable ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPendingChallenge({ id: c.userId, name: c.name }) }
                    } : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      padding: '8px 0',
                      borderTop: i > 0 ? '1px solid #2a2d38' : 'none',
                      cursor: rowClickable ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: c.avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Libre Baskerville', serif", fontSize: 13, fontWeight: 700, color: '#1a1c23', flexShrink: 0 }}>
                        {getAvatarInitial(c.name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</p>
                        <p style={{ fontSize: 11, color: '#918f8a', margin: 0 }}>{c.score} {pluralNo(c.score, 'riktig', 'riktige')}</p>
                      </div>
                    </div>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {sent
                        ? <span style={{ fontSize: 11, fontWeight: 600, color: '#c9a84c', letterSpacing: '0.06em' }}>Sendt</span>
                        : (
                          <>
                            <span style={{ fontSize: 11, color: '#918f8a' }}>Utfordre</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#918f8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 6 15 12 9 18" />
                            </svg>
                          </>
                        )
                      }
                    </span>
                  </div>
                  {err && <p style={{ fontSize: 12, color: '#E24B4A', margin: '2px 0 0' }}>{err}</p>}
                </div>
              )
            })}
          </div>
        )
      })()}

      <div className="qk-result-cta" style={{display:'flex',flexDirection:'column',gap:10}}>
        <button onClick={async () => {
          const shareText = deltProsent !== null
            ? `Jeg er bedre enn ${deltProsent}% av deltakerne på Quizkanonen denne uken! Kan du slå meg?`
            : `Jeg spilte Quizkanonen denne uken! Kan du slå meg?`
          const shareData = { title: 'Quizkanonen', text: shareText, url: 'https://quizkanonen.no' }
          if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            await navigator.share(shareData)
          } else {
            navigator.clipboard.writeText(shareText + ' quizkanonen.no').then(() => {
              setShareResultCopied(true)
              setTimeout(() => setShareResultCopied(false), 2000)
            }).catch(() => {})
          }
        }} style={{
          width:'100%',background:'transparent',border:'0.5px solid #2a2d38',
          borderRadius:10,padding:'8px 20px',fontSize:14,color:'#e8e4dd',
          fontFamily:"'Instrument Sans', sans-serif",cursor:'pointer',
        }}>
          {shareResultCopied ? 'Kopiert!' : 'Del resultatet →'}
        </button>

        <button onClick={async () => {
          const name = playerInfo.name
          const challengeUrl = `https://www.quizkanonen.no/utfordring?fra=${encodeURIComponent(name)}&quiz=${quizId}`
          const challengeText = `${name} utfordrer deg på ukens Quizkanonen! Kan du slå meg? 🎯`
          const shareData = { title: 'Quizkanonen', text: challengeText, url: challengeUrl }
          if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            await navigator.share(shareData).catch(() => {})
          } else {
            navigator.clipboard.writeText(`${challengeText}\n${challengeUrl}`).then(() => {
              setChallengeResultCopied(true)
              setTimeout(() => setChallengeResultCopied(false), 2500)
            }).catch(() => {})
          }
        }} style={{
          width:'100%',background:'transparent',border:'0.5px solid #2a2d38',
          borderRadius:10,padding:'8px 20px',fontSize:14,color: challengeResultCopied ? '#4ade80' : '#e8e4dd',
          fontFamily:"'Instrument Sans', sans-serif",cursor:'pointer',
          transition: 'color 0.15s',
        }}>
          {challengeResultCopied ? 'Lenke kopiert!' : 'Utfordre en venn →'}
        </button>

        {isLoggedIn && (
          <button
            onClick={generateAndShareCard}
            disabled={cardShareState === 'loading'}
            style={{
              width: '100%',
              background: 'transparent',
              border: '0.5px solid #2a2d38',
              borderRadius: 10,
              padding: '8px 20px',
              fontSize: 14,
              color: cardShareState === 'done' ? '#4ade80' : '#e8e4dd',
              fontFamily: "'Instrument Sans', sans-serif",
              cursor: cardShareState === 'loading' ? 'default' : 'pointer',
              opacity: cardShareState === 'loading' ? 0.6 : 1,
              transition: 'color 0.2s, opacity 0.2s',
            }}
          >
            {cardShareState === 'done'
              ? 'Lastet ned!'
              : cardShareState === 'loading'
                ? 'Genererer…'
                : 'Del resultatkort'}
          </button>
        )}

        {isLoggedIn && attemptId && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {isPremium ? (
              <a href={`/historikk/${attemptId}`} style={{
                display: 'inline-block',
                padding: '10px 28px',
                background: 'transparent',
                border: '1px solid #2a2d38',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                color: '#e8e4dd',
                textDecoration: 'none',
                fontFamily: "'Instrument Sans', sans-serif",
              }}>Se dine svar →</a>
            ) : (
              // Låst variant (22. august 2026) — samme mønster som forsidens
              // historikk-flis (qkp-lock-badge i app/page.tsx): teksten består,
              // pilen byttes med lås-badgen, målet er /premium. Knappen selv er
              // outline, ikke gull — «Se topplisten» over er skjermens gull.
              <a href="/premium" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 28px',
                background: 'transparent',
                border: '1px solid #2a2d38',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                color: '#e8e4dd',
                textDecoration: 'none',
                fontFamily: "'Instrument Sans', sans-serif",
              }}>
                Se dine svar
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: '#c9a84c',
                  background: 'rgba(201,168,76,0.1)',
                  border: '1px solid rgba(201,168,76,0.2)',
                  borderRadius: 999, padding: '2px 8px',
                }}>
                  {trialOffer?.show ? 'Prøv gratis' : 'Premium'}
                </span>
              </a>
            )}
          </div>
        )}

        {quiz.show_leaderboard && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <a href={`/leaderboard/${quizId}`} className="qk-btn-primary" style={{ width: 'auto', padding: '10px 28px' }}>Se topplisten</a>
          </div>
        )}

        {/* Fremtidsvakt, fredags-fallback og tidssone bor i lib/next-quiz-label.ts,
            delt med allerede-spilt-skjermen over. Sto tidligere inline BEGGE steder,
            og de to kopiene hadde drevet fra hverandre. */}
        <p style={{fontSize:13,color:'#e8e4dd',textAlign:'center'}}>
          Neste quiz: {nextQuizLabel(nextQuizAt)}
        </p>


        {isLoggedIn && !isPremium && (
          <div className="qk-result-upsell" style={{
            background: '#21242e',
            border: '1px solid rgba(201,168,76,0.15)',
            borderRadius: 16,
            padding: 28,
          }}>
            <p style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 18,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.3,
              marginBottom: 8,
            }}>
              {trialOffer?.show
                ? `Prøv Premium gratis i ${trialOffer.days} dager`
                : 'Følg fremgangen din uke etter uke'}
            </p>
            <ul style={{ listStyle: 'none', margin: '0 0 20px', padding: 0 }}>
              {[
                'Nøyaktig plassering i ukens resultater',
                'Historikk fra alle quizer du har spilt',
                // «Sesongtoppliste — konkurrér over tid» var usant som
                // Premium-punkt: deltakelse i sesongtopplisten er gratis, og
                // /slik-fungerer-det sier det selv. Dette er det Premium
                // faktisk gir der (server-gatet siden 9651416).
                'Din nøyaktige plass på sesongtopplisten — med søk og bla',
              ].map(txt => (
                <li key={txt} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#e8e4dd', marginBottom: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c9a84c', flexShrink: 0 }} />
                  {txt}
                </li>
              ))}
            </ul>
            <a href="/premium" style={{
              display: 'inline-block',
              padding: '10px 28px',
              background: 'transparent',
              border: '1px solid #e8e4dd',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: '#e8e4dd',
              textDecoration: 'none',
            }}>
              {trialOffer?.show ? 'Prøv gratis — ingen kortinfo →' : 'Oppgrader til Premium →'}
            </a>
          </div>
        )}

        {isLoggedIn && (
          <p style={{ textAlign: 'center', marginTop: 4, marginBottom: 8 }}>
            {/* Bevisst hard navigasjon, ikke <Link>: dette er UTGANGEN fra et spilt
                quiz. Full sidelast garanterer fersk server-data (aktiv quiz,
                deltakerantall, ligastatus) i stedet for Next sin router-cache, som
                kan være opptil 30 s gammel og dermed vise tall fra før innsendingen.
                Rydder samtidig all quiz-tilstand i klienten. Ikke en forglemmelse —
                se lint-oppryddingen 5. august 2026. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/liga" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
              Spill mot vennene dine → Opprett en liga (Premium)
            </a>
          </p>
        )}

        {orgBox && (
          <div style={{
            background: 'rgba(201,168,76,0.06)',
            border: '0.5px solid rgba(201,168,76,0.15)',
            borderRadius: 10,
            padding: '12px 16px',
            textAlign: 'left',
          }}>
            <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.5, marginBottom: 6 }}>
              {orgBox.userRank
                ? `Du er nr. ${orgBox.userRank} blant kollegene dine hos ${orgBox.orgName} denne måneden`
                : `Se hvordan du rangerer blant kollegene dine hos ${orgBox.orgName}`}
            </p>
            <a href={`/org/${orgBox.orgSlug}`} style={{ fontSize: 13, color: '#c9a84c', textDecoration: 'none' }}>
              Se bedriftens sesong-toppliste →
            </a>
          </div>
        )}

        {/* Bevisst hard navigasjon, ikke <Link>: dette er UTGANGEN fra et spilt
            quiz. Full sidelast garanterer fersk server-data (aktiv quiz,
            deltakerantall, ligastatus) i stedet for Next sin router-cache, som
            kan være opptil 30 s gammel og dermed vise tall fra før innsendingen.
            Rydder samtidig all quiz-tilstand i klienten. Ikke en forglemmelse —
            se lint-oppryddingen 5. august 2026. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="qk-btn-ghost">← Tilbake til forsiden</a>
      </div>

      {ligaBox && (
        <div style={{ marginTop: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '16px 20px', textAlign: 'left' }}>
          {ligaBox.type === 'liga' ? (
            <a href={`/liga/${ligaBox.slug}`} style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#e8e4dd', marginBottom: 3 }}>
                Se hvordan du gjør det mot vennene dine →
              </p>
              <p style={{ fontSize: 12, color: '#e8e4dd' }}>{ligaBox.name}</p>
            </a>
          ) : ligaBox.type === 'multi' ? (
            // Bevisst hard navigasjon, ikke <Link>: dette er UTGANGEN fra et spilt
            // quiz. Full sidelast garanterer fersk server-data (aktiv quiz,
            // deltakerantall, ligastatus) i stedet for Next sin router-cache, som
            // kan være opptil 30 s gammel og dermed vise tall fra før innsendingen.
            // Rydder samtidig all quiz-tilstand i klienten. Ikke en forglemmelse —
            // se lint-oppryddingen 5. august 2026.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/liga" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#e8e4dd', marginBottom: 3 }}>
                Se hvordan du gjør det mot vennene dine →
              </p>
              <p style={{ fontSize: 12, color: '#e8e4dd' }}>Se dine ligaer</p>
            </a>
          ) : (
            // Bevisst hard navigasjon, ikke <Link>: dette er UTGANGEN fra et spilt
            // quiz. Full sidelast garanterer fersk server-data (aktiv quiz,
            // deltakerantall, ligastatus) i stedet for Next sin router-cache, som
            // kan være opptil 30 s gammel og dermed vise tall fra før innsendingen.
            // Rydder samtidig all quiz-tilstand i klienten. Ikke en forglemmelse —
            // se lint-oppryddingen 5. august 2026.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/liga" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#e8e4dd', marginBottom: 3 }}>
                Konkurrer mot venner
              </p>
              <p style={{ fontSize: 12, color: '#e8e4dd' }}>Opprett en liga (Premium) og inviter vennegjengen</p>
            </a>
          )}
        </div>
      )}
    </div></div></div></>
  )
}