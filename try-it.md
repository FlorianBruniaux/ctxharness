# Try ctxharness — prompt clé en main

Copie-colle le bloc ci-dessous dans Claude Code, Cursor, ou n'importe quel agent.

---

```
I want to audit my AI instruction files for factual drift — versions, file paths,
and npm scripts that are mentioned in my docs but no longer match the actual codebase.

Run the following steps:

1. Check if ctxharness is available:
   npx ctxharness --version

2. Scan my primary AI instruction file for verifiable claims:
   npx ctxharness scan CLAUDE.md

   If CLAUDE.md doesn't exist, try these in order:
   AGENTS.md, .cursorrules, .github/copilot-instructions.md

3. For each drift or unresolvable result:
   - Explain what the claim was
   - Explain what the actual value is (or why it couldn't be resolved)
   - Tell me if it's worth fixing and how

4. If there are 3 or more verifiable claims, run:
   npx ctxharness scan CLAUDE.md --suggest-config

   Show me the suggested .ctxharness.yml and explain what each assertion does.

5. Give me a one-paragraph summary of the overall health of my AI instruction files.
```

---

## Ce que ça fait

ctxharness lit ton fichier d'instructions IA, détecte automatiquement les claims vérifiables
(versions comme `` `22.14.0` `` près du mot "node", chemins comme `` `src/config.ts` ``,
scripts comme `` `npm run typecheck` ``) et confronte chaque claim à la réalité du codebase.

Résultat typique :

```
claim                   detected        actual          status
────────────────────────────────────────────────────────────────
node                    22.0.0          22.14.0         ✓ match
next                    16.2.0          16.3.1          ✗ drift
npm run typecheck       mentioned       NOT in scripts  ✗ drift
src/utils/auth.ts       mentioned       NOT FOUND       ✗ drift
────────────────────────────────────────────────────────────────
✗ 3 drifts found
```

Aucune configuration requise. Fonctionne sur n'importe quel projet (Node, Python, Go, Rust).

→ [GitHub](https://github.com/FlorianBruniaux/ctxharness) · [npm](https://www.npmjs.com/package/ctxharness)
