import { escapeHtml } from './html-escape'
import type { BillingInterval } from './billing-interval'

// ── Brukerstyrt tekst i malene ───────────────────────────────────────────────
// Alt som interpoleres inn i disse template-strengene blir markup. Flere av
// verdiene er brukerstyrte (org-navn, avsendernavn, spillernavn), så de kjøres
// gjennom escapeHtml() HER, i selve malen — ikke hos kalleren. Da kan ingen
// framtidig kaller glemme det.
//
// URL-er vi bygger selv (invitasjons- og avmeldingslenker) escapes bevisst
// ikke: de er allerede validert/signert server-side, og `&` mellom
// query-parametere skal stå urørt.

const UNSUBSCRIBE_ROW = `
          <tr>
            <td align="center" style="padding-top:12px;">
              <p style="margin:0;font-size:11px;color:#918f8a;line-height:1.7;text-align:center;">
                Ønsker du ikke flere e-poster? <a href="https://quizkanonen.no/profil" style="color:#918f8a;text-decoration:underline;">Meld deg av her.</a>
              </p>
            </td>
          </tr>`

function unsubscribeRow(url: string): string {
  return `
          <tr>
            <td align="center" style="padding-top:12px;">
              <p style="margin:0;font-size:11px;color:#918f8a;line-height:1.7;text-align:center;">
                <a href="${url}" style="color:#918f8a;text-decoration:underline;">Avslutt abonnement på denne typen e-post</a>
              </p>
            </td>
          </tr>`
}

function formatNorwegianDate(isoString: string): string {
  const date = new Date(isoString)
  const TZ = 'Europe/Oslo'
  // All locale parts are resolved in the Norwegian timezone so Vercel's UTC
  // clock does not cause the time to appear 1–2 hours early in emails.
  const weekday = date.toLocaleString('no-NO', { timeZone: TZ, weekday: 'long' })
  const day     = date.toLocaleString('no-NO', { timeZone: TZ, day: 'numeric' })
  const month   = date.toLocaleString('no-NO', { timeZone: TZ, month: 'long' })
  const time    = date.toLocaleString('no-NO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  return `${weekday} ${day}. ${month} kl. ${time}`
}

export function trialEndingEmail(daysLeft: number): string {
  const dayWord = daysLeft === 1 ? 'dag' : 'dager'

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${daysLeft} ${dayWord} igjen av prøveperioden</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                ${daysLeft} ${dayWord} igjen av prøveperioden
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Din gratis prøveperiode på Quizkanonen utløper om <strong style="color:#ffffff;">${daysLeft} ${dayWord}</strong>.
              </p>
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#918f8a;">
                Du mister tilgangen til
              </p>

              <!-- Feature list -->
              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:6px 0;font-size:15px;color:#e0e0e0;">📊&nbsp; Quizhistorikk og score-utvikling</td></tr>
                <tr><td style="padding:6px 0;font-size:15px;color:#e0e0e0;">🏆&nbsp; Detaljert statistikk og beste streak</td></tr>
                <tr><td style="padding:6px 0;font-size:15px;color:#e0e0e0;">🔒&nbsp; Private ligaer med venner og kolleger</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Trialen utløper uten automatisk trekk.<br />
                Velger du Premium etterpå, koster det kr 49/mnd eller kr 399/år — du velger selv.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Fortsett med Premium
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er registrert på Quizkanonen.<br />
                Spørsmål? Svar på denne e-posten.
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// Sendes til den som nettopp ble MEDLEM av en bedrift (eneste kaller er
// /api/org/welcome-email, som fyres av /bli-med/[token] etter en fullført
// innmelding). Mottakeren er altså en ansatt, ikke administratoren:
// administratoren får orgPurchaseEmail eller orgTrialEmail i stedet.
//
// Derfor nevner denne malen bevisst IKKE bedriftspanelet, invitasjon av
// kolleger eller prøveperioden — det er administratorens oppgaver og
// betalingsforhold, og en ansatt har ikke tilgang til /org/[slug]/admin i det
// hele tatt. Én handling: spill ukens quiz.
export function orgWelcomeEmail(firstNameRaw: string, orgNameRaw: string): string {
  const firstName = escapeHtml(firstNameRaw)
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Velkommen til Quizkanonen!</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Hei ${firstName},
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Velkommen inn i <strong style="color:#ffffff;">${orgName}</strong> på Quizkanonen.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Quizkanonen er en quiz du spiller sammen med kollegene dine. Ny quiz hver fredag — du konkurrerer mot resten av ${orgName} på bedriftens egen toppliste, og følger din egen utvikling fra uke til uke.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Premium er inkludert for deg som medlem, så du ser nøyaktig plassering, historikk og statistikk fra første quiz.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Spill ukens quiz &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vil du bli minnet på det hver fredag? Skru på påminnelser under
                <a href="https://www.quizkanonen.no/profil" style="color:#e8e4dd;text-decoration:underline;">Profil</a>.
              </p>

              <p style="margin:0;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Spørsmål? Bare svar på denne e-posten.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                — Dennis, Quizkanonen
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function welcomeFreeEmail(firstNameRaw: string): string {
  const firstName = escapeHtml(firstNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Velkommen til Quizkanonen!</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Hei ${firstName},
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Velkommen til Quizkanonen! Du er nå logget inn og klar til å spille.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Som innlogget spiller du under ditt eget navn fra uke til uke, og kan utfordre andre til en H2H-duell — helt gratis.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Spill ukens quiz &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Premium-nevnelse. Ingen dagtall/sluttdato her: e-posten leses lenge
                   etter at den ble sendt, og prøveperiodens lengde er en innstilling. -->
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Nysgjerrig på mer? Med Premium får du nøyaktig plassering, historikk, statistikk,
                private ligaer og sesongtoppliste. Du kan
                <a href="https://www.quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">prøve gratis</a>
                — ingen kortinfo nødvendig.
              </p>

              <p style="margin:0;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Spørsmål? Bare svar på denne e-posten.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                — Dennis, Quizkanonen
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgRemovedEmail(orgNameRaw: string, graceUntil?: string | null): string {
  const orgName = escapeHtml(orgNameRaw)
  const premiumBlock = graceUntil
    ? `<p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Hadde du Premium gjennom bedriften, beholder du tilgangen i 7 dager — frem til ${formatNorwegianDate(graceUntil)}.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vil du fortsette med Premium etter det? Tegn ditt eget abonnement på
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a> — fra kr 49/mnd, fornyes automatisk til du selv avslutter.
              </p>`
    : `<p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Hvis du hadde Premium gjennom bedriften, har du nå mistet denne tilgangen.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Ønsker du å fortsette med Premium?
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a><br />
                Premium fornyes automatisk til du selv avslutter.
              </p>`
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Du er fjernet fra ${orgName} på Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Du er fjernet fra ${orgName}
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Din personlige profil, sesong-poeng og quizhistorikk er intakt.
              </p>
              ${premiumBlock}

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Se Premium
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er registrert på Quizkanonen.<br />
                Spørsmål? Svar på denne e-posten.
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Til ANSATTE (ikke admin) når bedriftens org låses — trial som løper ut,
 * kansellering, past_due eller unpaid. Admin får `orgCancelledEmail`; denne
 * er den ansattes versjon av samme hendelse.
 *
 * Formuleringen er bevisst NØYTRAL om årsaken: webhooken kan ikke skille
 * «prøveperioden er over» fra «abonnementet er sagt opp» fra «kortet ble
 * avvist» på en måte som holder i alle tilfeller, og en ansatt skal ikke få
 * feil forklaring på arbeidsgiverens vegne. Premium-setningen er betinget
 * («hadde du»), fordi et medlem kan ha egen dekning via verdikode eller eget
 * abonnement som overlever låsingen.
 *
 * `graceUntil` (29. juli 2026): ved en UFRIVILLIG lås — utløpt trial eller
 * avvist kort — beholder de ansatte Premium i 7 dager, og da er «du har nå
 * mistet den tilgangen» rett og slett usant. Samme mønster som
 * `orgRemovedEmail`, som har tatt en valgfri grace-dato siden før. Er den null,
 * er teksten uendret fra før — det er den bevisste oppsigelsen, der tilgangen
 * faktisk forsvant i samme øyeblikk.
 */
export function orgAccessEndedEmail(orgNameRaw: string, graceUntil?: string | null): string {
  const orgName = escapeHtml(orgNameRaw)
  const title = graceUntil
    ? `Tilgangen gjennom ${orgName} avsluttes snart`
    : `Tilgangen gjennom ${orgName} er avsluttet`
  const premiumBlock = graceUntil
    ? `<p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                <strong style="color:#ffffff;">${orgName}</strong> sin avtale med Quizkanonen er ikke lenger aktiv.
                Hadde du Premium gjennom bedriften, beholder du den frem til ${formatNorwegianDate(graceUntil)}.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Ordner bedriften opp i mellomtiden, fortsetter alt som f&oslash;r &mdash; da trenger du ikke gj&oslash;re noe.
              </p>`
    : `<p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                <strong style="color:#ffffff;">${orgName}</strong> sin avtale med Quizkanonen er ikke lenger aktiv.
                Hadde du Premium gjennom bedriften, har du n&aring; mistet den tilgangen.
              </p>`
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                ${title}
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              ${premiumBlock}
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Din personlige profil, quizhistorikk og sesong-poeng er intakt, og du kan
                fortsatt spille ukens quiz som vanlig.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vil du beholde Premium p&aring; egen h&aring;nd? Tegn ditt eget abonnement p&aring;
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a>
                &mdash; fra kr 49/mnd, fornyes automatisk til du selv avslutter.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Se Premium
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Sp&oslash;rsm&aring;l om selve avtalen? Ta kontakt med den som administrerer Quizkanonen hos dere.<br />
                Sp&oslash;rsm&aring;l ellers? Svar p&aring; denne e-posten.
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Påminnelse til ANSATTE et par dager før lås-grace utløper (29. juli 2026).
 *
 * Sendes kun i de to ufrivillige tilfellene — en bevisst oppsigelse gir ingen
 * grace, og dermed heller ingen påminnelse. Poenget er å gi den ansatte et
 * reelt valg før tilgangen forsvinner, ikke å mase på arbeidsgiveren deres:
 * derfor peker den på eget abonnement, ikke på «purre administratoren».
 */
export function orgGraceReminderEmail(orgNameRaw: string, graceUntil: string): string {
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Premium gjennom ${orgName} utløper snart — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Premium-tilgangen din utl&oslash;per snart
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Avtalen <strong style="color:#ffffff;">${orgName}</strong> hadde med Quizkanonen er ikke lenger aktiv.
                Vi lot Premium-tilgangen din st&aring; en stund til, men den utl&oslash;per
                ${formatNorwegianDate(graceUntil)}.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Ordner bedriften opp f&oslash;r det, fortsetter alt som f&oslash;r og du trenger ikke gj&oslash;re noe.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vil du beholde Premium uansett? Tegn ditt eget abonnement &mdash; fra kr 49/mnd,
                fornyes automatisk til du selv avslutter. Profil, historikk og sesong-poeng
                f&oslash;lger deg uansett hva du velger.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Se Premium
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Sp&oslash;rsm&aring;l om selve avtalen? Ta kontakt med den som administrerer Quizkanonen hos dere.<br />
                Sp&oslash;rsm&aring;l ellers? Svar p&aring; denne e-posten.
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Admin-versjonen av den samme påminnelsen.
 *
 * BEVISST IKKE en dublett av lås-e-posten: `orgAccessLockedEmail` /
 * `orgCancelledEmail` gikk ut i det øyeblikket orgen ble låst og handlet om at
 * betalingen stoppet. Denne handler om noe admin ikke er fortalt før — at de
 * ansatte har hatt tilgangen i mellomtiden, og nøyaktig når den forsvinner.
 * Det er det siste punktet der admin faktisk kan rekke å gjøre noe.
 */
export function orgGraceReminderAdminEmail(orgNameRaw: string, orgSlug: string, graceUntil: string): string {
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>De ansatte mister Premium snart — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                De ansatte mister Premium ${formatNorwegianDate(graceUntil)}
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Bedriftstilgangen for <strong style="color:#ffffff;">${orgName}</strong> ble satt p&aring; pause,
                men vi lot de ansatte beholde Premium en stund til. Den perioden er snart over.
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; De ansatte har hatt full tilgang hele tiden</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; Alle profiler, historikk og sesong-poeng er intakt uansett</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; Ordner betalingen seg f&oslash;r fristen, merker ingen noe som helst</td></tr>
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no/org/${orgSlug}/admin"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      G&aring; til bedriftssiden
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Stemmer ikke dette? Svar p&aring; denne e-posten, s&aring; ser vi p&aring; det.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// Premium fra verdikode med begrenset varighet har løpt ut.
// Samme oppsett som gracePeriodEndedEmail, men uten bedrifts-formuleringen —
// disse brukerne fikk tilgang via en kode, ikke gjennom en arbeidsgiver.
export function codePremiumEndedEmail(): string {
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Premium-tilgangen din er avsluttet</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Premium-tilgangen din er avsluttet
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Premium-perioden du fikk gjennom en verdikode er nå over. Profilen din, sesong-poengene og quizhistorikken er fortsatt intakt.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vil du beholde Premium? Tegn ditt eget abonnement på
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a> — fra kr 49/mnd.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Se Premium
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er registrert på Quizkanonen.<br />
                Spørsmål? Svar på denne e-posten.
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function gracePeriodEndedEmail(): string {
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Premium-tilgangen din er avsluttet</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Premium-tilgangen din er avsluttet
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Den midlertidige Premium-tilgangen du hadde gjennom en bedrift er nå avsluttet. Profilen din, sesong-poengene og quizhistorikken er fortsatt intakt.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vil du beholde Premium? Tegn ditt eget abonnement på
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a> — fra kr 49/mnd.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Se Premium
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er registrert på Quizkanonen.<br />
                Spørsmål? Svar på denne e-posten.
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgInviteEmail(senderNameRaw: string, orgNameRaw: string, inviteUrl: string): string {
  const senderName = escapeHtml(senderNameRaw)
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${senderName} inviterer deg til Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Du er invitert
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                <strong style="color:#ffffff;">${senderName}</strong> har invitert deg til å bli med i
                <strong style="color:#ffffff;">${orgName}</strong> på Quizkanonen.
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Quizkanonen er en ukentlig fredagsquiz der du konkurrerer mot kollegene dine
                og følger din egen utvikling over tid. Alle deltakere får Premium-tilgang inkludert.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="${inviteUrl}"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Bli med nå &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi ${senderName} inviterte deg.
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Til B2C-kunden når et kortrekk feiler.
 *
 * ARBEIDSDELINGEN MED STRIPE (17. august 2026): Stripes egen
 * betalingsfeil-e-post er slått på og dekker pengesiden — beløp, korttype,
 * siste fire og en knapp til Stripes hostede kortoppdatering. Det skal vi ikke
 * gjenta. Det eneste Stripe ikke vet noe om, er TILGANGEN: at Premium beholdes
 * mens de prøver på nytt, hvor lenge, og hva som skjer når fristen går ut.
 * Det er derfor denne e-posten finnes, og det er alt den skal si.
 *
 * `graceUntilIso` er slutten på karensperioden (lib/personal-grace.ts). Kjenner
 * vi den ikke — grace-skrivingen feilet, eller abonnementet er ikke i dunning —
 * faller teksten tilbake til en formulering uten dato. Aldri et gjettet dagtall:
 * det ville blitt usant i nøyaktig det tilfellet der karensen ikke ble gitt, og
 * da ville vi lovet en tilgang brukeren ikke har.
 */
export function paymentFailedEmail(graceUntilIso?: string | null): string {
  const graceDate = graceUntilIso ? new Date(graceUntilIso) : null
  const hasDate = !!graceDate && !isNaN(graceDate.getTime())
  const graceText = hasDate
    ? `Du beholder Premium-tilgangen din til <strong style="color:#ffffff;">${
        graceDate!.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })
      }</strong> mens vi prøver å trekke på nytt. Går betalingen gjennom før det, skjer ingenting — tilgangen fortsetter som før.`
    : 'Du beholder Premium-tilgangen din mens vi prøver å trekke på nytt. Går betalingen gjennom, skjer ingenting — tilgangen fortsetter som før.'
  // Uten dato finnes det ingen «frist» å vise til, og da skal teksten heller
  // ikke late som om den nettopp har nevnt en.
  const consequenceText = hasDate
    ? 'Ordner det seg ikke innen fristen, avsluttes abonnementet og du mister Premium.'
    : 'Ordner det seg ikke, avsluttes abonnementet og du mister Premium.'

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Betalingen feilet — Quizkanonen Premium</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Betalingen feilet
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Vi klarte ikke å trekke betaling for Premium-abonnementet ditt.
                Det skjer som regel fordi kortet er utløpt eller sperret.
              </p>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${graceText}
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${consequenceText} Historikk, poeng og profil beholder du
                uansett — og du kan starte igjen når du vil.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/profil"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Oppdater betalingskortet &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// Kortløs Founders-konvertering: trialen er over uten at bruker la inn kort.
// Vennlig, ikke-alarmerende tone — ingen «betalingen feilet», siden brukeren aldri
// ble bedt om å betale. Speiler paymentFailedEmail sin struktur.
export function trialEndedNoCardEmail(): string {
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prøveperioden din er over — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Prøveperioden din er over
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Den gratis prøveperioden din er nå ferdig. Du la aldri inn kort, så du er ikke
                blitt trukket for noe — og det skjer ikke automatisk heller.
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Vil du beholde nøyaktig plassering, historikk, private ligaer og sesong-leaderboard,
                kan du fortsette med Premium for kr 49/mnd — eller kr 399/år. Ønsker du ikke det, trenger du ikke gjøre noe.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Fortsett med Premium &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgPaymentFailedEmail(orgNameRaw: string, orgSlug: string): string {
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Betalingen feilet — Quizkanonen for bedrifter</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Betalingen feilet
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Vi klarte ikke å trekke betaling for <strong style="color:#ffffff;">${orgName}</strong>s abonnement.
                Abonnementet kan bli avsluttet hvis betalingen ikke ordnes.
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Oppdater betalingsinformasjonen i bedriftspanelet for å beholde tilgangen for alle ansatte.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/org/${orgSlug}/admin"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Gå til bedriftspanelet &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Bekreftelse på at en gratis prøveperiode er startet.
 *
 * Erstatter foundersWelcomeEmail som aktiveringsmal (12. august 2026). Den
 * gamle het «Founders Access aktivert» og åpnet med «Du er blant de første.
 * Det betyr noe.» — sant for Founders-kohorten våren 2026, men Founders ble
 * avviklet som brukersynlig inngang i 526b9dc. Hver ny bruker fikk dermed en
 * bekreftelse som viste til et program som ikke finnes lenger.
 *
 * LENGDEN SKRIVES ALDRI HARDKODET. To kilder, i prioritert rekkefølge:
 *   1. `trialEnd` — abonnementets faktiske `trial_end` fra Stripe. Den
 *      sterkeste kilden: en dato brukeren kan holde oss til, og den kan ikke
 *      drifte fra det som faktisk er opprettet.
 *
 *   2. `trialDays` — `site_settings.founders_new_trial_days`, samme verdi
 *      ruten brukte da den opprettet abonnementet, og samme verdi flatene i
 *      appen viser (se lib/trial-offer.ts).
 * Mangler begge, står det «i prøveperioden». Et gjettet tall her ville blitt
 * usant i samme øyeblikk lengden endres — nøyaktig grunnen til at verken
 * founders-activate eller decideTrialOffer har en innebygd fallback.
 *
 * KLOKKESLETTET ER MED, OG DET ER IKKE PYNT. Målt mot live-kontoen 12. august
 * 2026: `trial_period_days` gir `trial_end = trial_start + N×24t` på sekundet
 * (sub_1U0PNI: start 17:10:04 → slutt 17:10:04 fjorten dager etter). Stripe
 * runder IKKE av til døgnslutt. De eldre abonnementene som alle slutter
 * 21:59 UTC er kampanjen med fast sluttdato, opprettet med et eksplisitt
 * `trial_end` — en annen mekanikk enn den denne ruten bruker.
 *
 * «Til og med 26. august» ville derfor lovet et helt døgn brukeren ikke har.
 * Konkret utslag: aktiverer man kl. 09:00, er Premium borte kl. 09:00 på
 * dag 14 — før fredagsquizen åpner kl. 12:00. Klokkeslettet er forskjellen
 * på en riktig og en gal forventning den dagen.
 *
 * Formateringen er eksplisitt Europe/Oslo. `trial_end` er et UTC-instant, og
 * Vercel kjører i UTC: uten tidssone ville en prøveperiode som slutter
 * 26. august 22:30 UTC blitt skrevet som «26. august», mens den i Norge
 * slutter 27. august kl. 00:30. lib/oslo-time.ts brukes bevisst ikke — den
 * går motsatt vei (norsk veggklokke → UTC-instant), mens vi her har
 * instantet og skal vise det. `Intl` med `timeZone` er det direkte svaret.
 *
 * Ingen brukerstyrte felt, så ingenting å escape her. Kommer det en gang et
 * navn inn, skal det følge husmønsteret: ta parameteren som `xRaw` og lag en
 * escapet lokal variabel øverst.
 */
export function trialWelcomeEmail(trialEnd?: number | null, trialDays?: number | null): string {
  const sluttTidspunkt = trialEnd
    ? (() => {
      const d = new Date(trialEnd * 1000)
      const dato = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(d)
      const klokke = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }).format(d)
      return `${dato} kl. ${klokke}`
    })()
    : null
  const dager = Number.isInteger(trialDays) && (trialDays as number) > 0 ? trialDays as number : null

  // «fram til», ikke «til og med»: sluttpunktet er et klokkeslett midt i
  // døgnet, ikke døgnslutt. Se kommentaren over.
  const lengdeLinje = sluttTidspunkt && dager
    ? `Du har full tilgang til Premium i ${dager} dager — fram til ${sluttTidspunkt}.`
    : sluttTidspunkt
      ? `Du har full tilgang til Premium fram til ${sluttTidspunkt}.`
      : dager
        ? `Du har full tilgang til Premium i ${dager} dager.`
        : 'Du har full tilgang til Premium i prøveperioden.'

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prøveperioden din er i gang — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Prøveperioden din er i gang
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${lengdeLinje} Du har ikke lagt inn kortinformasjon, og det trengs ikke.
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Nøyaktig plassering på topplisten</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Quizhistorikk og statistikk</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Private ligaer</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Sesong-leaderboard</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Prøveperioden går ut av seg selv, og du blir ikke trukket for noe. Vil du
                fortsette etterpå, koster Premium kr 49 i måneden, eller kr 399 for et helt år &mdash;
                <a href="https://www.quizkanonen.no/premium" style="color:#c9a84c;text-decoration:none;">quizkanonen.no/premium</a>
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <!-- CTA-en pekte tidligere på /toppliste med teksten «Se
                         plasseringen din» — men en fersk prøvebruker HAR ingen
                         plassering ennå, så løftet var usant i nøyaktig det
                         øyeblikket e-posten leses. Forsiden er alltid sann:
                         den viser åpen quiz om det er en, ellers nedtellingen
                         til fredag. -->
                    <a href="https://www.quizkanonen.no/"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Kom i gang &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// BEHOLDT, men ikke lenger i bruk fra noen kodesti (12. august 2026):
// aktiveringsruten sender trialWelcomeEmail over. Malen står igjen fordi
// Founders-kohorten fortsatt refererer til den i historikk og support-saker.
export function foundersWelcomeEmail(trialEnd?: number | null): string {
  // Vis konkret sluttdato basert på abonnementets faktiske trial_end (Unix-sekunder).
  // Kjenner vi den ikke, sier vi «i prøveperioden» — aldri et gjettet dagtall, som
  // ville blitt usant så snart lengden på prøveperioden endres.
  const accessLine = trialEnd
    ? `Du er blant de første. Det betyr noe. Full tilgang gratis til ${new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date(trialEnd * 1000))} — ingen kortinfo, ingen forpliktelse. Bare spill.`
    : 'Du er blant de første. Det betyr noe. Full tilgang gratis i prøveperioden — ingen kortinfo, ingen forpliktelse. Bare spill.'
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Founders Access aktivert — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Founders Access aktivert
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${accessLine}
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Nøyaktig plassering på topplisten</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Quizhistorikk og statistikk</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Private ligaer</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Sesong-leaderboard</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Trialen utløper uten automatisk trekk — du velger selv om du vil fortsette.
                Hvis du vil fortsette etter trialen: <a href="https://www.quizkanonen.no/premium" style="color:#c9a84c;text-decoration:none;">quizkanonen.no/premium</a>
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/toppliste"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Utforsk Premium &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgPurchaseEmail(orgNameRaw: string, orgSlug: string): string {
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Velkommen til Quizkanonen for bedrifter — ${orgName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Velkommen til Quizkanonen
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                <strong style="color:#ffffff;">${orgName}</strong> er nå opprettet og klar til bruk.
              </p>

              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#918f8a;">
                Neste steg
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Gå til bedriftspanelet og kopier invitasjonslenken</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Del lenken med ansatte — de får Premium-tilgang så snart de godtar</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Abonnementet fornyes automatisk hver måned til du selv avslutter</td></tr>
              </table>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/org/${orgSlug}/admin"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Gå til bedriftspanelet &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function formatTrialEndDate(isoString: string): string {
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return 'prøveperioden'
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })
}

export function orgTrialEmail(orgNameRaw: string, orgSlug: string, trialEndIso: string): string {
  const orgName = escapeHtml(orgNameRaw)
  const endDate = formatTrialEndDate(trialEndIso)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prøveperioden er i gang — ${orgName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Prøveperioden er i gang
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                <strong style="color:#ffffff;">${orgName}</strong> har nå full tilgang til Quizkanonen for bedrifter — helt gratis, uten at du har lagt inn betalingskort.
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;">
                <tr>
                  <td style="background:#1a1c23;border:1px solid #2a2d38;border-radius:12px;padding:14px 18px;">
                    <span style="font-size:12px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:#918f8a;">
                      Prøveperioden varer til
                    </span><br />
                    <span style="font-size:16px;font-weight:600;color:#ffffff;margin-top:4px;display:inline-block;">
                      ${endDate}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#918f8a;">
                Slik kommer du i gang
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Gå til bedriftspanelet og kopier invitasjonslenken</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Del lenken med ansatte — de blir med på fredagsquizen</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; For å fortsette etter prøveperioden, legg inn betaling i bedriftspanelet</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:14px;color:#e0e0e0;line-height:1.7;">
                Vi trekker deg ikke automatisk. Når prøveperioden er over sperres bedriftssidene til du selv velger å fortsette med betaling — ingenting går tapt i mellomtiden.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/org/${orgSlug}/admin"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Gå til bedriftspanelet &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgTrialEndingEmail(orgNameRaw: string, orgSlug: string, trialEndIso: string): string {
  const orgName = escapeHtml(orgNameRaw)
  const endDate = formatTrialEndDate(trialEndIso)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prøveperioden er snart over — ${orgName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Prøveperioden er snart over
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Prøveperioden for <strong style="color:#ffffff;">${orgName}</strong> utløper <strong style="color:#ffffff;">${endDate}</strong>.
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Vil dere fortsette? Legg inn betaling i bedriftspanelet, så går abonnementet sømløst videre. Gjør dere ingenting, sperres bedriftssidene til betaling er på plass — ansattes profiler, historikk og poeng består.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/org/${orgSlug}/admin"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Legg inn betaling &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er administrator for ${orgName} på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgCancelledEmail(orgNameRaw: string): string {
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bedriftsabonnementet er avsluttet — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Bedriftsabonnementet er avsluttet
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Abonnementet for <strong style="color:#ffffff;">${orgName}</strong> er nå avsluttet.
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Alle ansatte har mistet Premium-tilgang</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Ansatte beholder sin personlige profil, historikk og sesong-poeng</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Ingen automatiske trekk fremover</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Ønsker dere å fortsette? Abonnementet kan reaktiveres når som helst.
              </p>

              <!-- Diskret lenke -->
              <p style="margin:0;font-size:14px;color:#e0e0e0;">
                <a href="https://www.quizkanonen.no/bedrift"
                   style="color:#e0e0e0;text-decoration:underline;">
                  Start nytt bedriftsabonnement &rarr;
                </a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Til ORG-ADMIN når en PRØVEPERIODE løper ut uten at kort er lagt inn
 * (29. juli 2026).
 *
 * Bevisst IKKE `orgCancelledEmail`. Den sier «Bedriftsabonnementet er
 * avsluttet» — og for en trial som bare rant ut er hvert ord feil: det fantes
 * aldri et abonnement, ingen har avsluttet noe, og ingen har betalt en krone.
 * Admin fikk altså en oppsigelsesbekreftelse for noe de aldri kjøpte, uten å
 * bli fortalt det ene som faktisk gjaldt: at det er kortet som mangler.
 *
 * Skillet er mulig fordi grace-arbeidet klassifiserer årsaken —
 * `member_grace_reason = 'trial_expired'`, se decideLockGrace() i
 * lib/org-lock-grace.ts. Reelle kanselleringer og betalingsfeil beholder
 * teksten de har i dag.
 *
 * Søsteren `orgTrialEndingEmail` varsler FØR utløpet («snart over»); denne
 * kommer etter («er over»), og forskjellen på de to er at tilgangen nå
 * faktisk er sperret.
 */
export function orgTrialEndedEmail(orgNameRaw: string, orgSlug: string): string {
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prøveperioden for ${orgName} er over — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Pr&oslash;veperioden for ${orgName} er over
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vi fikk aldri registrert et betalingskort, s&aring; bedriftssidene er n&aring;
                sperret. Det er alt som har skjedd &mdash; ingenting er sagt opp, og
                ingenting er slettet.
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; Alle profiler, historikk og sesong-poeng best&aring;r</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; De ansatte kan fortsatt spille ukens quiz som vanlig</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; Legger du inn betaling, er alt tilbake med &eacute;n gang</td></tr>
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no/org/${orgSlug}/admin"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Legg inn betaling &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er administrator for ${orgName} p&aring; Quizkanonen.<br />
                Sp&oslash;rsm&aring;l? Svar p&aring; denne e-posten.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Til ORG-ADMIN når orgen låses fra `subscription.updated` — altså
 * `past_due` eller `unpaid`, der Stripe fortsatt driver innkreving.
 *
 * Bevisst IKKE `orgCancelledEmail`: den sier «avsluttet», «ingen
 * automatiske trekk fremover» og «kan reaktiveres», og alle tre er feil
 * her — abonnementet lever, det er nettopp trekket som ikke gikk gjennom.
 * En kansellering går fortsatt via `subscription.deleted` og får den
 * eksisterende avslutnings-e-posten.
 *
 * Kunden har allerede fått `orgPaymentFailedEmail` fra
 * `invoice.payment_failed`. Det nye her er konsekvensen: de ansatte har
 * mistet tilgangen.
 */
export function orgAccessLockedEmail(orgNameRaw: string, orgSlug: string): string {
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bedriftstilgangen er satt på pause — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Bedriftstilgangen er satt p&aring; pause
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vi har ikke f&aring;tt registrert betalingen for <strong style="color:#ffffff;">${orgName}</strong>,
                og bedriftstilgangen er derfor satt p&aring; pause inntil videre.
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; De ansatte har mistet Premium-tilgangen sin</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; Alle profiler, historikk og sesong-poeng er intakt</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e8e4dd;">&mdash;&nbsp; Tilgangen kommer tilbake av seg selv n&aring;r betalingen g&aring;r gjennom</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Oppdater betalingskortet fra bedriftssiden deres, s&aring; ordner resten seg automatisk.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no/org/${orgSlug}/admin"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      G&aring; til bedriftssiden
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Stemmer ikke dette? Svar p&aring; denne e-posten, s&aring; ser vi p&aring; det.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgRenewalEmail(orgNameRaw: string, orgSlug: string): string {
  const orgName = escapeHtml(orgNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bedriftsabonnementet er fornyet — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Bedriftsabonnementet er fornyet
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Abonnementet for <strong style="color:#ffffff;">${orgName}</strong> er fornyet for en ny måned.
                Alle ansatte har fortsatt tilgang til Premium.
              </p>

              <!-- Diskret lenke -->
              <p style="margin:0;font-size:14px;color:#e0e0e0;">
                <a href="https://www.quizkanonen.no/org/${orgSlug}/admin"
                   style="color:#e0e0e0;text-decoration:underline;">
                  Administrer abonnement &rarr;
                </a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er administrator for ${orgName} på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// `interval` er faktureringsintervallet kunden faktisk kjøpte (fra checkout-
// sesjonens metadata, se lib/billing-interval.ts). null = UKJENT, og da
// skrives setningen som er sann for begge intervallene — aldri «hver måned»
// som standard: det var nøyaktig feilen som sto her fram til 3. september
// 2026, og den traff hver eneste årsabonnent.
export function premiumWelcomeEmail(interval?: BillingInterval | null): string {
  const renewalSentence =
    interval === 'year' ? 'Abonnementet fornyes automatisk hvert år til du selv avslutter.'
    : interval === 'month' ? 'Abonnementet fornyes automatisk hver måned til du selv avslutter.'
    : 'Abonnementet fornyes automatisk til du selv avslutter.'
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Velkommen til Premium — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Velkommen til Premium
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Premium er aktivert. Her er hva du har tilgang til:
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Nøyaktig plassering på topplisten</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Quizhistorikk og statistikk</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Private ligaer med venner og kolleger</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Sesong-leaderboard med din eksakte plass</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${renewalSentence}
                Du administrerer abonnementet fra profilsiden din.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/profil"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Gå til din profil &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du nettopp aktiverte Premium på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// `interval` leses av fakturalinjen i invoice.payment_succeeded (se
// lib/billing-interval.ts). null = UKJENT → «fornyet», uten periode-ord, og
// en reservesetning som er sann for begge intervallene. Se premiumWelcomeEmail.
export function premiumRenewalEmail(nextBillingDate?: string, interval?: BillingInterval | null): string {
  const renewedFor =
    interval === 'year' ? ' for et nytt år'
    : interval === 'month' ? ' for en ny måned'
    : ''
  const noDateSentence =
    interval === 'year' ? 'Abonnementet fornyes automatisk neste år.'
    : interval === 'month' ? 'Abonnementet fornyes automatisk neste måned.'
    : 'Abonnementet fornyes automatisk til du selv avslutter.'
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Abonnementet ditt er fornyet — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Abonnementet er fornyet
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Premium-abonnementet ditt er fornyet${renewedFor}. Du har fortsatt tilgang til alle Premium-funksjoner.
              </p>

              ${nextBillingDate ? `
              <!-- Next billing date -->
              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr>
                  <td style="background:#1a1c23;border:1px solid #2a2d38;border-radius:12px;padding:14px 18px;">
                    <span style="font-size:12px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:#918f8a;">
                      Neste betaling
                    </span><br />
                    <span style="font-size:16px;font-weight:600;color:#ffffff;margin-top:4px;display:inline-block;">
                      ${nextBillingDate}
                    </span>
                  </td>
                </tr>
              </table>
              ` : `<p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">${noDateSentence}</p>`}

              <!-- Diskret lenke -->
              <p style="margin:0;font-size:14px;color:#e0e0e0;">
                <a href="https://www.quizkanonen.no/profil"
                   style="color:#e0e0e0;text-decoration:underline;">
                  Administrer abonnement &rarr;
                </a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du har et aktivt Premium-abonnement på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function premiumCancelledEmail(): string {
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Premium-abonnementet ditt er avsluttet — Quizkanonen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Premium er avsluttet
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Premium-abonnementet ditt er nå avsluttet. Premium-tilgangen gjelder frem til slutten av inneværende periode.
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Du kan fortsatt spille gratis og se din plassering</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Historikk og statistikk er ikke lenger tilgjengelig etter perioden</td></tr>
                <tr><td style="padding:5px 0;font-size:15px;color:#e0e0e0;">&mdash;&nbsp; Ingen automatiske trekk fremover</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Ombestemmer du deg? Du kan reaktivere Premium når som helst.
              </p>

              <!-- Diskret lenke, ikke CTA-knapp -->
              <p style="margin:0;font-size:14px;color:#e0e0e0;">
                <a href="https://www.quizkanonen.no/premium"
                   style="color:#e0e0e0;text-decoration:underline;">
                  Gjenaktiver Premium &rarr;
                </a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du hadde et Premium-abonnement på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function reEngagementEmail(firstNameRaw?: string, unsubscribeUrl?: string): string {
  const greeting = firstNameRaw ? `Hei, ${escapeHtml(firstNameRaw)}!` : 'Hei!'

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vi savner deg — quizen venter</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                ${greeting}
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Vi la merke til at det er en stund siden du spilte sist.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Du mangler fra listen.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Ny quiz åpner fredag kl. 12:00. Kan du ta igjen det du har gått glipp av?
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Spill ukens quiz
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er registrert på Quizkanonen.
              </p>
            </td>
          </tr>
          ${unsubscribeUrl ? unsubscribeRow(unsubscribeUrl) : UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

type WeeklyReportData = {
  orgName: string
  winner: { displayName: string; correct: number; total: number } | null
  top3: Array<{ displayName: string; correct: number; total: number }>
  participantCount: number
  shareText: string
}

export function weeklyReportEmail(data: WeeklyReportData): string {
  const { winner, top3, participantCount, shareText } = data

  // Spillernavnene her kan komme fra attempts.player_name (fritekst ved
  // quiz-start), ikke bare fra den validerte profilen — se lib/weekly-report.ts.
  const orgName = escapeHtml(data.orgName)
  const winnerName = escapeHtml(winner?.displayName)

  const medals = ['🥇', '🥈', '🥉']
  const top3Rows = top3.map((e, i) => `
                <tr>
                  <td style="padding:8px 0;font-size:15px;color:#e0e0e0;border-bottom:${i < top3.length - 1 ? '1px solid #2a2d38' : 'none'};">
                    <span style="display:inline-block;width:28px;">${medals[i] ?? `${i + 1}.`}</span>
                    <strong style="color:#ffffff;">${escapeHtml(e.displayName)}</strong>
                    <span style="color:#c9a84c;float:right;font-weight:600;">${e.correct}/${e.total}</span>
                  </td>
                </tr>`).join('')

  // shareText har emoji og linjeskift — escape markup og bytt \n til <br>.
  const shareHtml = escapeHtml(shareText).replace(/\n/g, '<br />')

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quiz-oppsummering — ${orgName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Quiz-oppsummering
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 20px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${winner
                  ? `Vinneren i <strong style="color:#ffffff;">${orgName}</strong> er <strong style="color:#ffffff;">${winnerName}</strong> med <strong style="color:#c9a84c;">${winner.correct}/${winner.total}</strong> riktige.`
                  : `Siste quiz i <strong style="color:#ffffff;">${orgName}</strong> er avgjort.`}
              </p>

              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#918f8a;">
                Topp 3
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;">
                ${top3Rows}
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                <strong style="color:#ffffff;">${participantCount}</strong> ansatte kjempet om seieren.
              </p>

              <!-- Kopierbar tekstblokk for Teams/Slack -->
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#918f8a;">
                Klar til å dele
              </p>
              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr>
                  <td style="background:#1a1c23;border:1px solid #2a2d38;border-radius:12px;padding:18px 20px;font-size:15px;color:#e0e0e0;line-height:1.8;">
                    ${shareHtml}
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Se quizen &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er administrator for ${orgName} på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#918f8a;">support@quizkanonen.no</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function quizReminderEmail(quizId: string, closesAt?: string | null, quizTitle?: string, unsubscribeUrl?: string): string {
  const titleLine = quizTitle ? `<p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#c9a84c;line-height:1.4;">${escapeHtml(quizTitle)}</p>` : ''
  const closesLine = closesAt
    ? `<p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Du har til <strong style="color:#ffffff;">${formatNorwegianDate(closesAt)}</strong> på deg.
              </p>`
    : ''
  const quizUrl = `https://www.quizkanonen.no/quiz/${quizId}`

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quizen er åpen nå!</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Quizen er åpen nå!
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              ${titleLine}
              <p style="margin:0 0 ${closesAt ? '16' : '28'}px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                En ny quiz på Quizkanonen er nå åpen. Spill med en gang —
                vær rask for best mulig plassering.
              </p>
              ${closesLine}

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="${quizUrl}"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Spill nå &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du har slått på quiz-påminnelser.<br />
                Du kan skru det av under
                <a href="https://www.quizkanonen.no/profil" style="color:#c9a84c;text-decoration:none;">profilen din</a>.
              </p>
            </td>
          </tr>
          ${unsubscribeUrl ? unsubscribeRow(unsubscribeUrl) : UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgCloseReminderEmail(orgNameRaw: string, closesAt: string, quizTitle?: string): string {
  const orgName = escapeHtml(orgNameRaw)
  const timeStr = new Date(closesAt).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
  const titleLine = quizTitle ? `<p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#c9a84c;line-height:1.4;">${escapeHtml(quizTitle)}</p>` : ''

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>En time igjen til fristen!</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                En time igjen!
              </p>
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>
              ${titleLine}
              <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Hei! Fristen for ${orgName} nærmer seg.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Quizen stenger for bedriften din kl. <strong style="color:#c9a84c;">${timeStr}</strong>. Rekker du den?
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#c9a84c;border-radius:10px;padding:13px 32px;text-align:center;">
                    <a href="https://quizkanonen.no" style="font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;white-space:nowrap;">
                      Spill nå →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;color:#918f8a;text-align:center;line-height:1.6;">
                Du mottar denne e-posten fordi du er medlem av ${orgName} på Quizkanonen.<br/>
                <a href="https://quizkanonen.no/profil" style="color:#918f8a;">Endre varslingsinnstillinger</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function duelInviteEmail(challengerNameRaw: string, unsubscribeUrl?: string): string {
  const challengerName = escapeHtml(challengerNameRaw)
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${challengerName} utfordrer deg til en duell!</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Du har en ny duell-utfordring
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                <strong style="color:#ffffff;">${challengerName}</strong> har utfordret deg til en H2H Duell på Quizkanonen denne måneden.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Aksepter eller avslå utfordringen på forsiden din. Duellen teller sesong-poeng gjennom hele måneden — den med flest poeng vinner.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Gå til Quizkanonen
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du er registrert på Quizkanonen.
              </p>
            </td>
          </tr>
          ${unsubscribeUrl ? unsubscribeRow(unsubscribeUrl) : UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Verdikode-aktivering ─────────────────────────────────────────────────────
// To varianter: med og uten pauset abonnement. Den pausede varianten er ikke en
// høflighetsmelding — den er selve beskjeden om at kunden IKKE blir trukket i
// perioden, og at faktureringen starter igjen av seg selv etterpå.

// Engangs-utsendelse til Founders-kohorten formiddag 15. august 2026, mens
// Premium-tilgangen deres fortsatt er aktiv (se /api/admin/founders-farewell).
// Teksten er Dennis' egen, godkjent 12. august — ordrett, ikke et utkast:
//   * Emnet peker FREMOVER («Nå begynner den ordentlige sesongen») — aldri
//     «utløper»/lignende bakoverskuende formuleringer, og det ordet emnet
//     forbyr skal heller ikke forekomme i brødteksten.
//   * Teksten ender på «Vi sees på fredagsquizen.» — ingen takke-setning
//     etter CTA-knappen.
//   * CTA til /premium — ikke /founders, det navnet fases ut.
//   * Ingen kupong eller rabatt — kun tekst.
export function foundersFarewellEmail(firstNameRaw?: string | null): string {
  const firstName = firstNameRaw ? escapeHtml(firstNameRaw.trim().split(/\s+/)[0]) : null
  const greeting = firstName ? `Hei ${firstName},` : 'Hei,'

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nå begynner den ordentlige sesongen</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                N&aring; begynner den ordentlige sesongen
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${greeting}
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Du var en av de f&oslash;rste som ble med da fredagsquizen gikk fra
                Facebook-gruppe til egen plattform. Som Founders-medlem har du hatt
                full Premium-tilgang gratis mens vi bygget den &mdash; og du har
                v&aelig;rt med p&aring; &aring; forme det Quizkanonen har blitt.
                Takk for alle innspill underveis. Plattformen er fortsatt under
                bygging, og tilbakemeldinger er like velkomne fremover &mdash; det
                er s&aring;nn vi f&aring;r bygget en quizplattform vi alle er glade i.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                I dag, <strong style="color:#ffffff;">15. august</strong>, g&aring;r
                Founders-perioden over i vanlig drift. Premium-tilgangen din varer
                dagen ut, og du blir aldri trukket for noe &mdash; du la jo aldri
                inn noe kort.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Fredagsquizen er gratis, akkurat som f&oslash;r. Vil du ha med deg
                alle fordelene fra Premium videre &mdash; n&oslash;yaktig plassering,
                historikk og statistikk, private ligaer og egen plass p&aring;
                sesongtopplisten &mdash; koster det fra 49 kr i m&aring;neden og vil
                bidra til at plattformen kan bli enda bedre i fremtiden.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Fortsett med Premium
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Vi sees p&aring; fredagsquizen.
              </p>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#918f8a;line-height:1.7;">
                Du mottar denne e-posten fordi du har Founders Access p&aring; Quizkanonen.<br />
                Sp&oslash;rsm&aring;l? Svar p&aring; denne e-posten.
              </p>
            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function codeEmailShell(title: string, bodyRows: string): string {
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">
${bodyRows}
              <table cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/profil"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Se profilen din &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
          ${UNSUBSCRIBE_ROW}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function codeHeading(text: string): string {
  return `              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                ${text}
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>`
}

function codePeriodLine(startsAt: string, expiresAt: string | null): string {
  const startsNow = new Date(startsAt).getTime() <= Date.now() + 60_000
  const from = startsNow ? 'fra nå' : `fra ${formatTrialEndDate(startsAt)}`
  const to = expiresAt ? ` til ${formatTrialEndDate(expiresAt)}` : ' på ubestemt tid'
  return `${from}${to}`
}

export function codeActivatedEmail(startsAt: string, expiresAt: string | null): string {
  return codeEmailShell('Premium er aktivert — Quizkanonen', `${codeHeading('Premium er aktivert')}
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Koden er registrert, og du har Premium ${codePeriodLine(startsAt, expiresAt)}.
              </p>
              <p style="margin:0;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Det betyr n&oslash;yaktig plassering p&aring; leaderboardet, full sesong-toppliste,
                historikk og statistikk &mdash; og private ligaer med venner.
              </p>`)
}

export function codeActivatedPausedEmail(
  startsAt: string,
  expiresAt: string | null,
  resumesAt: string | null,
): string {
  const resumeLine = resumesAt
    ? `Abonnementet ditt er satt p&aring; <strong style="color:#ffffff;">pause</strong> i hele denne perioden.
                Du blir <strong style="color:#ffffff;">ikke trukket</strong> for den, og vanlig fakturering
                starter av seg selv igjen ${formatTrialEndDate(resumesAt)}.`
    : `Abonnementet ditt er satt p&aring; <strong style="color:#ffffff;">pause</strong> inntil videre.
                Du blir <strong style="color:#ffffff;">ikke trukket</strong> mens koden gjelder.`

  return codeEmailShell('Koden er aktivert — abonnementet er satt på pause', `${codeHeading('Koden er aktivert')}
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Du har Premium ${codePeriodLine(startsAt, expiresAt)}.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${resumeLine}
              </p>
              <p style="margin:0;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Du trenger ikke gj&oslash;re noe. Abonnementet er ikke sagt opp, og tilgangen din
                er uavbrutt hele veien.
              </p>`)
}

export function subscriptionResumedEmail(): string {
  return codeEmailShell('Abonnementet ditt er i gang igjen', `${codeHeading('Abonnementet er i gang igjen')}
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Premium-perioden fra verdikoden er over, og abonnementet ditt har gjenopptatt
                vanlig fakturering. Du beholder tilgangen uten avbrudd.
              </p>
              <p style="margin:0;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Vil du endre eller avslutte abonnementet, gj&oslash;r du det n&aring;r som helst fra profilen din.
              </p>`)
}

/**
 * «Ny quiz er klar» til e-postlisten for UINNLOGGEDE (`quiz_notifications`),
 * sendt av /api/cron/notify-subscribers.
 *
 * `unsubscribeUrl` er påkrevd, i motsetning til i de profilbaserte malene:
 * mottakeren har ingen konto og kan derfor ikke skru av varselet fra
 * profilsiden. Uten lenken har de ingen vei ut i det hele tatt, så den skal
 * ikke kunne utelates. Bygg den med `buildUnsubscribeUrl(rowId, 'quiznotify')`.
 */
export function quizOpenedEmail(quizTitleRaw: string | null | undefined, unsubscribeUrl: string): string {
  const titleLine = quizTitleRaw
    ? `<p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#c9a84c;line-height:1.4;">${escapeHtml(quizTitleRaw)}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ny quiz er klar!</title>
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">
              <p style="margin:0 0 8px;font-family:Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Ny quiz er klar!
              </p>
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>
              ${titleLine}
              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                En ny quiz på Quizkanonen er nå åpen. Spill nå og se hvor du havner på topplisten!
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#c9a84c;border-radius:10px;padding:13px 32px;text-align:center;">
                    <a href="https://quizkanonen.no" style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;white-space:nowrap;">
                      Spill nå →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;color:#918f8a;text-align:center;line-height:1.6;">
                Du mottok denne e-posten fordi du meldte deg på varsler på quizkanonen.no.
              </p>
            </td>
          </tr>
          ${unsubscribeRow(unsubscribeUrl)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
