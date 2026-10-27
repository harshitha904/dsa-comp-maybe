import { DatabaseSync } from 'node:sqlite';
import { seedData } from './seed.js';

export function createStore(path = process.env.DB_PATH || 'data/mastergraph.sqlite') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(collection,id));');
  const collections = ['customers','products','orders','requests','audit','config'];
  const insert = db.prepare('INSERT INTO records(collection,id,value) VALUES(?,?,?)');
  const get = db.prepare('SELECT value FROM records WHERE collection=? ORDER BY rowid');
  const store = {
    all: () => Object.fromEntries(collections.map(c=>[c,get.all(c).map(r=>JSON.parse(r.value))])),
    put: (collection,item) => db.prepare('INSERT INTO records(collection,id,value) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value').run(collection,item.id,JSON.stringify(item)),
    transaction: (fn) => { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } },
    reset: () => store.transaction(()=>{ db.exec('DELETE FROM records'); const data=seedData(); for(const c of collections) for(const item of data[c] ?? []) insert.run(c,item.id,JSON.stringify(item)); }),
    close: () => db.close()
  };
  if (!db.prepare('SELECT 1 FROM records LIMIT 1').get()) store.reset();
  return store;
}
