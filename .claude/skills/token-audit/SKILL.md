---
name: token-audit
description: "Audit Claude Code configuration to measure fixed-context token overhead and produce a prioritized action plan. Use when sessions feel slow, context compresses early, or after adding many rules files."
allowed-tools: Read, Grep, Glob, Bash
effort: medium
---

# /token-audit — Context Token Audit

**Purpose**: Measure how many tokens your Claude Code configuration consumes before any user task begins. Identify the biggest sources of overhead. Produce a concrete action plan with savings estimates.

## What You Will Measure

| Component | Loaded when | Typical range |
|-----------|-------------|---------------|
| `~/.claude/CLAUDE.md` + @imports | Always | 5–15K tokens |
| Project `CLAUDE.md` | Always | 2–8K tokens |
| `.claude/rules/*.md` | Always (all files) | 5–40K tokens |
| `MEMORY.md` | Always | 1–3K tokens |
| Claude Code system prompt | Always | ~7,500 tokens |
| Commands, agents, skills | On invocation only | 0 by default |

Key insight: `.claude/rules/` loads every `.md` file at session start. Commands and agents are lazy-loaded — zero cost until invoked.

---

## Step 1 — Run the Measurement

```bash
echo "=== PROJECT CLAUDE.md ===" && wc -c CLAUDE.md 2>/dev/null || echo "none"

echo ""
echo "=== RULES FILES (sorted by size) ===" && find .claude/rules -name "*.md" 2>/dev/null \
  | xargs wc -c 2>/dev/null | sort -rn | head -20
```

Then calculate the full budget:

```bash
PROJECT=$(wc -c < CLAUDE.md 2>/dev/null || echo 0)
RULES=$(find .claude/rules -name "*.md" 2>/dev/null | xargs cat 2>/dev/null | wc -c || echo 0)
TOTAL=$(( PROJECT + RULES + 30000 ))

echo "Project CLAUDE.md  : ~$(( PROJECT / 4 )) tokens"
echo "Rules (auto-loaded): ~$(( RULES / 4 )) tokens"
echo "System prompt      : ~7,500 tokens"
echo "---"
echo "TOTAL fixed context: ~$(( TOTAL / 4 )) tokens"
echo "% of 200K window   : $(( TOTAL / 4 * 100 / 200000 ))%"
```

---

## Step 2 — Classify Rules Files

| Class | Definition | Action |
|-------|------------|--------|
| **ALWAYS** | Applies to most tasks (conventions, safety) | Keep auto-loaded |
| **SOMETIMES** | Relevant in 20–40% of sessions | Keep if small (<3K chars) |
| **RARELY** | Relevant in <10% of sessions | Remove from auto-load |
| **NEVER** | Outdated or covered elsewhere | Delete or archive |

For each file in `.claude/rules/`, output:

```
| File | Size (chars) | Class | Reasoning (one sentence) |
```

Sort by size descending within each class. Calculate total chars saved by removing RARELY and NEVER files.

---

## Step 3 — Audit Hook Overhead

Hooks on `PreToolUse` and `PostToolUse` fire on every tool call. Check what you have:

```bash
python3 - << 'EOF'
import json, os
for path in [os.path.expanduser("~/.claude/settings.json"), ".claude/settings.json"]:
    if not os.path.exists(path): continue
    print(f"\n--- {path} ---")
    data = json.load(open(path))
    for event, hooks in data.get("hooks", {}).items():
        for h in hooks:
            cmd = h.get("command", "?")
            matcher = h.get("matcher", "*")
            print(f"  [{event}] matcher={matcher} → {cmd[:80]}")
EOF
```

**Red flags**: hooks that `cat` files unconditionally, `git status` on every call, multi-line debug echo never removed.

---

## Step 4 — Action Plan

| Action | Estimated savings | Effort | Risk |
|--------|------------------|--------|------|
| Remove RARELY files from auto-load | varies | 30 min | Low |
| Split large rules into core + detail | varies | 1–2h | Low |
| Trim hook stdout to essential fields | varies | 1h | Low |
| Archive outdated MEMORY.md entries | 500–1K tokens | 30 min | Low |

---

## Output Format

```markdown
## Token Audit — ctxharness — [DATE]

### Budget Summary

| Component | Tokens | % of total |
|-----------|--------|------------|
| Project CLAUDE.md | X | Y% |
| Rules (auto-loaded) | X | Y% |
| System prompt | 7,500 | Y% |
| **TOTAL** | **X** | **100%** |

Context window used before any task: X% of 200K

### Rules Classification

| File | Chars | Class | Action |
|------|-------|-------|--------|

### Action Plan

| Action | Savings | Effort |
|--------|---------|--------|

**Total achievable without infrastructure**: -X tokens → N% reduction
```

## Interpreting Results

| Fixed context | Assessment |
|---------------|------------|
| < 20K tokens | Healthy — no urgent action needed |
| 20–40K tokens | Moderate — grab easy wins |
| 40–60K tokens | High — rules audit is worth an afternoon |
| > 60K tokens | Critical — you are burning 30%+ of your window before any task |
