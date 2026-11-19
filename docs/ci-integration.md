# CI integration: diagnostics, report validity and merge policy

Updated: 2026-11-18. Status: guide for source version `v0.6.0`, with dated observations from one anonymized consumer repository. [Documentation index](README.md).

CTX Harness can find a failed assertion and still appear inside a green CI job. The command's exit code, the validity of its report, the job conclusion and the repository's merge policy answer different questions.

## What each result establishes

| Signal                   | What it establishes                                                     | What still needs separate evidence                                   |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `run` result             | Selected documentation assertions were evaluated against local sources. | An instruction-quality heuristic is not a judgment of task quality.  |
| Configuration diagnosis  | Supported declarations were inspected in the selected host and scope.   | Client loading, authentication, tool invocation and runtime benefit. |
| Portable parser succeeds | The report satisfies the versioned schema and consistency checks.       | Findings may still include failures or unknowns.                     |
| CI job succeeds          | Its configured blocking steps passed.                                   | Advisory steps may have failed or been skipped.                      |
| Merge is allowed         | The active server-side policy permits it.                               | A checked-in ruleset alone does not establish the active policy.     |

The [composite Action](../action.yml) runs documentation assertions. Configuration diagnosis, portable validation and explicit profile expectations require their own CLI or library calls. See [doctor modes and exit codes](doctor.md#read-findings-and-exit-codes) and [versioned contracts](contracts/README.md).

## Observed integration case

These observations come from a user-supplied audit of three CI runs and a separate local profile check. They are dated evidence, not a new remote verification in this documentation revision. Project, PR, profile and server names are omitted. Private source links and the audit are retained in the local review notes.

The application repository owns its instruction generator, conditional Git hooks, test selection and review-bot policy. CTX Harness checks files available on disk. In the reviewed audit job, ignored client outputs were not generated before inspection. A neighboring staleness job had its own generation step, which does not establish that the audit job saw those outputs.

| Reviewed run                | Documentation assertions                    | Configuration report                             | Consumer contract fixtures and portable validation |
| --------------------------- | ------------------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| Earlier `0.5.0` run         | Two instruction-balance findings, exit `1`. | 57 mandatory failures, exit `1`.                 | Nine fixtures passed. Portable report accepted.    |
| Later `0.5.0` run           | One instruction-balance finding, exit `1`.  | 57 mandatory failures, exit `1`.                 | Nine fixtures passed. Portable report accepted.    |
| Latest reviewed `0.6.0` run | One instruction-balance finding, exit `1`.  | 64 mandatory failures and 15 unknowns, exit `1`. | Nine fixtures passed. Portable report accepted.    |

The latest assertion measured a positive/negative instruction ratio of `0.0` (`0p / 3n`) against a configured threshold of `0.2`. This demonstrates a reproducible deviation from the team's editorial rule. It does not by itself demonstrate a stale code fact or a defect in the guide.

The workflow set `continue-on-error` on the documentation and configuration diagnostic steps. Their exit codes were `1`, while the job remained green. The consumer contract fixtures and report validation could fail the job. Whether that job was required for merging remained unknown because active server-side protections were not retrieved.

The individual causes of the 64 mandatory findings were not established by the portable totals. The change from 57 to 64 cannot be attributed to the version upgrade alone. It is also not a count of incidents prevented.

### Local profile check versus the CI job

A separate local `doctor --expect` check confirmed two presence requirements: an instructions file and an expected MCP declaration. Both expectations passed, while other mandatory diagnostics made the overall command exit `1`.

The reviewed CI job did **not** supply a profile contract through `--expect`. The [interactive backend demo](../demo/README.md) uses another, illustrative contract that forbids a named design MCP. These three observations describe different checks. None establishes native client loading.

### What belonged to the application repository

The application's own `ai:ctxtest` compared documented facts with code. It detected an older ignored snapshot listing 13 permission resources when the code defined 35 during a separate local replay. That finding was not produced by CTX Harness. The latest reviewed CI run used its own checkout and generation.

The measured contribution is repeatable assertion evaluation, static configuration findings and a validated report that a consumer can read. The reviewed evidence does not establish an avoided incident, saved time or tokens, or improved coding-agent task quality. The selected runs document integration changes rather than coverage across all recent pull requests.

## Choose the workflow policy explicitly

An advisory rollout can collect findings while a team qualifies their causes. Keep the raw step outcome visible so a green job is not read as a clean diagnostic report. In GitHub Actions, `outcome` is the result before `continue-on-error`, while `conclusion` includes that policy. [GitHub steps context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#steps-context).

This steps fragment illustrates advisory documentation assertions and a summary. It assumes the consumer repository is already checked out, Node.js is available, and `.ctxharness.yml` exists. It does not add a configuration audit or profile contract:

```yaml
- name: Evaluate documentation assertions (advisory)
  id: documentation
  continue-on-error: true
  uses: FlorianBruniaux/ctxharness@v0.6.0
  with:
    config: .ctxharness.yml
    format: gha

- name: Summarize the diagnostic step
  if: always()
  env:
    RAW_OUTCOME: ${{ steps.documentation.outcome }}
    POLICY_CONCLUSION: ${{ steps.documentation.conclusion }}
  run: |
    printf '## Documentation assertions\n\n' >> "$GITHUB_STEP_SUMMARY"
    printf -- '- Step outcome: %s\n' "$RAW_OUTCOME" >> "$GITHUB_STEP_SUMMARY"
    printf -- '- Policy conclusion: %s\n' "$POLICY_CONCLUSION" >> "$GITHUB_STEP_SUMMARY"
```

A failure here can also come from setup or build, so inspect the command's logs before attributing it to an assertion. Removing `continue-on-error` makes a failing Action fail its job under the Action's default `fail-on-drift: true`. Whether the check blocks merging still depends on active repository policy. [GitHub step failure policy](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepscontinue-on-error).

### Validate the report before consuming findings

A configuration diagnostic may write a valid portable report and exit `1`. Validation must remain separate from the diagnostic's acceptance policy. After a [source build](../README.md#inspect-current-configuration-and-export-evidence) at `../ctxharness-source`, this module snippet validates a saved report from the consumer repository:

```js
import { readFileSync } from 'node:fs'
import { parsePortableReport } from '../ctxharness-source/packages/core/dist/index.js'

const report = parsePortableReport(
  JSON.parse(readFileSync('.ctxharness/doctor.portable.json', 'utf8')),
)
console.log(JSON.stringify(report.summary))
```

Malformed JSON, an unsupported schema or inconsistent counts must fail validation. A schema-valid report can still contain failures. Missing or unreadable output must not be treated as an empty successful report. The [portable contract](contracts/README.md) describes fields and disclosure limits.

### Add profile checks against the intended files

If a job should verify a generated profile, generate it in that job or supply the exact outputs as explicit inputs. A different job's generation is not evidence of file availability. Use an isolated test profile so the audit does not silently depend on a developer's current local profile.

Pass a contract explicitly with `doctor --host claude --scope project --expect …`. Exercise an expected declaration and a forbidden declaration independently. An unverifiable explicit requirement fails that contract, and passing all expectations does not cancel other mandatory diagnostics. Keep client-loading claims tied to separate traces. [Expectation format and limits](doctor.md#explicit-project-expectations).

## Consumer follow-up suggested by the case

These are proposed integration improvements, not delivered changes to the consumer workflow:

1. **Show diagnostic outcomes in the Actions summary.** Distinguish command failure, parser failure and final job policy. Check a clean result, an intentional assertion mismatch and an invalid report.
2. **Exercise a representative generated profile.** Supply isolated outputs and an explicit contract. Change one required and one forbidden declaration independently and confirm each result.
3. **Check compiled CLI/core provenance.** Pin source and rebuild both packages in a clean checkout with the frozen lockfile. A CLI version string alone does not attest the core's compiled bytes. Reject a deliberately stale CLI/core pair and accept a clean build of the pinned source.

This work belongs to the consumer's integration. It does not require CTX Harness to generate configuration, start an MCP server, select application tests or run review bots.
