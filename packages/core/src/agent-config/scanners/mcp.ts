import { readFileSync } from 'node:fs'
import { parse as parseToml } from 'smol-toml'
import type { AgentConfigEvidence, AgentConfigFinding, AgentConfigInventory } from '../types.js'

const SECRET_FIELD = /(?:authorization|api[_-]?key|token|secret|password|credential)/i
const LITERAL_SECRET =
  /(?:\bBearer\s+(?!\$\{)|\bsk-[A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9_]{8,}|[?&](?:token|key|secret|password)=)/i
const ENV_REFERENCE = /^(?:Bearer\s+)?\$\{[A-Z_][A-Z0-9_]*\}$/

function containsLiteralSecret(value: unknown, key = '', protectedEnvReference = false): boolean {
  if (typeof value === 'string') {
    if (protectedEnvReference) return !/^[A-Z_][A-Z0-9_]*$/.test(value)
    if (SECRET_FIELD.test(key)) return value.trim() !== '' && !ENV_REFERENCE.test(value)
    return LITERAL_SECRET.test(value)
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const item = value[index]
      if (
        typeof item === 'string' &&
        SECRET_FIELD.test(item) &&
        typeof value[index + 1] === 'string'
      ) {
        if (!ENV_REFERENCE.test(value[index + 1] as string)) return true
      }
      if (containsLiteralSecret(item, key, protectedEnvReference)) return true
    }
    return false
  }

  if (typeof value !== 'object' || value === null) return false
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    const protectedChild = childKey === 'bearer_token_env_var' || key === 'env_http_headers'
    if (containsLiteralSecret(child, childKey, protectedChild)) return true
  }
  return false
}

function parseMcpServers(evidence: AgentConfigEvidence): Record<string, unknown> | null {
  try {
    const content = readFileSync(evidence.path, 'utf-8')
    const parsed = evidence.path.endsWith('.toml') ? parseToml(content) : JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null) return null
    const fields = parsed as Record<string, unknown>
    const servers = evidence.host === 'claude' ? fields['mcpServers'] : fields['mcp_servers']
    return typeof servers === 'object' && servers !== null
      ? (servers as Record<string, unknown>)
      : {}
  } catch {
    return null
  }
}

/** Parses MCP JSON/TOML and reports secret policy failures without serializing values. */
export function scanMcp(inventory: AgentConfigInventory): AgentConfigFinding[] {
  const findings: AgentConfigFinding[] = []

  for (const capability of inventory.capabilities.filter((item) => item.layer === 'mcp')) {
    const evidence = capability.evidence
    const servers = parseMcpServers(evidence)
    if (servers === null) {
      findings.push({
        code: 'mcp-config-invalid',
        status: 'fail',
        message: `MCP configuration is not valid ${evidence.path.endsWith('.toml') ? 'TOML' : 'JSON'}.`,
        host: evidence.host,
        scope: evidence.scope,
        layer: 'mcp',
        path: evidence.path,
        evidence: [evidence],
      })
      continue
    }

    for (const [serverName, server] of Object.entries(servers)) {
      const literalSecret = containsLiteralSecret(server)
      findings.push({
        code: literalSecret ? 'mcp-literal-secret' : 'mcp-config-valid',
        status: literalSecret ? 'fail' : 'pass',
        message: literalSecret
          ? 'MCP server contains a literal-looking secret; the value is redacted.'
          : 'MCP server uses no detected literal secret values.',
        host: evidence.host,
        scope: evidence.scope,
        layer: 'mcp',
        path: evidence.path,
        evidence: [evidence],
        server: serverName,
      })
    }
  }

  return findings
}
