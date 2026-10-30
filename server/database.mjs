import pg from 'pg';
import { readFile } from 'node:fs/promises';
export function database(url) {
  if (!url) throw new Error('DATABASE_URL is required. See .env.example.');
  return new pg.Pool({connectionString:url,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
}
export async function transaction(pool, action) {
  const client=await pool.connect();
  try {await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function migrate(pool) {
  await transaction(pool,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(280, 1)");
    await client.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  });
}
