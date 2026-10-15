import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync,existsSync,createReadStream} from 'node:fs';
import {mkdir,writeFile,rename,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';

export const root=path.dirname(fileURLToPath(import.meta.url));
export const dataDir=path.resolve(process.env.PAPERLEAF_DATA_DIR||path.join(root,'data'));
mkdirSync(dataDir,{recursive:true});
const sql=new DatabaseSync(path.join(dataDir,'library.sqlite'));
sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
sql.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
for(const name of readdirSync(path.join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort()){
 if(!sql.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)){
  sql.exec('BEGIN IMMEDIATE');try{sql.exec(readFileSync(path.join(root,'migrations',name),'utf8'));sql.prepare('INSERT INTO local_migrations VALUES (?,?)').run(name,new Date().toISOString());sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}
 }
}
class Statement{
 constructor(query,values=[]){this.query=query;this.values=values;}
 bind(...values){return new Statement(this.query,values);}
 async first(){return sql.prepare(this.query).get(...this.values)||null;}
 execute(){const query=sql.prepare(this.query);const before=Number(sql.prepare('SELECT total_changes() AS n').get().n);let results=[];if(query.columns().length)results=query.all(...this.values);else query.run(...this.values);return {results,success:true,meta:{changes:Number(sql.prepare('SELECT total_changes() AS n').get().n)-before}};}
 async all(){return this.execute();}
 async run(){return this.execute();}
}
const DB={prepare:(query)=>new Statement(query),batch:async statements=>{sql.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const filesDir=path.join(dataDir,'files');mkdirSync(filesDir,{recursive:true});
function filePath(key){const resolved=path.resolve(filesDir,key);if(!resolved.startsWith(filesDir+path.sep))throw new Error('Invalid file path');return resolved;}
const BUCKET={
 async put(key,bytes){const dest=filePath(key);await mkdir(path.dirname(dest),{recursive:true});const temp=dest+'.tmp';await writeFile(temp,new Uint8Array(bytes));await rename(temp,dest);},
 async delete(key){await unlink(filePath(key)).catch(e=>{if(e.code!=='ENOENT')throw e;});},
 async get(key,options){const dest=filePath(key);if(!existsSync(dest))return null;const info=await stat(dest);const range=options?.range;const stream=createReadStream(dest,range?{start:range.offset,end:range.offset+range.length-1}:undefined);return {size:info.size,body:Readable.toWeb(stream)};},
};
export const env={DB,BUCKET};
export function closeStorage(){sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');sql.close();}
