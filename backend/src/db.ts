import mysql from 'mysql2/promise'

// DB session/connection time zone. Records are written in this tz (default ICT,
// +07:00) so NOW()/CURRENT_TIMESTAMP and JS Date values land as Bangkok time.
const DB_TZ = process.env.DB_TZ || '+07:00'

// MySQL connection pool. Defaults target the in-cluster service
// (mysql.data.svc.cluster.local:3306, user "admin").
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql.data.svc.cluster.local',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'iothub.2026',
  database: process.env.DB_NAME || 'iothub',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  timezone: DB_TZ, // mysql2 converts JS Date ↔ string using this tz
})

// Pin each pooled connection's session time zone so NOW(3) writes Bangkok time.
// mysql2/promise's PromisePool exposes its EventEmitter as `.pool`; binding on
// the wrapper throws ("pool.on is not a function") and would crash on import.
try {
  ;(pool as unknown as { pool: { on(ev: string, cb: (c: { query(sql: string): void }) => void): void } }).pool
    .on('connection', (conn) => { conn.query(`SET time_zone = '${DB_TZ}'`) })
} catch (e) {
  console.warn('[db] session-tz hook skipped:', (e as Error).message)
}

export async function ping(): Promise<boolean> {
  try {
    const conn = await pool.getConnection()
    await conn.ping()
    conn.release()
    return true
  } catch (e) {
    console.error('[db] ping failed:', (e as Error).message)
    return false
  }
}
