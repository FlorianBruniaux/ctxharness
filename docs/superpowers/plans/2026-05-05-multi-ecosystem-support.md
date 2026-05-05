# Multi-Ecosystem Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ctxharness usable on non-Node.js repos (Python, Go, Rust) with native extractors and distribute as a single binary so Node.js is not required to install or run the tool.

**Architecture:** Two independent phases — Phase 1 adds 4 new extractors (`pyprojectToml`, `requirementsTxt`, `cargoToml`, `goMod`) following the existing extractor pattern exactly; Phase 2 adds binary releases via `bun build --compile` and a GitHub Actions release workflow. Each phase ships value independently.

**Tech Stack:** TypeScript (existing), `smol-toml` (new dep — TOML parser, 0 transitive deps), `bun` (binary build only, not a runtime dep for users), GitHub Actions.

---

## File Map

### Phase 1 — Ecosystem Extractors

| Action | File |
|--------|------|
| Modify | `packages/core/src/config.ts` — add 4 names to `ExtractorNameSchema` |
| Modify | `packages/core/src/extractors/index.ts` — implement 4 extractors + add to registry |
| Modify | `packages/core/package.json` — add `smol-toml` dependency |
| Create | `packages/core/src/__tests__/fixtures/pyproject.toml` |
| Create | `packages/core/src/__tests__/fixtures/requirements.txt` |
| Create | `packages/core/src/__tests__/fixtures/Cargo.toml` |
| Create | `packages/core/src/__tests__/fixtures/go.mod` |
| Modify | `packages/core/src/__tests__/extractors.test.ts` — 4 new `describe` blocks |
| Create | `templates/presets/python.yml` |
| Create | `templates/presets/go.yml` |
| Create | `templates/presets/rust.yml` |
| Modify | `README.md` — add ecosystem table + preset docs |
| Modify | `CLAUDE.md` — update extractor count (15 → 19) |

### Phase 2 — Binary Distribution

| Action | File |
|--------|------|
| Create | `.github/workflows/release.yml` |
| Create | `install.sh` |
| Modify | `README.md` — add binary install section |

---

## Phase 1 — Ecosystem Extractors

### Task 1: TOML dependency + fixture files

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/__tests__/fixtures/pyproject.toml`
- Create: `packages/core/src/__tests__/fixtures/requirements.txt`
- Create: `packages/core/src/__tests__/fixtures/Cargo.toml`
- Create: `packages/core/src/__tests__/fixtures/go.mod`

- [ ] **Step 1: Add smol-toml to core dependencies**

In `packages/core/package.json`, add to `dependencies`:

```json
"smol-toml": "^1.3.1"
```

Full updated `dependencies` block:
```json
"dependencies": {
  "fast-glob": "^3.3.3",
  "js-yaml": "^4.1.0",
  "smol-toml": "^1.3.1",
  "zod": "^3.24.4"
}
```

- [ ] **Step 2: Install the new dependency**

```bash
cd /path/to/ctxharness
pnpm install
```

Expected: `pnpm-lock.yaml` updated, `node_modules/@smol-toml` present.

- [ ] **Step 3: Create pyproject.toml fixture**

Create `packages/core/src/__tests__/fixtures/pyproject.toml`:

```toml
[project]
name = "my-python-app"
version = "1.2.3"
requires-python = ">=3.11"
dependencies = [
    "django>=4.2.0",
    "requests>=2.28.0",
]

[tool.poetry]
name = "my-python-app"
version = "1.2.3"

[tool.poetry.dependencies]
python = "^3.11"
django = "^4.2.0"
sqlalchemy = { version = "^2.0.0", extras = ["asyncio"] }
```

- [ ] **Step 4: Create requirements.txt fixture**

Create `packages/core/src/__tests__/fixtures/requirements.txt`:

```
django==4.2.0
requests>=2.28.0
numpy~=1.24.0
Flask[async]>=2.3.0
# dev
pytest>=7.0.0
```

- [ ] **Step 5: Create Cargo.toml fixture**

Create `packages/core/src/__tests__/fixtures/Cargo.toml`:

```toml
[package]
name = "my-rust-app"
version = "0.3.1"
edition = "2021"

[dependencies]
serde = { version = "1.0.193", features = ["derive"] }
tokio = "1.35.1"

[dev-dependencies]
criterion = "0.5.1"
```

- [ ] **Step 6: Create go.mod fixture**

Create `packages/core/src/__tests__/fixtures/go.mod`:

```
module github.com/myorg/myapp

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)

require github.com/bytedance/sonic v1.9.1 // indirect
```

- [ ] **Step 7: Commit fixtures**

```bash
git add packages/core/package.json pnpm-lock.yaml \
        packages/core/src/__tests__/fixtures/pyproject.toml \
        packages/core/src/__tests__/fixtures/requirements.txt \
        packages/core/src/__tests__/fixtures/Cargo.toml \
        packages/core/src/__tests__/fixtures/go.mod
git commit -m "chore: add smol-toml dep + ecosystem fixture files"
```

---

### Task 2: Config schema — add 4 extractor names

**Files:**
- Modify: `packages/core/src/config.ts:6-22`

- [ ] **Step 1: Write failing test to confirm new names are not yet valid**

Add temporarily to `packages/core/src/__tests__/extractors.test.ts` (remove after schema update):

```typescript
describe('config schema — ecosystem extractor names', () => {
  it('pyprojectToml is a valid ExtractorName', () => {
    // If this import fails to typecheck, the schema is missing the name
    const name: import('../config.js').ExtractorName = 'pyprojectToml'
    expect(name).toBe('pyprojectToml')
  })
})
```

Run:
```bash
pnpm lint
```
Expected: TypeScript error — `'pyprojectToml' is not assignable to type 'ExtractorName'`

- [ ] **Step 2: Add 4 names to ExtractorNameSchema**

In `packages/core/src/config.ts`, update `ExtractorNameSchema`:

```typescript
const ExtractorNameSchema = z.enum([
  'packageJson',
  'packageManager',
  'nvmrc',
  'fileExists',
  'regexScan',
  'countMatches',
  'constant',
  'prismaModel',
  'prismaEnum',
  'prismaModelList',
  'trpcRouter',
  'trpcRouterList',
  'gitStaleness',
  'packageEngines',
  'tsconfigPaths',
  'pyprojectToml',
  'requirementsTxt',
  'cargoToml',
  'goMod',
])
```

- [ ] **Step 3: Run lint to confirm no TypeScript errors**

```bash
pnpm lint
```
Expected: no errors.

- [ ] **Step 4: Remove the temporary test, commit**

Remove the temporary describe block added in Step 1, then:

```bash
git add packages/core/src/config.ts packages/core/src/__tests__/extractors.test.ts
git commit -m "feat(config): add pyprojectToml, requirementsTxt, cargoToml, goMod to schema"
```

---

### Task 3: Python extractors — `pyprojectToml` + `requirementsTxt`

**Files:**
- Modify: `packages/core/src/extractors/index.ts`
- Modify: `packages/core/src/__tests__/extractors.test.ts`

- [ ] **Step 1: Write failing tests for pyprojectToml**

Append to `packages/core/src/__tests__/extractors.test.ts`:

```typescript
describe('pyprojectToml extractor', () => {
  it('returns project.version by default (PEP 621)', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, {})).toBe('1.2.3')
  })
  it('returns dependency version from PEP 621 dependencies array', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, { package: 'requests' })).toBe('2.28.0')
  })
  it('returns dependency version from tool.poetry.dependencies (string)', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, { package: 'django' })).toBe('4.2.0')
  })
  it('returns dependency version from tool.poetry.dependencies (object)', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, { package: 'sqlalchemy' })).toBe('2.0.0')
  })
  it('returns field value via dot-path', () => {
    expect(runExtractor('pyprojectToml', FIXTURES, { field: 'project.name' })).toBe('my-python-app')
  })
  it('throws for unknown package', () => {
    expect(() =>
      runExtractor('pyprojectToml', FIXTURES, { package: 'nonexistent-xyz' })
    ).toThrow()
  })
})
```

- [ ] **Step 2: Write failing tests for requirementsTxt**

Append to the same test file:

```typescript
describe('requirementsTxt extractor', () => {
  it('extracts == pinned version', () => {
    expect(runExtractor('requirementsTxt', FIXTURES, { package: 'django' })).toBe('4.2.0')
  })
  it('extracts >= version', () => {
    expect(runExtractor('requirementsTxt', FIXTURES, { package: 'requests' })).toBe('2.28.0')
  })
  it('extracts ~= version', () => {
    expect(runExtractor('requirementsTxt', FIXTURES, { package: 'numpy' })).toBe('1.24.0')
  })
  it('extracts package with extras notation', () => {
    expect(runExtractor('requirementsTxt', FIXTURES, { package: 'Flask' })).toBe('2.3.0')
  })
  it('throws when package not found', () => {
    expect(() =>
      runExtractor('requirementsTxt', FIXTURES, { package: 'nonexistent-xyz' })
    ).toThrow()
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
pnpm vitest run packages/core/src/__tests__/extractors.test.ts
```
Expected: all new tests FAIL with `Unknown extractor: "pyprojectToml"` and `Unknown extractor: "requirementsTxt"`.

- [ ] **Step 4: Add import for smol-toml in extractors/index.ts**

At the top of `packages/core/src/extractors/index.ts`, add after existing imports:

```typescript
import { parse as parseToml } from 'smol-toml'
```

- [ ] **Step 5: Add TOML path navigation helper**

After the `stripVersionPrefix` helper in `packages/core/src/extractors/index.ts`, add:

```typescript
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
```

- [ ] **Step 6: Implement pyprojectToml extractor**

Add the following function in `packages/core/src/extractors/index.ts`, before the `// ─── Registry` comment:

```typescript
/**
 * pyprojectToml — reads versions from pyproject.toml
 * Args: { package?: string, field?: string }
 * - field: dot-path to TOML field (e.g. "project.version")
 * - package: dependency name — searches tool.poetry.dependencies then project.dependencies
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
    // 1. Poetry format: [tool.poetry.dependencies]
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

    // 2. PEP 621 format: [project] dependencies array of strings
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

  // Default: project.version (PEP 621) then tool.poetry.version
  const pep621 = getTomlPath(parsed, 'project.version')
  if (typeof pep621 === 'string') return pep621

  const poetryVer = getTomlPath(parsed, 'tool.poetry.version')
  if (typeof poetryVer === 'string') return poetryVer

  throw new Error('No version found in pyproject.toml')
}
```

- [ ] **Step 7: Implement requirementsTxt extractor**

Add immediately after `pyprojectToml` in the same file:

```typescript
/**
 * requirementsTxt — reads a package version from requirements.txt
 * Args: { package: string, path?: string }
 * Supports: ==, >=, ~=, <=, >, <, != operators. Extracts first version number found.
 * Default path: requirements.txt
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
```

- [ ] **Step 8: Register both extractors**

In the `EXTRACTORS` registry object (near bottom of `packages/core/src/extractors/index.ts`), add:

```typescript
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
  pyprojectToml,    // new
  requirementsTxt,  // new
}
```

- [ ] **Step 9: Run tests to confirm Python extractors pass**

```bash
pnpm vitest run packages/core/src/__tests__/extractors.test.ts
```
Expected: all `pyprojectToml` and `requirementsTxt` tests PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/extractors/index.ts packages/core/src/__tests__/extractors.test.ts
git commit -m "feat(extractors): add pyprojectToml and requirementsTxt extractors"
```

---

### Task 4: Rust extractor — `cargoToml`

**Files:**
- Modify: `packages/core/src/extractors/index.ts`
- Modify: `packages/core/src/__tests__/extractors.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/core/src/__tests__/extractors.test.ts`:

```typescript
describe('cargoToml extractor', () => {
  it('returns package.version by default', () => {
    expect(runExtractor('cargoToml', FIXTURES, {})).toBe('0.3.1')
  })
  it('returns dependency version in string format', () => {
    expect(runExtractor('cargoToml', FIXTURES, { package: 'tokio' })).toBe('1.35.1')
  })
  it('returns dependency version in object format', () => {
    expect(runExtractor('cargoToml', FIXTURES, { package: 'serde' })).toBe('1.0.193')
  })
  it('returns dev-dependency version', () => {
    expect(runExtractor('cargoToml', FIXTURES, { package: 'criterion' })).toBe('0.5.1')
  })
  it('returns field value via dot-path', () => {
    expect(runExtractor('cargoToml', FIXTURES, { field: 'package.name' })).toBe('my-rust-app')
  })
  it('throws for unknown crate', () => {
    expect(() =>
      runExtractor('cargoToml', FIXTURES, { package: 'nonexistent-xyz' })
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm vitest run packages/core/src/__tests__/extractors.test.ts --reporter=verbose 2>&1 | grep -E "cargoToml|FAIL|PASS"
```
Expected: all `cargoToml` tests FAIL with `Unknown extractor`.

- [ ] **Step 3: Implement cargoToml extractor**

Add after `requirementsTxt` in `packages/core/src/extractors/index.ts`:

```typescript
/**
 * cargoToml — reads versions from Cargo.toml
 * Args: { package?: string, field?: string }
 * - field: dot-path to TOML field (e.g. "package.version")
 * - package: crate name — searches dependencies, dev-dependencies, build-dependencies
 * - neither: returns package.version (the crate's own version)
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
    for (const section of ['dependencies', 'dev-dependencies', 'build-dependencies']) {
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

  const version = getTomlPath(parsed, 'package.version')
  if (typeof version !== 'string') {
    throw new Error('package.version not found in Cargo.toml')
  }
  return version
}
```

- [ ] **Step 4: Register cargoToml**

In the `EXTRACTORS` registry, add `cargoToml` after `requirementsTxt`:

```typescript
const EXTRACTORS: Record<string, ExtractorFn> = {
  // ... existing entries ...
  pyprojectToml,
  requirementsTxt,
  cargoToml,   // new
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run packages/core/src/__tests__/extractors.test.ts
```
Expected: all `cargoToml` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/extractors/index.ts packages/core/src/__tests__/extractors.test.ts
git commit -m "feat(extractors): add cargoToml extractor"
```

---

### Task 5: Go extractor — `goMod`

**Files:**
- Modify: `packages/core/src/extractors/index.ts`
- Modify: `packages/core/src/__tests__/extractors.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/core/src/__tests__/extractors.test.ts`:

```typescript
describe('goMod extractor', () => {
  it('extracts module version from require block', () => {
    expect(
      runExtractor('goMod', FIXTURES, { module: 'github.com/gin-gonic/gin' })
    ).toBe('1.9.1')
  })
  it('extracts version with // indirect comment', () => {
    expect(
      runExtractor('goMod', FIXTURES, { module: 'github.com/bytedance/sonic' })
    ).toBe('1.9.1')
  })
  it('throws for unknown module', () => {
    expect(() =>
      runExtractor('goMod', FIXTURES, { module: 'github.com/nonexistent/pkg' })
    ).toThrow()
  })
  it('throws when module arg is missing', () => {
    expect(() => runExtractor('goMod', FIXTURES, {})).toThrow()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm vitest run packages/core/src/__tests__/extractors.test.ts --reporter=verbose 2>&1 | grep -E "goMod|FAIL"
```
Expected: all `goMod` tests FAIL with `Unknown extractor`.

- [ ] **Step 3: Implement goMod extractor**

Add after `cargoToml` in `packages/core/src/extractors/index.ts`:

```typescript
/**
 * goMod — reads a module version from go.mod
 * Args: { module: string }
 * Strips leading "v" from version tags.
 * Handles both inline and parenthesized require blocks, including // indirect entries.
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
  // Matches: "    github.com/foo/bar v1.2.3" or "    github.com/foo/bar v1.2.3 // indirect"
  const regex = new RegExp(`^\\s*${escaped}\\s+v?([\\d]+(?:\\.[\\d]+)*(?:-[\\w.]+)?)`, 'gm')
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
```

- [ ] **Step 4: Register goMod**

In the `EXTRACTORS` registry, add `goMod`:

```typescript
const EXTRACTORS: Record<string, ExtractorFn> = {
  // ... existing entries ...
  pyprojectToml,
  requirementsTxt,
  cargoToml,
  goMod,   // new
}
```

- [ ] **Step 5: Run all tests**

```bash
pnpm test
```
Expected: all 102+ tests pass (4 new `goMod` tests added).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/extractors/index.ts packages/core/src/__tests__/extractors.test.ts
git commit -m "feat(extractors): add goMod extractor"
```

---

### Task 6: Presets — python.yml, go.yml, rust.yml

**Files:**
- Create: `templates/presets/python.yml`
- Create: `templates/presets/go.yml`
- Create: `templates/presets/rust.yml`

No tests needed (presets are config templates, not code). Validate by loading each through `loadConfig`.

- [ ] **Step 1: Create python.yml preset**

Create `templates/presets/python.yml`:

```yaml
version: 1

files:
  include:
    - 'CLAUDE.md'
    - 'AGENTS.md'
    - '.cursorrules'
    - 'docs/**/*.md'
  exclude:
    - '.venv/**'
    - '__pycache__/**'

assertions:
  # L1 — fact drift
  - id: project-version
    extractor: pyprojectToml
    scanner: inlineRegex
    scannerArgs:
      pattern: 'v?(\d+\.\d+\.\d+)'

  - id: django-version
    extractor: pyprojectToml
    extractorArgs:
      package: django
    scanner: inlineRegex
    scannerArgs:
      pattern: 'Django\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'

  - id: python-version
    extractor: regexScan
    extractorArgs:
      path: '.python-version'
      pattern: '(\d+\.\d+(?:\.\d+)?)'
    scanner: inlineRegex
    scannerArgs:
      pattern: 'Python\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'

  # L2 — instruction quality
  - id: no-vague-language
    extractor: constant
    extractorArgs:
      value: check
    scanner: vaguenessPattern

  - id: instruction-balance
    extractor: constant
    extractorArgs:
      value: check
    scanner: negativeConstraintDensity
    scannerArgs:
      minRatio: 2.0

  # L3 — context freshness
  - id: claude-md-freshness
    extractor: gitStaleness
    extractorArgs:
      path: CLAUDE.md
    scanner: freshnessScore
    scannerArgs:
      warnAfter: 30
      failAfter: 100
```

- [ ] **Step 2: Create go.yml preset**

Create `templates/presets/go.yml`:

```yaml
version: 1

files:
  include:
    - 'CLAUDE.md'
    - 'AGENTS.md'
    - 'docs/**/*.md'
  exclude:
    - 'vendor/**'

assertions:
  # L1 — fact drift
  - id: go-toolchain-version
    extractor: regexScan
    extractorArgs:
      path: 'go.mod'
      pattern: '^go\s+(\d+\.\d+)'
    scanner: inlineRegex
    scannerArgs:
      pattern: 'Go\s+v?(\d+\.\d+(?:\.\d+)?)'

  - id: gin-version
    extractor: goMod
    extractorArgs:
      module: github.com/gin-gonic/gin
    scanner: inlineRegex
    scannerArgs:
      pattern: 'gin\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'

  # L2 — instruction quality
  - id: no-vague-language
    extractor: constant
    extractorArgs:
      value: check
    scanner: vaguenessPattern

  - id: instruction-balance
    extractor: constant
    extractorArgs:
      value: check
    scanner: negativeConstraintDensity
    scannerArgs:
      minRatio: 2.0

  # L3 — context freshness
  - id: claude-md-freshness
    extractor: gitStaleness
    extractorArgs:
      path: CLAUDE.md
    scanner: freshnessScore
    scannerArgs:
      warnAfter: 30
      failAfter: 100
```

- [ ] **Step 3: Create rust.yml preset**

Create `templates/presets/rust.yml`:

```yaml
version: 1

files:
  include:
    - 'CLAUDE.md'
    - 'AGENTS.md'
    - 'docs/**/*.md'
  exclude:
    - 'target/**'

assertions:
  # L1 — fact drift
  - id: crate-version
    extractor: cargoToml
    scanner: inlineRegex
    scannerArgs:
      pattern: 'v?(\d+\.\d+\.\d+)'

  - id: tokio-version
    extractor: cargoToml
    extractorArgs:
      package: tokio
    scanner: inlineRegex
    scannerArgs:
      pattern: 'tokio\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'

  - id: serde-version
    extractor: cargoToml
    extractorArgs:
      package: serde
    scanner: inlineRegex
    scannerArgs:
      pattern: 'serde\s+v?(\d+(?:\.\d+(?:\.\d+)?)?)'

  # L2 — instruction quality
  - id: no-vague-language
    extractor: constant
    extractorArgs:
      value: check
    scanner: vaguenessPattern

  - id: instruction-balance
    extractor: constant
    extractorArgs:
      value: check
    scanner: negativeConstraintDensity
    scannerArgs:
      minRatio: 2.0

  # L3 — context freshness
  - id: claude-md-freshness
    extractor: gitStaleness
    extractorArgs:
      path: CLAUDE.md
    scanner: freshnessScore
    scannerArgs:
      warnAfter: 100
      failAfter: 300
```

- [ ] **Step 4: Validate presets parse correctly**

```bash
node -e "
const { loadConfig } = await import('./packages/core/dist/index.js')
loadConfig('./templates/presets/python.yml')
loadConfig('./templates/presets/go.yml')
loadConfig('./templates/presets/rust.yml')
console.log('All presets valid')
" --input-type=module
```

Note: run `pnpm build` first if `dist/` is stale.

- [ ] **Step 5: Commit**

```bash
git add templates/presets/python.yml templates/presets/go.yml templates/presets/rust.yml
git commit -m "feat(presets): add python, go, rust stack presets"
```

---

### Task 7: Docs update for Phase 1

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README.md — extractor table**

In the Extractors table, add 4 rows after `tsconfigPaths`:

```markdown
| `pyprojectToml` | Version from `pyproject.toml` — Poetry and PEP 621 formats | `package?: string`, `field?: string` |
| `requirementsTxt` | Package version from `requirements.txt` | `package: string`, `path?: string` |
| `cargoToml` | Version from `Cargo.toml` — crate or dependency | `package?: string`, `field?: string` |
| `goMod` | Module version from `go.mod` | `module: string` |
```

- [ ] **Step 2: Update README.md — presets table**

In the Stack presets table, add 3 rows:

```markdown
| Python | `templates/presets/python.yml` | python version, pyproject.toml deps + quality assertions |
| Go | `templates/presets/go.yml` | go toolchain version, go.mod deps + quality assertions |
| Rust | `templates/presets/rust.yml` | crate version, Cargo.toml deps + quality assertions |
```

- [ ] **Step 3: Update CLAUDE.md — extractor count**

In `CLAUDE.md` Key files table, change:

```markdown
| `packages/core/src/extractors/index.ts` | 19 extractors (ground truth from code) |
```

And in the Commands section, update the test count:

```bash
pnpm test            # vitest (106+ tests)
```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update extractor table and presets for multi-ecosystem support"
```

---

## Phase 2 — Binary Distribution

### Task 8: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create .github/workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create release.yml**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    name: Build ${{ matrix.target }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            target: linux-x64
            exe: ''
          - os: ubuntu-24.04-arm
            target: linux-arm64
            exe: ''
          - os: macos-latest
            target: darwin-arm64
            exe: ''
          - os: windows-latest
            target: windows-x64
            exe: .exe

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build binary
        run: >
          bun build packages/cli/src/index.ts
          --compile
          --target bun-${{ matrix.target }}
          --outfile dist/ctxharness-${{ matrix.target }}${{ matrix.exe }}

      - name: Upload to release
        uses: softprops/action-gh-release@v2
        with:
          files: dist/ctxharness-${{ matrix.target }}${{ matrix.exe }}
          generate_release_notes: true
```

- [ ] **Step 3: Test locally that bun can compile the CLI**

```bash
bun build packages/cli/src/index.ts --compile --outfile /tmp/ctxharness-test
/tmp/ctxharness-test --version
```

Expected output: `0.1.0`

If bun is not installed: `npm install -g bun` or `brew install bun`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions release workflow — builds binaries for linux/macos/windows"
```

---

### Task 9: Install script + README binary section

**Files:**
- Create: `install.sh`
- Modify: `README.md`

- [ ] **Step 1: Create install.sh**

Create `install.sh` at the project root:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="FlorianBruniaux/ctxharness"
INSTALL_DIR="${CTXHARNESS_INSTALL:-/usr/local/bin}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64)          ARCH="x64" ;;
  aarch64|arm64)   ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

case "$OS" in
  linux|darwin) ;;
  *)
    echo "Unsupported OS: $OS — on Windows download from: https://github.com/${REPO}/releases/latest" >&2
    exit 1
    ;;
esac

TARGET="${OS}-${ARCH}"
VERSION=$(curl -sf "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
  echo "Could not determine latest version. Check https://github.com/${REPO}/releases" >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${VERSION}/ctxharness-${TARGET}"

echo "Installing ctxharness ${VERSION} for ${TARGET} → ${INSTALL_DIR}/ctxharness"
curl -fL "$URL" -o /tmp/ctxharness-download
chmod +x /tmp/ctxharness-download
mv /tmp/ctxharness-download "${INSTALL_DIR}/ctxharness"

echo "Done."
ctxharness --version
```

Make it executable:

```bash
chmod +x install.sh
```

- [ ] **Step 2: Update README.md — Install section**

Replace the existing Install section with:

```markdown
## Install

**npm/pnpm (Node.js projects):**
```bash
npm install -g ctxharness
# or
pnpm add -D ctxharness
```

**Single binary (Python, Go, Rust, or any non-Node project):**
```bash
# macOS / Linux — no Node.js required
curl -fsSL https://raw.githubusercontent.com/FlorianBruniaux/ctxharness/main/install.sh | bash
```

Or download a binary directly from [GitHub Releases](https://github.com/FlorianBruniaux/ctxharness/releases/latest):

| Platform | File |
|----------|------|
| Linux x64 | `ctxharness-linux-x64` |
| Linux arm64 | `ctxharness-linux-arm64` |
| macOS Apple Silicon | `ctxharness-darwin-arm64` |
| Windows x64 | `ctxharness-windows-x64.exe` |
```

- [ ] **Step 3: Commit**

```bash
git add install.sh README.md
git commit -m "feat: add install.sh + binary distribution docs"
```

---

## Self-Review

### Spec coverage

| Requirement | Covered by |
|-------------|------------|
| Python deps from pyproject.toml (Poetry + PEP 621) | Task 3 — `pyprojectToml` |
| Python deps from requirements.txt | Task 3 — `requirementsTxt` |
| Rust deps from Cargo.toml | Task 4 — `cargoToml` |
| Go deps from go.mod | Task 5 — `goMod` |
| Config schema updated | Task 2 |
| Presets for new ecosystems | Task 6 |
| TDD with fixtures | Tasks 1, 3, 4, 5 |
| Docs updated | Tasks 7, 9 |
| Binary distribution | Tasks 8, 9 |
| No Node.js required for binary users | Task 9 — install.sh |

### No placeholders

All code blocks are complete. All test expectations use concrete values from fixture files. All commands have expected outputs.

### Type consistency

- `pyprojectToml`, `requirementsTxt`, `cargoToml`, `goMod` are registered in `EXTRACTORS` registry as `ExtractorFn`
- All return `string` (via `ExtractorResult` = `string`)
- `getTomlPath` and `escapeRegex` helpers are shared across extractors 3 and 4
- `stripVersionPrefix` is the existing helper, reused as-is
- Config schema names match registry keys exactly
