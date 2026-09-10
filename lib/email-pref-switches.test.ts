// Kjøres med:  npm test
//   enkelt:    node --import ./scripts/ts-node-resolve.mjs --test lib/email-pref-switches.test.ts
//
// De to org-avhengige bryterne i E-postvarsler-kortet på /profil (10. september
// 2026). Tre halvdeler:
//
//   1) SYNLIGHETEN (decideOrgEmailSwitches) — hvem ser hvilken bryter, og hva
//      sier den. Ukjent medlemskap er en egen tilstand, ikke «ingen org».
//   2) SKRIVING SOM FEILER (decidePrefSave) — en mislykket PATCH skal
//      reversere, ikke vise «Lagret».
//   3) KOBLINGEN (app/profil/page.tsx + ruta + migrasjonen) — at bryteren
//      faktisk er koblet på kolonnen, at kolonnen faktisk kan skrives, og at
//      fallback-verdien er den samme DEFAULT-en prod har.
//
// FELLA DENNE RUNDEN (jf. 9. september): en test kan være grønn fordi
// testmiljøet ikke ligner prod. Her er «prod-verdien» kolonnenes DEFAULT.
// Test 3c leser derfor DEFAULT-en UT AV migrasjonsfila i stedet for å
// hardkode `true` — hardkodet ville bare bekreftet min egen antakelse, og
// vært like grønn om jeg hadde speilet email_reminders sin DEFAULT false.
//
// MUTASJONSBEVIS (10. september 2026, alle talt på disk før kjøring):
//   • `input.membership?.isAdmin === true ||` strøket
//        → «org-admin ser begge bryterne» rød
//   • `|| input.emailWeeklyReport === false` strøket
//        → «avmeldt ser bryteren selv uten kjent org» rød
//   • `input.membership?.isMember === true` → `=== false`
//        → «org-medlem uten admin ser kun bedriftspåminnelsen» rød
//   • `|| input.emailOrgReminders === false` strøket
//        → «avmeldt ser bryteren ved UKJENT medlemskap» rød
//   • `input.emailOrgReminders && !input.emailReminders` → `false`
//        → «på + fredagspåminnelse av sier fra» rød
//   • `if (response === null)` → `if (false)`  → «kallet kastet = feil» rød
//   • `if (!response.ok)` → `if (false)`       → «500 = feil» rød
//   • i page.tsx: `revert()` strøket → 3e rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { decideOrgEmailSwitches, decidePrefSave, type OrgEmailInput } from './email-pref-switches'
import { deriveProfileScreen, type ProfileRow } from './profile-load'

const les = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

// Aktive linjer — en utkommentert gren skal ikke kunne oppfylle et anker.
const aktiveLinjer = (kilde: string) =>
  kilde
    .split(/\r?\n/)
    .filter(l => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')

// Alt PÅ, org-admin: utgangspunktet de fleste testene varierer ett ledd fra.
const base: OrgEmailInput = {
  emailWeeklyReport: true,
  emailOrgReminders: true,
  emailReminders: true,
  membership: { isAdmin: true, isMember: true },
}
const nokler = (i: OrgEmailInput) => decideOrgEmailSwitches(i).map(s => s.key)
const finn = (i: OrgEmailInput, key: string) => decideOrgEmailSwitches(i).find(s => s.key === key)

// ── 1) Synligheten ──────────────────────────────────────────────────────────

test('org-admin ser begge bryterne', () => {
  assert.deepEqual(nokler(base), ['weeklyreport', 'orgreminders'])
})

test('org-medlem uten admin ser KUN bedriftspåminnelsen', () => {
  // Ukesrapporten går til admins (cron/weekly-report → getOrgAdminEmails).
  // En bryter for en e-post du aldri får er støy.
  assert.deepEqual(nokler({ ...base, membership: { isAdmin: false, isMember: true } }), ['orgreminders'])
})

test('bruker uten organisasjon ser INGEN av dem', () => {
  assert.deepEqual(nokler({ ...base, membership: { isAdmin: false, isMember: false } }), [])
})

test('ukjent medlemskap + alt PÅ → ingen brytere (ufarlig: ingen er stengt ute)', () => {
  assert.deepEqual(nokler({ ...base, membership: null }), [])
})

// Andre ledd i regelen — selve grunnen til at oppgaven finnes.

test('avmeldt ukesrapport ser bryteren selv UTEN kjent org (veien tilbake)', () => {
  const ut = nokler({ ...base, emailWeeklyReport: false, membership: { isAdmin: false, isMember: false } })
  assert.deepEqual(ut, ['weeklyreport'])
})

test('avmeldt bedriftspåminnelse ser bryteren ved UKJENT medlemskap', () => {
  // Nettopp tilfellet en ren relevans-regel ville tapt: myOrgs feilet, og
  // brukeren som meldte seg av i går ville sett et kort uten vei tilbake.
  const ut = nokler({ ...base, emailOrgReminders: false, membership: null })
  assert.deepEqual(ut, ['orgreminders'])
})

test('begge avmeldt uten kjent org → begge vises', () => {
  assert.deepEqual(
    nokler({ ...base, emailWeeklyReport: false, emailOrgReminders: false, membership: null }),
    ['weeklyreport', 'orgreminders'],
  )
})

// Hva de VISER.

test('verdien speiles ut på bryteren — på og av', () => {
  assert.equal(finn(base, 'weeklyreport')?.value, true)
  assert.equal(finn({ ...base, emailWeeklyReport: false }, 'weeklyreport')?.value, false)
  assert.equal(finn(base, 'orgreminders')?.value, true)
  assert.equal(finn({ ...base, emailOrgReminders: false }, 'orgreminders')?.value, false)
})

test('bryterne eier hver sin kolonne', () => {
  assert.equal(finn(base, 'weeklyreport')?.column, 'email_weekly_report')
  assert.equal(finn(base, 'orgreminders')?.column, 'email_org_reminders')
})

test('org-påminnelse PÅ mens fredagspåminnelsen er AV sier fra i teksten', () => {
  // cron/send-reminders krever BEGGE kolonnene. Uten dette lover bryteren
  // en e-post som ikke kommer.
  const med = finn({ ...base, emailReminders: false }, 'orgreminders')
  assert.match(med!.desc, /Fredagspåminnelse/)
})

test('… men ikke når bryteren står AV — teksten skal ikke gjøre det vanskeligere å skru den på', () => {
  const uten = finn({ ...base, emailReminders: false, emailOrgReminders: false }, 'orgreminders')
  assert.doesNotMatch(uten!.desc, /Fredagspåminnelse/)
  const normal = finn(base, 'orgreminders')
  assert.doesNotMatch(normal!.desc, /Fredagspåminnelse/)
})

// ── 2) Skriving som feiler ──────────────────────────────────────────────────

test('OK-svar = lagret', () => {
  assert.deepEqual(decidePrefSave({ ok: true }), { kind: 'saved' })
})

test('500 fra ruta = feil, ikke «Lagret»', () => {
  assert.equal(decidePrefSave({ ok: false }).kind, 'failed')
})

test('kallet kastet (nettverk) = feil', () => {
  assert.equal(decidePrefSave(null).kind, 'failed')
})

test('feilgrenen bærer en melding å vise', () => {
  const ut = decidePrefSave(null)
  assert.ok(ut.kind === 'failed' && ut.message.length > 0)
})

// ── 3) Koblingen ────────────────────────────────────────────────────────────

const PROFIL = aktiveLinjer(les('app/profil/page.tsx'))
const RUTE = aktiveLinjer(les('app/api/profile/preferences/route.ts'))
const MIGRASJON = les('supabase/migrations/20260909000001_email_prefs_weekly_report_and_org_reminders.sql')

test('3a: profilsiden henter begge kolonnene i den AUTORITATIVE selecten', () => {
  const i = PROFIL.indexOf(".select('display_name, nickname, member_number")
  assert.ok(i > 0, 'fant ikke den autoritative profil-selecten')
  const select = PROFIL.slice(i, PROFIL.indexOf(')', i))
  assert.ok(select.includes('email_weekly_report'), 'email_weekly_report mangler i selecten')
  assert.ok(select.includes('email_org_reminders'), 'email_org_reminders mangler i selecten')
})

test('3b: PATCH-ruta godtar begge kolonnene', () => {
  // Uten dette ville bryteren vist en ny stilling og ruta svart 400.
  assert.ok(RUTE.includes("typeof body.email_weekly_report === 'boolean'"))
  assert.ok(RUTE.includes("typeof body.email_org_reminders === 'boolean'"))
})

test('3c: fallback-verdien er den DEFAULT-en prod faktisk har', () => {
  // Leses ut av migrasjonen, ikke hardkodet. 179/179 rader i prod står på
  // true fordi ADD COLUMN med DEFAULT backfyller.
  const par = [
    ['email_weekly_report', 'emailWeeklyReport'],
    ['email_org_reminders', 'emailOrgReminders'],
  ] as const
  for (const [kolonne, felt] of par) {
    const m = MIGRASJON.match(new RegExp(kolonne + '\\s+boolean\\s+NOT NULL\\s+DEFAULT\\s+(true|false)'))
    assert.ok(m, 'fant ingen NOT NULL DEFAULT for ' + kolonne + ' i migrasjonen')
    const forventet = m![1] === 'true'

    // Raden finnes ikke ennå → brukeren HAR defaultene, raden lages med dem.
    const tom = deriveProfileScreen({ ok: true, value: null })
    assert.ok(tom.state === 'ready')
    assert.equal(tom.fields[felt], forventet, felt + ' speiler ikke DEFAULT ' + m![1])

    // Kolonnen er NOT NULL, men en bufret/eldre payload kan mangle feltet.
    const nullFelt = deriveProfileScreen({ ok: true, value: { [kolonne]: null } as unknown as ProfileRow })
    assert.ok(nullFelt.state === 'ready')
    assert.equal(nullFelt.fields[felt], forventet)
  }
})

test('3d: UKJENT — en feilet henting gir ingen felter i det hele tatt', () => {
  // «Feil er ikke av» er strukturelt her: fields finnes kun på ready-grenen,
  // og profilsiden rendrer ikke kortet i feiltilstand. Bryteren kan derfor
  // ikke vise «av» for noe vi ikke har lest.
  const feilet = deriveProfileScreen({ ok: false })
  assert.equal(feilet.state, 'error')
  assert.ok(!('fields' in feilet))
  assert.ok(PROFIL.includes("if (loadState === 'error') {"), 'feilgrenen returnerer ikke før kortet rendres')
})

test('3e: hver bryter skriver SIN kolonne, og reverserer ved feil', () => {
  assert.ok(PROFIL.includes("savePref({ email_weekly_report: next }, 'weeklyreport', () => setEmailWeeklyReport(!next))"))
  assert.ok(PROFIL.includes("savePref({ email_org_reminders: next }, 'orgreminders', () => setEmailOrgReminders(!next))"))
  // Reverseringen skjer i savePref, felles for alle bryterne.
  assert.ok(PROFIL.includes('revert()'), 'savePref reverserer ikke ved feil')
  assert.ok(PROFIL.includes('const utfall = decidePrefSave(res)'))
})

test('3f: synligheten avgjøres av lib-funksjonen, ikke av en betingelse i JSX-en', () => {
  assert.ok(PROFIL.includes("import { decideOrgEmailSwitches, decidePrefSave } from '@/lib/email-pref-switches'"))
  assert.ok(PROFIL.includes('...decideOrgEmailSwitches({'))
  // «Vet ikke» kommer fra contextens egne flagg — ingen nytt oppslag.
  assert.ok(PROFIL.includes('membership: myOrgsLoaded && !myOrgsError'))
  // Tre fra før: mount-hentingen, den autoritative hentingen og
  // medlemsnummer-tellingen. De to kolonnene ble lagt til i de to første —
  // ingen fjerde spørring.
  assert.equal(PROFIL.split(".from('profiles')").length - 1, 3, 'profilsiden har fått en ny profiles-spørring')
})
