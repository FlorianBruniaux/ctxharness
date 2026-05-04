import type { ExtractorFn } from './extractors/index.js'
import type { ScannerFn } from './scanners/index.js'
import { registerExtractor } from './extractors/index.js'
import { registerScanner } from './scanners/index.js'

// ─── Plugin types ─────────────────────────────────────────────────────────────

export type CtxharnessExtractor = {
  name: string
  fn: ExtractorFn
}

export type CtxharnessScanner = {
  name: string
  fn: ScannerFn
}

export type CtxharnessPlugin = {
  extractors?: CtxharnessExtractor[]
  scanners?: CtxharnessScanner[]
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Type-safe plugin definition helper.
 * Returns the plugin as-is — useful for type checking plugin objects before passing to loadPlugin.
 */
export function definePlugin(plugin: CtxharnessPlugin): CtxharnessPlugin {
  return plugin
}

/**
 * Register all extractors and scanners from a plugin into the global registry.
 * Call this before running assertions — typically at the top of your script.
 *
 * @example
 * import { loadPlugin } from '@ctxharness/core'
 * import myPlugin from './my-plugin.js'
 * loadPlugin(myPlugin)
 */
export function loadPlugin(plugin: CtxharnessPlugin): void {
  for (const extractor of plugin.extractors ?? []) {
    registerExtractor(extractor.name, extractor.fn)
  }
  for (const scanner of plugin.scanners ?? []) {
    registerScanner(scanner.name, scanner.fn)
  }
}
