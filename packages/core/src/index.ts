// @ctxharness/core — exports added incrementally
export type { CtxharnessConfig, Assertion, ExtractorName, ScannerName, FilesConfig } from './config.js'
export { loadConfig } from './config.js'
export { runExtractor } from './extractors/index.js'
export type { ExtractorFn, ExtractorArgs } from './extractors/index.js'
