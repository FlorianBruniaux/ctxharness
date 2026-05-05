import { describe, it, expect } from 'vitest'
import { detectClaims, verifyClaim } from '../scan.js'
import type { HeuristicClaim } from '../scan.js'

// ─── Root for extractor tests (the worktree itself) ───────────────────────────

// Go up from packages/core/src/__tests__ → src → core → packages → root
import { join } from 'node:path'
const ROOT = join(import.meta.dirname, '..', '..', '..', '..')

// ─── detectClaims ─────────────────────────────────────────────────────────────

describe('detectClaims — semver', () => {
  it('detects semver near node keyword', () => {
    const content = 'Requires node `22.14.0` or higher.'
    const claims = detectClaims(content)
    const semverClaims = claims.filter((c) => c.type === 'semver')
    expect(semverClaims.length).toBeGreaterThanOrEqual(1)
    const nodeClaim = semverClaims.find((c) => c.tech === 'node')
    expect(nodeClaim).toBeDefined()
    expect(nodeClaim?.value).toBe('22.14.0')
    expect(nodeClaim?.line).toBe(1)
  })

  it('detects semver near pnpm keyword', () => {
    const content = 'Uses pnpm `9.4.0` as package manager.'
    const claims = detectClaims(content)
    const pnpmClaim = claims.find((c) => c.type === 'semver' && c.tech === 'pnpm')
    expect(pnpmClaim).toBeDefined()
    expect(pnpmClaim?.value).toBe('9.4.0')
  })

  it('detects semver near typescript keyword', () => {
    const content = 'TypeScript `5.8` is required.'
    const claims = detectClaims(content)
    const tsClaim = claims.find((c) => c.type === 'semver' && c.tech === 'typescript')
    expect(tsClaim).toBeDefined()
    expect(tsClaim?.value).toBe('5.8')
  })

  it('skips version ranges (>= operator)', () => {
    const content = 'Requires node >= `22.0.0` to run.'
    const claims = detectClaims(content)
    // Should NOT detect this as a claim because >= appears before the version
    const semverClaims = claims.filter((c) => c.type === 'semver')
    expect(semverClaims.length).toBe(0)
  })

  it('skips versions that are URL path segments (/v prefix)', () => {
    // node is a tech keyword so detection runs, but /v before the backtick triggers the filter
    const content = 'The node `/v2.0.0` endpoint handles auth.'
    const claims = detectClaims(content)
    const semverClaims = claims.filter((c) => c.type === 'semver')
    expect(semverClaims).toHaveLength(0)
  })

  it('deduplicates identical (tech, value) pairs', () => {
    const content = [
      'Run with node `22.14.0`.',
      'Make sure node `22.14.0` is installed.',
    ].join('\n')
    const claims = detectClaims(content)
    const nodeClaims = claims.filter((c) => c.type === 'semver' && c.tech === 'node')
    expect(nodeClaims.length).toBe(1)
  })

  it('reports correct line numbers', () => {
    const content = 'First line.\nRequires node `18.0.0`.'
    const claims = detectClaims(content)
    const nodeClaim = claims.find((c) => c.type === 'semver' && c.tech === 'node')
    expect(nodeClaim?.line).toBe(2)
  })
})

describe('detectClaims — path', () => {
  it('detects file paths in backticks', () => {
    const content = 'Edit `src/index.ts` to configure.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.length).toBeGreaterThanOrEqual(1)
    expect(pathClaims.some((c) => c.value === 'src/index.ts')).toBe(true)
  })

  it('detects paths starting with ./', () => {
    const content = 'Config lives at `./config.yml`.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.some((c) => c.value === './config.yml')).toBe(true)
  })

  it('detects paths starting with packages/', () => {
    const content = 'See `packages/core/src/index.ts` for the API.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.some((c) => c.value === 'packages/core/src/index.ts')).toBe(true)
  })

  it('does NOT detect Rust-style snake_case module names without slash', () => {
    const content = 'Use the `ruff_python_ast` crate for parsing.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.length).toBe(0)
  })

  it('does NOT detect Claude Code slash commands as paths', () => {
    const content = 'Use `/plan` to start, `/ship` to release, `/tech:commit` to commit.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.length).toBe(0)
  })

  it('does NOT detect template placeholder patterns as paths', () => {
    const content = 'Create `YYYY-MM-DD-{slug}.md` or `changelog/fragments/{PR_NUMBER}/change.md`.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.length).toBe(0)
  })

  it('does NOT detect Next.js dynamic route segments as paths', () => {
    const content = 'Routes: `/[owner]/[repo]/page.tsx` and `/api/stats/[owner]/route.ts`.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.length).toBe(0)
  })

  it('does NOT detect URL route paths without file extension as file paths', () => {
    const content = 'Visit `/api/chunk`, `/devs/atlas`, or `/about/` in your browser.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.length).toBe(0)
  })

  it('DOES detect absolute paths that have a file extension', () => {
    const content = 'Config at `/etc/nginx/nginx.conf` and source at `/home/user/app/index.ts`.'
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path')
    expect(pathClaims.some((c) => c.value.includes('nginx.conf'))).toBe(true)
  })

  it('deduplicates identical paths', () => {
    const content = [
      'See `src/config.ts`.',
      'Also `src/config.ts` for reference.',
    ].join('\n')
    const claims = detectClaims(content)
    const pathClaims = claims.filter((c) => c.type === 'path' && c.value === 'src/config.ts')
    expect(pathClaims.length).toBe(1)
  })
})

describe('detectClaims — script', () => {
  it('detects npm run script', () => {
    const content = 'Run `npm run build` to compile.'
    const claims = detectClaims(content)
    const scriptClaims = claims.filter((c) => c.type === 'script')
    expect(scriptClaims.length).toBeGreaterThanOrEqual(1)
    const buildClaim = scriptClaims.find((c) => c.value === 'build')
    expect(buildClaim).toBeDefined()
    expect(buildClaim?.tech).toBe('npm')
  })

  it('detects pnpm run script', () => {
    const content = 'Use `pnpm run test` to run the test suite.'
    const claims = detectClaims(content)
    const scriptClaims = claims.filter((c) => c.type === 'script')
    expect(scriptClaims.some((c) => c.value === 'test' && c.tech === 'pnpm')).toBe(true)
  })

  it('detects bare pnpm script alias', () => {
    const content = 'Run `pnpm build` to compile.'
    const claims = detectClaims(content)
    const scriptClaims = claims.filter((c) => c.type === 'script')
    expect(scriptClaims.some((c) => c.value === 'build' && c.tech === 'pnpm')).toBe(true)
  })

  it('does NOT detect pnpm install as a script', () => {
    const content = 'First run `pnpm install` to set up.'
    const claims = detectClaims(content)
    const installClaims = claims.filter((c) => c.type === 'script' && c.value === 'install')
    expect(installClaims.length).toBe(0)
  })

  it('does NOT detect npm add as a script', () => {
    const content = 'Run `npm add typescript` to install.'
    const claims = detectClaims(content)
    const addClaims = claims.filter((c) => c.type === 'script' && c.value === 'add')
    expect(addClaims.length).toBe(0)
  })

  it('deduplicates identical script claims', () => {
    const content = [
      'Run `pnpm build` to compile.',
      'After changes, run `pnpm build` again.',
    ].join('\n')
    const claims = detectClaims(content)
    const buildClaims = claims.filter((c) => c.type === 'script' && c.value === 'build' && c.tech === 'pnpm')
    expect(buildClaims.length).toBe(1)
  })
})

// ─── verifyClaim ─────────────────────────────────────────────────────────────

describe('verifyClaim — path', () => {
  it('returns match for existing file', () => {
    const claim: HeuristicClaim = {
      type: 'path',
      raw: 'packages/core/src/index.ts',
      value: 'packages/core/src/index.ts',
      tech: '',
      line: 1,
    }
    const result = verifyClaim(claim, ROOT)
    expect(result.status).toBe('match')
    expect(result.actual).toBe('exists')
  })

  it('returns drift for non-existent file', () => {
    const claim: HeuristicClaim = {
      type: 'path',
      raw: 'src/does-not-exist.ts',
      value: 'src/does-not-exist.ts',
      tech: '',
      line: 1,
    }
    const result = verifyClaim(claim, ROOT)
    expect(result.status).toBe('drift')
    expect(result.actual).toBe('NOT FOUND')
  })
})

describe('verifyClaim — script', () => {
  it('returns match for existing script (build)', () => {
    const claim: HeuristicClaim = {
      type: 'script',
      raw: 'pnpm build',
      value: 'build',
      tech: 'pnpm',
      line: 1,
    }
    const result = verifyClaim(claim, ROOT)
    // Root package.json has "build" script
    expect(result.status).toBe('match')
    expect(result.actual).toBe('in scripts')
  })

  it('returns drift for non-existent script', () => {
    const claim: HeuristicClaim = {
      type: 'script',
      raw: 'pnpm run nonexistent-script-xyz',
      value: 'nonexistent-script-xyz',
      tech: 'pnpm',
      line: 1,
    }
    const result = verifyClaim(claim, ROOT)
    expect(result.status).toBe('drift')
    expect(result.actual).toBe('NOT in scripts')
  })
})

describe('verifyClaim — semver (unresolvable)', () => {
  it('returns unresolvable for unknown tech package', () => {
    const claim: HeuristicClaim = {
      type: 'semver',
      raw: '5.0.0',
      value: '5.0.0',
      tech: 'nonexistent-package-xyz',
      line: 1,
    }
    const result = verifyClaim(claim, ROOT)
    expect(result.status).toBe('unresolvable')
  })
})
