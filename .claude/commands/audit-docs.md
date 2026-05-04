---
name: audit-docs
description: Audit repository documentation against 30 best practices — root files, structure, machine-readable, automation, quality. Produces a scored report. Use before releases or when onboarding a new contributor.
argument-hint: "[--generate to create missing files]"
---

# Documentation Audit

Score this repository's documentation against 30 criteria across 5 categories.

## Usage

```
/audit-docs              # Audit only, generate markdown report
/audit-docs --generate   # Audit + propose creating missing files
```

---

## Phase 1: Discovery

```bash
ls -la README.md VERSION CHANGELOG.md CLAUDE.md CONTRIBUTING.md LICENSE .gitignore 2>/dev/null
ls -la docs/ guide/ 2>/dev/null
find examples/ -type f 2>/dev/null | head -10
grep -n "Quick Start\|Getting Started\|Installation" README.md 2>/dev/null | head -3
grep -c "\!\[.*\](.*badge.*)" README.md 2>/dev/null || echo "0"
head -20 CHANGELOG.md 2>/dev/null
cat VERSION 2>/dev/null
```

---

## Phase 2: Evaluation (30 Criteria)

Score each as: ✅ (present) / ⚠️ (partial) / ❌ (missing)

### Category 1: Root Files (8 criteria, weight ×3)

| # | Criterion | Detection |
|---|-----------|-----------|
| 1.1 | README.md with Quick Start < 40 lines | `head -50 README.md | grep -n "Quick Start"` |
| 1.2 | VERSION (single semver line) | `cat VERSION` matches `^\d+\.\d+\.\d+$` |
| 1.3 | CHANGELOG.md (Keep a Changelog format) | Has `## [Unreleased]` or `## [x.y.z]` sections |
| 1.4 | CLAUDE.md (project instructions) | File exists with > 10 lines |
| 1.5 | CONTRIBUTING.md | File exists |
| 1.6 | LICENSE | File exists |
| 1.7 | .gitignore (categorized sections) | Has comment sections `# Category` |
| 1.8 | Functional badges in README | At least 2 badge images |

### Category 2: Documentation Structure (7 criteria, weight ×2)

| # | Criterion |
|---|-----------|
| 2.1 | Dedicated docs/ or guide/ folder |
| 2.2 | Metadata in docs (YAML frontmatter) |
| 2.3 | Table of Contents with anchors |
| 2.4 | TL;DR or Quick Start section |
| 2.5 | Time estimates mentioned |
| 2.6 | Cheatsheet available |
| 2.7 | Examples in dedicated folder (> 3 files) |

### Category 3: Machine-Readable (5 criteria, weight ×1)

| # | Criterion |
|---|-----------|
| 3.1 | llms.txt or equivalent |
| 3.2 | Index YAML/JSON < 3K tokens |
| 3.3 | Line numbers in doc references |
| 3.4 | Version synchronized across files |
| 3.5 | Keywords/tags in frontmatter |

### Category 4: Automation (5 criteria, weight ×1)

| # | Criterion |
|---|-----------|
| 4.1 | Version sync script |
| 4.2 | Check/verify script |
| 4.3 | --check mode (dry-run) |
| 4.4 | CI/CD integration |
| 4.5 | Slash commands documented |

### Category 5: Quality (5 criteria, weight ×2)

| # | Criterion |
|---|-----------|
| 5.1 | Tables for structured data (≥3 tables) |
| 5.2 | Code blocks with language hints |
| 5.3 | Collapsibles for optional content (`<details>`) |
| 5.4 | Cross-references functional |
| 5.5 | Footer with version or date |

---

## Phase 3: Scoring

```
Max points:
  Root Files:    8 × 3 = 24
  Structure:     7 × 2 = 14
  Machine-Read:  5 × 1 = 5
  Automation:    5 × 1 = 5
  Quality:       5 × 2 = 10
  ─────────────────────────
  Total:         58 points
```

| Score | Grade | Status |
|-------|-------|--------|
| 90–100 | A | Excellent |
| 75–89 | B | Good |
| 60–74 | C | Needs work |
| 40–59 | D | Significant gaps |
| 0–39 | F | Critical issues |

---

## Phase 4: Report

Output:

```markdown
# Documentation Audit Report

**Repository**: ctxharness
**Date**: {current_date}
**Score**: {score}/100 ({grade})

## Summary

| Category | Score | Status |
|----------|-------|--------|
| Root Files | {x}/8 | {emoji} {percent}% |
| Structure | {x}/7 | {emoji} {percent}% |
| Machine-Readable | {x}/5 | {emoji} {percent}% |
| Automation | {x}/5 | {emoji} {percent}% |
| Quality | {x}/5 | {emoji} {percent}% |

## Critical Issues (Priority 1)
{missing Root Files items}

## Recommended Improvements (Priority 2)
{missing Structure and Quality items}

## Quick Wins (Priority 3)
{easy items from any category — < 5 min}
```

---

## Phase 5: Optional Generation (--generate)

If `$ARGUMENTS` contains `--generate`:

1. List all missing files that would be created
2. Ask: "Create these N files? (y/n)"
3. On approval, create files using standard templates
4. Report what was created
