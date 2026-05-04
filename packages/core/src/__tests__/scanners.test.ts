import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { runScanner, normalizeMatch } from '../scanners/index.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const CLAUDE_MD = join(FIXTURES, 'CLAUDE.md')
const AGENTS_MD = join(FIXTURES, 'AGENTS.md')
const VAGUE_DOC = join(FIXTURES, 'vague-doc.md')
const RULE_WITH_PATHS = join(FIXTURES, 'rule-with-paths.md')
const RULE_NO_FRONTMATTER = join(FIXTURES, 'rule-no-frontmatter.md')
const RULE_FRONTMATTER_NO_PATHS = join(FIXTURES, 'rule-frontmatter-no-paths.md')
// Standalone scanner fixture roots (.claude/settings.json + .claude/skills/ live here)
const ROOT_VALID = join(FIXTURES, 'root-valid')
const ROOT_INVALID_HOOKS = join(FIXTURES, 'root-invalid-hooks')

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

describe('contextBudget scanner', () => {
  it('passes when file is under maxTokens threshold', () => {
    const results = runScanner('contextBudget', CLAUDE_MD, '', { maxTokens: 10000 })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('fails when file exceeds maxTokens threshold', () => {
    const results = runScanner('contextBudget', CLAUDE_MD, '', { maxTokens: 1 })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('fail')
  })

  it('uses default threshold of 3000 tokens when not specified', () => {
    const results = runScanner('contextBudget', CLAUDE_MD, '', {})
    expect(results).toHaveLength(1)
  })

  it('reports estimated token count in actual field', () => {
    const results = runScanner('contextBudget', CLAUDE_MD, '', {})
    expect(results[0]?.actual).toMatch(/\d+ tokens/)
  })
})

describe('ruleGlobValidity scanner', () => {
  it('passes on rule file with YAML frontmatter', () => {
    const results = runScanner('ruleGlobValidity', RULE_WITH_PATHS, '', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('fails on rule file without any frontmatter', () => {
    const results = runScanner('ruleGlobValidity', RULE_NO_FRONTMATTER, '', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('fail')
  })

  it('passes on rule file with frontmatter but no paths: by default', () => {
    const results = runScanner('ruleGlobValidity', RULE_FRONTMATTER_NO_PATHS, '', {})
    expect(results[0]?.status).toBe('pass')
  })

  it('passes when requirePaths=true and paths: field is present', () => {
    const results = runScanner('ruleGlobValidity', RULE_WITH_PATHS, '', { requirePaths: true })
    expect(results[0]?.status).toBe('pass')
  })

  it('fails when requirePaths=true and frontmatter lacks paths: field', () => {
    const results = runScanner('ruleGlobValidity', RULE_FRONTMATTER_NO_PATHS, '', { requirePaths: true })
    expect(results[0]?.status).toBe('fail')
  })

  it('fails when requirePaths=true and no frontmatter at all', () => {
    const results = runScanner('ruleGlobValidity', RULE_NO_FRONTMATTER, '', { requirePaths: true })
    expect(results[0]?.status).toBe('fail')
  })
})

describe('contextBudget scanner — followImports', () => {
  const CLAUDE_WITH_IMPORTS = join(FIXTURES, 'claude-with-imports.md')
  const IMPORTED_RULE = join(FIXTURES, 'imported-rule.md')

  it('includes imported file size when followImports is true', () => {
    const { readFileSync } = require('node:fs')
    const baseChars = readFileSync(CLAUDE_WITH_IMPORTS, 'utf-8').length
    const importedChars = readFileSync(IMPORTED_RULE, 'utf-8').length
    const expectedTokens = Math.ceil((baseChars + importedChars) / 4)

    const results = runScanner('contextBudget', CLAUDE_WITH_IMPORTS, '', {
      maxTokens: 10000,
      followImports: true,
    })
    expect(results[0]?.status).toBe('pass')
    expect(results[0]?.actual).toContain('incl. imports')
    expect(results[0]?.actual).toContain(String(expectedTokens))
  })

  it('does not include imports when followImports is false', () => {
    const results = runScanner('contextBudget', CLAUDE_WITH_IMPORTS, '', {
      maxTokens: 10000,
      followImports: false,
    })
    expect(results[0]?.actual).not.toContain('incl. imports')
  })

  it('fails when total including imports exceeds maxTokens', () => {
    const results = runScanner('contextBudget', CLAUDE_WITH_IMPORTS, '', {
      maxTokens: 1,
      followImports: true,
    })
    expect(results[0]?.status).toBe('fail')
  })
})

describe('hookValidity scanner (standalone — receives root)', () => {
  it('passes when root has a valid .claude/settings.json', () => {
    const results = runScanner('hookValidity', ROOT_VALID, '', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('fails when .claude/settings.json has malformed hook entries', () => {
    const results = runScanner('hookValidity', ROOT_INVALID_HOOKS, '', {})
    expect(results.some((r) => r.status === 'fail')).toBe(true)
  })

  it('returns skip when .claude/settings.json is absent', () => {
    // FIXTURES root has no .claude/settings.json
    const results = runScanner('hookValidity', FIXTURES, '', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('skip')
  })
})

describe('backtickEntityPresence scanner', () => {
  it('passes when entity appears as `entity` in file', () => {
    const results = runScanner('backtickEntityPresence', CLAUDE_MD, '', { entity: 'User' })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('fails when entity is absent', () => {
    const results = runScanner('backtickEntityPresence', CLAUDE_MD, '', { entity: 'NonExistentEntity' })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('fail')
  })

  it('throws when entity arg is missing', () => {
    expect(() => runScanner('backtickEntityPresence', CLAUDE_MD, '', {})).toThrow()
  })
})

describe('skillValidity scanner (standalone — receives root)', () => {
  it('returns one result per skill file — root-valid has 3 skill files', () => {
    // root-valid/.claude/skills/ has skill-valid.md, skill-no-frontmatter.md, skill-no-name.md
    const results = runScanner('skillValidity', ROOT_VALID, '', {})
    expect(results).toHaveLength(3)
  })

  it('passes on skill-valid.md (has name: and description:)', () => {
    const results = runScanner('skillValidity', ROOT_VALID, '', {})
    const valid = results.find((r) => r.file.includes('skill-valid'))
    expect(valid?.status).toBe('pass')
  })

  it('fails on skill-no-frontmatter.md', () => {
    const results = runScanner('skillValidity', ROOT_VALID, '', {})
    const noFm = results.find((r) => r.file.includes('skill-no-frontmatter'))
    expect(noFm?.status).toBe('fail')
  })

  it('fails on skill-no-name.md (missing name:)', () => {
    const results = runScanner('skillValidity', ROOT_VALID, '', {})
    const noName = results.find((r) => r.file.includes('skill-no-name'))
    expect(noName?.status).toBe('fail')
  })

  it('returns skip when .claude/skills directory does not exist', () => {
    const results = runScanner('skillValidity', FIXTURES, '', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('skip')
  })
})

describe('freshnessScore scanner', () => {
  it('passes when commits is 0 (up-to-date)', () => {
    const results = runScanner('freshnessScore', CLAUDE_MD, '0', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('passes when commits is at the warnAfter threshold (30)', () => {
    const results = runScanner('freshnessScore', CLAUDE_MD, '30', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('warns when commits is 50 (between warnAfter=30 and failAfter=100)', () => {
    const results = runScanner('freshnessScore', CLAUDE_MD, '50', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('warn')
  })

  it('fails when commits is 150 (exceeds failAfter=100)', () => {
    const results = runScanner('freshnessScore', CLAUDE_MD, '150', {})
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('fail')
  })

  it('respects custom warnAfter and failAfter', () => {
    const resultsWarn = runScanner('freshnessScore', CLAUDE_MD, '5', { warnAfter: 3, failAfter: 10 })
    expect(resultsWarn[0]?.status).toBe('warn')

    const resultsFail = runScanner('freshnessScore', CLAUDE_MD, '15', { warnAfter: 3, failAfter: 10 })
    expect(resultsFail[0]?.status).toBe('fail')
  })

  it('throws on non-numeric expected value', () => {
    expect(() => runScanner('freshnessScore', CLAUDE_MD, 'not-a-number', {})).toThrow()
  })
})

describe('coverageRatio scanner', () => {
  it('passes when all items are mentioned in the file', () => {
    // CLAUDE.md mentions "User" and "Post" is not in the file; use only User and Next.js
    // Use items we know are in CLAUDE.md
    const results = runScanner('coverageRatio', CLAUDE_MD, '["User","Prisma"]', { minRatio: 1.0 })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
  })

  it('fails when ratio is below minRatio', () => {
    // "TOTALLY_ABSENT_XYZ" is definitely not in CLAUDE.md — 0/1 = 0% < 80%
    const results = runScanner('coverageRatio', CLAUDE_MD, '["TOTALLY_ABSENT_XYZ_123"]', { minRatio: 0.8 })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('fail')
  })

  it('respects valueAllowlist — skips specified items', () => {
    // With TOTALLY_ABSENT_XYZ skipped, only User remains — which is present → pass
    const results = runScanner('coverageRatio', CLAUDE_MD, '["User","TOTALLY_ABSENT_XYZ_123"]', {
      minRatio: 1.0,
      valueAllowlist: ['TOTALLY_ABSENT_XYZ_123'],
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('pass')
    expect(results[0]?.note).toContain('skipped by valueAllowlist')
  })

  it('throws on invalid JSON expected value', () => {
    expect(() => runScanner('coverageRatio', CLAUDE_MD, 'not-json', {})).toThrow()
  })

  it('throws when expected is not a string array', () => {
    expect(() => runScanner('coverageRatio', CLAUDE_MD, '{"key":"value"}', {})).toThrow()
  })

  it('reports actual coverage in actual field', () => {
    const results = runScanner('coverageRatio', CLAUDE_MD, '["User","Prisma"]', {})
    expect(results[0]?.actual).toMatch(/\d+\/\d+ \(\d+%\)/)
  })
})
