// node scripts/build-site.js [path/to/b3sciences_full_site_content.txt]
// Builds data/site.json, the read-only knowledge that ships with the deployment.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSiteDump } from '../src/ingest.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = process.argv[2] || path.join(root, '..', 'b3sciences_full_site_content.txt')
const chunks = parseSiteDump(fs.readFileSync(src, 'utf8'))
fs.mkdirSync(path.join(root, 'data'), { recursive: true })
fs.writeFileSync(path.join(root, 'data', 'site.json'), JSON.stringify(chunks))
console.log(chunks.length, 'chunks written to data/site.json')
