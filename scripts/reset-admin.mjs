// Offline recovery for an EXISTING SUPER_ADMIN. Never creates a database or user.
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,statSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,scryptSync} from 'node:crypto';
import {emitKeypressEvents} from 'node:readline';

function options(argv){
 const opts={list:false,email:null,id:null,newEmail:null,passwordStdin:false,backupDir:null};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--list')opts.list=true;
  else if(arg==='--password-stdin')opts.passwordStdin=true;
  else if(arg==='--email'&&argv[i+1])opts.email=argv[++i];
  else if(arg==='--id'&&argv[i+1])opts.id=argv[++i];
  else if(arg==='--new-email'&&argv[i+1])opts.newEmail=argv[++i];
  else if(arg==='--backup-dir'&&argv[i+1])opts.backupDir=argv[++i];
  else throw Error(`Invalid argument: ${arg}`);
 }
 if(opts.list){
  if(opts.email||opts.id||opts.newEmail||opts.passwordStdin||opts.backupDir)throw Error('--list cannot be combined with reset options');
 }else{
  if(Boolean(opts.email)===Boolean(opts.id))throw Error('Select exactly one existing account with --email <current-login> or --id <user-id>');
  if(opts.email&&(opts.email.trim()!==opts.email||!opts.email.trim()))throw Error('Invalid existing login');
  if(opts.id&&(!/^[1-9][0-9]*$/.test(opts.id)||!Number.isSafeInteger(Number(opts.id))))throw Error('Invalid user ID');
  if(opts.newEmail&&!validEmail(opts.newEmail))throw Error('Invalid new email address');
 }
 return opts;
}

function validEmail(email){
 return typeof email==='string'&&email.length<=254&&email===email.trim()&&
  /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email);
}

const requiredTables=['users','sessions','buildings','rooms','periods','invoices','invoice_versions','payments','payment_reversals','audit_logs'];
const financialTables=['buildings','rooms','periods','invoices','invoice_versions','payments','payment_reversals'];
function verify(db){
 if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw Error('Database integrity_check failed');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database foreign_key_check failed');
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
 for(const table of requiredTables)if(!tables.has(table))throw Error(`Incompatible database: missing ${table}`);
 return Object.fromEntries(financialTables.map(t=>[t,db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get().count]));
}

async function hiddenInput(label){
 const input=process.stdin;
 if(!input.isTTY||typeof input.setRawMode!=='function')throw Error('Interactive terminal required. For secure automation use --password-stdin.');
 process.stderr.write(label);
 return new Promise((resolvePromise,reject)=>{
  let value='';
  const wasRaw=input.isRaw===true;
  function done(err){
   input.removeListener('keypress',onKey);
   input.removeListener('error',onError);
   input.setRawMode(wasRaw);
   input.pause();
   process.stderr.write('\n');
   if(err)reject(err);else resolvePromise(value);
  }
  function onError(e){done(e);}
  function onKey(char,key={}){
   if((key.ctrl&&key.name==='c')||key.name==='escape')return done(Error('Cancelled'));
   if(key.name==='return'||key.name==='enter')return done();
   if(key.name==='backspace'){value=value.slice(0,-1);return;}
   if(char&&!key.ctrl&&!key.meta)value+=char;
  }
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  input.on('keypress',onKey);
  input.on('error',onError);
 });
}

async function newPassword(passwordStdin){
 let first,confirmation;
 if(passwordStdin){
  if(process.stdin.isTTY)throw Error('--password-stdin requires a pipe, not an interactive terminal');
  const lines=readFileSync(0,'utf8').replace(/\r\n/g,'\n').split('\n');
  if(lines.at(-1)==='')lines.pop();
  if(lines.length!==2)throw Error('Provide exactly two lines (new password and confirmation) via stdin');
  [first,confirmation]=lines;
 }else{
  first=await hiddenInput('New Admin password (hidden): ');
  confirmation=await hiddenInput('Confirm new password (hidden): ');
 }
 if(first!==confirmation)throw Error('Passwords do not match');
 if(first.length<12||first.length>1024||/[\r\n\0]/.test(first))throw Error('Password must contain 12-1024 characters without line breaks');
 return first;
}

async function main(){
 const opts=options(process.argv.slice(2));
 const dataDir=resolve(process.env.VINCENT_DATA_DIR||'data');
 const path=join(dataDir,'vincent.sqlite');
 if(!existsSync(path)||!statSync(path).isFile())throw Error(`Database missing; no new database will be created: ${path}`);

 const existing=new DatabaseSync(path,{readOnly:true});
 let before,account;
 try{
  before=verify(existing);
  if(opts.list){
   const users=existing.prepare('SELECT id,email,role FROM users ORDER BY id').all();
   console.log(`Database: ${path}`);
   for(const user of users)console.log(`${user.id}\t${user.email}\t${user.role}`);
   console.log(`Accounts: ${users.length}`);
   return;
  }
  account=opts.id
   ?existing.prepare('SELECT id,email,role FROM users WHERE id=?').get(Number(opts.id))
   :existing.prepare('SELECT id,email,role FROM users WHERE email=?').get(opts.email);
  if(!account||account.role!=='SUPER_ADMIN')throw Error('No matching SUPER_ADMIN account; nothing changed');
  if(opts.newEmail&&existing.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>?').get(opts.newEmail,account.id))
   throw Error('New email belongs to another account; nothing changed');
 }finally{existing.close();}

 const password=await newPassword(opts.passwordStdin);
 const newHash=(()=>{const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;})();
 // Online SQLite backup before any write; retain it even if the reset later fails.
 const backupDir=resolve(opts.backupDir||join(dataDir,'backups'));
 mkdirSync(backupDir,{recursive:true,mode:0o700});
 const filename=`vincent-before-admin-reset-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(5).toString('hex')}.sqlite`;
 const destination=join(backupDir,filename);
 const source=new DatabaseSync(path,{readOnly:true});
 try{await backup(source,destination);}finally{source.close();}
 chmodSync(destination,0o600);
 const snapshot=new DatabaseSync(destination,{readOnly:true});
 try{
  const counts=verify(snapshot);
  if(JSON.stringify(counts)!==JSON.stringify(before))throw Error('Backup financial row counts mismatch; reset cancelled');
 }finally{snapshot.close();}

 const db=new DatabaseSync(path,{create:false});
 try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  try{
   const current=db.prepare('SELECT id,email,role,password_hash FROM users WHERE id=? AND email=?').get(account.id,account.email);
   if(!current||current.role!=='SUPER_ADMIN')throw Error('Admin account changed during recovery');
   const updatedEmail=opts.newEmail||current.email;
   if(opts.newEmail&&db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>?').get(updatedEmail,account.id))
    throw Error('New email belongs to another account; nothing changed');
   const update=db.prepare("UPDATE users SET email=?,password_hash=? WHERE id=? AND role='SUPER_ADMIN' AND email=? AND password_hash=?")
    .run(updatedEmail,newHash,account.id,current.email,current.password_hash);
   if(update.changes!==1)throw Error('Admin credentials update did not affect exactly one account');
   const revoked=db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id).changes;
   const emailChanged=updatedEmail!==current.email;
   db.prepare('INSERT INTO audit_logs(user_id,action,entity,entity_id,before_data,after_data,reason) VALUES(?,?,?,?,?,?,?)')
    .run(account.id,'ADMIN_PASSWORD_RESET','user',account.id,
     emailChanged?JSON.stringify({email:current.email}):null,
     JSON.stringify({...emailChanged?{email:updatedEmail}:{},sessionsRevoked:Number(revoked)}),'Admin recovery by server operator');
   const after=Object.fromEntries(financialTables.map(t=>[t,db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get().count]));
   if(JSON.stringify(after)!==JSON.stringify(before))throw Error('Financial row counts changed; reset cancelled');
   db.exec('COMMIT');
   console.log(`Admin credentials reset: ${current.email}${emailChanged?` -> ${updatedEmail}`:''} (id=${account.id})`);
   console.log(`Revoked sessions: ${revoked}`);
   console.log(`Verified backup: ${destination}`);
   console.log('Financial records retained. Sign in using the new password.');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }finally{db.close();}
}

main().catch(e=>{console.error(`Admin recovery failed: ${e.message}`);process.exitCode=1;});
