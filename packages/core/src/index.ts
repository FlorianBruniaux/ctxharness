// @ctxharness/core — exports added incrementally
export type { CtxharnessConfig, Assertion, ExtractorName, ScannerName, FilesConfig } from './config.js'
export { loadConfig } from './config.js'
export { runExtractor, registerExtractor } from './extractors/index.js'
export type { ExtractorFn, ExtractorArgs } from './extractors/index.js'
export { runScanner, registerScanner, normalizeMatch, STANDALONE_SCANNERS } from './scanners/index.js'
export type { ScanResult, ScannerFn } from './scanners/index.js'
export { run, detectGeneratedFile } from './runner.js'
export type { RunResult, AssertionResult } from './runner.js'
export { report } from './reporter.js'
export type { OutputFormat } from './reporter.js'
export { definePlugin, loadPlugin } from './plugin.js'
export type { CtxharnessPlugin, CtxharnessExtractor, CtxharnessScanner } from './plugin.js'
export { buildSnapshot, saveSnapshot, loadSnapshot, findLatestSnapshot, diffSnapshots } from './snapshot.js'
export type { Snapshot, SnapshotDiff, SnapshotEntry, DiffEntry } from './snapshot.js'
export { detectClaims, verifyClaim, scanFile, detectIncludes } from './scan.js'
export type { HeuristicClaim, HeuristicResult, ClaimStatus, ClaimType } from './scan.js'
export { appendTrendRecord, loadTrendHistory, summarizeTrend } from './trend.js'
export type { TrendRecord, TrendSummary } from './trend.js'
export { populateFromConfig, assertionsToYaml } from './populate.js'
export type { PopulateResult } from './populate.js'
export {
  inventoryAgentConfig,
  isPathWithinBoundary,
  resolveProjectConfigRoots,
  resolveGlobalConfigRoots,
} from './agent-config/inventory.js'
export type { AgentConfigPathApi } from './agent-config/inventory.js'
export { resolveClaudeRoots } from './agent-config/adapters/claude.js'
export { resolveCodexRoots } from './agent-config/adapters/codex.js'
export type {
  AgentHost,
  AgentConfigScope,
  AgentConfigLayer,
  AgentConfigRoot,
  AgentConfigEvidence,
  AgentConfigCapability,
  AgentConfigSkill,
  AgentConfigFindingStatus,
  AgentConfigFindingReason,
  AgentConfigFinding,
  AgentConfigInventory,
  AgentConfigInventoryOptions,
} from './agent-config/types.js'
