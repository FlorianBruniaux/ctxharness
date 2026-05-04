import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { z } from 'zod'

// Extractor schemas
const ExtractorNameSchema = z.enum([
  'packageJson',
  'packageManager',
  'nvmrc',
  'fileExists',
  'regexScan',
  'countMatches',
  'constant',
])

// Scanner schemas
const ScannerNameSchema = z.enum([
  'inlineRegex',
  'codeBlockRegex',
  'yamlField',
  'jsonField',
  'literalInMd',
  'pathReference',
  'vaguenessPattern',
  'negativeConstraintDensity',
])

// One assertion
const AssertionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  extractor: ExtractorNameSchema,
  extractorArgs: z.record(z.unknown()).optional(),
  scanner: ScannerNameSchema,
  scannerArgs: z.record(z.unknown()).default({}),
})

// Files config
const FilesConfigSchema = z.object({
  include: z.array(z.string()).default(['CLAUDE.md', 'AGENTS.md', '.cursorrules']),
  exclude: z.array(z.string()).default(['node_modules/**']),
})

// Full config
const CtxharnessConfigSchema = z.object({
  version: z.literal(1),
  files: FilesConfigSchema.default({}),
  assertions: z.array(AssertionSchema).min(1),
})

export type ExtractorName = z.infer<typeof ExtractorNameSchema>
export type ScannerName = z.infer<typeof ScannerNameSchema>
export type Assertion = z.infer<typeof AssertionSchema>
export type FilesConfig = z.infer<typeof FilesConfigSchema>
export type CtxharnessConfig = z.infer<typeof CtxharnessConfigSchema>

export function loadConfig(configPath: string): CtxharnessConfig {
  const raw = readFileSync(configPath, 'utf-8')
  const parsed = load(raw)
  const result = CtxharnessConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid .ctxharness.yml:\n${JSON.stringify(result.error.format(), null, 2)}`)
  }
  return result.data
}
