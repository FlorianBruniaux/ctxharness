import { readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { ExtractorName } from '../config.js'
import { parse as parseToml } from 'smol-toml'

// ─── JSONC parser ────────────────────────────────────────────────────────────
// TypeScript configs often use // comments. Strip them before JSON.parse.
function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  return JSON.parse(stripped)
}

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

function getTomlPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

/**
 * constant — returns a fixed string value
 * Args: { value: string }
 * Useful as a placeholder extractor for quality scanners that define their
 * own expected threshold via scannerArgs rather than comparing against code.
 */
function constant(_root: string, args: ExtractorArgs): ExtractorResult {
  const value = args['value']
  if (typeof value !== 'string') {
    throw new Error('constant extractor requires args.value (string)')
  }
  return value
}

/**
 * prismaModel — counts model blocks in a Prisma schema file
 * Args: { path: string }  — relative path to schema.prisma
 * Returns: count as string (e.g. "34")
 */
function prismaModel(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('prismaModel extractor requires args.path (string)')
  }

  const fullPath = resolve(root, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`Prisma schema not found: ${fullPath}`)
  }

  const content = readFileSync(fullPath, 'utf-8')
  const matches = content.match(/^model\s+\w+\s*\{/gm)
  return matches === null ? '0' : String(matches.length)
}

/**
 * prismaModelList — extracts model names from a Prisma schema file
 * Args: { path: string }  — relative path to schema.prisma
 * Returns: JSON array string of model names (e.g. '["User","Post"]')
 */
function prismaModelList(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('prismaModelList extractor requires args.path (string)')
  }

  const fullPath = resolve(root, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`Prisma schema not found: ${fullPath}`)
  }

  const content = readFileSync(fullPath, 'utf-8')
  const matches = content.match(/^model\s+(\w+)\s*\{/gm)
  if (matches === null) return '[]'

  const names = matches.map((m) => {
    const match = /^model\s+(\w+)/.exec(m)
    return match?.[1] ?? ''
  }).filter((n) => n.length > 0)

  return JSON.stringify(names)
}

/**
 * prismaEnum — counts values in a named Prisma enum block
 * Args: { path: string, enum: string }
 * Returns: value count as string (e.g. "7")
 */
function prismaEnum(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  const enumName = args['enum']

  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('prismaEnum extractor requires args.path (string)')
  }
  if (typeof enumName !== 'string' || enumName.length === 0) {
    throw new Error('prismaEnum extractor requires args.enum (string)')
  }

  const fullPath = resolve(root, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`Prisma schema not found: ${fullPath}`)
  }

  const content = readFileSync(fullPath, 'utf-8')

  // Match the enum block: `enum NAME { ... }`
  const enumRegex = new RegExp(`\\benum\\s+${enumName}\\s*\\{([^}]*)\\}`)
  const match = enumRegex.exec(content)
  if (match === null) {
    throw new Error(`Enum "${enumName}" not found in ${fullPath}`)
  }

  const body = match[1] ?? ''
  // Count non-empty, non-comment lines (each is an enum value)
  const valueLines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('/'))

  return String(valueLines.length)
}

/**
 * trpcRouter — counts registered routers in a tRPC root file
 * Args: { path: string }  — relative path to the root router file (e.g. src/server/api/root.ts)
 * Detects lines matching `  name: someRouter,` inside createTRPCRouter({...})
 * Returns: router count as string (e.g. "34")
 */
function trpcRouter(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('trpcRouter extractor requires args.path (string)')
  }

  const fullPath = resolve(root, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`tRPC root file not found: ${fullPath}`)
  }

  const content = readFileSync(fullPath, 'utf-8')
  // Match router property assignments: `  name: someRouter,` or `  name: createTRPCRouter({`
  const matches = content.match(/^\s+\w+:\s+\w+,?\s*$/gm)
  return matches === null ? '0' : String(matches.length)
}

/**
 * trpcRouterList — extracts router names from a tRPC root file
 * Args: { path: string }  — relative path to the root router file (must be a file, not a directory)
 * Returns: JSON array string of router names (e.g. '["user","post","auth"]')
 */
function trpcRouterList(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('trpcRouterList extractor requires args.path (string)')
  }

  const fullPath = resolve(root, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`tRPC root file not found: ${fullPath}`)
  }

  if (statSync(fullPath).isDirectory()) {
    throw new Error(
      `trpcRouterList: "${filePath}" is a directory. Point to the root router file that calls createTRPCRouter() (e.g. src/server/api/root.ts)`,
    )
  }

  const content = readFileSync(fullPath, 'utf-8')
  const matches = content.match(/^\s+\w+:\s+\w+,?\s*$/gm)
  if (matches === null) return '[]'

  const names = matches.map((m) => {
    const match = /^\s+(\w+):/.exec(m)
    return match?.[1] ?? ''
  }).filter((n) => n.length > 0)

  return JSON.stringify(names)
}

/**
 * gitStaleness — counts how many commits have been made since a file was last changed
 * Args: { path: string }  — relative path to the file
 * Returns: commit count as string (e.g. "5" means 5 commits since last touch, "0" means up-to-date)
 * Useful to surface context files that haven't been updated while the codebase evolved.
 */
function gitStaleness(root: string, args: ExtractorArgs): ExtractorResult {
  const filePath = args['path']
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('gitStaleness extractor requires args.path (string)')
  }

  const fullPath = resolve(root, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`)
  }

  // Get the hash of the last commit that touched this file
  const lastCommit = execFileSync(
    'git',
    ['log', '-1', '--format=%H', '--', filePath],
    { cwd: root, encoding: 'utf-8' },
  ).trim()

  // File exists but has never been committed (untracked or ignored)
  if (lastCommit.length === 0) return '0'

  // Count commits reachable from HEAD but not from lastCommit (commits after last touch)
  const count = execFileSync(
    'git',
    ['rev-list', '--count', 'HEAD', `^${lastCommit}`],
    { cwd: root, encoding: 'utf-8' },
  ).trim()

  return count.length > 0 ? count : '0'
}

/**
 * packageEngines — reads a field from the engines map in package.json
 * Args: { field?: string }  — which engine key to read (default: "node")
 * Returns: version string with leading operators stripped (e.g. ">=22.14.0" → "22.14.0")
 */
function packageEngines(root: string, args: ExtractorArgs): ExtractorResult {
  const field = typeof args['field'] === 'string' ? args['field'] : 'node'

  const pkgPath = resolve(root, 'package.json')
  const pkg = readJson(pkgPath)

  const engines = pkg['engines']
  if (typeof engines !== 'object' || engines === null || Array.isArray(engines)) {
    throw new Error('package.json does not have an "engines" field')
  }

  const rawValue = (engines as Record<string, unknown>)[field]
  if (typeof rawValue !== 'string') {
    throw new Error(`engines.${field} not found or not a string in package.json`)
  }

  return stripVersionPrefix(rawValue)
}

/**
 * tsconfigPaths — counts path aliases defined in tsconfig.json compilerOptions.paths
 * Args: { path?: string }  — relative path to tsconfig (default: "tsconfig.json")
 * Returns: count as string (e.g. "5")
 */
function tsconfigPaths(root: string, args: ExtractorArgs): ExtractorResult {
  const tsconfigFile = typeof args['path'] === 'string' ? args['path'] : 'tsconfig.json'
  const fullPath = resolve(root, tsconfigFile)

  if (!existsSync(fullPath)) {
    throw new Error(`tsconfig not found: ${fullPath}`)
  }

  const raw = readFileSync(fullPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = parseJsonc(raw)
  } catch {
    throw new Error(`Failed to parse ${fullPath} as JSONC`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return '0'
  }

  const compilerOptions = (parsed as Record<string, unknown>)['compilerOptions']
  if (typeof compilerOptions !== 'object' || compilerOptions === null) return '0'

  const paths = (compilerOptions as Record<string, unknown>)['paths']
  if (typeof paths !== 'object' || paths === null) return '0'

  return String(Object.keys(paths).length)
}

/**
 * pyprojectToml — reads versions from pyproject.toml
 * Args: { package?: string, field?: string }
 * - field: dot-path (e.g. "project.version")
 * - package: dep name — searches tool.poetry.dependencies then project.dependencies
 * - neither: returns project.version (PEP 621) or tool.poetry.version
 */
function pyprojectToml(root: string, args: ExtractorArgs): ExtractorResult {
  const pkgName = args['package']
  const field = args['field']

  const pyprojectPath = resolve(root, 'pyproject.toml')
  if (!existsSync(pyprojectPath)) {
    throw new Error('pyproject.toml not found')
  }

  const content = readFileSync(pyprojectPath, 'utf-8')
  const parsed = parseToml(content)

  if (typeof field === 'string' && field.length > 0) {
    const value = getTomlPath(parsed, field)
    if (typeof value !== 'string') {
      throw new Error(`Field "${field}" not found or not a string in pyproject.toml`)
    }
    return stripVersionPrefix(value)
  }

  if (typeof pkgName === 'string' && pkgName.length > 0) {
    const poetryDeps = getTomlPath(parsed, 'tool.poetry.dependencies')
    if (typeof poetryDeps === 'object' && poetryDeps !== null && !Array.isArray(poetryDeps)) {
      const dep = (poetryDeps as Record<string, unknown>)[pkgName]
      if (dep !== undefined) {
        if (typeof dep === 'string') return stripVersionPrefix(dep)
        if (typeof dep === 'object' && dep !== null) {
          const ver = (dep as Record<string, unknown>)['version']
          if (typeof ver === 'string') return stripVersionPrefix(ver)
        }
      }
    }

    const projectDeps = getTomlPath(parsed, 'project.dependencies')
    if (Array.isArray(projectDeps)) {
      for (const dep of projectDeps) {
        if (typeof dep !== 'string') continue
        const match = new RegExp(
          `^${escapeRegex(pkgName)}(?:\\[.*?\\])?\\s*[=><!~]+\\s*([\\d.]+)`,
          'i',
        ).exec(dep)
        if (match !== null && match[1] !== undefined) return match[1]
      }
    }

    throw new Error(`Package "${pkgName}" not found in pyproject.toml`)
  }

  const pep621 = getTomlPath(parsed, 'project.version')
  if (typeof pep621 === 'string') return pep621

  const poetryVer = getTomlPath(parsed, 'tool.poetry.version')
  if (typeof poetryVer === 'string') return poetryVer

  throw new Error('No version found in pyproject.toml')
}

/**
 * requirementsTxt — reads a package version from requirements.txt
 * Args: { package: string, path?: string }
 * Supports: ==, >=, ~=, <=, >, < operators. Extracts first version number found.
 */
function requirementsTxt(root: string, args: ExtractorArgs): ExtractorResult {
  const pkgName = args['package']
  if (typeof pkgName !== 'string' || pkgName.length === 0) {
    throw new Error('requirementsTxt extractor requires args.package (string)')
  }

  const filePath = typeof args['path'] === 'string' ? args['path'] : 'requirements.txt'
  const reqPath = resolve(root, filePath)
  if (!existsSync(reqPath)) {
    throw new Error(`${filePath} not found`)
  }

  const lines = readFileSync(reqPath, 'utf-8').split('\n')
  const pkgRegex = new RegExp(
    `^${escapeRegex(pkgName)}(?:\\[.*?\\])?\\s*[=><!~]+\\s*([\\d.]+)`,
    'i',
  )

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('-')) continue
    const match = pkgRegex.exec(trimmed)
    if (match !== null && match[1] !== undefined) return match[1]
  }

  throw new Error(`Package "${pkgName}" not found in ${filePath}`)
}

/**
 * cargoToml — reads versions from Cargo.toml
 * Args: { package?: string, field?: string }
 * - field: dot-path (e.g. "package.version")
 * - package: crate name — searches dependencies, dev-dependencies, build-dependencies
 * - neither: returns package.version
 */
function cargoToml(root: string, args: ExtractorArgs): ExtractorResult {
  const pkgName = args['package']
  const field = args['field']

  const cargoPath = resolve(root, 'Cargo.toml')
  if (!existsSync(cargoPath)) {
    throw new Error('Cargo.toml not found')
  }

  const content = readFileSync(cargoPath, 'utf-8')
  const parsed = parseToml(content)

  if (typeof field === 'string' && field.length > 0) {
    const value = getTomlPath(parsed, field)
    if (typeof value !== 'string') {
      throw new Error(`Field "${field}" not found or not a string in Cargo.toml`)
    }
    return stripVersionPrefix(value)
  }

  if (typeof pkgName === 'string' && pkgName.length > 0) {
    for (const section of [
      'dependencies',
      'dev-dependencies',
      'build-dependencies',
      'workspace.dependencies',
    ]) {
      const deps = getTomlPath(parsed, section)
      if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) continue
      const dep = (deps as Record<string, unknown>)[pkgName]
      if (dep === undefined) continue
      if (typeof dep === 'string') return stripVersionPrefix(dep)
      if (typeof dep === 'object' && dep !== null) {
        const ver = (dep as Record<string, unknown>)['version']
        if (typeof ver === 'string') return stripVersionPrefix(ver)
      }
    }
    throw new Error(`Crate "${pkgName}" not found in Cargo.toml dependencies`)
  }

  const version =
    getTomlPath(parsed, 'package.version') ?? getTomlPath(parsed, 'workspace.package.version')
  if (typeof version !== 'string') {
    throw new Error('package.version not found in Cargo.toml')
  }
  return version
}

/**
 * goMod — reads a module version from go.mod
 * Args: { module: string }
 * Strips leading "v" from version tags. Handles // indirect entries.
 */
function goMod(root: string, args: ExtractorArgs): ExtractorResult {
  const moduleName = args['module']
  if (typeof moduleName !== 'string' || moduleName.length === 0) {
    throw new Error('goMod extractor requires args.module (string)')
  }

  const goModPath = resolve(root, 'go.mod')
  if (!existsSync(goModPath)) {
    throw new Error('go.mod not found')
  }

  const content = readFileSync(goModPath, 'utf-8')
  const escaped = escapeRegex(moduleName)
  // Matches both block-style (`\t<module> v<ver>`) and single-line (`require <module> v<ver>`)
  const regex = new RegExp(
    `^\\s*(?:require\\s+)?${escaped}\\s+v?([\\d]+(?:\\.[\\d]+)*(?:-[\\w.]+)?)`,
    'gm',
  )
  const match = regex.exec(content)

  if (match === null) {
    throw new Error(`Module "${moduleName}" not found in go.mod`)
  }

  const version = match[1]
  if (version === undefined || version.length === 0) {
    throw new Error(`Cannot parse version for "${moduleName}" in go.mod`)
  }

  return version
}

// ─── Registry ────────────────────────────────────────────────────────────────

const EXTRACTORS: Record<string, ExtractorFn> = {
  packageJson,
  packageManager,
  nvmrc,
  fileExists,
  regexScan,
  countMatches,
  constant,
  prismaModel,
  prismaModelList,
  prismaEnum,
  trpcRouter,
  trpcRouterList,
  gitStaleness,
  packageEngines,
  tsconfigPaths,
  pyprojectToml,
  requirementsTxt,
  cargoToml,
  goMod,
}

/**
 * Register a custom extractor at runtime (plugin API).
 * The name does not need to be in the built-in enum — it is validated at runtime.
 */
export function registerExtractor(name: string, fn: ExtractorFn): void {
  EXTRACTORS[name] = fn
}

export function runExtractor(name: ExtractorName | string, root: string, args: ExtractorArgs): string {
  const fn = EXTRACTORS[name]
  if (fn === undefined) throw new Error(`Unknown extractor: "${name}"`)
  return fn(root, args)
}
