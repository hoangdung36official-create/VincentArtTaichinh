import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';

const dataDir=resolve(process.env.VINCENT_DATA_DIR||'data');
const source=join(dataDir,'vincent.sqlite');
if(!existsSync(source))throw Error(`Database missing: ${source}`);
const backupDir=resolve(process.argv[2]||join(dataDir,'backups'));
mkdirSync(backupDir,{recursive:true});
const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
const destination=join(backupDir,`vincent-${timestamp}.sqlite`);
const db=new DatabaseSync(source,{readOnly:true});
try{
 await backup(db,destination);
 const check=new DatabaseSync(destination,{readOnly:true});
 try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');}
 finally{check.close();}
 console.log(`Verified SQLite backup: ${destination}`);
}finally{db.close();}
