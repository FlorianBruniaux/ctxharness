---
name: eval-skills
description: "Audit all skills in .claude/skills/ for frontmatter completeness, effort level appropriateness, allowed-tools scoping, and content quality. Produces a scored report with effort-level recommendations for each skill. Use when onboarding, reviewing skill quality before shipping, or adding effort fields to an existing skill library."
allowed-tools: Read, Glob, Bash
effort: medium
---

# Skill Evaluator

Discover all skills, score them across 6 criteria, and infer the appropriate `effort` level based on content analysis.

## When to Use

- After adding new skills to ctxharness `.claude/skills/`
- Before cutting a release (quality gate)
- After bulk-importing skills from another project
- When adding `effort` fields for the first time

## Scoring Criteria (14 pts per skill)

| # | Criterion | Max | What is checked |
|---|-----------|-----|-----------------|
| 1 | **name** | 1 | Present, lowercase, hyphens only, matches directory name |
| 2 | **description** | 2 | Present + has "Use when" / trigger phrasing |
| 3 | **allowed-tools** | 2 | Present + not overly broad (Bash without scoping when read-only) |
| 4 | **effort** | 3 | Present (1pt) + appropriate for content (2pt based on inference) |
| 5 | **content structure** | 4 | Has Purpose/When section (1), has examples/usage (1), has clear workflow (1), no placeholder text (1) |
| 6 | **bonus** | +2 | argument-hint present (1), version/author metadata (1) |

**Thresholds:**
- ✅ Good: ≥11/14 (≥80%)
- ⚠️ Needs work: 8–10/14 (60–79%)
- ❌ Fix: <8/14 (<60%)

## Effort Level Inference

### `low` — Mechanical execution, no design decisions
Signals: commit, scaffold, generate, format, sync. No sub-agents. Short workflow (<5 steps).

### `medium` — Analysis with bounded scope
Signals: review, triage, analyze, evaluate (single file or bounded scope). May spawn 1-2 sub-agents with predefined scope.

### `high` — Design decisions, adversarial reasoning, cross-system analysis
Signals: architect, threat-model, audit (security), orchestrate (multi-agent). Broad tool access. Spawns multiple sub-agents.

If a skill has `effort:` already set but the inferred level differs, flag it:
> ⚠️ Effort mismatch: declared `low`, inferred `high`

## Execution Instructions

### Step 1 — Discovery

```bash
find .claude/skills -name "SKILL.md" 2>/dev/null
find .claude/skills -maxdepth 1 -name "*.md" ! -name "README*" 2>/dev/null
```

### Step 2 — Parse each skill

For each skill file:
1. Read the full file
2. Extract YAML frontmatter
3. Parse: name, description, allowed-tools, effort, argument-hint
4. Read body for structure analysis

### Step 3 — Score and infer

Apply scoring criteria. Infer effort from content. Compare vs declared effort if set.

### Step 4 — Output report

```
# Skills Audit — ctxharness
Date: [today] | Scanned: N skills

## Summary
| Status | Count |
|--------|-------|
| ✅ Good (≥80%) | N |
| ⚠️ Needs work (60–79%) | N |
| ❌ Fix (<60%) | N |

Effort coverage: N/N skills have effort field set

---

## Per-Skill Results

### [skill-name] — [score]/14 [✅/⚠️/❌]

| Criterion | Score | Notes |
|-----------|-------|-------|
| name | ✅ 1/1 | — |
| description | ⚠️ 1/2 | Missing "Use when" phrasing |
| effort | ❌ 0/3 | Missing — Recommended: medium |
```

End with a **Fix Summary** — all missing/mismatched effort fields ready to copy-paste.
