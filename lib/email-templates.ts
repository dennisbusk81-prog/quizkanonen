const UNSUBSCRIBE_ROW = `
          <tr>
            <td align="center" style="padding-top:12px;">
              <p style="margin:0;font-size:11px;color:#7a7873;line-height:1.7;text-align:center;">
                Ønsker du ikke flere e-poster? <a href="https://quizkanonen.no/profil" style="color:#7a7873;text-decoration:underline;">Meld deg av her.</a>
              </p>
            </td>
          </tr>`

function unsubscribeRow(url: string): string {
  return `
          <tr>
            <td align="center" style="padding-top:12px;">
              <p style="margin:0;font-size:11px;color:#7a7873;line-height:1.7;text-align:center;">
                <a href="${url}" style="color:#7a7873;text-decoration:underline;">Avslutt abonnement på denne typen e-post</a>
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
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#7a7873;">
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
                Velger du Premium etterpå, fornyes det månedlig til kr 49.
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
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

export function orgWelcomeEmail(firstName: string, orgName: string, orgSlug: string, isTrial?: boolean): string {
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
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Velkommen til Quizkanonen! Vi håper det blir mange morsomme timer for teamet hos <strong style="color:#ffffff;">${orgName}</strong>.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Det eneste du trenger å gjøre nå, er å få med kollegene dine. Gå inn på bedriftspanelet — der kan du enten dele en invitasjonslenke direkte, eller la oss sende e-post til dem for deg.
              </p>

              <!-- CTA button -->
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

              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Når de er med, trenger du ikke gjøre noe mer — alle får automatisk en påminnelse på e-post hver fredag når ukens quiz åpner, så ingen glemmer å bli med.
              </p>

              ${isTrial ? `
              <!-- Trial note -->
              <p style="margin:0 0 16px;font-size:14px;color:#7a7873;line-height:1.7;border-left:2px solid #2a2d38;padding-left:14px;">
                Dere har 14 dager gratis, ingen kortinfo nødvendig.
              </p>
              ` : ''}

              <p style="margin:0;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Spørsmål? Bare svar på denne e-posten.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
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

export function welcomeFreeEmail(firstName: string): string {
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

              <!-- MIDLERTIDIG: Founders Access-nevnelse — fjern når kampanjen avsluttes -->
              <p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Nysgjerrig på mer? Med
                <a href="https://www.quizkanonen.no/founders" style="color:#e8e4dd;text-decoration:underline;">Founders Access</a>
                får du 30 dager med full tilgang — nøyaktig plassering, historikk, statistikk, private ligaer og sesongtoppliste — helt gratis, ingen kortinfo nødvendig.
              </p>

              <p style="margin:0;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Spørsmål? Bare svar på denne e-posten.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
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

export function orgRemovedEmail(orgName: string, graceUntil?: string | null): string {
  const premiumBlock = graceUntil
    ? `<p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Hadde du Premium gjennom bedriften, beholder du tilgangen i 7 dager — frem til ${formatNorwegianDate(graceUntil)}.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Vil du fortsette med Premium etter det? Tegn ditt eget abonnement på
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a> — kr 49/mnd, fornyes automatisk til du selv avslutter.
              </p>`
    : `<p style="margin:0 0 16px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Hvis du hadde Premium gjennom bedriften, har du nå mistet denne tilgangen.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e8e4dd;line-height:1.7;">
                Ønsker du å fortsette med Premium?
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a><br />
                Premium fornyes automatisk hver måned til du selv avslutter.
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
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
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
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a> — kr 49/mnd.
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
              <p style="margin:0;font-size:12px;color:#7a7873;line-height:1.7;">
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

export function orgInviteEmail(senderName: string, orgName: string, inviteUrl: string): string {
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
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

export function paymentFailedEmail(): string {
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
                Abonnementet kan bli avsluttet hvis betalingen ikke ordnes.
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Oppdater betalingsinformasjonen din for å beholde tilgangen.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/profil"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Oppdater betalingsinformasjon &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function orgPaymentFailedEmail(orgName: string, orgSlug: string): string {
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function foundersWelcomeEmail(): string {
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
                Du er blant de første. Det betyr noe. 30 dager med full tilgang — ingen kortinfo, ingen forpliktelse. Bare spill.
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function orgPurchaseEmail(orgName: string, orgSlug: string): string {
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

              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#7a7873;">
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function orgTrialEmail(orgName: string, orgSlug: string, trialEndIso: string): string {
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
                    <span style="font-size:12px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:#7a7873;">
                      Prøveperioden varer til
                    </span><br />
                    <span style="font-size:16px;font-weight:600;color:#ffffff;margin-top:4px;display:inline-block;">
                      ${endDate}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#7a7873;">
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function orgTrialEndingEmail(orgName: string, orgSlug: string, trialEndIso: string): string {
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du er administrator for ${orgName} på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function orgCancelledEmail(orgName: string): string {
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function orgRenewalEmail(orgName: string, orgSlug: string): string {
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du er administrator for ${orgName} på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function premiumWelcomeEmail(): string {
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
                Abonnementet fornyes automatisk hver måned til du selv avslutter.
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du nettopp aktiverte Premium på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function premiumRenewalEmail(nextBillingDate?: string): string {
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
                Premium-abonnementet ditt er fornyet for en ny måned. Du har fortsatt tilgang til alle Premium-funksjoner.
              </p>

              ${nextBillingDate ? `
              <!-- Next billing date -->
              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr>
                  <td style="background:#1a1c23;border:1px solid #2a2d38;border-radius:12px;padding:14px 18px;">
                    <span style="font-size:12px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:#7a7873;">
                      Neste betaling
                    </span><br />
                    <span style="font-size:16px;font-weight:600;color:#ffffff;margin-top:4px;display:inline-block;">
                      ${nextBillingDate}
                    </span>
                  </td>
                </tr>
              </table>
              ` : '<p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">Abonnementet fornyes automatisk neste måned.</p>'}

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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du har et aktivt Premium-abonnement på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du hadde et Premium-abonnement på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function reEngagementEmail(firstName?: string, unsubscribeUrl?: string): string {
  const greeting = firstName ? `Hei, ${firstName}!` : 'Hei!'

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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
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
  const { orgName, winner, top3, participantCount, shareText } = data

  const medals = ['🥇', '🥈', '🥉']
  const top3Rows = top3.map((e, i) => `
                <tr>
                  <td style="padding:8px 0;font-size:15px;color:#e0e0e0;border-bottom:${i < top3.length - 1 ? '1px solid #2a2d38' : 'none'};">
                    <span style="display:inline-block;width:28px;">${medals[i] ?? `${i + 1}.`}</span>
                    <strong style="color:#ffffff;">${e.displayName}</strong>
                    <span style="color:#c9a84c;float:right;font-weight:600;">${e.correct}/${e.total}</span>
                  </td>
                </tr>`).join('')

  // shareText har emoji og linjeskift — escape < og > og bytt \n til <br>.
  const shareHtml = shareText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />')

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ukens quiz-oppsummering — ${orgName}</title>
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
                Ukens oppsummering
              </p>

              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <p style="margin:0 0 20px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                ${winner
                  ? `Ukens vinner i <strong style="color:#ffffff;">${orgName}</strong> er <strong style="color:#ffffff;">${winner.displayName}</strong> med <strong style="color:#c9a84c;">${winner.correct}/${winner.total}</strong> riktige.`
                  : `Ukens quiz i <strong style="color:#ffffff;">${orgName}</strong> er avgjort.`}
              </p>

              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#7a7873;">
                Topp 3
              </p>

              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;">
                ${top3Rows}
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                <strong style="color:#ffffff;">${participantCount}</strong> ansatte kjempet om ukens seier.
              </p>

              <!-- Kopierbar tekstblokk for Teams/Slack -->
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#7a7873;">
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
                      Se ukens quiz &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du er administrator for ${orgName} på Quizkanonen.<br />
                Spørsmål? <a href="mailto:support@quizkanonen.no" style="color:#9a9590;">support@quizkanonen.no</a>
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

export function quizReminderEmail(nextQuizDate: string, quizTitle?: string, unsubscribeUrl?: string): string {
  const formattedDate = formatNorwegianDate(nextQuizDate)
  const titleLine = quizTitle ? `<p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#c9a84c;line-height:1.4;">${quizTitle}</p>` : ''

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quizen åpner snart!</title>
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
                Quizen åpner snart!
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              ${titleLine}
              <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Hei! En ny quiz er på vei på Quizkanonen.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Sett av tid — quizen åpner
                <strong style="color:#ffffff;">${formattedDate}</strong>.
                Vær klar fra første sekund for best mulig plassering.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Gå til Quizkanonen
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
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

export function orgCloseReminderEmail(orgName: string, closesAt: string, quizTitle?: string): string {
  const timeStr = new Date(closesAt).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
  const titleLine = quizTitle ? `<p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#c9a84c;line-height:1.4;">${quizTitle}</p>` : ''

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
              <p style="margin:0;font-size:12px;color:#7a7873;text-align:center;line-height:1.6;">
                Du mottar denne e-posten fordi du er medlem av ${orgName} på Quizkanonen.<br/>
                <a href="https://quizkanonen.no/innstillinger" style="color:#7a7873;">Endre varslingsinnstillinger</a>
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

export function duelInviteEmail(challengerName: string, unsubscribeUrl?: string): string {
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
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
