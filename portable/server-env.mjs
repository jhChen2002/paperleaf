import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync,existsSync,createReadStream} from 'node:fs';
import {mkdir,writeFile,rename,unlink,stat,readFile,open,rmdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
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
 async put(key,bytes){const dest=filePath(key);await mkdir(path.dirname(dest),{recursive:true});const temp=dest+'.'+randomUUID()+'.tmp';await writeFile(temp,typeof bytes==='string'?bytes:new Uint8Array(bytes));await rename(temp,dest);},
 async delete(key){await unlink(filePath(key)).catch(e=>{if(e.code!=='ENOENT')throw e;});},
 async head(key){try{return {size:(await stat(filePath(key))).size};}catch(e){if(e.code==='ENOENT')return null;throw e;}},
 async get(key,options){const dest=filePath(key);if(!existsSync(dest))return null;const info=await stat(dest);const range=options?.range;const stream=createReadStream(dest,range?{start:range.offset,end:range.offset+range.length-1}:undefined);return {size:info.size,body:Readable.toWeb(stream)};},
 async createMultipartUpload(key){const id=randomUUID();await BUCKET.put(`_multipart/${id}/key`,key);return BUCKET.resumeMultipartUpload(key,id);},
 resumeMultipartUpload(key,uploadId){
  if(!/^[a-f0-9-]{36}$/.test(uploadId))throw new Error('Invalid upload id');
  const prefix=`_multipart/${uploadId}`;
  async function validate(){if(await readFile(filePath(prefix+'/key'),'utf8')!==key)throw new Error('Upload mismatch');}
  async function cleanup(){const directory=path.dirname(filePath(prefix+'/key'));for(const file of readdirSync(directory))await unlink(filePath(prefix+'/'+file));await rmdir(directory);}
  return {key,uploadId,
   async uploadPart(partNumber,bytes){await validate();await BUCKET.put(`${prefix}/part-${partNumber}`,bytes);return {partNumber,etag:createHash('sha256').update(new Uint8Array(bytes)).digest('hex')};},
   async abort(){await validate();await cleanup();},
   async complete(parts){await validate();const dest=filePath(key);await mkdir(path.dirname(dest),{recursive:true});const temp=dest+'.'+randomUUID()+'.tmp';const handle=await open(temp,'w');let size=0;
    try{for(const part of parts){const bytes=await readFile(filePath(`${prefix}/part-${part.partNumber}`));if(createHash('sha256').update(bytes).digest('hex')!==part.etag)throw new Error('Part checksum mismatch');await handle.writeFile(bytes);size+=bytes.length;}}catch(e){await handle.close();await unlink(temp);throw e;}
    await handle.close();await rename(temp,dest);await cleanup();return {size};
   }
  };
 },
};
export const env={DB,BUCKET};
export function closeStorage(){sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');sql.close();}
