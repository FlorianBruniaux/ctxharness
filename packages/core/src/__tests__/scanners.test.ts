import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { runScanner, normalizeMatch } from '../scanners/index.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const CLAUDE_MD = join(FIXTURES, 'CLAUDE.md')
const AGENTS_MD = join(FIXTURES, 'AGENTS.md')
const VAGUE_DOC = join(FIXTURES, 'vague-doc.md')

describe('normalizeMatch', () => {
  it('passes when doc mentions major only', () => {
    expect(normalizeMatch('22', '22.14.0')).toBe(true)
  })
  it('passes when doc mentions major.minor', () => {
    expect(normalizeMatch('5.8', '5.8.3')).toBe(true)
  })
  it('fails when major differs', () => {
    expect(normalizeMatch('14', '15.3.1')).toBe(false)
  })
  it('passes on exact match', () => {
    expect(normalizeMatch('15.3.1', '15.3.1')).toBe(true)
  })
  it('strips leading v before comparing', () => {
    expect(normalizeMatch('v22', '22.14.0')).toBe(true)
  })
})

describe('inlineRegex scanner', () => {
  it('finds passing version mention in CLAUDE.md', () => {
    const results = runScanner('inlineRegex', CLAUDE_MD, '15.3.1', {
      pattern: 'Next\\.js\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)',
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.status === 'pass')).toBe(true)
  })

  it('finds failing version in AGENTS.md (v14 vs 15.3.1)', () => {
    const results = runScanner('inlineRegex', AGENTS_MD, '15.3.1', {
      pattern: 'Next\\.js\\s+v?(\\d+(?:\\.\\d+(?:\\.\\d+)?)?)',
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.status === 'fail')).toBe(true)
  })

  it('returns empty array when pattern not found', () => {
    const results = runScanner('inlineRegex', CLAUDE_MD, '99.0.0', {
      pattern: 'NOMATCH_XYZ_PATTERN',
    })
    expect(results).toHaveLength(0)
  })
})

describe('codeBlockRegex scanner', () => {
  it('finds version inside code block', () => {
    const results = runScanner('codeBlockRegex', CLAUDE_MD, '15.3.1', {
      pattern: '"version":\\s*"(\\d+\\.\\d+\\.\\d+)"',
      lang: 'json',
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.status).toBe('pass')
  })
})

describe('literalInMd scanner', () => {
  it('passes when literal is found', () => {
    const results = runScanner('literalInMd', CLAUDE_MD, 'Prisma', {
      literal: 'Prisma',
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })
  it('fails when literal is absent', () => {
    const results = runScanner('literalInMd', CLAUDE_MD, 'absent', {
      literal: 'TOTALLY_ABSENT_STRING_XYZ',
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('fail')
  })
})

describe('pathReference scanner', () => {
  it('passes when path is referenced', () => {
    const results = runScanner('pathReference', CLAUDE_MD, '', {
      path: 'src/server/api/routers/user.ts',
    })
    expect(results[0]?.status).toBe('pass')
  })
  it('fails when path is absent', () => {
    const results = runScanner('pathReference', CLAUDE_MD, '', {
      path: 'nonexistent/path.ts',
    })
    expect(results[0]?.status).toBe('fail')
  })
})

describe('jsonField scanner', () => {
  it('extracts field from inline JSON', () => {
    const results = runScanner('jsonField', CLAUDE_MD, 'nextjs', {
      field: 'framework',
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.status).toBe('pass')
  })
})

describe('vaguenessPattern scanner', () => {
  it('flags vague phrases in vague-doc.md', () => {
    const results = runScanner('vaguenessPattern', VAGUE_DOC, '', {})
    expect(results.every((r) => r.status === 'fail')).toBe(true)
    expect(results.length).toBeGreaterThan(0)
  })

  it('passes on clean CLAUDE.md with no vague language', () => {
    const results = runScanner('vaguenessPattern', CLAUDE_MD, '', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('accepts extra custom patterns via scannerArgs', () => {
    const results = runScanner('vaguenessPattern', CLAUDE_MD, '', {
      patterns: ['Using Prisma'],
    })
    expect(results.some((r) => r.status === 'fail')).toBe(true)
  })
})

describe('negativeConstraintDensity scanner', () => {
  it('fails on vague-doc.md with default minRatio 1.0 (too many negatives)', () => {
    const results = runScanner('negativeConstraintDensity', VAGUE_DOC, '', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('fail')
  })

  it('passes on CLAUDE.md (zero negatives → infinite ratio)', () => {
    const results = runScanner('negativeConstraintDensity', CLAUDE_MD, '', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('respects custom minRatio', () => {
    // vague-doc has: positives=~1 (use), negatives=3 (never, do not, avoid) → ratio ~0.33
    // with minRatio=0.1 it should pass
    const results = runScanner('negativeConstraintDensity', VAGUE_DOC, '', { minRatio: 0.1 })
    expect(results[0]?.status).toBe('pass')
  })
})
