import { database,migrate } from './database.mjs';
const pool=database(process.env.DATABASE_URL);
try {await migrate(pool);console.log('Database schema is ready.');}finally{await pool.end();}
