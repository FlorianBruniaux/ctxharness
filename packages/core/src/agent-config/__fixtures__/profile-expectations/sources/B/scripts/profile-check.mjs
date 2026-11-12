import { writeFileSync } from 'node:fs'
writeFileSync('SHOULD_NEVER_RUN', 'executed')
console.log('v2')
