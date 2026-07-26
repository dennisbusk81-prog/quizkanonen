// Resolve-hook for `node --test` mot prosjektets .ts-filer.
//
// Node 24 kan kjøre TypeScript direkte (type-stripping), men den kan ikke to
// ting prosjektets kode tar for gitt:
//   1. `@/lib/x`-aliaset fra tsconfig.json
//   2. import uten filendelse ("./season-points" → "./season-points.ts")
//
// Denne hooken legger på begge deler, slik at rene lib-moduler kan testes uten
// byggesteg eller nye avhengigheter. Brukes kun av tester:
//   node --import ./scripts/ts-node-resolve.mjs --test lib/**/*.test.ts
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

// `server-only` er ikke en installert pakke — Next.js løser den selv under
// bygging. Under `node --test` finnes den ikke på disk, så et hvilket som helst
// lib-modul som importerer den (lib/paginate.ts m.fl.) ville feilet med
// ERR_MODULE_NOT_FOUND før en eneste test fikk kjøre. Den har ingen kjøretids-
// oppførsel å bevare — den er en ren byggetids-markør — så en tom modul er en
// korrekt stubb, ikke en forenkling.
const EMPTY_MODULE = 'data:text/javascript,export {}'

registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier

    if (spec === 'server-only' || spec === 'client-only') {
      return { url: EMPTY_MODULE, shortCircuit: true }
    }

    if (spec.startsWith('@/')) {
      spec = pathToFileURL(path.join(ROOT, spec.slice(2))).href
    }

    if (spec.startsWith('.') || spec.startsWith('file:')) {
      const url = new URL(spec, context.parentURL)
      if (!path.extname(url.pathname)) {
        const withExt = fileURLToPath(url) + '.ts'
        if (existsSync(withExt)) {
          return { url: pathToFileURL(withExt).href, shortCircuit: true }
        }
      }
      return nextResolve(spec, context)
    }

    // Bare specifiers uten filendelse: Next.js sine egne inngangspunkter
    // (`next/server`) er filer på disk uten `exports`-felt i package.json, så
    // ESM-resolveren finner dem ikke. Node foreslår selv `next/server.js` —
    // vi prøver den varianten før vi gir opp. Gjelder kun rute-tester som
    // importerer ekte App Router-handlere.
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && !path.extname(spec)) {
        return nextResolve(`${spec}.js`, context)
      }
      throw err
    }
  },
})
