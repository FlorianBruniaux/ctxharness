import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExtractorName } from '../config.js'

export type ExtractorResult = string // ground truth value

export type ExtractorArgs = Record<string, unknown>

export type ExtractorFn = (root: string, args: ExtractorArgs) => ExtractorResult

// ─── Helpers ────────────────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object at ${filePath}`)
  }
  return parsed as Record<string, unknown>
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key]
  return typeof val === 'string' ? val : undefined
}

function stripVersionPrefix(version: string): string {
  return version.replace(/^[~^>=<!]+/, '')
}

// ─── Extractors ─────────────────────────────────────────────────────────────

/**
 * packageJson — reads a package version from package.json
 * Args: { package: string }
 */
function packageJson(root: string, args: ExtractorArgs): ExtractorResult {
  const pkgName = args['package']
  if (typeof pkgName !== 'string' || pkgName.length === 0) {
    throw new Error('packageJson extractor requires args.package (string)')
  }

  const pkgPath = resolve(root, 'package.json')
  const pkg = readJson(pkgPath)

  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const section = pkg[depField]
    if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
      const depMap = section as Record<string, unknown>
      const version = getString(depMap, pkgName)
      if (version !== undefined) {
        return stripVersionPrefix(version)
      }
    }
  }

  throw new Error(
    `Package "${pkgName}" not found in dependencies, devDependencies, or peerDependencies`,
  )
}

/**
 * packageManager — reads the packageManager field from package.json
 * Args: none
 * Format: "pnpm@10.2.1+sha512.abc..." → returns "10.2.1"
 */
function packageManager(root: string, _args: ExtractorArgs): ExtractorResult {
  const pkgPath = resolve(root, 'package.json')
  const pkg = readJson(pkgPath)

  const field = getString(pkg, 'packageManager')
  if (field === undefined) {
    throw new Error('package.json does not have a "packageManager" field')
  }

  // Format: "pnpm@10.2.1+sha512.abc..." — extract the version between @ and +
  const match = /^[^@]+@([^+]+)/.exec(field)
  if (match === null) {
    throw new Error(`Cannot parse packageManager field: "${field}"`)
  }

  const version = match[1]
  if (version === undefined || version.length === 0) {
    throw new Error(`Empty version in packageManager field: "${field}"`)
  }

  return version
}

/**
 * nvmrc — reads .nvmrc and returns the node version
 * Args: none
 * Strips leading "v" if present ("v22" → "22")
 */
function nvmrc(root: string, _args: ExtractorArgs): ExtractorResult {
  const nvmrcPath = resolve(root, '.nvmrc')
  if (!existsSync(nvmrcPath)) {
    throw new Error('.nvmrc file not found')
  }

  const raw = readFileSync(nvmrcPath, 'utf-8').trim()
  return raw.startsWith('v') ? raw.slice(1) : raw
}

/**
 * fileExists — returns "true" or "false" based on whether a file exists
 * Args: { path: string }
 */
function fileExists(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('fileExists extractor requires args.path (string)')
  }

  return existsSync(resolve(root, filePath)) ? 'true' : 'false'
}

/**
 * regexScan — scans a file with a regex and returns a capture group
 * Args: { path: string, pattern: string, group?: number }
 */
function regexScan(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  const pattern = args['pattern']

  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('regexScan extractor requires args.path (string)')
  }
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('regexScan extractor requires args.pattern (string)')
  }

  const groupIndex = typeof args['group'] === 'number' ? args['group'] : 1

  const fullPath = resolve(root, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`)
  }

  const content = readFileSync(fullPath, 'utf-8')
  const regex = new RegExp(pattern, 'g')
  const match = regex.exec(content)

  if (match === null) {
    throw new Error(`No match found for pattern "${pattern}" in ${fullPath}`)
  }

  const captured = match[groupIndex]
  if (captured === undefined) {
    throw new Error(
      `Capture group ${groupIndex} is undefined for pattern "${pattern}" in ${fullPath}`,
    )
  }

  return captured
}

/**
 * countMatches — counts all non-overlapping regex matches in a file
 * Args: { path: string, pattern: string }
 */
function countMatches(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  const pattern = args['pattern']

  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('countMatches extractor requires args.path (string)')
  }
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('countMatches extractor requires args.pattern (string)')
  }

  const fullPath = resolve(root, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`)
  }

  const content = readFileSync(fullPath, 'utf-8')
  const regex = new RegExp(pattern, 'g')
  const matches = content.match(regex)

  return matches === null ? '0' : String(matches.length)
}

// ─── Registry ────────────────────────────────────────────────────────────────

const EXTRACTORS: Record<ExtractorName, ExtractorFn> = {
  packageJson,
  packageManager,
  nvmrc,
  fileExists,
  regexScan,
  countMatches,
}

export function runExtractor(name: ExtractorName, root: string, args: ExtractorArgs): string {
  const fn = EXTRACTORS[name]
  return fn(root, args)
}
