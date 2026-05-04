---
name: eval-rules
description: "Audit .claude/rules/ files for structural correctness, glob validity, and real-world usefulness. Resolves each paths: pattern against actual project files, then asks whether each rule is still relevant. Can update rules in-place. Use when setting up rules for the first time, debugging rules that fire too often or never, or doing a periodic rules hygiene pass."
allowed-tools: Read, Glob, Bash, Edit
effort: medium
argument-hint: "[path to rules dir — default: .claude/rules/]"
---

# Rules Evaluator

Discover all rule files, validate their structure and glob patterns against the real project, then run an interactive session to confirm (or improve) each rule.

The goal is not just to score — it is to leave the rules directory in better shape than it was.

## When to Use

- First time writing `.claude/rules/` files (validate before committing)
- A rule seems to never trigger, or fires on every file
- Migrating `@` imports from CLAUDE.md to path-scoped rules
- Periodic hygiene: "are these rules still relevant to how we work?"
- Before shipping ctxharness as a new project to users

## Key Concepts

| Mechanism | When it loads | Notes |
|---|---|---|
| `@file` in CLAUDE.md | Session start, always | Even inside a conditional sentence |
| No `paths:` in rule | Session start, always | Same cost as @import |
| `paths:` frontmatter | When Claude reads a matching file | Trigger = Read tool, not Write |

The `paths:` field is the main lever for keeping rules contextual. An always-on rule with 80 lines loads on every session even if you're fixing a typo in README.md.

---

## Scoring Criteria (12 pts per rule)

| # | Criterion | Max | What is checked |
|---|-----------|-----|-----------------|
| 1 | **frontmatter block** | 1 | File has YAML frontmatter (`---` delimited) |
| 2 | **paths: field** | 2 | Present (1pt) + at least one pattern listed (1pt) |
| 3 | **pattern validity** | 3 | Each pattern matches ≥1 file in project (up to 3 patterns checked) |
| 4 | **scope** | 2 | Not dead (≥1 match) + not too broad (<30% of project source files) |
| 5 | **content quality** | 3 | Has clear header/title (1pt) + rules are specific/actionable (1pt) + under 150 lines (1pt) |
| Bonus | **focus** | +1 | Under 15 rules in file |

**Thresholds:**
- ✅ Good: ≥10/12 (≥83%)
- ⚠️ Needs work: 7–9/12 (58–82%)
- ❌ Fix: <7/12 (<58%)

**Always-on rules** (no `paths:` field): skip criteria 2, 3, 4. Score on 5 pts max. Flag with 🔵 and go through the interactive step to decide if scoping is needed.

---

## Execution Instructions

### Step 1 — Discovery

Use Glob to find all rule files:

```
.claude/rules/**/*.md
```

If an argument was passed, use that path instead.

Also count total source files for scope % calculation:
```bash
find . \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" \
  2>/dev/null | wc -l
```

If no `.claude/rules/` directory exists, report it and stop.

### Step 2 — Parse each rule

For each `.md` file found:
1. Read the full file
2. Extract YAML frontmatter (content between first `---` and second `---`)
3. Parse `paths:` field — collect all glob patterns as a list
4. Classify: **conditional** (has `paths:`) or **always-on** (no frontmatter or no `paths:`)
5. Read the body: line count, presence of a clear title/header, whether rules are specific

### Step 3 — Resolve glob patterns

For each rule with `paths:`, use Glob to resolve each pattern against the project:

- Collect total matched files per pattern
- Show up to 10 sample paths
- Flag dead patterns (0 matches) and broad patterns (>30% of source files)

### Step 4 — Interactive review

Process rules **one by one**.

**For each conditional rule (has `paths:`):**

Show:
```
Rule: my-rule.md [conditional]
paths: ["packages/core/**", "packages/cli/**"]
Matches: 24 files
  - packages/core/src/config.ts
  - packages/core/src/scanners/index.ts
  ... (22 more)
```

Ask:
1. "Is this scope right? (y / n = needs adjustment)"
2. "Is this rule still useful day-to-day? (y / n / unsure)"
3. "Anything to add, remove, or update in the rule content? (describe or skip)"

**For each always-on rule (no `paths:`):**

Show:
```
Rule: universal.md [always-on — loads every session]
Content: 45 lines, 6 rules
```

Ask:
1. "This rule loads at every session. Should it stay always-on, or be scoped? (keep / scope / skip)"
2. "Is the content still accurate and useful? (y / n)"

If the user says **scope**: help them define a `paths:` pattern based on the rule content. Propose the frontmatter block and ask for confirmation before editing.

**If the user provides corrections or updates**: apply them directly using Edit, confirm each change, then move to the next rule.

### Step 5 — Output report

```
# Rules Audit — ctxharness
Date: [today] | Scanned: N rules (X conditional, Y always-on)

## Summary

| Status | Count |
|--------|-------|
| ✅ Good (≥83%) | N |
| ⚠️ Needs work (58–82%) | N |
| ❌ Fix (<58%) | N |
| 🔵 Always-on (no paths:) | N |
```

### Step 6 — Fix Summary

List all edits applied and rules flagged as stale. Never delete a rule without explicit confirmation.
