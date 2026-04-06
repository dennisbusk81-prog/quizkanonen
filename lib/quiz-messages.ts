// Meldinger som vises på mellomskjermen under quizen.
// Rediger gjerne tekster her — én melding per linje er nok.
// Støttede plassholdere: {streak}, {percent}, {rivalName}, {remaining}

export type QuizMessageCategory =
  | 'streak'
  | 'perfect_run'
  | 'comeback'
  | 'halftime_good'
  | 'halftime_bad'
  | 'final_push'
  | 'rival_intro'

export interface QuizMessage {
  headline: string
  subline: string | null
}

export const quizMessages: Record<QuizMessageCategory, QuizMessage[]> = {
  streak: [
    { headline: '{streak} på rad!', subline: 'Du er i flytsonen nå.' },
    { headline: 'Strålende!', subline: '{streak} riktige på rad — hold det gående.' },
    { headline: 'Ustoppelig!', subline: '{streak} i strekk. Gir du deg?' },
  ],

  perfect_run: [
    { headline: 'Feilfritt til nå!', subline: 'Alle riktige — holder du det ut?' },
    { headline: '100% så langt.', subline: 'Imponerende. Fortsett slik.' },
    { headline: 'Perfekt kontroll.', subline: 'Ingen feil ennå.' },
  ],

  comeback: [
    { headline: 'Gi ikke opp.', subline: 'Hvert spørsmål er en ny sjanse.' },
    { headline: 'Nå er det comeback-tid.', subline: 'Du kan snu dette.' },
    { headline: 'Fortsett å kjempe!', subline: 'Alle har tøffe perioder.' },
  ],

  halftime_good: [
    { headline: 'Halvvegs — bra jobbet!', subline: '{percent}% riktige så langt.' },
    { headline: 'Godt halvtidsresultat!', subline: 'Du er {percent}% riktige.' },
    { headline: 'Halvtid.', subline: '{percent}% — solid start.' },
  ],

  halftime_bad: [
    { headline: 'Halvtid.', subline: 'Vanskeligere enn du trodde?' },
    { headline: 'Midtpause.', subline: 'Det er fortsatt mulig å snu det.' },
    { headline: 'Halve veien.', subline: 'Konsentrer deg — nå gjelder det.' },
  ],

  final_push: [
    { headline: 'Innspurten!', subline: 'Bare {remaining} spørsmål igjen.' },
    { headline: 'Nesten i mål!', subline: '{remaining} igjen — avslutt sterkt.' },
    { headline: 'Siste etappe.', subline: 'Gi alt på de siste {remaining}.' },
  ],

  rival_intro: [
    { headline: '{rivalName} er å slå.', subline: 'Du er ikke langt unna.' },
    { headline: 'Duell pågår.', subline: '{rivalName} følger med.' },
    { headline: 'Jakten er på.', subline: 'Sist uke: {rivalName}.' },
  ],
}
