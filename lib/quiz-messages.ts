// Meldinger som vises på mellomskjermen under quizen.
// Rediger gjerne tekster her — én melding per linje er nok.
//
// Gyldige plassholdere PER KATEGORI (håndhevet av lib/select-quiz-message.test.ts
// — en tekst med en plassholder utenfor lista vises som rå tekst til spilleren,
// f.eks. bokstavelig «{n}»):
//   streak      → {streak}
//   final_push  → {remaining}  (remaining er alltid 2 eller 3 — se under)
//   category    → {category}
//   rival_intro → {rivalName}
//   alle andre  → ingen plassholdere (også final_push_last, som dekker
//                 remaining=1 og derfor kan skrive «siste spørsmål» i klartekst)
//
// PRINSIPP (fra logikk-økten 30. juli 2026): en melding skal aldri påstå noe om
// resultat, plassering eller ledelse — mellomskjermen viser tallene ved siden
// av, og en melding som motsier tallet i samme skjermbilde er verre enn ingen
// melding. Derfor finnes ikke {percent} lenger.
//
// MERK til tekstøkten: streak-tekster må ikke bruke ordet «Perfekt» — in-game-
// overlayet (app/quiz/[id]/page.tsx, fireCorrectAnswer) sier «Perfekt!» rett før
// mellomskjermen ved streak >= 5. after_wrong-tekster må ikke si «du svarte
// feil» — et utløpt (ubesvart) spørsmål registreres også som feil.

export type QuizMessageCategory =
  | 'perfect_run'
  | 'halftime'
  | 'final_push'
  | 'final_push_last'
  | 'comeback'
  | 'streak'
  | 'after_wrong'
  | 'category'
  | 'rival_intro'
  | 'generic'

export interface QuizMessage {
  headline: string
  subline: string | null
}

export const quizMessages: Record<QuizMessageCategory, QuizMessage[]> = {
  perfect_run: [
    { headline: 'Feilfritt til nå!', subline: 'Alle riktige — holder du det ut?' },
    { headline: '100% så langt.', subline: 'Imponerende. Fortsett slik.' },
    { headline: 'Perfekt kontroll.', subline: 'Ingen feil ennå.' },
  ],

  // Nøytral — skal være sann uansett hvordan spilleren ligger an. De gamle
  // halftime_good/halftime_bad påsto noe om stilling og er fjernet.
  halftime: [
    { headline: 'Du er halvveis.', subline: 'Konsentrer deg — nå gjelder det.' },
    { headline: 'Halvtid.', subline: 'Halvparten unnagjort — halvparten igjen.' },
    { headline: 'Midtveis i quizen.', subline: 'Andre omgang starter nå.' },
  ],

  // {remaining} er her alltid 2 eller 3 — remaining=1 rutes til
  // final_push_last under (selectQuizMessage), så tekstene kan bøye i flertall.
  final_push: [
    { headline: 'Innspurten!', subline: 'Bare {remaining} spørsmål igjen.' },
    { headline: 'Nesten i mål!', subline: '{remaining} igjen — avslutt sterkt.' },
    { headline: 'Siste etappe.', subline: 'Gi alt på de siste {remaining}.' },
  ],

  // Entallssettet for innspurten — nøyaktig ett spørsmål igjen. Fram til
  // 2. august 2026 fikk spilleren flertallstekstene med tallet 1 innfylt:
  // «Gi alt på de siste 1.» (QK_4 punkt 12).
  final_push_last: [
    { headline: 'Siste spørsmål!', subline: 'Avslutt sterkt.' },
    { headline: 'Ett igjen.', subline: 'Gi alt på det siste.' },
    { headline: 'Nå avgjøres det.', subline: 'Bare ett spørsmål igjen.' },
  ],

  comeback: [
    { headline: 'Gi ikke opp.', subline: 'Hvert spørsmål er en ny sjanse.' },
    { headline: 'Nå er det comeback-tid.', subline: 'Du kan snu dette.' },
    { headline: 'Fortsett å kjempe!', subline: 'Alle har tøffe perioder.' },
  ],

  streak: [
    { headline: '{streak} på rad!', subline: 'Du er i flytsonen nå.' },
    { headline: 'Strålende!', subline: '{streak} riktige på rad — hold det gående.' },
    { headline: 'Ustoppelig!', subline: '{streak} i strekk. Gir du deg?' },
  ],

  // Midlertidige tekster — fullt sett kommer i egen tekstøkt. Dekker også
  // timeout (ubesvart spørsmål registreres som feil), derfor aldri «du svarte
  // feil».
  after_wrong: [
    { headline: 'Videre.', subline: 'Neste spørsmål teller like mye.' },
    { headline: 'Rist det av deg.', subline: 'Ett spørsmål avgjør ingenting.' },
    { headline: 'Nytt spørsmål, ny sjanse.', subline: null },
    { headline: 'Blikket fremover.', subline: 'Det neste kan være ditt.' },
  ],

  // Midlertidige tekster — fullt sett kommer i egen tekstøkt.
  category: [
    { headline: 'Du kan {category}, du.', subline: 'Sterk kategori for deg.' },
    { headline: '{category} sitter.', subline: 'Du har truffet godt der.' },
    { headline: 'Sterk i {category}.', subline: null },
    { headline: '{category} er ditt felt.', subline: 'Fortsett sånn.' },
  ],

  rival_intro: [
    { headline: '{rivalName} leder foran deg.', subline: 'Kan du ta igjen?' },
    { headline: 'Du jakter på {rivalName} akkurat nå.', subline: null },
    { headline: 'Sist uke vant {rivalName}.', subline: 'Revansje?' },
  ],

  // Midlertidige tekster — default når ingen annen gren treffer. Må være sanne
  // i enhver tilstand.
  generic: [
    { headline: 'Neste spørsmål venter.', subline: null },
    { headline: 'Hold fokus.', subline: 'Quizen er ikke over ennå.' },
    { headline: 'Videre i quizen.', subline: 'Hvert spørsmål teller.' },
    { headline: 'Klar for neste?', subline: null },
  ],
}
