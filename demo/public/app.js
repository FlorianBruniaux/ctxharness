import { contract, scenarios } from '/lib/fixtures.js'

const $ = (id) => document.getElementById(id)
let current = 'design'
let sequence = 0
$('contract').textContent = JSON.stringify(contract, null, 2)

async function run(scenario) {
  current = scenario
  const runId = ++sequence
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === scenario))
  })
  $('configuration').textContent = scenarios[scenario].content
  $('scenario-note').textContent = scenarios[scenario].explanation
  $('result').dataset.status = 'loading'
  $('result-icon').textContent = '…'
  $('result-title').textContent = 'Running the check…'
  $('result-description').textContent = 'Reading the selected fixture with CTX Harness.'
  $('evidence').textContent = ''
  $('rerun').disabled = true
  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Check unavailable')
    const result = await response.json()
    if (runId !== sequence) return
    const unknown = result.findings[0].status === 'unknown'
    $('result').dataset.status = unknown ? 'unknown' : result.status
    $('result-icon').textContent = unknown ? '?' : result.status === 'pass' ? '✓' : '×'
    $('result-title').textContent = unknown
      ? 'UNKNOWN evidence · check failed'
      : result.status === 'pass'
        ? 'PASS · backend expectation satisfied'
        : 'FAIL · design MCP is still declared'
    $('result-description').textContent = unknown
      ? 'The JSON is invalid. CTX Harness cannot verify absence, so the overall check fails.'
      : result.status === 'pass'
        ? 'Expected absent. Observed absent. The configuration matches the rule.'
        : 'Expected absent. Observed present. Remove the design declaration to satisfy this rule.'
    $('evidence').textContent = JSON.stringify(result, null, 2)
  } catch {
    if (runId !== sequence) return
    $('result').dataset.status = 'error'
    $('result-icon').textContent = '!'
    $('result-title').textContent = 'The check could not complete'
    $('result-description').textContent =
      'Try again, or run the same check locally with the command below.'
  } finally {
    if (runId === sequence) $('rerun').disabled = false
  }
}

document.querySelectorAll('[data-scenario]').forEach((button) => {
  button.addEventListener('click', () => run(button.dataset.scenario))
})
$('rerun').addEventListener('click', () => run(current))
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(contract, null, 2) + '\n'], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = '.ctxharness-expectations.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('command').textContent)
    $('copy-status').textContent = 'Command copied.'
  } catch {
    $('copy-status').textContent = 'Select the command above to copy it manually.'
  }
})
run(current)
