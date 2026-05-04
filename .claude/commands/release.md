# Release ctxharness

Bump version, update CHANGELOG, build, test, tag, publish.

## Steps

1. **Determine bump type** from argument: `patch` | `minor` | `major`
2. **Read current version** from `packages/core/package.json`
3. **Compute new version** (semver bump)
4. **Update version** in:
   - `packages/core/package.json`
   - `packages/cli/package.json`
   - `package.json` (root, if it has version)
5. **Update CHANGELOG.md**: rename `[Unreleased]` to `[vX.Y.Z] - YYYY-MM-DD`, add new empty `[Unreleased]` section
6. **Build**: `pnpm build`
7. **Test**: `pnpm test`
8. **Commit**: `git commit -am "release: vX.Y.Z"`
9. **Tag**: `git tag vX.Y.Z`
10. **Push**: `git push && git push --tags`
11. **Publish**: `pnpm -r publish --no-git-checks #confirmed`

## Usage

```
/release patch    # 0.1.0 → 0.1.1
/release minor    # 0.1.0 → 0.2.0
/release major    # 0.1.0 → 1.0.0
```

## Pre-flight checklist

- [ ] `pnpm test` passes (31 tests)
- [ ] `CHANGELOG.md [Unreleased]` has content
- [ ] No uncommitted changes after release commit
- [ ] Both `packages/*/package.json` have matching versions
