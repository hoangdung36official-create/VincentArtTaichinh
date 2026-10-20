// Restore to a brand-new directory. Existing operational databases are never overwritten.
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';

const [sourceArg,destinationArg]=process.argv.slice(2);
if(!sourceArg||!destinationArg){
 console.error('Usage: npm run restore -- <verified-backup.sqlite> <new-empty-data-directory>');
 process.exit(2);
}

const source=resolve(sourceArg),destinationDir=resolve(destinationArg);
const activeDir=resolve(process.env.VINCENT_DATA_DIR||'data');
if(!existsSync(source)||!statSync(source).isFile())throw Error(`Backup file not found: ${source}`);
if(existsSync(destinationDir))throw Error(`Destination already exists; refusing to overwrite: ${destinationDir}`);
if(destinationDir===activeDir)throw Error('Cannot restore over the active application data directory');

function validate(db){
 if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw Error('SQLite integrity check failed');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Backup has invalid foreign key references');
 const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
 for(const table of ['users','buildings','rooms','periods','invoices','invoice_versions','payments','payment_reversals','audit_logs']){
  if(!present.has(table))throw Error(`Not a compatible Vincent ART backup: missing ${table}`);
 }
 return Object.fromEntries(['users','buildings','rooms','invoices','payments','audit_logs'].map(table=>[
  table,db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
 ]));
}

const original=new DatabaseSync(source,{readOnly:true});
let created=false;
try{
 const before=validate(original);
 mkdirSync(destinationDir);created=true;
 const restoredPath=join(destinationDir,'vincent.sqlite');
 await backup(original,restoredPath);
 const restored=new DatabaseSync(restoredPath,{readOnly:true});
 try{
  const after=validate(restored);
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Row counts differ after restore');
 }finally{restored.close();}
 console.log(`Verified restore staging: ${restoredPath}`);
 console.log(`Validated row counts: ${JSON.stringify(before)}`);
 console.log('To inspect safely, start the app using VINCENT_DATA_DIR set to this new directory.');
}catch(error){
 if(created)rmSync(destinationDir,{recursive:true,force:true});
 throw error;
}finally{original.close();}
