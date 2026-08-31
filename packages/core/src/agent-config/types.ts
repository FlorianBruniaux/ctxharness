/** Supported agent configuration hosts. */
export type AgentHost = 'claude' | 'codex'

/** Where a configuration artifact is loaded from. */
export type AgentConfigScope = 'project' | 'global'

/** The normalized configuration surface shared by supported hosts. */
export type AgentConfigLayer = 'instructions' | 'skills' | 'rules' | 'agents' | 'hooks' | 'mcp'

/** A resolved configuration root, before filesystem discovery. */
export interface AgentConfigRoot {
  host: AgentHost
  scope: AgentConfigScope
  layer: AgentConfigLayer
  path: string
  boundary: string
}

/** Provenance for one discovered configuration artifact. */
export interface AgentConfigEvidence {
  host: AgentHost
  scope: AgentConfigScope
  layer: AgentConfigLayer
  root: string
  path: string
}

/** A configuration artifact discovered at a resolved root. */
export interface AgentConfigCapability {
  host: AgentHost
  scope: AgentConfigScope
  layer: AgentConfigLayer
  path: string
  evidence: AgentConfigEvidence
}

/** A logical skill with every root that exposed it. */
export interface AgentConfigSkill {
  host: AgentHost
  name: string
  evidence: AgentConfigEvidence[]
}

export type AgentConfigFindingStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'not-applicable'

/** A normalized result for scanners and later policy checks. */
export interface AgentConfigFinding {
  code: string
  status: AgentConfigFindingStatus
  message: string
  host?: AgentHost
  scope?: AgentConfigScope
  layer?: AgentConfigLayer
  path?: string
  evidence?: AgentConfigEvidence[]
}

export interface AgentConfigInventory {
  root: string
  home: string
  roots: AgentConfigRoot[]
  capabilities: AgentConfigCapability[]
  skills: AgentConfigSkill[]
  findings: AgentConfigFinding[]
}

export interface AgentConfigInventoryOptions {
  /** Explicit CLI project root. This is never inferred from process.cwd(). */
  root: string
  /** Injectable home path for deterministic global inventory. */
  home: string
  hosts?: AgentHost[]
  scopes?: AgentConfigScope[]
}
