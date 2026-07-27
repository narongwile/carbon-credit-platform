import 'dotenv/config'
import mysql from 'mysql2/promise'
import * as http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Auto-migration runner for ONEOPS backend.
//
// • Creates the `iothub` database + `schema_migrations` tracking table if
//   they don't exist (bootstraps a blank MySQL instance).
// • Runs SQL files from `sql/` in deterministic order:
//     1. schema.sql          (core tables)
//     2. bloodbox.sql        (BloodBox domain)
//     3. migrate-v2 … v99   (incremental patches, sorted numerically)
//     4. seed-*.sql          (demo data — only if AUTO_SEED=1)
// • Each file is tracked in `schema_migrations`; already-applied files are
//   skipped, so the runner is fully idempotent and safe to call on every
//   pod startup.
//
// Usage:
//   Standalone:   npm run migrate                (or: node dist/migrate.js)
//   At startup:   await runMigrations()          (called from index.ts)
//   Env:
//     AUTO_SEED=1   — also run seed-*.sql on first boot (default: off)
//     SKIP_MIGRATE=1 — skip migration entirely (escape hatch)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))

// SQL files live at `backend/sql/` — from dist/ that's `../sql/`, from src/
// it's also `../sql/`. We resolve relative to the compiled output location.
const SQL_DIR = join(__dirname, '..', 'sql')

/** Ordered list of SQL files to execute. Deterministic, not glob-based. */
function discoverFiles(includeSeed: boolean): string[] {
  let entries: string[]
  try {
    entries = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql'))
  } catch {
    console.warn(`[migrate] sql/ directory not found at ${SQL_DIR} — skipping`)
    return []
  }

  // Buckets (run in this order)
  const schema: string[] = []       // schema.sql
  const domain: string[] = []       // bloodbox.sql (or any future domain files)
  const migrations: string[] = []   // migrate-v*.sql
  const seeds: string[] = []        // seed-*.sql

  for (const f of entries) {
    // install.sql is a `mysql` CLI-only wrapper (SOURCE schema.sql; SOURCE
    // bloodbox.sql; ...) for a human running `mysql < install.sql` by hand.
    // SOURCE is a client meta-command, not SQL the server understands, so
    // handing this file to the driver — which sends statements straight to
    // the server — fails with a syntax error on the very first line. Every
    // file it sources is already discovered and ordered below on its own.
    if (f === 'install.sql') continue
    if (f === 'schema.sql') schema.push(f)
    else if (f.startsWith('migrate-')) migrations.push(f)
    else if (f.startsWith('seed-')) seeds.push(f)
    else domain.push(f) // bloodbox.sql, any future domain files
  }

  // Sort migrations numerically: migrate-v2 < migrate-v3 < … < migrate-v10
  migrations.sort((a, b) => {
    const numA = parseInt(a.match(/v(\d+)/)?.[1] || '0', 10)
    const numB = parseInt(b.match(/v(\d+)/)?.[1] || '0', 10)
    return numA - numB
  })

  // Sort seeds and domain files alphabetically for deterministic order
  domain.sort()
  seeds.sort()

  const result = [...schema, ...domain, ...migrations]
  if (includeSeed) result.push(...seeds)
  return result
}

/**
 * Split a SQL file into individual statements, respecting:
 * - line comments  (-- …)
 * - block comments (/* … *​/)
 * - quoted strings ('…' and "…") with escape handling
 * - delimiter `;`
 */
function splitStatements(sql: string): string[] {
  const stmts: string[] = []
  let current = ''
  let i = 0

  while (i < sql.length) {
    const ch = sql[i]

    // Line comment
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? sql.length : nl + 1
      continue
    }

    // Block comment
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      continue
    }

    // Quoted string (skip to closing quote, handle escapes)
    if (ch === "'" || ch === '"') {
      current += ch
      i++
      while (i < sql.length) {
        const qc = sql[i]
        current += qc
        i++
        if (qc === ch) break                       // closing quote
        if (qc === '\\' && i < sql.length) {       // escaped char
          current += sql[i]
          i++
        }
      }
      continue
    }

    // Statement delimiter
    if (ch === ';') {
      const trimmed = current.trim()
      if (trimmed.length > 0) stmts.push(trimmed)
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  // Trailing statement without `;`
  const last = current.trim()
  if (last.length > 0) stmts.push(last)

  return stmts
}

/**
 * Run all pending migrations. Safe to call repeatedly (idempotent).
 * Returns the number of newly applied files.
 */
/** Shared MySQL connection config. `database` omitted lets us CREATE it first. */
function connConfig(database?: string) {
  return {
    host: process.env.DB_HOST || 'mysql.data.svc.cluster.local',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'iothub.2026',
    multipleStatements: false, // we split & run one-by-one for safety
    timezone: 'Z',
    ...(database ? { database } : {}),
  }
}

/**
 * Derive a safe, deterministic per-org database name: `iothub_<slug>`.
 * The org id can be attacker-influenced and a DB name cannot be a bound
 * parameter, so we hard-restrict it to [a-z0-9_] (no interpolation risk).
 * NOTE: this exact function must be mirrored wherever the app routes a request
 * to an org's DB (data-plane connection resolver) so both agree on the name.
 */
export function orgDbName(orgId: string): string {
  const slug = String(orgId).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!slug) throw new Error(`invalid orgId for db name: ${JSON.stringify(orgId)}`)
  return ('iothub_' + slug).slice(0, 64)
}

/**
 * Run all pending migrations against a target database. Safe to call repeatedly
 * (idempotent). `opts.dbName` overrides DB_NAME (used for per-org DBs); each DB
 * gets its OWN `schema_migrations` table, so version tracking is per-DB/per-org
 * for free. `opts.seed` overrides AUTO_SEED (default: never seed a customer org).
 * Returns the number of newly applied files.
 */
export async function runMigrations(opts: { dbName?: string; seed?: boolean } = {}): Promise<number> {
  if (process.env.SKIP_MIGRATE === '1') {
    console.log('[migrate] SKIP_MIGRATE=1 — skipping')
    return 0
  }

  const dbName = opts.dbName || process.env.DB_NAME || 'iothub'
  console.log(`[migrate] target db: ${dbName}`)

  // Connect WITHOUT selecting a database first — DB may not exist yet.
  const conn = await mysql.createConnection(connConfig())

  try {
    // 1. Ensure the database exists
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
    await conn.query(`USE \`${dbName}\``)

    // 2. Ensure the tracking table exists
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    VARCHAR(255) PRIMARY KEY,
        applied_at  DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        checksum    CHAR(8),
        statements  INT DEFAULT 0
      )
    `)

    // 3. Load already-applied set
    const [rows] = await conn.query('SELECT filename FROM schema_migrations') as [
      Array<{ filename: string }>,
      unknown
    ]
    const applied = new Set(rows.map((r) => r.filename))

    // 4. Discover & run pending files
    const includeSeed = opts.seed ?? (process.env.AUTO_SEED === '1')
    const files = discoverFiles(includeSeed)
    let count = 0

    for (const filename of files) {
      if (applied.has(filename)) continue

      const filePath = join(SQL_DIR, filename)
      let raw: string
      try {
        raw = readFileSync(filePath, 'utf-8')
      } catch (err) {
        console.error(`[migrate] cannot read ${filePath}: ${(err as Error).message}`)
        continue
      }

      // Remove `CREATE DATABASE` and `USE` statements — we already selected the DB
      const filtered = raw
        .replace(/^\s*CREATE\s+DATABASE\s+.*?;\s*$/gim, '')
        .replace(/^\s*USE\s+\w+\s*;\s*$/gim, '')

      const stmts = splitStatements(filtered)
      if (stmts.length === 0) {
        console.log(`[migrate] ${filename} — empty, marking applied`)
        await conn.query(
          'INSERT IGNORE INTO schema_migrations (filename, statements) VALUES (?, 0)',
          [filename]
        )
        applied.add(filename)
        count++
        continue
      }

      console.log(`[migrate] applying ${filename} (${stmts.length} statements) …`)

      let executed = 0
      for (const stmt of stmts) {
        try {
          await conn.query(stmt)
          executed++
        } catch (err) {
          const msg = (err as { message: string; code?: string }).message
          const code = (err as { code?: string }).code

          // Tolerate common idempotency errors (table/column already exists)
          const ignorable =
            code === 'ER_TABLE_EXISTS_ERROR' ||
            code === 'ER_DUP_FIELDNAME' ||
            code === 'ER_DUP_KEYNAME' ||
            code === 'ER_DUP_ENTRY' ||
            code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
            msg.includes('Duplicate column name') ||
            msg.includes('Duplicate key name') ||
            msg.includes('Duplicate entry')

          if (ignorable) {
            // Silently skip — this is expected on re-runs
            executed++
          } else {
            console.error(`[migrate] ${filename} FAILED at statement ${executed + 1}:`)
            console.error(`  ${stmt.slice(0, 200)}`)
            console.error(`  → ${msg}`)
            throw new Error(`Migration ${filename} failed: ${msg}`)
          }
        }
      }

      // Simple checksum: first 8 hex chars of content length + hash-ish
      const checksum = rawChecksum(raw)

      await conn.query(
        'INSERT IGNORE INTO schema_migrations (filename, checksum, statements) VALUES (?, ?, ?)',
        [filename, checksum, executed]
      )
      applied.add(filename)
      count++
      console.log(`[migrate] ✓ ${filename} — ${executed} statements applied`)
    }

    if (count === 0) {
      console.log('[migrate] all migrations already applied — nothing to do')
    } else {
      console.log(`[migrate] done — ${count} file(s) applied`)
    }

    return count
  } finally {
    await conn.end()
  }
}

/** Simple non-crypto checksum for change detection (not security). */
function rawChecksum(content: string): string {
  let h = 0
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// DB-per-tenant helpers
// ---------------------------------------------------------------------------

/**
 * Create + migrate a single org's dedicated database `iothub_<org>`.
 * Called on provisionPlatform. Does NOT seed demo data by default (a real
 * customer org starts empty; pass {seed:true} only for demos).
 */
export async function migrateOrg(orgId: string, opts: { seed?: boolean } = {}): Promise<{ orgId: string; db: string; applied: number }> {
  const db = orgDbName(orgId)
  const applied = await runMigrations({ dbName: db, seed: opts.seed ?? false })
  return { orgId, db, applied }
}

/**
 * Upgrade EVERY existing org DB — reads the org list from the control DB
 * (`organizations` table) and runs migrateOrg on each. Use this to roll a new
 * schema version out to all tenants after adding a migrate-vN.sql.
 */
export async function migrateAllOrgs(): Promise<Array<{ orgId: string; db: string; applied: number }>> {
  const controlDb = process.env.CONTROL_DB_NAME || process.env.DB_NAME || 'iothub'
  const conn = await mysql.createConnection(connConfig(controlDb))
  let orgIds: string[] = []
  try {
    const [rows] = (await conn.query('SELECT id FROM organizations')) as [Array<{ id: string }>, unknown]
    orgIds = rows.map((r) => r.id)
  } finally {
    await conn.end()
  }
  const out: Array<{ orgId: string; db: string; applied: number }> = []
  for (const orgId of orgIds) {
    try { out.push(await migrateOrg(orgId)) }
    catch (e) { console.error(`[migrate] org ${orgId} FAILED: ${(e as Error).message}`) }
  }
  console.log(`[migrate] all-orgs: migrated ${out.length}/${orgIds.length} org DB(s)`)
  return out
}

/**
 * Serve mode: a tiny HTTP wrapper so a Node-RED-only backend (which can't import
 * this module) can trigger per-org migration on provisionPlatform via fetch.
 *   POST /migrate/org/:orgId   → create + migrate iothub_<org>
 *   POST /migrate/all-orgs     → upgrade all org DBs
 *   GET  /health
 */
export function startMigrateServer(port = Number(process.env.MIGRATE_PORT || 8090)): http.Server {
  const server = http.createServer(async (req, res) => {
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    try {
      const url = req.url || ''
      if (req.method === 'GET' && (url === '/health' || url === '/')) return send(200, { ok: true })
      const m = url.match(/^\/migrate\/org\/([^/?]+)/)
      if (req.method === 'POST' && m) {
        const r = await migrateOrg(decodeURIComponent(m[1]))
        console.log(`[migrate] provisioned org ${r.orgId} → ${r.db} (${r.applied} file(s))`)
        return send(200, { ok: true, ...r })
      }
      if (req.method === 'POST' && url.startsWith('/migrate/all-orgs')) {
        return send(200, { ok: true, orgs: await migrateAllOrgs() })
      }
      send(404, { error: 'not found' })
    } catch (e) {
      send(500, { error: (e as Error).message })
    }
  })
  server.listen(port, () => console.log(`[migrate] serve mode listening on :${port}`))
  return server
}

// ---------------------------------------------------------------------------
// Standalone entry point:
//   node dist/migrate.js                 → migrate the control DB (DB_NAME|iothub), seeds on
//   node dist/migrate.js --org <orgId>   → create + migrate iothub_<org> (no seed)
//   node dist/migrate.js --all-orgs      → upgrade every existing org DB
//   node dist/migrate.js --serve         → HTTP trigger service (for Node-RED provisioning)
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/migrate.js') ||
    process.argv[1].endsWith('/migrate.ts') ||
    process.argv[1].endsWith('\\migrate.js') ||
    process.argv[1].endsWith('\\migrate.ts'))

if (isMain) {
  const args = process.argv.slice(2)
  const flag = (f: string) => args.includes(f)
  const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }

  ;(async () => {
    if (flag('--serve')) { startMigrateServer(); return }   // long-running; never exits
    if (flag('--all-orgs')) {
      const r = await migrateAllOrgs()
      console.log(`[migrate] all-orgs complete (${r.length} org DB(s))`)
      process.exit(0)
    }
    const org = value('--org')
    if (org) {
      const r = await migrateOrg(org, { seed: process.env.AUTO_SEED === '1' })
      console.log(`[migrate] org ${r.orgId} → ${r.db} (${r.applied} applied)`)
      process.exit(0)
    }
    // Default: control DB. Seed demo data unless AUTO_SEED explicitly disabled.
    process.env.AUTO_SEED = process.env.AUTO_SEED ?? '1'
    const n = await runMigrations()
    console.log(`[migrate] complete (${n} applied)`)
    process.exit(0)
  })().catch((err) => {
    console.error('[migrate] fatal:', err)
    process.exit(1)
  })
}
