// @ctxharness/core — exports added incrementally
export type { CtxharnessConfig, Assertion, ExtractorName, ScannerName, FilesConfig } from './config.js'
export { loadConfig } from './config.js'
export { runExtractor } from './extractors/index.js'
export type { ExtractorFn, ExtractorArgs } from './extractors/index.js'
export { runScanner, normalizeMatch } from './scanners/index.js'
export type { ScanResult, ScannerFn } from './scanners/index.js'
