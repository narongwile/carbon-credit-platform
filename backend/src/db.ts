import mysql from 'mysql2/promise'

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
  timezone: 'Z',
})

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
