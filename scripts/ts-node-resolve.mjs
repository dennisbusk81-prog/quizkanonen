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

registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier

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

    return nextResolve(specifier, context)
  },
})
