'use client'

import { useState } from 'react'
import { selectQuizMessage, QuizMessageState } from '@/lib/select-quiz-message'
import { getAvatarInitial } from '@/lib/avatar-initial'
import { pluralNo } from '@/lib/plural-no'

// Del 3 (25. juli 2026) — plassering og prosentil hviler nå på et anslag av
// sluttresultatet, skalert opp fra tempoet så langt (se computePlacement i
// lib/ranking-snapshot.ts). Med bare ett eller to besvarte spørsmål er ett svar
// 50–100 % av datagrunnlaget, og anslaget spretter mellom ytterpunktene. Vi
// venter derfor til det finnes nok å regne på. Delt med app/quiz/[id]/page.tsx,
// som hopper over selve kallet under samme terskel.
export const MIN_ANSWERED_FOR_PLACEMENT = 3

interface RivalData {
  name: string
  avatarColor: string
  score: number
}

interface RankingSnapshot {
  top10MinCorrect: number
  leaderName: string
  leaderCorrect: number
  totalPlayers: number
}

interface LiveRanking {
  totalPlayers: number
  userRank: number
  above: { name: string; correct: number } | null
  below: { name: string; correct: number } | null
}

interface QuizInterludeProps {
  phase: 'in' | 'out'
  lastCorrect: boolean | null
  correctAnswerText: string | null
  explanation?: string | null
  score: number               // correct answers so far
  totalQuestions: number
  streak: number
  wrongInARow: number
  questionIndex: number       // 0-based index of question just answered
  // Seed-komponent for meldingsvalget: samme (attemptId, questionIndex) skal
  // alltid gi samme tekst — også etter gjenopptakelse (start-attempt sin
  // reused-sti returnerer samme attemptId).
  attemptId: string | null
  // Ferdig utledet i goToNext (computeStrongCategory) — komponenten får aldri
  // questions/answers, kun aggregater.
  strongCategory: string | null
  low: number | null          // estimated rank range
  high: number | null
  rival: RivalData | null
  rankingSnapshot?: RankingSnapshot
  isPremium?: boolean
  // Kun innloggede får plassering i det hele tatt. Gjester skal derfor heller
  // ikke se venteteksten under terskelen — for dem kommer det aldri et tall.
  isLoggedIn?: boolean
  // Del 5: hentes nå av page.tsx (goToNext) i SAMME kall som gir low/high, og
  // sendes ned hit. Tidligere gjorde denne komponenten sitt eget fetch mot
  // /api/quiz/live-ranking — et andre kall mot nøyaktig samme snapshot, per
  // spørsmål, per premium-spiller.
  liveRanking?: LiveRanking
  onNext: () => void
}

function RivalAvatar({ rival }: { rival: RivalData }) {
  const initial = getAvatarInitial(rival.name)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      marginBottom: 20,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: rival.avatarColor + '22',
        border: `2px solid ${rival.avatarColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 700, color: rival.avatarColor,
        flexShrink: 0,
      }}>
        {initial}
      </div>
      {/* minWidth 0 + break-word: display_name kan være 40 tegn uten mellomrom
          — uten dette sprenger et langt navn flex-raden horisontalt. */}
      <div style={{ textAlign: 'left', minWidth: 0 }}>
        <p style={{ fontSize: 13, color: '#e8e4dd', fontWeight: 600, margin: 0, overflowWrap: 'break-word' }}>{rival.name}</p>
        {/* Rivalens tall er en SLUTTSUM (findRival teller kun leverte forsøk).
            «Ferdig» skal stå i selve tallinja: tallet er et mål å slå, ikke en
            pågående kappestrid mot spillerens delsum. */}
        <p style={{ fontSize: 11, color: '#918f8a', margin: 0 }}>
          Ferdig med {rival.score} {pluralNo(rival.score, 'riktig', 'riktige')} — kan du slå det?
        </p>
      </div>
    </div>
  )
}

export default function QuizInterlude({
  phase,
  lastCorrect,
  correctAnswerText,
  explanation,
  score,
  totalQuestions,
  streak,
  wrongInARow,
  questionIndex,
  attemptId,
  strongCategory,
  low,
  high,
  rival,
  rankingSnapshot,
  isPremium,
  isLoggedIn,
  liveRanking,
  onNext,
}: QuizInterludeProps) {
  // PERSENTIL FJERNET 2. august 2026 (siste flate i samme opprydding som
  // 5c983dc). Hintet «Du er bedre enn X% av deltakerne» slo opp spillerens
  // DELSUM i en fordeling av ferdige spilleres SLUTTSUMMER, uten
  // tempo-projeksjonen som rettet rangeringen 25. juli — samme feilklasse som
  // funn 5 og 6. Det lot seg ikke redde:
  //   • Et projisert oppslag i persentil-fordelingen ville rettet skalaen, men
  //     den fordelingen kom fra en ANNEN pool enn snapshoten plasseringen leses
  //     fra (ingen dedupe per spiller, ingen tid-tiebreak, hentet én gang ved
  //     quiz-start) — to tall utledet av to ulike populasjoner, side om side
  //     på samme skjerm, kan motsi hverandre.
  //   • Å utlede persentilen av snapshotens rank/total ville vært konsistent,
  //     men er da bare en omskriving av plasseringen som allerede står to
  //     linjer over — OG hintet hadde ingen isPremium-gate, så det ville gitt
  //     gratisbrukere et presist plasseringstall som paywallen bevisst
  //     grovmaler (se leaderboard-gatingen 1.–2. august).
  // Resultatskjermens persentil (app/quiz/[id]/page.tsx) er sluttsum mot
  // sluttsum og er upåvirket. Ikke gjeninnfør et persentil-hint under spilling
  // uten å løse begge punktene over.

  // questionIndex er 0-basert indeks for spørsmålet som nettopp ble besvart.
  const answeredSoFar = questionIndex + 1
  const placementReady = answeredSoFar >= MIN_ANSWERED_FOR_PLACEMENT

  const msgState: QuizMessageState = {
    streak,
    wrongInARow,
    correctSoFar: score,
    totalQuestions,
    questionIndex,
    rival,
    strongCategory,
  }

  // FRYST VED MOUNT — useState-initializer, ikke useMemo. Komponenten mountes
  // på nytt for hver mellomskjerm (interPhase-gaten i page.tsx), så meldingen
  // velges én gang per visning. Med useMemo kunne rivalData (som ankommer
  // asynkront etter quiz-start) bytte GREN midt i visningen — seedet valg alene
  // fjerner bare re-rullingen innen samme gren, ikke gren-byttet.
  const [message] = useState(() =>
    selectQuizMessage(msgState, `${attemptId ?? 'anon'}:${questionIndex}`)
  )

  const animClass = phase === 'in' ? 'qk-intermediate-in' : 'qk-intermediate-out'

  return (
    <div
      className={animClass}
      style={{
        position: 'fixed', inset: 0, background: '#1a1c23', zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', overflowY: 'auto',
        padding: '40px 32px',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 360, width: '100%' }}>

        {/* Previous question result pill */}
        {lastCorrect === true ? (
          <div style={{
            display: 'inline-block',
            background: 'rgba(59,109,17,0.15)', border: '1px solid rgba(59,109,17,0.35)',
            borderRadius: 10, padding: '10px 22px', marginBottom: explanation ? 12 : 28,
            color: '#4ade80', fontSize: 15, fontWeight: 600,
          }}>
            ✓ Riktig svar
          </div>
        ) : lastCorrect === false ? (
          <div style={{
            display: 'inline-block',
            background: 'rgba(201,76,76,0.10)', border: '1px solid rgba(201,76,76,0.25)',
            borderRadius: 10, padding: '10px 22px', marginBottom: explanation ? 12 : 28,
            color: '#e8e4dd', fontSize: 14,
          }}>
            Riktig svar var: <strong>{correctAnswerText}</strong>
          </div>
        ) : null}

        {/* Explanation */}
        {explanation && (
          <div style={{
            borderLeft: '3px solid #c9a84c',
            paddingLeft: 12,
            marginBottom: 28,
            textAlign: 'left',
          }}>
            <p style={{ fontSize: 14, color: '#e8e4dd', fontStyle: 'italic', lineHeight: 1.5 }}>
              {explanation}
            </p>
          </div>
        )}

        {/* Dynamic headline */}
        <h2 style={{
          fontFamily: "'Libre Baskerville', serif",
          fontSize: 28, fontWeight: 700, color: '#ffffff',
          lineHeight: 1.2, marginBottom: message.subline ? 10 : 20,
          // Tekstbredden er 296px (maxWidth 360 − 2×32 padding) — et langt norsk
          // sammensatt ord må brytes, ellers renner det ut horisontalt.
          overflowWrap: 'break-word',
          // Gulv på to linjer (målt: 2 × 33,59px = 67,19px ved fontSize 28 /
          // lineHeight 1.2) så blokken under ikke hopper vertikalt mellom
          // 1- og 2-linjers headlines. Tre linjer vokser som før — gulv, ikke tak.
          minHeight: 68,
        }}>
          {message.headline}
        </h2>

        {message.subline && (
          <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 20, lineHeight: 1.5 }}>
            {message.subline}
          </p>
        )}

        {/* Del 3 — for tidlig til et meningsfylt anslag. Nøytral tilstand, slik at
            plasseringen ikke bare forsvinner og dukker opp igjen uforklart.

            Teksten sa fram til 1. august 2026 «Beregner posisjon…», som lovet
            noe den ikke holdt: ingenting beregnes her. Under terskelen gjør
            page.tsx (goToNext) bevisst ikke rangeringskallet i det hele tatt —
            visningen venter kun på at nok spørsmål er besvart. En spiller som
            sto fast av andre grunner hadde dermed en «pågår»-tekst foran seg
            som aldri kunne bli ferdig. Nå sier den hva som faktisk mangler. */}
        {isLoggedIn && !placementReady && (
          <div style={{ marginBottom: 18 }}>
            <p style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#918f8a', marginBottom: 6,
            }}>
              Din plassering
            </p>
            <p style={{ fontSize: 13, color: '#918f8a' }}>
              Vises når du har svart på {MIN_ANSWERED_FOR_PLACEMENT} spørsmål
            </p>
          </div>
        )}

        {/* Live ranking — gratis ser estimert spenn, Premium ser eksakt plassering */}
        {placementReady && !isPremium && low !== null && high !== null && (
          <div style={{ marginBottom: 18 }}>
            <p style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#918f8a', marginBottom: 6,
            }}>
              Din rangering
            </p>
            <p style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 34, fontWeight: 700, color: '#c9a84c', lineHeight: 1,
            }}>
              {low}–{high}
            </p>
          </div>
        )}

        {/* Premium: eksakt plassering som hovedelement, mini-leaderboard som støtte */}
        {placementReady && isPremium && liveRanking && liveRanking.totalPlayers >= 2 && (
          <div style={{ marginBottom: 18 }}>
            <p style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#918f8a', marginBottom: 6,
            }}>
              Din plassering
            </p>
            <p style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 34, fontWeight: 700, color: '#c9a84c', lineHeight: 1,
            }}>
              {liveRanking.userRank}.<span style={{ fontSize: 18, color: '#918f8a', fontWeight: 400 }}> plass</span>
            </p>
            <p style={{ fontSize: 13, color: '#918f8a', marginTop: 6 }}>
              av {liveRanking.totalPlayers} spillere så langt
            </p>

            {/* Mini-leaderboard — naboer rundt deg. "Du"-raden er hvit (ikke gull)
                så plasseringstallet over forblir det eneste gule elementet.

                Naboene viser IKKE poengtall: poolen består av FERDIGE forsøk
                (sluttsummer), mens din egen sum er en delsum — rå tall side om
                side ser ut som en regnefeil (naboen UNDER kan ha flere riktige
                enn deg, fordi rangeringen bruker den tempo-projiserte summen
                din). Rangeringen og navnene er riktige; kun tallene lyver.
                En dempet forbeholdslinje under (Del 4, 25. juli) ble beviselig
                ikke lest — merkingen må stå i selve tallinja. */}
            <div style={{ marginTop: 14, lineHeight: 1.8 }}>
              {liveRanking.above && (
                <p style={{ fontSize: 13, color: '#918f8a', margin: 0 }}>
                  #{liveRanking.userRank - 1} {liveRanking.above.name}
                </p>
              )}
              <p style={{ fontSize: 14, color: '#ffffff', fontWeight: 600, margin: 0 }}>
                #{liveRanking.userRank} Du · {score} {pluralNo(score, 'riktig', 'riktige')} etter {answeredSoFar} spørsmål
              </p>
              {liveRanking.below && (
                <p style={{ fontSize: 13, color: '#918f8a', margin: 0 }}>
                  #{liveRanking.userRank + 1} {liveRanking.below.name}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Rival */}
        {rival && <RivalAvatar rival={rival} />}

        {/* Ranking context — computed from snapshot, no DB calls */}
        {rankingSnapshot && rankingSnapshot.totalPlayers >= 3 && (() => {
          const questionsLeft = totalQuestions - (questionIndex + 1)
          const isInTop10 = score >= rankingSnapshot.top10MinCorrect &&
            (rankingSnapshot.top10MinCorrect > 0 || rankingSnapshot.totalPlayers >= 2)
          const neededForTop10 = rankingSnapshot.top10MinCorrect - score

          if (isInTop10) {
            return (
              <p style={{ fontSize: 13, color: '#c9a84c', marginBottom: 16 }}>
                Du er i topp 10 akkurat nå — hold det gående
              </p>
            )
          }
          if (neededForTop10 > 0 && questionsLeft < 3) {
            return (
              <p style={{ fontSize: 13, color: '#e8e4dd', marginBottom: 16 }}>
                Du trenger {neededForTop10} {pluralNo(neededForTop10, 'riktig', 'riktige')} til for å komme inn i topp 10
              </p>
            )
          }
          // «{rival} ligger ett hakk foran deg» ble slettet 2. aug 2026: den
          // testet rivalens SLUTTSUM mot spillerens DELSUM (score + 1), så
          // påstanden var som regel usann og kan ikke reddes med merking.
          // Ikke gjeninnfør en rival-gren her uten delsum-mot-delsum-data.
          return null
        })()}

        {/* Score line */}
        {low === null && (
          <p style={{ fontSize: 13, color: '#918f8a', marginBottom: 24 }}>
            {score} av {totalQuestions} riktige
            {streak >= 2 ? ` · ${streak} på rad` : ''}
          </p>
        )}

        {/* Next question button */}
        <button
          onClick={onNext}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#c9a84c', color: '#1a1c23',
            fontFamily: "'Instrument Sans', sans-serif",
            fontSize: 15, fontWeight: 600,
            padding: '11px 28px',
            borderRadius: 10, border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s, transform 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#d9b85c'; e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#c9a84c'; e.currentTarget.style.transform = 'none' }}
          onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.98)' }}
          onMouseUp={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
        >
          Neste spørsmål
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M3 2L11 7 3 12V2Z"/>
          </svg>
        </button>

      </div>
    </div>
  )
}
