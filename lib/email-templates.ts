function formatNorwegianDate(isoString: string): string {
  const date = new Date(isoString)
  const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
  const months = [
    'januar', 'februar', 'mars', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'desember',
  ]
  const dayName = days[date.getDay()]
  const day = date.getDate()
  const month = months[date.getMonth()]
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${dayName} ${day}. ${month} kl. ${hours}:${minutes}`
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
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#6a6860;">
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
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#0f0f10;text-decoration:none;letter-spacing:0.02em;">
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

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function orgWelcomeEmail(firstName: string, orgName: string, orgSlug: string): string {
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Du er med i ${orgName} på Quizkanonen</title>
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
                Hei ${firstName}!
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                <strong style="color:#ffffff;">${orgName}</strong> har invitert deg til fredagsquizen på Quizkanonen.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Hver fredag kl. 12 legges det ut 15 spørsmål. Du konkurrerer mot kollegene dine og samler poeng gjennom sesongen — se hvem som topper listen når måneden er omme.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Her teller det å kunne svaret — ikke bare å klikke først.
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Logg inn med Google, så er du med hver fredag.
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#e0e0e0;line-height:1.7;">
                Tips: Gå til <a href="https://quizkanonen.no/profil" style="color:#c9a84c;text-decoration:none;">profilen din</a> og slå på e-postpåminnelse, så får du beskjed når quizen åpner hver fredag.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://quizkanonen.no"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;letter-spacing:0.02em;">
                      Spill ukens quiz →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Secondary link -->
              <p style="margin:0;font-size:14px;color:#e0e0e0;line-height:1.7;">
                Se hvordan du ligger an mot kollegene:<br />
                <a href="https://quizkanonen.no/org/${orgSlug}"
                   style="color:#c9a84c;text-decoration:none;">
                  Bedriftens toppliste →
                </a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Lykke til!<br />Quizkanonen
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

export function orgRemovedEmail(orgName: string): string {
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
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Hvis du hadde Premium gjennom bedriften, har du nå mistet denne tilgangen.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Ønsker du å fortsette med Premium?
                <a href="https://quizkanonen.no/premium" style="color:#e8e4dd;text-decoration:underline;">quizkanonen.no/premium</a><br />
                Premium fornyes automatisk hver måned til du selv avslutter.
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
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du er registrert på Quizkanonen.<br />
                Spørsmål? Svar på denne e-posten.
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

              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#6a6860;">
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
                Takk for at du valgte Premium. Du har nå tilgang til:
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

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function premiumRenewalEmail(): string {
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
                Abonnementet ditt er fornyet for en ny måned. Du har fortsatt tilgang til alle Premium-funksjoner.
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Du administrerer abonnementet fra profilsiden din.
              </p>

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

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function quizReminderEmail(nextQuizDate: string): string {
  const formattedDate = formatNorwegianDate(nextQuizDate)

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
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#0f0f10;text-decoration:none;letter-spacing:0.02em;">
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

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
