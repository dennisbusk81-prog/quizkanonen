// Meldinger som vises på mellomskjermen under quizen.
// Rediger gjerne tekster her — én linje per melding.
//
// ── HVORDAN EN MELDING SER UT ────────────────────────────────────────────────
// `headline` er den store serif-linja, `subline` den lille under (kan være
// null). Praktisk tak for headline er ~35 tegn: tekstbredden er 296px, og en
// lengre headline går på tre linjer og dytter blokken under seg nedover.
// Sublinen har mye mer plass og tåler lange navn.
//
// `priority: true` gir teksten DOBBEL vekt i trekningen — den dukker opp
// omtrent dobbelt så ofte som en tekst uten. Brukt på Dennis' favoritter.
// Valget er fortsatt en ren funksjon av seeden (se pickWeighted i
// select-quiz-message.ts), så samme spiller får samme tekst ved re-render.
//
// ── GYLDIGE PLASSHOLDERE PER KATEGORI ────────────────────────────────────────
// Håndhevet av lib/select-quiz-message.test.ts — en tekst med en plassholder
// utenfor lista vises som rå tekst til spilleren, f.eks. bokstavelig «{n}»:
//   streak      → {streak}
//   final_push  → {remaining}  (alltid 2 eller 3 — se final_push_last)
//   category    → {category}   (KUN fallback-settet, se categoryMessages)
//   rival_intro → {rivalName}
//   alle andre  → ingen plassholdere
//
// ── PRINSIPP: EN MELDING SKAL ALDRI PÅSTÅ NOE USANT ──────────────────────────
// (fra logikk-øktene 30. juli og 2. august 2026)
// Mellomskjermen viser tallene ved siden av teksten, og en melding som motsier
// tallet i samme skjermbilde er verre enn ingen melding. Konkret betyr det:
//
//   • INGEN melding kan påstå noe om plassering, ledelse eller resultat.
//     Derfor finnes ikke {percent}, og derfor sier ingen rival-tekst at rivalen
//     «leder» — se rival_intro under.
//   • `halftime` er BEVISST nøytral. Den vises like ofte til en spiller med 0
//     riktige som til en med 7, så «så langt, så bra» hører ikke hjemme der.
//   • `comeback` vises MENS spilleren er nede (to eller flere feil på rad, akkurat
//     nå) — ikke etter en snuoperasjon. Ingen comeback-tekst kan derfor si at
//     noe «har snudd», «går bedre» eller «er hentet inn». Se comeback under.
//   • `after_wrong` må ikke si «du svarte feil»: et utløpt (ubesvart) spørsmål
//     registreres også som feil, og da svarte spilleren ingenting.
//   • Ordet «Perfekt» er forbudt i BÅDE streak og perfect_run: in-game-overlayet
//     (app/quiz/[id]/page.tsx, fireCorrectAnswer) skriver «Perfekt!» over
//     skjermen ved streak >= 5, ~1,2 sekunder før mellomskjermen. Ved en perfekt
//     rekke ER streak lik antall besvarte, så begge grenene treffer det samme
//     øyeblikket.

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
  // Dobbel vekt i trekningen. Utelatt = vanlig vekt.
  priority?: boolean
}

export const quizMessages: Record<QuizMessageCategory, QuizMessage[]> = {
  // Alt riktig så langt (fra og med spørsmål 2). Ingen «Perfekt» — se toppen.
  perfect_run: [
    { headline: 'Alt riktig så langt.', subline: 'Bare fortsett.', priority: true },
    { headline: 'Feilfritt til nå.', subline: null, priority: true },
    { headline: 'Full pott hittil.', subline: null, priority: true },
    { headline: 'Du har ikke bomma én gang.', subline: null, priority: true },
    { headline: 'Alt sitter.', subline: null, priority: true },
    { headline: 'Ingen feil ennå.', subline: 'Sånn kan det gå.' },
    { headline: 'Plettfritt så langt.', subline: null },
    { headline: 'Ikke ett eneste feilsvar.', subline: null },
    { headline: 'Du har full uttelling.', subline: null },
    { headline: 'Så langt er alt inne.', subline: null },
    { headline: 'Ingenting å si på det.', subline: null },
    { headline: 'Ren rekke.', subline: 'Ingen feil.' },
    { headline: 'Alt riktig hittil.', subline: null },
    { headline: 'Du har ikke gjort en eneste feil.', subline: null },
    { headline: 'Full score så langt.', subline: null },
    { headline: 'Ikke en bom.', subline: null },
    { headline: 'Alt på plass.', subline: null },
    { headline: 'Feilfritt hele veien til nå.', subline: null },
    { headline: 'Du har svart riktig på alt.', subline: null },
    { headline: 'Rent bord så langt.', subline: null },
    { headline: 'Ingen glipp ennå.', subline: null },
    { headline: 'Du er fortsatt feilfri.', subline: null },
    { headline: 'Ingen skår i gleden så langt.', subline: null },
    { headline: 'Du har hatt rett hver gang.', subline: null },
    { headline: 'Så langt er alt riktig.', subline: null },
    { headline: 'Ingen feil. Punktum.', subline: null },
    { headline: 'Plettfritt hittil.', subline: 'Ingen press.' },
    { headline: 'Du har ikke svart feil én gang.', subline: null },
    { headline: 'Alt riktig. Fortsett.', subline: null },
  ],

  // Nøytral — skal være sann uansett hvordan spilleren ligger an. De gamle
  // halftime_good/halftime_bad påsto noe om stilling og er fjernet.
  halftime: [
    { headline: 'Halvveis.', subline: 'Nå er det alvor.', priority: true },
    { headline: 'Halvtid.', subline: 'Ingen har vunnet noe ennå.', priority: true },
    { headline: 'Du er halvveis.', subline: 'Hold hodet kaldt.', priority: true },
    { headline: 'Halvtid.', subline: 'Nå kommer andre halvdel.', priority: true },
    { headline: 'Halvveis.', subline: 'Andre omgang kan avgjøre.', priority: true },
    { headline: 'Halvveis unnagjort.', subline: null },
    { headline: 'Halvtid.', subline: 'Ta en slurk og fortsett.' },
    { headline: 'Nå er du halvveis.', subline: null },
    { headline: 'Halvtid.', subline: 'Resten teller like mye.' },
    { headline: 'Halvveis.', subline: 'Det meste kan fortsatt snu.' },
    { headline: 'Halvtid.', subline: 'Ingen grunn til å stresse.' },
    { headline: 'Halvveis.', subline: 'Nå strammer det seg til.' },
    { headline: 'Halvtid.', subline: 'Andre halvdel gjenstår.' },
    { headline: 'Du har gjort unna halve jobben.', subline: null },
    { headline: 'Halvveis.', subline: 'Ta det med ro.' },
    { headline: 'Halvtid.', subline: 'Ingenting er avgjort.' },
    { headline: 'Midtveis.', subline: 'Fortsett i samme spor.' },
    { headline: 'Halvtid.', subline: 'Nå begynner andre omgang.' },
    { headline: 'Du er midtveis.', subline: null },
    { headline: 'Halvtid.', subline: 'Hold drivet oppe.' },
    { headline: 'Halvveis.', subline: 'Du er fortsatt med.' },
    { headline: 'Halvtid.', subline: 'Hold tempoet.' },
    { headline: 'Halvveis.', subline: 'Ingen hast.' },
    { headline: 'Halvtid.', subline: 'Fortsatt alt å spille for.' },
    { headline: 'Du har halve quizen igjen.', subline: null },
    { headline: 'Halvtid.', subline: 'Nå gjelder det å holde hodet.' },
    { headline: 'Halvtid.', subline: 'Alt er fortsatt åpent.' },
    { headline: 'Halvveis.', subline: 'Resten kan gjøre utslaget.' },
    { headline: 'Halvtid.', subline: 'Videre.' },
  ],

  // 2 eller 3 spørsmål igjen. {remaining} er derfor aldri 1 — ett igjen rutes
  // til final_push_last under, så tekstene her kan bøye i flertall.
  final_push: [
    { headline: 'Snart i mål.', subline: null, priority: true },
    { headline: 'Nå gjelder det.', subline: null, priority: true },
    { headline: 'Siste strekk.', subline: 'Ikke slurv nå.', priority: true },
    { headline: 'Innspurten.', subline: 'Hold fokus.', priority: true },
    { headline: 'Siste sving.', subline: null, priority: true },
    { headline: '{remaining} spørsmål igjen.', subline: null },
    { headline: 'Snart ferdig.', subline: 'Ta deg tid.' },
    { headline: 'Nå avgjøres det.', subline: null },
    { headline: 'De siste kan gjøre utslaget.', subline: null },
    { headline: 'Hold fokus litt til.', subline: null },
    { headline: 'Nesten i mål.', subline: null },
    { headline: 'Målstreken nærmer seg.', subline: null },
    { headline: 'Siste etappe.', subline: null },
    { headline: 'Nå er det ikke mange igjen.', subline: null },
    { headline: 'Avslutt godt.', subline: null },
    { headline: 'De siste kan avgjøre.', subline: null },
    { headline: 'Ikke gi slipp nå.', subline: null },
    { headline: 'Snart ferdig.', subline: 'Konsentrer deg.' },
    { headline: 'Nå er det innspurt.', subline: null },
    { headline: 'Nå skal det avgjøres.', subline: null },
    { headline: 'Litt igjen. Stå på.', subline: null },
    { headline: 'De siste er ofte de tøffeste.', subline: null },
    { headline: 'Snart i havn.', subline: null },
    { headline: 'Hold hodet kaldt til slutt.', subline: null },
    { headline: 'Siste mulighet.', subline: 'Nå kan du løfte resultatet.' },
  ],

  // Entallssettet for innspurten — nøyaktig ett spørsmål igjen. Fram til
  // 2. august 2026 fikk spilleren flertallstekstene med tallet 1 innfylt:
  // «Gi alt på de siste 1.» (QK_4 punkt 12). Ingen {remaining} her — ett er
  // skrevet ut i klartekst.
  final_push_last: [
    { headline: 'Siste spørsmål.', subline: 'Så er du i mål.', priority: true },
    { headline: 'Ett igjen.', subline: 'Gi alt på det siste.', priority: true },
    { headline: 'Det siste nå.', subline: 'Så er quizen ferdig.', priority: true },
    { headline: 'Nå avgjøres alt.', subline: 'Bare ett spørsmål igjen.' },
    { headline: 'Ett spørsmål gjenstår.', subline: 'Ikke slurv på tampen.' },
    { headline: 'Her er det siste.', subline: null },
  ],

  // TO ELLER FLERE FEIL PÅ RAD — AKKURAT NÅ. Ikke etter en snuoperasjon.
  // Spilleren har nettopp svart feil (eller latt tiden gå ut) for andre gang på
  // rad, og ingenting har bedret seg. Tekster som «du har snudd trenden», «nå
  // går det bedre» eller «du har hentet inn mye» er derfor USANNE her — 30 slike
  // ble forkastet 2. august 2026. Alt som står igjen er enten en nøytral
  // konstatering eller en oppfordring framover.
  //
  // Trygt å si: det er alltid minst 4 spørsmål igjen når denne vises
  // (final_push fanger 1–3, og siste spørsmål går rett til resultatskjermen).
  comeback: [
    { headline: 'Ikke gi opp nå.', subline: 'Det er fortsatt en del igjen.', priority: true },
    { headline: 'Tung periode.', subline: 'Alle har dem.', priority: true },
    { headline: 'Det kan fortsatt snu.', subline: null, priority: true },
    { headline: 'Neste er en ny sjanse.', subline: null, priority: true },
    { headline: 'Stå i det.', subline: 'Det er flere spørsmål igjen.', priority: true },
    { headline: 'Sånn går det noen ganger.', subline: null },
    { headline: 'Ingen krise.', subline: 'Det er langt igjen.' },
    { headline: 'Slikt skjer.', subline: null },
    { headline: 'Du er ikke ute av det.', subline: null },
    { headline: 'Det er lov å bomme.', subline: null },
    { headline: 'Pust ut, så videre.', subline: null },
    { headline: 'Tøff periode akkurat nå.', subline: 'Det er fortsatt tid.' },
    { headline: 'Feil skjer.', subline: 'Det er flere igjen.' },
    { headline: 'Hold ut.', subline: 'Quizen er ikke ferdig.' },
  ],

  // Terskel 5 (STREAK_MESSAGE_THRESHOLD). Ingen «Perfekt» — se toppen.
  streak: [
    { headline: '{streak} på rad.', subline: 'Det sitter.', priority: true },
    { headline: 'Du er i siget nå.', subline: null, priority: true },
    { headline: '{streak} riktige etter hverandre.', subline: 'Ikke verst.', priority: true },
    { headline: 'Her er det peiling ute og går.', subline: null, priority: true },
    { headline: 'Det går på skinner nå.', subline: null, priority: true },
    { headline: '{streak} på rad.', subline: 'Noen begynner å bli irriterte.', priority: true },
    { headline: 'Du har funnet rytmen.', subline: null },
    { headline: 'Rekka holder.', subline: null },
    { headline: 'Det sitter godt i dag.', subline: null },
    { headline: 'Du er varm nå.', subline: null },
    { headline: '{streak} riktige på rad.', subline: 'Hold koken.' },
    { headline: 'Ingenting å utsette på den rekka.', subline: null },
    { headline: 'Du treffer igjen og igjen.', subline: null },
    { headline: '{streak} på rad.', subline: 'Det begynner å ligne noe.' },
    { headline: 'Solid levert så langt.', subline: null },
    { headline: 'Du har god flyt.', subline: null },
    { headline: 'Det går unna nå.', subline: null },
    { headline: 'Formen er på plass.', subline: null },
    { headline: '{streak} på rad.', subline: 'Fortsett sånn.' },
    { headline: 'Du har greie på det meste her.', subline: null },
    { headline: 'Stø kurs.', subline: null },
    { headline: '{streak} på rad.', subline: 'Ingen bom.' },
    { headline: 'Du kan saker, du.', subline: null },
    { headline: 'Det flyter lett for deg nå.', subline: null },
    { headline: 'Rekka er oppe i {streak}.', subline: null },
    { headline: 'Godt jobba så langt.', subline: null },
    { headline: 'Du holder nivået oppe.', subline: null },
    { headline: '{streak} etter hverandre. Bra.', subline: null },
    { headline: 'Ingen tegn til slinger her.', subline: null },
    { headline: 'Du har full kontroll.', subline: null },
    { headline: '{streak} riktige på rad.', subline: 'Sterkt levert.' },
    { headline: 'Du leverer stabilt.', subline: null },
    { headline: 'Der satt den igjen.', subline: null },
    { headline: '{streak} på rad.', subline: 'Merkelig lett, eller?' },
    { headline: 'Du leverer.', subline: null },
  ],

  // Nøyaktig ett feil sist. Dekker også timeout (ubesvart spørsmål registreres
  // som feil), derfor aldri «du svarte feil».
  after_wrong: [
    { headline: 'Det går fint.', subline: null },
    { headline: 'Ingen stress.', subline: null },
    { headline: 'Du er fortsatt med.', subline: null },
    { headline: 'Det er ikke over ennå.', subline: null },
    { headline: 'Det ordner seg.', subline: null },
    { headline: 'Så går vi videre.', subline: null },
    { headline: 'Ingen fare.', subline: 'Neste.' },
    { headline: 'Videre.', subline: 'Neste spørsmål teller like mye.' },
    { headline: 'Rist det av deg.', subline: 'Ett spørsmål avgjør ingenting.' },
    { headline: 'Nytt spørsmål, ny sjanse.', subline: null },
    { headline: 'Blikket fremover.', subline: 'Det neste kan være ditt.' },
  ],

  // FALLBACK for kategorier som ikke har egne tekster i categoryMessages under
  // — f.eks. en kategori lagt til i admin etter at tekstsettet ble skrevet.
  // Bruker {category}, med de linjebrudd-problemene et langt kategorinavn gir
  // («Du kan Vitenskap & Natur, du.» går på tre linjer). Derfor er de kjente
  // kategoriene skrevet ut manuelt under i stedet.
  category: [
    { headline: '{category} sitter.', subline: 'Du har truffet godt der.' },
    { headline: 'Sterk i {category}.', subline: null },
    { headline: '{category} er ditt felt.', subline: 'Fortsett sånn.' },
  ],

  // Rivalen er en ANNEN spiller som har FULLFØRT denne quizen (findRival i
  // app/api/quiz/rival/route.ts krever submitted_at). Ingenting mer er kjent:
  //   • Rivalen er IKKE fra forrige uke — det er samme quiz.
  //   • Rivalen LEDER ikke nødvendigvis. Har spilleren ikke levert ennå (det
  //     normale under spilling), plukkes rivalen fra MEDIANEN av feltet, helt
  //     uten sammenligning mot spillerens egen delsum.
  // Derfor sier ingen tekst her noe om ledelse, jakt eller forrige uke — de tre
  // gamle tekstene gjorde alle tre og ble forkastet 2. august 2026.
  //
  // Navnet står i SUBLINE, aldri i headline: display_name kan være 40 tegn og
  // ville sprengt headline-høyden. Sublinen bryter pent.
  rival_intro: [
    { headline: 'Du har noen å slå.', subline: '{rivalName} er ferdig.', priority: true },
    { headline: 'Én har levert allerede.', subline: 'Det er {rivalName}.', priority: true },
    { headline: 'Du er ikke alene om dette.', subline: '{rivalName} har spilt ferdig.' },
    { headline: 'Noen har satt et tall.', subline: '{rivalName} har fullført.' },
    { headline: 'Det er et mål å slå her.', subline: null },
  ],

  // Default når ingen annen gren treffer. Må være sanne i enhver tilstand.
  generic: [
    { headline: 'Det er kunnskapen som teller.', subline: null, priority: true },
    { headline: 'Her teller det å vite.', subline: null, priority: true },
    { headline: 'Du er i gang.', subline: null },
    { headline: 'Fortsett.', subline: null },
    { headline: 'Hold det gående.', subline: null },
    { headline: 'Én om gangen.', subline: null },
    { headline: 'Tenk deg om.', subline: null },
    { headline: 'Ro i rekkene.', subline: null },
    { headline: 'Neste spørsmål venter.', subline: null },
    { headline: 'Du har tid.', subline: null },
    { headline: 'Mye kan fortsatt skje.', subline: null },
    { headline: 'Ta det som det kommer.', subline: null },
    { headline: 'Kjør på.', subline: null },
    { headline: 'Hold fokus.', subline: null },
    { headline: 'Det er lov å tenke.', subline: null },
    { headline: 'Ingen hast her.', subline: null },
    { headline: 'Videre.', subline: null },
  ],
}

// ── KATEGORITEKSTER ──────────────────────────────────────────────────────────
// Én liste per kategori, med kategorinavnet SKREVET INN i teksten i stedet for
// en {category}-plassholder. Det gir to ting:
//   1. Teksten kan formuleres naturlig per fag («Du har hørt etter» for Musikk),
//      ikke bare «Sterk i X».
//   2. Ingen lange navn å bryte. «Du kan Vitenskap & Natur, du.» gikk på tre
//      linjer på 320px og dyttet blokken under seg 33px ned.
//
// NØKLENE er kategorinavnet i lowercase, og må matche `questions.category` i
// databasen. Oppslaget i selectQuizMessage trimmer og lowercaser, så casing i
// admin spiller ingen rolle — men stavemåten gjør det («&», ikke «og»).
// Bekreftet mot prod 2. august 2026 (199 spørsmål):
//   Diverse 34 · Geografi 33 · Vitenskap & Natur 27 · Musikk 23 · Sport 21
//   Film & TV 19 · Historie 12 · Mat & Drikke 11 · Politikk & Samfunn 9
//   Kunst & Kultur 6 · uten kategori 4
//
// «Diverse» står bevisst IKKE her: det er en sekkepost, ikke en ferdighet, og
// «Du kan Diverse, du» er meningsløst. Den filtreres allerede bort i
// computeStrongCategory (CATEGORY_MESSAGE_EXCLUDED) og når aldri hit.
//
// En kategori som mangler her faller tilbake på quizMessages.category over —
// ingenting krasjer om admin legger til en ny kategori.
export const categoryMessages: Record<string, QuizMessage[]> = {
  musikk: [
    { headline: 'Du har hørt etter.', subline: null },
    { headline: 'Musikken sitter.', subline: null },
    { headline: 'Du kjenner låtene dine.', subline: null },
    { headline: 'Du har øre for musikk.', subline: null },
    { headline: 'Platesamlingen har vært til nytte.', subline: null },
  ],

  sport: [
    { headline: 'Du følger med på sport, ja.', subline: null },
    { headline: 'Sport er tydeligvis din greie.', subline: null },
    { headline: 'Der satt sportskunnskapen.', subline: null },
    { headline: 'Du har oversikten.', subline: 'Lag og resultater sitter.' },
    { headline: 'Du har fulgt med på sendingene.', subline: null },
  ],

  historie: [
    { headline: 'Du kan historie, du.', subline: null },
    { headline: 'Historien sitter tydeligvis.', subline: null },
    { headline: 'Der var det peiling på historie.', subline: null },
    { headline: 'Du har lest deg opp.', subline: null },
    { headline: 'Fortiden har du kontroll på.', subline: null },
  ],

  geografi: [
    { headline: 'Du vet hvor ting ligger.', subline: null },
    { headline: 'Geografien sitter.', subline: null },
    { headline: 'Du har kartet i hodet.', subline: null },
    { headline: 'Du har reist eller lest godt.', subline: 'Kanskje begge deler.' },
    { headline: 'Ingen problemer med geografi her.', subline: null },
  ],

  'film & tv': [
    { headline: 'Du har sett en del film, du.', subline: null },
    { headline: 'Der satt filmkunnskapen.', subline: null },
    { headline: 'Du kjenner rollelistene.', subline: null },
    { headline: 'TV-kveldene har lønt seg.', subline: null },
    { headline: 'Du har god oversikt.', subline: 'Både film og TV.' },
  ],

  'mat & drikke': [
    { headline: 'Du kan mat og drikke.', subline: null },
    { headline: 'Du har vært på kjøkkenet.', subline: null },
    { headline: 'Der satt matkunnskapen.', subline: null },
    { headline: 'Du vet hva du snakker om.', subline: 'På kjøkkenet, i hvert fall.' },
    { headline: 'Kontroll på kjøkken og glass.', subline: null },
  ],

  'vitenskap & natur': [
    { headline: 'Du kan dette.', subline: null },
    { headline: 'Realfagene sitter.', subline: null },
    { headline: 'Du har fulgt med.', subline: 'Både i timen og ute.' },
    { headline: 'Naturen og realfagene sitter.', subline: null },
    { headline: 'Du husker mer enn de fleste.', subline: null },
  ],

  'kunst & kultur': [
    { headline: 'Du kan kultur.', subline: null },
    { headline: 'Du har sans for kunst og kultur.', subline: null },
    { headline: 'Museumsbesøkene har lønt seg.', subline: null },
    { headline: 'Du følger med på kulturfeltet.', subline: null },
    { headline: 'Kulturhistorien sitter.', subline: null },
  ],

  'politikk & samfunn': [
    { headline: 'Du følger med på nyhetene.', subline: null },
    { headline: 'Samfunnskunnskapen sitter.', subline: null },
    { headline: 'Du leser avisa.', subline: null },
    { headline: 'Du har oversikt.', subline: null },
    { headline: 'Du har kontroll.', subline: 'Både på sakene og systemet.' },
  ],
}
