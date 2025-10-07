import { Database } from "better-sqlite3";
import sql from "sql-template-strings";
const db = new Database('dragonball.db');

db.exec(sql`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    
  )
`);