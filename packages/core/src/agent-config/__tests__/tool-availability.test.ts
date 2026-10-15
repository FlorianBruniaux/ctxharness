import { afterEach, expect, it } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '../../index.js'
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function root() {
  const r = mkdtempSync(join(tmpdir(), 'ctx-tools-'))
  dirs.push(r)
  return r
}
interface ToolReport {
  results: {
    tool: string
    state: string
    reason: string
    authentication: string
    permissions: string
    advice: string
    pathEntriesChecked: number
  }[]
}
function diagnose(options: object): ToolReport {
  const fn: unknown = Reflect.get(core, 'diagnoseToolAvailability')
  expect(fn).toBeTypeOf('function')
  return (fn as (o: object) => ToolReport)(options)
}
function executable(path: string) {
  writeFileSync(path, '#!/bin/sh\ntouch SHOULD_NEVER_RUN\n')
  chmodSync(path, 0o755)
}
it('resolves only requested tools with explicit environment and leaves auth/permissions unknown', () => {
  const r = root()
  executable(join(r, 'fixture'))
  const report = diagnose({
    tools: ['fixture', 'missing', 'fixture'],
    environment: { identity: 'synthetic-client', path: r, platform: 'posix' },
  })
  expect(report.results.map((r) => r.state)).toEqual(['installed', 'not-found'])
  expect(
    report.results.every((r) => r.authentication === 'unknown' && r.permissions === 'unknown'),
  ).toBe(true)
  expect(report.results.every((r) => r.advice === 'none')).toBe(true)
  expect(existsSync(join(r, 'SHOULD_NEVER_RUN'))).toBe(false)
})
it('keeps an absent client environment unknown even if the current shell resolves a tool', () => {
  expect(diagnose({ tools: ['node'] }).results[0]?.state).toBe('unknown-client-environment')
  expect(
    diagnose({
      tools: ['node'],
      environment: { identity: 'windows-client', path: 'C:\\bin', platform: 'win32' },
    }).results[0]?.state,
  ).toBe('unknown-client-environment')
})
it('handles spaces and shell metacharacters as literal names without execution', () => {
  const r = root()
  for (const name of [
    'with space',
    'tool; touch SHOULD_NEVER_RUN',
    'tool$(touch SHOULD_NEVER_RUN)',
  ])
    executable(join(r, name))
  const b = diagnose({
    tools: [
      'with space',
      'tool; touch SHOULD_NEVER_RUN',
      'tool$(touch SHOULD_NEVER_RUN)',
      '../escape',
      'bad/name',
      'bad\0name',
    ],
    environment: { identity: 'inert', path: r, platform: 'posix' },
  })
  expect(b.results.slice(0, 3).every((r) => r.state === 'installed')).toBe(true)
  expect(
    b.results
      .slice(3)
      .every((r) => r.state === 'unknown-client-environment' && r.reason === 'invalid-tool-name'),
  ).toBe(true)
  expect(existsSync(join(r, 'SHOULD_NEVER_RUN'))).toBe(false)
})
it('deduplicates PATH entries and distinguishes non-executable files', () => {
  const r = root()
  writeFileSync(join(r, 'blocked'), 'inert')
  chmodSync(join(r, 'blocked'), 0o644)
  const b = diagnose({
    tools: ['blocked', 'missing'],
    environment: { identity: 'inert', path: [r, r, r].join(':'), platform: 'posix' },
  })
  expect(b.results.map((r) => r.state)).toEqual(['not-executable', 'not-found'])
  expect(b.results[1]?.pathEntriesChecked).toBe(1)
})
it('makes symlink policy explicit and handles missing or denied directories conservatively', () => {
  const r = root(),
    target = root()
  executable(join(target, 'fixture'))
  symlinkSync(join(target, 'fixture'), join(r, 'alias'))
  symlinkSync(join(target, 'missing'), join(r, 'broken'))
  const environment = { identity: 'inert', path: r, platform: 'posix' }
  expect(diagnose({ tools: ['alias'], environment }).results[0]?.reason).toBe('symlink-rejected')
  expect(diagnose({ tools: ['alias'], environment, symlinks: 'follow' }).results[0]?.state).toBe(
    'installed',
  )
  expect(diagnose({ tools: ['broken'], environment, symlinks: 'follow' }).results[0]?.state).toBe(
    'not-found',
  )
  const denied = join(r, 'denied')
  mkdirSync(denied)
  chmodSync(denied, 0)
  try {
    expect(
      diagnose({ tools: ['missing'], environment: { ...environment, path: denied } }).results[0]
        ?.state,
    ).toBe('unknown-client-environment')
  } finally {
    chmodSync(denied, 0o755)
  }
  expect(
    diagnose({ tools: ['missing'], environment: { ...environment, path: join(r, 'gone') } })
      .results[0]?.state,
  ).toBe('not-found')
})
it('requires an explicit cwd for relative PATH entries and links advice to caller requirements', () => {
  const r = root()
  mkdirSync(join(r, 'bin'))
  executable(join(r, 'bin/fixture'))
  expect(
    diagnose({
      tools: ['fixture'],
      environment: { identity: 'inert', path: 'bin', platform: 'posix' },
    }).results[0]?.state,
  ).toBe('unknown-client-environment')
  expect(
    diagnose({
      tools: ['fixture'],
      environment: { identity: 'inert', path: 'bin', cwd: r, platform: 'posix' },
    }).results[0]?.state,
  ).toBe('installed')
  expect(
    diagnose({
      tools: ['missing'],
      environment: { identity: 'inert', path: r, platform: 'posix' },
      requirements: [{ tool: 'missing', kind: 'project-requirement' }],
    }).results[0]?.advice,
  ).toBe('review-requirement')
})

it('bounds portable tool results and rejects hostile strings or unsupported schemas', () => {
  const r = root()
  executable(join(r, 'HOSTILE-tool'))
  const fn = Reflect.get(core, 'diagnoseToolAvailability') as (o: object) => unknown
  const local = fn({
    tools: ['HOSTILE-tool'],
    environment: { identity: 'HOSTILE-client', path: r, platform: 'posix' },
  })
  const project = Reflect.get(core, 'portableToolAvailability') as (o: unknown) => unknown
  expect(project).toBeTypeOf('function')
  const portable = project(local)
  expect(JSON.stringify(portable)).not.toContain('HOSTILE')
  expect(JSON.stringify(portable)).not.toContain(r)
  const parse = Reflect.get(core, 'PortableToolsSchema') as { parse: (v: unknown) => unknown }
  expect(() => parse.parse({ ...(portable as object), profileVersion: 999 })).toThrow()
  expect(() =>
    parse.parse({ ...(portable as object), results: [{ ref: 'HOSTILE', state: 'installed' }] }),
  ).toThrow()
})
