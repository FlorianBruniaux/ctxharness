# Conventional Commit

Create a git commit following conventional commits format for ctxharness.

## Steps

1. Run `git status` and `git diff --staged` to see what's staged
2. If nothing staged, run `git add -p` guidance or ask user what to stage
3. Draft commit message:
   - Format: `type(scope): short description`
   - Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`
   - Scopes: `core`, `cli`, `extractors`, `scanners`, `runner`, `reporter`, `config`, `gha`, `hooks`
4. Commit with: `git commit -m "type(scope): description"`

## Examples

```
feat(extractors): add prismaEnum extractor for schema drift detection
fix(scanners): handle empty YAML field gracefully
test(runner): add integration test for no-mention status
docs(readme): add v0.2 stack-aware extractor table
chore(deps): bump zod to 3.24.5
build(gha): add node-version matrix to CI workflow
```

## Rules

- Subject line max 72 chars, no period at end
- Body optional: explain WHY not WHAT
- Never `--no-verify`
- Never amend published commits
