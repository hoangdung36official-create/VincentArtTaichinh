import http from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {calculateInvoice,balance} from './finance.js';
import {parseCommand} from './ai-command.js';
import {resolveAiCommand} from './ai-provider.js';
import {parseCsv,parseVndInteger,importedMonth} from './import-csv.js';
import {xlsxCsv,xlsxSheets,xlsxTable} from './import-xlsx.js';
import {analyzeA12Table} from './import-a12.js';
import {exportCsv} from './export-csv.js';

const base=resolve('.');
const dataDir=resolve(process.env.VINCENT_DATA_DIR||join(base,'data'));
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(join(dataDir,'vincent.sqlite'));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','MANAGER','ACCOUNTANT','COLLECTOR','VIEWER')));
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS buildings(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,address TEXT DEFAULT '',electric_rate INTEGER NOT NULL DEFAULT 3800,water_rate INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS user_buildings(user_id INTEGER REFERENCES users(id),building_id INTEGER REFERENCES buildings(id),PRIMARY KEY(user_id,building_id));
CREATE TABLE IF NOT EXISTS rooms(id INTEGER PRIMARY KEY,building_id INTEGER NOT NULL REFERENCES buildings(id),code TEXT NOT NULL,rent INTEGER NOT NULL DEFAULT 0,internet INTEGER NOT NULL DEFAULT 0,cleaning INTEGER NOT NULL DEFAULT 0,parking INTEGER NOT NULL DEFAULT 0,tenant TEXT DEFAULT '',UNIQUE(building_id,code));
CREATE TABLE IF NOT EXISTS periods(id INTEGER PRIMARY KEY,building_id INTEGER NOT NULL REFERENCES buildings(id),month TEXT NOT NULL CHECK(length(month)=7),locked INTEGER NOT NULL DEFAULT 0,UNIQUE(building_id,month));
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY,period_id INTEGER NOT NULL REFERENCES periods(id),room_id INTEGER NOT NULL REFERENCES rooms(id),version INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL DEFAULT 'DRAFT',input TEXT NOT NULL,total INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(period_id,room_id));
CREATE TABLE IF NOT EXISTS invoice_versions(id INTEGER PRIMARY KEY,invoice_id INTEGER NOT NULL REFERENCES invoices(id),version INTEGER NOT NULL,input TEXT NOT NULL,total INTEGER NOT NULL,reason TEXT,actor_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(invoice_id,version));
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,invoice_id INTEGER NOT NULL REFERENCES invoices(id),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL CHECK(method IN ('CASH','TRANSFER')),collector_id INTEGER NOT NULL REFERENCES users(id),reference TEXT UNIQUE NOT NULL,received_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payment_reversals(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),actor_id INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL CHECK(length(reason)>0),created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),action TEXT NOT NULL,entity TEXT NOT NULL,entity_id INTEGER NOT NULL,before_data TEXT,after_data TEXT,reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_rooms_building ON rooms(building_id);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity,entity_id);`);
if(!db.prepare('PRAGMA table_info(rooms)').all().some(c=>c.name==='occupants')) db.exec('ALTER TABLE rooms ADD COLUMN occupants INTEGER NOT NULL DEFAULT 0');
for(const column of ['electric_rate','water_rate'])if(!db.prepare('PRAGMA table_info(rooms)').all().some(c=>c.name===column))
 db.exec(`ALTER TABLE rooms ADD COLUMN ${column} INTEGER DEFAULT NULL CHECK(${column}>=0)`);
const query=(sql,...params)=>db.prepare(sql).all(...params);
const one=(sql,...params)=>db.prepare(sql).get(...params);
const run=(sql,...params)=>db.prepare(sql).run(...params);
const hashPassword=(p,s=randomBytes(16).toString('hex'))=>s+':'+scryptSync(p,s,64).toString('hex');
const checkPassword=(p,h)=>{const [s,d]=h.split(':');const computed=scryptSync(p,s,64);const expected=Buffer.from(d,'hex');return computed.length===expected.length&&timingSafeEqual(computed,expected);};
const secret=process.env.ADMIN_PASSWORD;
if(!one('SELECT id FROM users LIMIT 1')){
 if(!secret||secret.length<12){console.error('Set ADMIN_PASSWORD (12+ chars) before initial startup.');process.exit(1);}
 run('INSERT INTO users(email,password_hash,role) VALUES(?,?,?)',process.env.ADMIN_EMAIL||'admin@example.com',hashPassword(secret),'SUPER_ADMIN');
 console.log('Initial admin user created.');
}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const fail=(status,message)=>Object.assign(new Error(message),{status});
const requireValue=(v,name)=>{if(v===undefined||v===null||v==='')throw fail(400,`Missing ${name}`);return v;};
const safeInt=(v,name)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw fail(400,`Invalid ${name}`);return v;};
const safeSqlMoney=(value,name)=>{const exact=BigInt(value);if(exact<0n||exact>BigInt(Number.MAX_SAFE_INTEGER))throw fail(409,`${name} exceeds safe integer range`);return Number(exact);};
const allowed=(user,buildingId)=>user.role==='SUPER_ADMIN'||!!one('SELECT 1 FROM user_buildings WHERE user_id=? AND building_id=?',user.id,buildingId);
const authorize=(user,buildingId,write=true)=>{if(write&&!['SUPER_ADMIN','MANAGER','ACCOUNTANT','COLLECTOR'].includes(user.role))throw fail(403,'Read only');if(!allowed(user,buildingId))throw fail(403,'Building access denied');};
const requireRole=(user,roles)=>{if(!roles.includes(user.role))throw fail(403,'Insufficient role');};
const monthValid=month=>typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month);
const invoiceInputFields=new Set(['rent','previousElectric','currentElectric','previousWater','currentWater','electricRate','waterRate','internet','cleaning','parking','extras','discount']);
const invoiceOverrides=value=>{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!invoiceInputFields.has(key)))throw fail(400,'Invalid invoice input fields');
 return value;
};
const aiPreviews=new Map();
const importPreviews=new Map();
const initialImportPreviews=new Map();
const loginFailures=new Map();
const cookieFlags=`HttpOnly; SameSite=Strict; Path=/${process.env.NODE_ENV==='production'||process.env.COOKIE_SECURE==='1'?'; Secure':''}`;
const audit=(user,action,entity,id,before,after,reason='')=>run('INSERT INTO audit_logs(user_id,action,entity,entity_id,before_data,after_data,reason) VALUES(?,?,?,?,?,?,?)',user.id,action,entity,id,before&&JSON.stringify(before),after&&JSON.stringify(after),reason);
const paid=id=>safeSqlMoney(one('SELECT CAST(COALESCE(SUM(t.amount),0) AS TEXT) as amount FROM payments t WHERE t.invoice_id=? AND NOT EXISTS(SELECT 1 FROM payment_reversals v WHERE v.payment_id=t.id)',id).amount,'Payment sum');
const sumMoney=(list,key)=>list.reduce((sum,row)=>{const n=sum+row[key];if(!Number.isSafeInteger(n))throw fail(409,'Financial report sum exceeds safe integer range');return n;},0);
function financialStats(invoices,rooms=0){
 const rows=invoices.map(detail);
 return {rooms,invoiced:rows.length,total:sumMoney(rows,'total'),paid:sumMoney(rows,'paid'),due:sumMoney(rows,'due'),overpaid:sumMoney(rows,'overpaid'),unpaid:rows.filter(x=>x.status==='UNPAID').length,partial:rows.filter(x=>x.status==='PARTIAL').length,complete:rows.filter(x=>x.status==='PAID'||x.status==='OVERPAID').length};
}
const detail=(invoice)=>{const amount=paid(invoice.id);return {...invoice,input:JSON.parse(invoice.input),paid:amount,...balance(invoice.total,amount)};};
const previousMonth=month=>{const date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);};
const nextMonth=month=>{const date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+1);return date.toISOString().slice(0,7);};
function carryoverConflict(roomId,month,before,after){
 if(before.currentElectric===after.currentElectric&&before.currentWater===after.currentWater)return null;
 const future=one('SELECT i.id,i.input,p.locked FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.room_id=? AND p.month=?',roomId,nextMonth(month));
 if(!future)return null;
 const subsequent=JSON.parse(future.input);
 if((before.currentElectric!==after.currentElectric&&subsequent.previousElectric===before.currentElectric)||
    (before.currentWater!==after.currentWater&&subsequent.previousWater===before.currentWater))return {invoiceId:future.id,month:nextMonth(month),locked:!!future.locked};
 return null;
}
function initialInvoiceInput(room,month,overrides={}){
 const prev=one('SELECT i.input FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.room_id=? AND p.month=?',room.id,previousMonth(month));
 const prior=prev?JSON.parse(prev.input):null;
 return {rent:room.rent,internet:room.internet,cleaning:room.cleaning,parking:room.parking,previousElectric:prior?.currentElectric??null,currentElectric:null,previousWater:prior?.currentWater??null,currentWater:null,electricRate:room.electric_rate,waterRate:room.water_rate,extras:0,discount:0,...overrides};
}
function inheritedMeterChanges(room,month,overrides){
 const inherited=initialInvoiceInput(room,month);
 return ['previousElectric','previousWater'].filter(key=>inherited[key]!==null&&overrides[key]!==undefined&&overrides[key]!==inherited[key]);
}
function inspectPeriod(buildingId,month){
 const rooms=query(`SELECT r.id,r.code,r.tenant,i.id invoice_id,i.input,i.total,i.version
   FROM rooms r LEFT JOIN periods p ON p.building_id=r.building_id AND p.month=?
   LEFT JOIN invoices i ON i.period_id=p.id AND i.room_id=r.id
   WHERE r.building_id=? ORDER BY r.code`,month,buildingId);
 const rows=rooms.map(r=>{
  const issues=[],warnings=[];
  if(!r.invoice_id)return {roomId:r.id,room:r.code,invoiceId:null,status:'MISSING',issues:['Chưa có hóa đơn'],warnings};
  let expected=null,input;
  try{
   input=JSON.parse(r.input);
   for(const field of ['previousElectric','currentElectric','previousWater','currentWater'])if(input[field]===null||input[field]===undefined)issues.push(`Thiếu ${field}`);
   if(input.currentElectric>input.previousElectric&&!input.electricRate)issues.push('Thiếu đơn giá điện');
   if(input.currentWater>input.previousWater&&!input.waterRate)issues.push('Thiếu đơn giá nước');
   expected=calculateInvoice(input);
   if(expected!==r.total)issues.push(`Sai tổng tiền: lưu ${r.total}đ, tính ${expected}đ`);
   if(input.currentElectric-input.previousElectric>1500)warnings.push('Điện tiêu thụ trên 1.500 kWh: cần kiểm tra');
   if(input.currentWater-input.previousWater>100)warnings.push('Nước tiêu thụ trên 100 m³: cần kiểm tra');
   const prior=one('SELECT i.input FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.room_id=? AND p.month=?',r.id,previousMonth(month));
   if(prior){
    const before=JSON.parse(prior.input);
    if(input.previousElectric!==before.currentElectric)warnings.push('Điện cũ khác điện mới kỳ trước');
    if(input.previousWater!==before.currentWater)warnings.push('Nước cũ khác nước mới kỳ trước');
   }
  }catch{issues.push('Dữ liệu hóa đơn không hợp lệ');}
  const savedVersion=one('SELECT version,input,total FROM invoice_versions WHERE invoice_id=? ORDER BY version DESC LIMIT 1',r.invoice_id);
  if(!savedVersion||savedVersion.version!==r.version||savedVersion.total!==r.total||savedVersion.input!==r.input)issues.push('Lịch sử phiên bản không khớp hóa đơn hiện tại');
  const history=query('SELECT version,input,total FROM invoice_versions WHERE invoice_id=? ORDER BY version',r.invoice_id);
  if(history.length!==r.version||history.some((version,index)=>version.version!==index+1))issues.push('Chuỗi phiên bản hóa đơn bị thiếu hoặc không liên tục');
  for(const version of history){
   try{if(calculateInvoice(JSON.parse(version.input))!==version.total)issues.push(`Lịch sử phiên bản ${version.version} sai tổng tiền`);}
   catch{issues.push(`Lịch sử phiên bản ${version.version} chứa dữ liệu không hợp lệ`);}
  }
  return {roomId:r.id,room:r.code,invoiceId:r.invoice_id,version:r.version,total:r.total,expected,paid:paid(r.invoice_id),status:issues.length?'ERROR':warnings.length?'WARNING':'VALID',issues,warnings};
 });
 return {buildingId,month,rooms:rows,missing:rows.filter(r=>r.status==='MISSING').length,errors:rows.filter(r=>r.status==='ERROR').length,warnings:rows.filter(r=>r.status==='WARNING').length,valid:rows.filter(r=>r.status==='VALID').length};
}
function paymentJournal(buildingId,month){
 return query(`SELECT t.id,t.amount,CASE WHEN v.id IS NULL THEN t.amount ELSE 0 END net_amount,
   CASE WHEN v.id IS NULL THEN 0 ELSE 1 END reversed,v.reason reversal_reason,v.created_at reversed_at,ru.email reversed_by,
   t.method,t.reference,t.received_at,t.created_at,t.collector_id,u.email collector,
   r.code room_code,i.id invoice_id FROM payments t JOIN invoices i ON i.id=t.invoice_id
   JOIN rooms r ON r.id=i.room_id JOIN periods p ON p.id=i.period_id JOIN users u ON u.id=t.collector_id
   LEFT JOIN payment_reversals v ON v.payment_id=t.id LEFT JOIN users ru ON ru.id=v.actor_id
   WHERE p.building_id=? AND p.month=? ORDER BY t.id DESC`,buildingId,month);
}
function reconcileBuilding(buildingId,month){
 const review=inspectPeriod(buildingId,month);
 const period=one('SELECT locked FROM periods WHERE building_id=? AND month=?',buildingId,month);
 const invoices=query(`SELECT i.*,r.code room_code FROM invoices i JOIN rooms r ON r.id=i.room_id
  JOIN periods p ON p.id=i.period_id WHERE p.building_id=? AND p.month=? ORDER BY r.code`,buildingId,month);
 const journal=paymentJournal(buildingId,month);
 const ledger=new Map();
 for(const entry of journal){
  const total=(ledger.get(entry.invoice_id)||0)+entry.net_amount;
  if(!Number.isSafeInteger(total))throw fail(409,'Payment ledger exceeds safe integer range');
  ledger.set(entry.invoice_id,total);
 }
 const issues=[];
 const rows=invoices.map(inv=>{
  const actual=paid(inv.id),journalPaid=ledger.get(inv.id)||0;
  if(actual!==journalPaid)issues.push(`Giao dịch không khớp hóa đơn phòng ${inv.room_code}`);
  return {invoiceId:inv.id,room:inv.room_code,version:inv.version,total:inv.total,paid:actual,...balance(inv.total,actual),transactionCount:journal.filter(j=>j.invoice_id===inv.id&&!j.reversed).length};
 });
 const totals={total:sumMoney(rows,'total'),paid:sumMoney(rows,'paid'),due:sumMoney(rows,'due'),overpaid:sumMoney(rows,'overpaid')};
 const paymentMethods={cash:sumMoney(journal.filter(x=>x.method==='CASH'),'net_amount'),transfer:sumMoney(journal.filter(x=>x.method==='TRANSFER'),'net_amount')};
 if(paymentMethods.cash+paymentMethods.transfer!==totals.paid)issues.push('Tổng thực thu theo phương thức không khớp sổ hóa đơn');
 if(sumMoney(journal,'net_amount')!==totals.paid)issues.push('Nhật ký giao dịch không khớp tổng đã thu');
 if(review.errors)issues.push(`${review.errors} hóa đơn có lỗi nghiệp vụ`);
 if(review.missing)issues.push(`${review.missing} phòng chưa có hóa đơn`);
 return {buildingId,month,periodExists:!!period,locked:!!period?.locked,rooms:review.rooms.length,invoiced:rows.length,
  missing:review.missing,warnings:review.warnings,errors:review.errors,issues,
  transactions:journal.length,activeTransactions:journal.filter(x=>!x.reversed).length,reversedTransactions:journal.filter(x=>x.reversed).length,
  totals,paymentMethods,rows,checks:review.rooms};
}
function csvPlan(body,user){
 requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
 const buildingId=Number(body.buildingId),month=body.month;
 authorize(user,buildingId);
 if(!monthValid(month))throw fail(400,'Tháng nhập không hợp lệ');
 const period=one('SELECT * FROM periods WHERE building_id=? AND month=?',buildingId,month);
 if(period?.locked)throw fail(409,'Kỳ đã khóa');
 const building=one('SELECT code FROM buildings WHERE id=?',buildingId);
 const rooms=query('SELECT r.*,COALESCE(r.electric_rate,b.electric_rate) electric_rate_effective,COALESCE(r.water_rate,b.water_rate) water_rate_effective FROM rooms r JOIN buildings b ON b.id=r.building_id WHERE r.building_id=?',buildingId)
  .map(r=>({...r,electric_rate:r.electric_rate_effective,water_rate:r.water_rate_effective}));
 const roomMap=new Map(rooms.map(r=>[r.code.toUpperCase(),r]));
 let parsed;try{parsed=parseCsv(body.csv);}catch(e){throw fail(400,e.message);}
 const items=[],rows=[],seen=new Set();let skippedMonth=0;
 for(const row of parsed){
  if(row.month!==undefined){const found=importedMonth(row.month);if(!found){rows.push({line:row.line,room:row.room,status:'ERROR',message:'Tháng trong file không hợp lệ'});continue;}
   if(found!==month){skippedMonth++;continue;}}
  const label=String(row.room).trim().toUpperCase();
  const split=label.match(/^([A-Z]\d+)\s*[.\-/]\s*(\d+)$/);
  const code=split?split[2]:label;
  try{
   if(split&&split[1]!==building.code.toUpperCase())throw Error('Dòng thuộc tòa khác');
   if(row.building&&row.building.trim().toUpperCase()!==building.code.toUpperCase())throw Error('Mã nhà không đúng');
   const room=roomMap.get(code);if(!room)throw Error('Không tìm thấy phòng trong tòa đã chọn');
   if(seen.has(code))throw Error('Phòng bị lặp trong file');seen.add(code);
   if(period&&one('SELECT id FROM invoices WHERE period_id=? AND room_id=?',period.id,room.id))throw Error('Phòng đã có hóa đơn, không tự ghi đè');
   const changes={};
   for(const key of ['previousElectric','currentElectric','previousWater','currentWater','rent','internet','cleaning','parking','electricRate','waterRate','extras','discount']){
    const num=parseVndInteger(row[key],key,!['previousElectric','currentElectric','previousWater','currentWater'].includes(key));
    if(num!==undefined)changes[key]=num;
   }
   const conflicts=inheritedMeterChanges(room,month,changes);
   if(conflicts.length)throw Error(`Chỉ số cũ lệch kỳ trước (${conflicts.join(', ')}); cần kiểm tra và điều chỉnh có lý do trước khi nhập`);
   const input=initialInvoiceInput(room,month,changes),total=calculateInvoice(input);
   const stated=parseVndInteger(row.total,'Tổng tham chiếu',true);
   if(stated!==undefined&&stated!==total)throw Error(`Lệch tổng tiền ${stated-total}đ (file ${stated}đ, tính lại ${total}đ)`);
   items.push({roomId:room.id,code,input,total});
   rows.push({line:row.line,room:code,status:'READY',total});
  }catch(e){rows.push({line:row.line,room:label,status:'ERROR',message:e.message});}
 }
 const errors=rows.filter(r=>r.status==='ERROR').length;
 return {buildingId,month,items,rows,skippedMonth,ready:items.length,errors,reply:errors?`Có ${errors} dòng lỗi. Chỉnh file trước khi nhập để tránh sai số.`:`Đã kiểm tra ${items.length} phòng của kỳ ${month}. Xác nhận trước khi lưu.`};
}
function aiPlan(command,user,selectedMonth=null){
 if(selectedMonth!==null&&!monthValid(selectedMonth))throw fail(400,'Tháng được chọn không hợp lệ');
 const intent=parseCommand(command,selectedMonth?Number(selectedMonth.slice(0,4)):new Date().getFullYear());
 if(['water_reading','electric_reading','meter_batch','debt_search','invoice_images'].includes(intent.type)&&!intent.month&&selectedMonth)intent.month=selectedMonth;
 if(intent.type==='invoice_lookup'&&!intent.room&&!intent.month&&selectedMonth)intent.month=selectedMonth;
 if(intent.type==='help')return {type:intent.type,readOnly:true,reply:'Lệnh mẫu: Thêm tòa nhà A15 tên Nhà A15; thêm các phòng 201,202 nhà A15 giá phòng 4.000.000 internet 100.000; tìm phòng nhà A15; tìm công nợ nhà A15 tháng 10/2026; nhập điện mới nhà A15: 201=130, 202=140 tháng 10/2026; xuất ảnh hóa đơn nhà A15 tháng 10/2026; import Excel nhà A15.'};
 if(intent.type==='import_help'){
  if(intent.building){const b=one('SELECT id FROM buildings WHERE UPPER(code)=?',intent.building);if(!b)throw fail(404,'Không tìm thấy tòa nhà');authorize(user,b.id,false);}
  return {type:intent.type,readOnly:true,navigate:'imports',reply:'Mở mục Import AI / Excel, chọn đúng tòa và kỳ, tải XLSX/CSV, kiểm tra bản xem trước rồi xác nhận nhập. AI không tự ghi dữ liệu từ tệp chưa được xem trước.'};
 }
 if(intent.type==='unsupported')throw fail(422,'Chưa hiểu yêu cầu. Gõ “Hướng dẫn AI” để xem các lệnh hỗ trợ.');
 if(intent.type==='create_building'||intent.type==='create_building_floors'){
  requireRole(user,['SUPER_ADMIN']);
  if(!/^[AV]\d{1,3}$/.test(intent.code||'')||!intent.name||intent.name.length>100||intent.address.length>250)throw fail(400,'Cần mã nhà A/V, tên và địa chỉ hợp lệ');
  const electricRate=intent.electricRate??3800,waterRate=intent.waterRate??0;
  if(![electricRate,waterRate].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000))throw fail(400,'Đơn giá không hợp lệ');
  if(one('SELECT id FROM buildings WHERE UPPER(code)=?',intent.code))throw fail(409,'Mã tòa nhà đã tồn tại');
  const buildingItem={code:intent.code,name:intent.name,address:intent.address,electricRate,waterRate};
  if(intent.type==='create_building')return {type:intent.type,items:[buildingItem],reply:`Xác nhận tạo nhà ${intent.code} (${intent.name}), điện ${electricRate.toLocaleString('vi-VN')}đ/kWh, nước ${waterRate.toLocaleString('vi-VN')}đ/m³?`};
  if(intent.layoutError)throw fail(400,intent.layoutError);
  if(!Number.isSafeInteger(intent.totalRooms)||intent.totalRooms<1||intent.totalRooms>100||!intent.floors?.length)throw fail(400,'Cần 1–100 phòng và cấu trúc từng tầng rõ ràng');
  if(intent.floors.some(({floor,count})=>!Number.isInteger(floor)||floor<1||floor>99||!Number.isInteger(count)||count<1||count>99))throw fail(400,'Mỗi tầng phải có số tầng 1–99 và 1–99 phòng');
  if(new Set(intent.floors.map(f=>f.floor)).size!==intent.floors.length)throw fail(400,'Tầng được khai báo lặp');
  const actual=intent.floors.reduce((sum,f)=>sum+f.count,0);
  if(actual!==intent.totalRooms)throw fail(400,`Tổng số phòng khai báo ${intent.totalRooms} nhưng cộng các tầng được ${actual}. Vui lòng kiểm tra lại.`);
  const rooms=intent.floors.flatMap(({floor,count})=>Array.from({length:count},(_,i)=>({kind:'room',code:String(floor*100+i+1),floor})));
  if(new Set(rooms.map(r=>r.code)).size!==rooms.length)throw fail(400,'Quy tắc đánh số phòng bị trùng');
  const previewFloors=intent.floors.map(({floor,count})=>({floor,count,from:String(floor*100+1),to:String(floor*100+count)}));
  const description=previewFloors.map(f=>`tầng ${f.floor}: ${f.count} phòng (${f.from}–${f.to})`).join('; ');
  return {type:intent.type,items:[{kind:'building',...buildingItem},...rooms],floors:previewFloors,reply:`Xem trước: tạo nhà ${intent.code}, địa chỉ ${intent.address}; ${rooms.length} phòng: ${description}. Đánh số theo tầng (101–103, 201–209, ...). Giá thuê/dịch vụ các phòng ban đầu là 0đ, cần cập nhật sau; điện mặc định ${electricRate.toLocaleString('vi-VN')}đ/kWh, nước ${waterRate.toLocaleString('vi-VN')}đ/m³. Bạn xác nhận tạo cả nhà và ${rooms.length} phòng?`};
 }
 if(intent.type==='create_rooms'){
  requireRole(user,['SUPER_ADMIN','MANAGER']);
  if(!intent.building)throw fail(400,'Cần nêu mã nhà');
  const b=one('SELECT id FROM buildings WHERE UPPER(code)=?',intent.building);if(!b)throw fail(404,'Không tìm thấy nhà');authorize(user,b.id);
  if(!intent.codes?.length||intent.codes.length>100||new Set(intent.codes).size!==intent.codes.length||intent.codes.some(c=>!/^\d{2,5}$/.test(c)))throw fail(400,'Chỉ nhận 1–100 mã phòng riêng biệt từ 2–5 chữ số');
  const values={rent:intent.rent??0,internet:intent.internet??0,cleaning:intent.cleaning??0,parking:intent.parking??0,occupants:intent.occupants??0};
  if(Object.values(values).some(n=>!Number.isSafeInteger(n)||n<0)||values.occupants>100)throw fail(400,'Tiền phòng/dịch vụ hoặc số người không hợp lệ');
  const items=intent.codes.map(code=>{if(one('SELECT id FROM rooms WHERE building_id=? AND code=?',b.id,code))throw fail(409,`Phòng ${intent.building}.${code} đã tồn tại`);return {buildingId:b.id,building:intent.building,code,...values};});
  return {type:intent.type,items,reply:`Xác nhận tạo ${items.length} phòng nhà ${intent.building}: ${items.map(i=>i.code).join(', ')}; tiền phòng ${values.rent.toLocaleString('vi-VN')}đ, internet ${values.internet.toLocaleString('vi-VN')}đ, vệ sinh ${values.cleaning.toLocaleString('vi-VN')}đ, tiền xe ${values.parking.toLocaleString('vi-VN')}đ?`};
 }
 if(intent.type==='entity_search'){
  if(!intent.building){const rows=query(user.role==='SUPER_ADMIN'?'SELECT code,name,address FROM buildings ORDER BY code LIMIT 100':'SELECT b.code,b.name,b.address FROM buildings b JOIN user_buildings ub ON ub.building_id=b.id WHERE ub.user_id=? ORDER BY b.code LIMIT 100',...(user.role==='SUPER_ADMIN'?[]:[user.id]));return {type:intent.type,readOnly:true,records:rows,reply:`Có ${rows.length} tòa nhà được phân quyền (tối đa 100 kết quả).`};}
  const b=one('SELECT * FROM buildings WHERE UPPER(code)=?',intent.building);if(!b)throw fail(404,'Không tìm thấy tòa nhà');authorize(user,b.id,false);
  const rows=intent.room?query('SELECT code,rent,internet,cleaning,parking,tenant,occupants FROM rooms WHERE building_id=? AND code=?',b.id,intent.room):query('SELECT code,rent,internet,cleaning,parking,tenant,occupants FROM rooms WHERE building_id=? ORDER BY code LIMIT 100',b.id);
  return {type:intent.type,readOnly:true,records:rows,reply:`Nhà ${b.code} (${b.name}): ${rows.length} phòng phù hợp (tối đa 100). Giá điện ${b.electric_rate}đ/kWh, giá nước ${b.water_rate}đ/m³.`};
 }
 if(intent.type==='debt_search'){
  if(!intent.building)throw fail(400,'Cần chỉ rõ mã nhà để tìm công nợ');
  const b=one('SELECT id FROM buildings WHERE UPPER(code)=?',intent.building);if(!b)throw fail(404,'Không tìm thấy nhà');authorize(user,b.id,false);
  if(!intent.month)throw fail(400,'Cần chọn tháng/năm để tra cứu');
  const rows=query(`SELECT i.*,p.month,r.code room_code FROM invoices i JOIN periods p ON p.id=i.period_id JOIN rooms r ON r.id=i.room_id WHERE p.building_id=? AND p.month=? AND (? IS NULL OR r.code=?) ORDER BY r.code LIMIT 100`,b.id,intent.month,intent.room||null,intent.room||null).map(detail);
  return {type:intent.type,readOnly:true,records:rows.map(i=>({room:i.room_code,month:i.month,total:i.total,paid:i.paid,due:i.due,overpaid:i.overpaid,status:i.status})),reply:`Công nợ nhà ${intent.building} kỳ ${intent.month}: ${rows.length} hóa đơn (tối đa 100).`};
 }
 if(intent.type==='invoice_images'){
  if(!intent.month||!intent.buildings.length)throw fail(400,'Cần chỉ rõ mã nhà và tháng cần xuất ảnh');
  const invoices=[];
  for(const code of (intent.room?[intent.building]:intent.buildings)){
   const b=one('SELECT id FROM buildings WHERE UPPER(code)=?',code);if(!b)throw fail(404,`Không tìm thấy nhà ${code}`);authorize(user,b.id,false);
   const rows=query(`SELECT i.id,i.total,i.version,p.month,r.code room_code FROM invoices i JOIN periods p ON p.id=i.period_id JOIN rooms r ON r.id=i.room_id WHERE p.building_id=? AND p.month=? AND (? IS NULL OR r.code=?) ORDER BY r.code LIMIT 101`,b.id,intent.month,intent.room||null,intent.room||null);
   invoices.push(...rows.map(r=>({...r,building:code})));
  }
  if(invoices.length>100)throw fail(400,'Mỗi lần chỉ xuất tối đa 100 hóa đơn; chọn ít tòa/phòng hơn');
  return {type:intent.type,readOnly:true,exportImages:true,invoices,reply:`Tìm thấy ${invoices.length} hóa đơn kỳ ${intent.month}. Có thể tải PNG từng phòng hoặc ZIP ảnh hàng loạt.`};
 }
 if(intent.type==='invoice_lookup'){
  if(!intent.building)throw fail(400,'Cần chỉ rõ mã nhà');
  const b=one('SELECT id FROM buildings WHERE UPPER(code)=?',intent.building);if(!b)throw fail(404,'Không tìm thấy nhà');authorize(user,b.id,false);
  if(!intent.room&&!intent.month)throw fail(400,'Cần chọn kỳ khi lấy hóa đơn cả tòa');
  const invoices=query(`SELECT i.*,p.month,r.code room_code FROM invoices i JOIN periods p ON p.id=i.period_id JOIN rooms r ON r.id=i.room_id
    WHERE p.building_id=? AND (? IS NULL OR r.code=?) AND (? IS NULL OR p.month=?) ORDER BY p.month DESC,r.code LIMIT 100`,b.id,intent.room||null,intent.room||null,intent.month||null,intent.month||null).map(detail);
  return {type:intent.type,readOnly:true,reply:invoices.length?`Tìm thấy ${invoices.length} hóa đơn cho nhà ${intent.building} (tối đa 100).`:'Chưa có hóa đơn phù hợp.',invoices:invoices.map(x=>({id:x.id,room:x.room_code,month:x.month,total:x.total,paid:x.paid,due:x.due,version:x.version}))};
 }
 if(intent.type==='meter_batch'){
  requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
  if(!intent.building||!intent.month||!intent.readings.length||intent.readings.length>100||new Set(intent.readings.map(r=>r.room)).size!==intent.readings.length)throw fail(400,'Cần mã nhà, kỳ và tối đa 100 phòng không trùng');
  const b=one('SELECT id FROM buildings WHERE UPPER(code)=?',intent.building);if(!b)throw fail(404,'Không tìm thấy nhà');authorize(user,b.id);
  const items=intent.readings.map(row=>{
   if(!Number.isSafeInteger(row.value)||row.value<0)throw fail(400,'Chỉ số không hợp lệ');
   const inv=one(`SELECT i.*,p.locked FROM invoices i JOIN periods p ON p.id=i.period_id JOIN rooms r ON r.id=i.room_id WHERE p.building_id=? AND p.month=? AND r.code=?`,b.id,intent.month,row.room);
   if(!inv)throw fail(404,`Thiếu hóa đơn ${intent.building}.${row.room}`);if(inv.locked)throw fail(409,'Kỳ đã khóa');
   const before=JSON.parse(inv.input),updated={...before,[intent.field]:row.value};
   if(before[intent.field]===row.value)throw fail(409,`Chỉ số phòng ${row.room} đã đúng`);
   let total;try{total=calculateInvoice(updated);}catch(e){throw fail(400,`Phòng ${row.room}: ${e.message}`);}
   return {invoiceId:inv.id,version:inv.version,field:intent.field,building:intent.building,room:row.room,month:intent.month,from:before[intent.field],to:row.value,oldTotal:inv.total,newTotal:total,impact:carryoverConflict(inv.room_id,intent.month,before,updated)};
  });
  return {type:intent.type,items,reply:`Xác nhận cập nhật ${intent.field==='currentElectric'?'điện':'nước'} mới cho ${items.length} phòng nhà ${intent.building}, kỳ ${intent.month}? ${items.map(i=>`${i.room}: ${i.from} → ${i.to}, tổng ${i.oldTotal} → ${i.newTotal}đ`).join('; ')}`};
 }
 if(!Number.isSafeInteger(intent.value)||intent.value<0)throw fail(400,'Cần nhập giá trị số nguyên không âm rõ ràng.');
  requireRole(user,['water_reading','electric_reading'].includes(intent.type)?['SUPER_ADMIN','MANAGER','ACCOUNTANT']:['SUPER_ADMIN','MANAGER']);
 if(intent.type==='electric_rate'){
  if(!intent.buildings?.length)throw fail(400,'Cần nêu mã nhà.');
  if(!Number.isInteger(intent.value)||intent.value>100000)throw fail(400,'Giá điện ngoài giới hạn hợp lệ');
  const items=intent.buildings.map(code=>{const b=one('SELECT * FROM buildings WHERE UPPER(code)=?',code);if(!b)throw fail(404,`Không tìm thấy nhà ${code}`);authorize(user,b.id);return {buildingId:b.id,building:code,from:b.electric_rate,to:intent.value};}).filter(item=>item.from!==item.to);
  if(!items.length)throw fail(409,'Giá điện đã đúng với yêu cầu; không có gì cần sửa.');
  return {type:intent.type,items,reply:`Xác nhận đổi giá điện của ${items.map(x=>x.building).join(', ')} thành ${intent.value.toLocaleString('vi-VN')}đ/kWh? Giá này áp dụng cho hóa đơn tạo mới; hóa đơn cũ được giữ nguyên.`};
 }
 if(!intent.building||!intent.room)throw fail(400,'Cần nêu rõ tòa.phòng.');
 const room=one('SELECT r.*,b.code building_code FROM rooms r JOIN buildings b ON b.id=r.building_id WHERE UPPER(b.code)=? AND r.code=?',intent.building,intent.room);
 if(!room)throw fail(404,`Không tìm thấy phòng ${intent.building}.${intent.room}`);authorize(user,room.building_id);
 if(intent.type==='occupants'){if(intent.value>100)throw fail(400,'Số người ngoài giới hạn');if(room.occupants===intent.value)throw fail(409,'Số người đã đúng với yêu cầu; không có gì cần sửa.');return {type:intent.type,items:[{roomId:room.id,building:intent.building,room:intent.room,from:room.occupants,to:intent.value}],reply:`Xác nhận sửa số người phòng ${intent.building}.${intent.room}: ${room.occupants} → ${intent.value}?`};}
 if(!intent.month)throw fail(400,'Cần nêu tháng/năm để sửa chỉ số điện/nước, ví dụ: tháng 10/2026.');
 const inv=one('SELECT i.*,p.locked FROM invoices i JOIN periods p ON p.id=i.period_id WHERE p.building_id=? AND p.month=? AND i.room_id=?',room.building_id,intent.month,room.id);
 if(!inv)throw fail(404,'Kỳ này chưa có hóa đơn');if(inv.locked)throw fail(409,'Kỳ đã khóa');
 const input=JSON.parse(inv.input);const field=intent.type==='electric_reading'?'currentElectric':'currentWater';
 if(input[field]===intent.value)throw fail(409,'Chỉ số đã đúng với yêu cầu; không tạo thêm phiên bản hóa đơn.');
 const changed={...input,[field]:intent.value};
 let total;try{total=calculateInvoice(changed);}catch(e){throw fail(400,`Chỉ số mới không hợp lệ: ${e.message}`);}
 const impact=carryoverConflict(room.id,intent.month,input,changed);
 const meterName=field==='currentElectric'?'điện':'nước';
 return {type:intent.type,items:[{invoiceId:inv.id,version:inv.version,building:intent.building,room:intent.room,month:intent.month,from:input[field],to:intent.value,oldTotal:inv.total,newTotal:total,impact}],reply:`Xác nhận sửa ${meterName} mới ${intent.building}.${intent.room} (${intent.month}) từ ${input[field]} thành ${intent.value}, tổng hóa đơn ${inv.total.toLocaleString('vi-VN')}đ → ${total.toLocaleString('vi-VN')}đ? ${impact?`Lưu ý: hóa đơn tháng ${impact.month} đã tạo; phải đối soát chỉ số cũ tháng sau thủ công, hệ thống sẽ giữ nguyên hóa đơn đó. `:''}Sau khi sửa, bạn có muốn xem hóa đơn không?`};
}
// Initial A12 import is deliberately independent of the existing CSV importer.
// Planning is read-only; apply re-plans inside a single transaction.
function initialA12Plan(body,user){
 requireRole(user,['SUPER_ADMIN','MANAGER']);
 const month=body.month,code=String(body.buildingCode??'').trim().toUpperCase();
 if(!monthValid(month)||!/^([A-Z][A-Z0-9]{0,9})$/.test(code))throw fail(400,'Cần chọn đúng tháng và mã tòa (ví dụ A12)');
 const building=one('SELECT * FROM buildings WHERE code=?',code);
 if(building)authorize(user,building.id);
 else requireRole(user,['SUPER_ADMIN']);
 const name=String(body.buildingName??`Tòa nhà ${code}`).trim(),address=String(body.address??'').trim();
 if(!name||name.length>150||address.length>300)throw fail(400,'Tên hoặc địa chỉ tòa không hợp lệ');
 let sheet,parsed;
 try{sheet=xlsxTable(body.xlsxBase64,month,body.sheetName);parsed=analyzeA12Table(sheet.rows);}catch(e){throw fail(400,e.message);}
 const prior=building?one('SELECT * FROM periods WHERE building_id=? AND month=?',building.id,month):null;
 const known=building?query('SELECT * FROM rooms WHERE building_id=?',building.id):[];
 const roomMap=new Map(known.map(r=>[r.code,r]));
 const rows=[],items=[];
 for(const item of parsed.rows){
  const errors=[...item.errors],existing=roomMap.get(item.code);
  if(prior?.locked)errors.push('Kỳ đã khóa');
  if(existing&&prior&&one('SELECT id FROM invoices WHERE period_id=? AND room_id=?',prior.id,existing.id))errors.push('Đã có hóa đơn, không ghi đè');
  if(existing&&item.input){
   const previous=one('SELECT i.input FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.room_id=? AND p.month=?',existing.id,previousMonth(month));
   if(previous){const previousInput=JSON.parse(previous.input);
    if(previousInput.currentElectric!==item.previousElectric||previousInput.currentWater!==item.previousWater)errors.push('Chỉ số cũ khác chỉ số chốt tháng trước');
   }
  }
  const selectedRateE=item.input?.electricRate??null,selectedRateW=item.input?.waterRate??null;
  const old=existing?{rent:existing.rent,internet:existing.internet,cleaning:existing.cleaning,occupants:existing.occupants,electricRate:existing.electric_rate,waterRate:existing.water_rate}:null;
  const configuration=item.input?{rent:item.rent,internet:item.internet,cleaning:item.cleaning,occupants:item.occupants,
   electricRate:selectedRateE=== (building?.electric_rate??parsed.defaults.electricRate)?null:selectedRateE,
   waterRate:selectedRateW=== (building?.water_rate??parsed.defaults.waterRate)?null:selectedRateW}:null;
  const roomChange=!!existing&&Object.entries(configuration??{}).some(([key,value])=>old?.[key]!==value);
  if(!errors.length)items.push({code:item.code,roomId:existing?.id??null,old,configuration,roomChange,input:item.input,total:item.total});
  rows.push({...item,status:errors.length?'ERROR':'READY',errors,exists:!!existing,old,configuration,roomChange});
 }
 const errors=rows.filter(r=>r.status==='ERROR').length+parsed.summaryIssues.length;
 const unmapped=rows.filter(r=>r.unmapped&&(r.unmapped.M||r.unmapped.O)).length;
 return {building:{id:building?.id??null,code,name:building?.name??name,address:building?.address??address,exists:!!building},
  month,sheetName:sheet.sheetName,defaults:parsed.defaults,sourceSummary:parsed.sourceSummary,totals:parsed.totals,
  summaryIssues:parsed.summaryIssues,rows,items,unmapped,roomChanges:rows.filter(row=>row.status==='READY'&&row.roomChange).length,ready:items.length,errors};
}
async function handle(method,url,body,user){
 const parts=url.pathname.split('/').filter(Boolean),id=Number(parts[2]);
 if(parts[1]==='imports'&&method==='POST'){
  if(parts[2]==='initial'){
   if(parts[3]==='sheets'){
    requireRole(user,['SUPER_ADMIN','MANAGER']);
    try{return {sheets:xlsxSheets(body.xlsxBase64)};}catch(e){throw fail(400,e.message);}
   }
   if(parts[3]==='preview'){
    const plan=initialA12Plan(body,user);
    if(!plan.errors&&plan.ready){
     for(const [key,value] of initialImportPreviews)if(value.expires<Date.now())initialImportPreviews.delete(key);
     const previewId=randomBytes(24).toString('hex');
     initialImportPreviews.set(previewId,{userId:user.id,source:{month:plan.month,buildingCode:plan.building.code,buildingName:body.buildingName,address:body.address,xlsxBase64:body.xlsxBase64,sheetName:plan.sheetName},
      expected:JSON.stringify({items:plan.items,totals:plan.totals,summaryIssues:plan.summaryIssues}),expires:Date.now()+5*60_000});
     return {...plan,items:undefined,previewId};
    }
    return {...plan,items:undefined};
   }
   if(parts[3]==='apply'){
    const pending=initialImportPreviews.get(String(requireValue(body.previewId,'previewId')));
    if(!pending||pending.userId!==user.id||pending.expires<Date.now())throw fail(409,'Bản xem trước đã hết hạn, cần kiểm tra lại');
    db.exec('BEGIN IMMEDIATE');
    try{
     const plan=initialA12Plan(pending.source,user);
     if(plan.errors||!plan.ready||JSON.stringify({items:plan.items,totals:plan.totals,summaryIssues:plan.summaryIssues})!==pending.expected)
      throw fail(409,'Dữ liệu thay đổi hoặc chưa đối soát xong, cần xem trước lại');
     if(plan.unmapped&&body.acknowledgeUnmapped!==true)throw fail(409,'Cần xác nhận các cột chưa xác định sẽ không tính vào hóa đơn');
     if(plan.roomChanges&&body.acknowledgeRoomChanges!==true)throw fail(409,'Cần xác nhận riêng việc cập nhật cấu hình phòng đã tồn tại');
     let buildingId=plan.building.id;
     if(!buildingId){
      const ins=run('INSERT INTO buildings(code,name,address,electric_rate,water_rate) VALUES(?,?,?,?,?)',plan.building.code,plan.building.name,plan.building.address,plan.defaults.electricRate,plan.defaults.waterRate);
      buildingId=Number(ins.lastInsertRowid);audit(user,'A12_IMPORT_BUILDING','building',buildingId,null,{code:plan.building.code,month:plan.month});
     }
     run('INSERT OR IGNORE INTO periods(building_id,month) VALUES(?,?)',buildingId,plan.month);
     const period=one('SELECT * FROM periods WHERE building_id=? AND month=?',buildingId,plan.month);
     if(period.locked)throw fail(409,'Kỳ đã khóa');
     let created=0,updated=0;
     for(const item of plan.items){
      let roomId=item.roomId;
      const cfg=item.configuration;
      if(roomId){
       if(item.roomChange){
        run('UPDATE rooms SET rent=?,internet=?,cleaning=?,occupants=?,electric_rate=?,water_rate=? WHERE id=?',cfg.rent,cfg.internet,cfg.cleaning,cfg.occupants,cfg.electricRate,cfg.waterRate,roomId);
        updated++;audit(user,'A12_IMPORT_ROOM_UPDATE','room',roomId,item.old,cfg,'Explicitly acknowledged initial import');
       }
      }else{
       const ins=run('INSERT INTO rooms(building_id,code,rent,internet,cleaning,occupants,electric_rate,water_rate) VALUES(?,?,?,?,?,?,?,?)',buildingId,item.code,cfg.rent,cfg.internet,cfg.cleaning,cfg.occupants,cfg.electricRate,cfg.waterRate);
       roomId=Number(ins.lastInsertRowid);created++;
       audit(user,'A12_IMPORT_ROOM','room',roomId,null,{code:item.code,...cfg},'Reviewed initial import');
      }
      const inv=run('INSERT INTO invoices(period_id,room_id,input,total) VALUES(?,?,?,?)',period.id,roomId,JSON.stringify(item.input),item.total);
      const invoiceId=Number(inv.lastInsertRowid);
      run('INSERT INTO invoice_versions(invoice_id,version,input,total,reason,actor_id) VALUES(?,?,?,?,?,?)',invoiceId,1,JSON.stringify(item.input),item.total,'Initial A12 XLSX import',user.id);
      audit(user,'A12_IMPORT_INVOICE','invoice',invoiceId,null,{room:item.code,month:plan.month,total:item.total,sourceSheet:plan.sheetName},'Reviewed initial import');
     }
     audit(user,'A12_IMPORT_PERIOD','period',period.id,null,{count:plan.items.length,created,updated,sourceSheet:plan.sheetName,unmappedAcknowledged:!!plan.unmapped},'Reviewed initial import');
     db.exec('COMMIT');initialImportPreviews.delete(String(body.previewId));
     return {ok:true,buildingId,month:plan.month,count:plan.items.length,created,updated};
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
  }
  if(parts[2]==='sheets'){
   requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
   authorize(user,Number(body.buildingId));
   try{return {sheets:xlsxSheets(body.xlsxBase64)};}catch(e){throw fail(400,e.message);}
  }
  if(parts[2]==='preview'){
   requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
   authorize(user,Number(body.buildingId));
   let excel;try{excel=body.xlsxBase64?xlsxCsv(body.xlsxBase64,body.month,body.sheetName):null;}catch(e){throw fail(400,e.message);}
   const plan=csvPlan({...body,...excel},user);
   if(!plan.errors&&plan.ready){
    for(const [key,value] of importPreviews)if(value.expires<Date.now())importPreviews.delete(key);
    const previewId=randomBytes(24).toString('hex');
    importPreviews.set(previewId,{userId:user.id,source:{buildingId:plan.buildingId,month:plan.month,csv:body.csv,xlsxBase64:body.xlsxBase64,sheetName:excel?.sheetName},items:JSON.stringify(plan.items),expires:Date.now()+5*60_000});
    return {...plan,sheetName:excel?.sheetName,skippedHeaderRows:excel?.skippedHeaderRows,previewId};
   }
   return {...plan,sheetName:excel?.sheetName,skippedHeaderRows:excel?.skippedHeaderRows};
  }
  if(parts[2]==='apply'){
   requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
   const previewId=String(requireValue(body.previewId,'previewId'));
   const pending=importPreviews.get(previewId);
   if(!pending||pending.userId!==user.id||pending.expires<Date.now())throw fail(409,'Bản xem trước hết hạn, cần kiểm tra lại');
   db.exec('BEGIN IMMEDIATE');try{
    const excel=pending.source.xlsxBase64?xlsxCsv(pending.source.xlsxBase64,pending.source.month,pending.source.sheetName):null;
    const plan=csvPlan({...pending.source,...excel},user);
    if(plan.errors||!plan.ready||JSON.stringify(plan.items)!==pending.items)throw fail(409,'Dữ liệu đã đổi, cần xem trước lại');
    run('INSERT OR IGNORE INTO periods(building_id,month) VALUES(?,?)',plan.buildingId,plan.month);
    const period=one('SELECT * FROM periods WHERE building_id=? AND month=?',plan.buildingId,plan.month);
    if(period.locked)throw fail(409,'Kỳ đã khóa');
    for(const item of plan.items){
     const inserted=run('INSERT INTO invoices(period_id,room_id,input,total) VALUES(?,?,?,?)',period.id,item.roomId,JSON.stringify(item.input),item.total);
     const invoiceId=Number(inserted.lastInsertRowid);
     run('INSERT INTO invoice_versions(invoice_id,version,input,total,reason,actor_id) VALUES(?,?,?,?,?,?)',invoiceId,1,JSON.stringify(item.input),item.total,'Imported from reviewed CSV',user.id);
     audit(user,'IMPORT_CSV_INVOICE','invoice',invoiceId,null,{room:item.code,month:plan.month,total:item.total},'Reviewed CSV import');
    }
    audit(user,'IMPORT_CSV','period',period.id,null,{count:plan.ready},'Reviewed CSV import');
    db.exec('COMMIT');importPreviews.delete(previewId);
    return {ok:true,count:plan.ready,month:plan.month};
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 }
 if(parts[1]==='assistant'&&method==='POST'){
  if(parts[2]==='preview'){
   const message=String(requireValue(body.message,'message'));
   if(message.length>1800)throw fail(400,'Yêu cầu AI quá dài');
   const selectedMonth=body.month??null;
   const command=await resolveAiCommand(message,selectedMonth,parseCommand);
   const plan=aiPlan(command,user,selectedMonth);
   if(plan.readOnly)return plan;
   for(const [key,value] of aiPreviews)if(value.expires<Date.now())aiPreviews.delete(key);
   const previewId=randomBytes(24).toString('hex');
   aiPreviews.set(previewId,{userId:user.id,message,command,selectedMonth,items:JSON.stringify(plan.items),expires:Date.now()+5*60_000});
   return {...plan,previewId};
  }
  if(parts[2]==='apply'){
   const previewId=String(requireValue(body.previewId,'previewId'));
   const pending=aiPreviews.get(previewId);
   if(!pending||pending.userId!==user.id||pending.expires<Date.now())throw fail(409,'Đề xuất đã hết hạn, cần xem trước lại');
   const message=pending.command;
   const reason=String(body.reason||pending.message).trim();
   db.exec('BEGIN IMMEDIATE');try{
    const plan=aiPlan(message,user,pending.selectedMonth);
    if(plan.readOnly||JSON.stringify(plan.items)!==pending.items)throw fail(409,'Dữ liệu đã thay đổi, cần xem trước lại');
    if(['water_reading','electric_reading','meter_batch'].includes(plan.type)&&plan.items.some(item=>item.impact)&&body.acknowledgeCarryover!==true)throw fail(409,'Cần xác nhận đối soát hóa đơn tháng sau bằng acknowledgeCarryover=true');
    let newBuildingId=null;
    for(const item of plan.items){
     if(plan.type==='create_building_floors'&&item.kind==='building'){
      const inserted=run('INSERT INTO buildings(code,name,address,electric_rate,water_rate) VALUES(?,?,?,?,?)',item.code,item.name,item.address,item.electricRate,item.waterRate);
      newBuildingId=Number(inserted.lastInsertRowid);
      audit(user,'AI_CREATE_BUILDING','building',newBuildingId,null,item,reason);
     }
     if(plan.type==='create_building_floors'&&item.kind==='room'){
      if(newBuildingId===null)throw fail(409,'Thiếu tòa nhà cho phòng mới');
      const inserted=run('INSERT INTO rooms(building_id,code) VALUES(?,?)',newBuildingId,item.code);
      audit(user,'AI_CREATE_ROOM','room',Number(inserted.lastInsertRowid),null,{buildingId:newBuildingId,code:item.code,floor:item.floor},reason);
     }
     if(plan.type==='create_building'){
      const inserted=run('INSERT INTO buildings(code,name,address,electric_rate,water_rate) VALUES(?,?,?,?,?)',item.code,item.name,item.address,item.electricRate,item.waterRate);
      audit(user,'AI_CREATE_BUILDING','building',Number(inserted.lastInsertRowid),null,item,reason);
     }
     if(plan.type==='create_rooms'){
      const inserted=run('INSERT INTO rooms(building_id,code,rent,internet,cleaning,parking,occupants) VALUES(?,?,?,?,?,?,?)',item.buildingId,item.code,item.rent,item.internet,item.cleaning,item.parking,item.occupants);
      audit(user,'AI_CREATE_ROOM','room',Number(inserted.lastInsertRowid),null,item,reason);
     }
     if(plan.type==='electric_rate'){const b=one('SELECT * FROM buildings WHERE id=?',item.buildingId);if(b.electric_rate!==item.from)throw fail(409,'Giá đã thay đổi, xem lại đề xuất');run('UPDATE buildings SET electric_rate=? WHERE id=?',item.to,b.id);audit(user,'AI_ELECTRIC_RATE','building',b.id,{electricRate:item.from},{electricRate:item.to},reason);}
     if(plan.type==='occupants'){const room=one('SELECT * FROM rooms WHERE id=?',item.roomId);if(room.occupants!==item.from)throw fail(409,'Số người đã thay đổi');run('UPDATE rooms SET occupants=? WHERE id=?',item.to,room.id);audit(user,'AI_OCCUPANTS','room',room.id,{occupants:item.from},{occupants:item.to},reason);}
     if(['water_reading','electric_reading','meter_batch'].includes(plan.type)){
      const inv=one('SELECT i.*,p.locked FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.id=?',item.invoiceId);
      if(!inv||inv.locked||inv.version!==item.version)throw fail(409,'Hóa đơn đã thay đổi hoặc kỳ đã khóa');
      const before=JSON.parse(inv.input),field=item.field||(plan.type==='electric_reading'?'currentElectric':'currentWater');
      const updated={...before,[field]:item.to},total=calculateInvoice(updated);
      if(total!==item.newTotal)throw fail(409,'Tổng hóa đơn đã thay đổi');
      const saved=run('UPDATE invoices SET input=?,total=?,version=? WHERE id=? AND version=?',JSON.stringify(updated),total,inv.version+1,inv.id,inv.version);
      if(!saved.changes)throw fail(409,'Hóa đơn đã thay đổi');
      run('INSERT INTO invoice_versions(invoice_id,version,input,total,reason,actor_id) VALUES(?,?,?,?,?,?)',inv.id,inv.version+1,JSON.stringify(updated),total,reason,user.id);
      audit(user,field==='currentElectric'?'AI_ELECTRIC_EDIT':'AI_WATER_EDIT','invoice',inv.id,{input:before,total:inv.total},{input:updated,total,carryoverReview:item.impact||undefined},reason);
     }
    }
    db.exec('COMMIT');aiPreviews.delete(previewId);
    const edited=['water_reading','electric_reading','meter_batch'].includes(plan.type);
    return {ok:true,reply:edited?'Đã sửa và lưu phiên bản hóa đơn. Bạn có muốn lấy hóa đơn vừa sửa không?':plan.type==='create_building_floors'?`Đã tạo nhà ${plan.items[0].code} cùng ${plan.items.length-1} phòng.`:plan.type.startsWith('create_')?`Đã tạo thành công ${plan.items.length} mục.`:`Đã cập nhật thành công ${plan.items.length} thay đổi.`,invoiceId:edited&&plan.items.length===1?plan.items[0].invoiceId:null,invoiceIds:edited?plan.items.map(i=>i.invoiceId):[]};
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 }
 if(parts[1]==='me'&&method==='GET')return {id:user.id,email:user.email,role:user.role};
 if(parts[1]==='buildings'){
  if(method==='GET')return query(user.role==='SUPER_ADMIN'?'SELECT * FROM buildings ORDER BY code':'SELECT b.* FROM buildings b JOIN user_buildings u ON b.id=u.building_id WHERE u.user_id=? ORDER BY b.code',...(user.role==='SUPER_ADMIN'?[]:[user.id]));
  if(method==='POST'){if(user.role!=='SUPER_ADMIN')throw fail(403,'Admin only');const code=String(requireValue(body.code,'code')).trim().toUpperCase(),name=String(requireValue(body.name,'name')).trim();const inserted=run('INSERT INTO buildings(code,name,address,electric_rate,water_rate) VALUES(?,?,?,?,?)',code,name,body.address||'',safeInt(body.electricRate??3800,'electricRate'),safeInt(body.waterRate??0,'waterRate'));audit(user,'CREATE','building',Number(inserted.lastInsertRowid),null,{code,name});return {id:Number(inserted.lastInsertRowid)};}
 }
 if(parts[1]==='rooms'){
  if(method==='GET'){const bid=Number(url.searchParams.get('buildingId'));authorize(user,bid,false);return query('SELECT * FROM rooms WHERE building_id=? ORDER BY code',bid);}
  if(method==='POST'){requireRole(user,['SUPER_ADMIN','MANAGER']);const bid=Number(body.buildingId);authorize(user,bid);const inserted=run('INSERT INTO rooms(building_id,code,rent,internet,cleaning,parking,tenant) VALUES(?,?,?,?,?,?,?)',bid,String(requireValue(body.code,'code')).trim(),safeInt(body.rent??0,'rent'),safeInt(body.internet??0,'internet'),safeInt(body.cleaning??0,'cleaning'),safeInt(body.parking??0,'parking'),body.tenant||'');audit(user,'CREATE','room',Number(inserted.lastInsertRowid),null,body);return {id:Number(inserted.lastInsertRowid)};}
 }
 if(parts[1]==='periods'){
  if(method==='GET'){const bid=Number(url.searchParams.get('buildingId'));authorize(user,bid,false);return query('SELECT * FROM periods WHERE building_id=? ORDER BY month DESC',bid);}
  if(method==='POST'&&parts[2]==='lock'){
   requireRole(user,body.locked?['SUPER_ADMIN','MANAGER']:['SUPER_ADMIN']);
   const bid=Number(body.buildingId);authorize(user,bid);if(!monthValid(body.month)||typeof body.locked!=='boolean')throw fail(400,'Invalid lock request');
   const period=one('SELECT * FROM periods WHERE building_id=? AND month=?',bid,body.month);if(!period)throw fail(404,'Period missing');
   const reason=String(body.reason||'').trim();if(!reason)throw fail(400,'Reason required');
   db.exec('BEGIN IMMEDIATE');try{
    if(body.locked){
     const review=inspectPeriod(bid,body.month);
     if(review.errors)throw fail(409,`Chưa thể khóa kỳ: ${review.errors} hóa đơn có lỗi. Hãy đối soát trước khi chốt.`);
     if(review.missing&&body.acknowledgeMissing!==true)throw fail(409,`Còn ${review.missing} phòng chưa có hóa đơn. Cần xác nhận danh sách phòng không phát hành kỳ này (acknowledgeMissing=true).`);
     if(review.warnings&&body.acknowledgeWarnings!==true)throw fail(409,`Có ${review.warnings} hóa đơn cần kiểm tra cảnh báo. Cần xác nhận đã đối soát (acknowledgeWarnings=true).`);
    }
    run('UPDATE periods SET locked=? WHERE id=?',Number(body.locked),period.id);
    audit(user,body.locked?'LOCK_PERIOD':'UNLOCK_PERIOD','period',period.id,{locked:period.locked},{locked:Number(body.locked),acknowledgeMissing:body.locked&&body.acknowledgeMissing===true,acknowledgeWarnings:body.locked&&body.acknowledgeWarnings===true},reason);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return one('SELECT * FROM periods WHERE id=?',period.id);
  }
  if(method==='POST'&&parts.length===2){
   requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
   const bid=Number(body.buildingId);authorize(user,bid);if(!monthValid(body.month))throw fail(400,'Invalid billing month');
   run('INSERT OR IGNORE INTO periods(building_id,month) VALUES(?,?)',bid,body.month);return one('SELECT * FROM periods WHERE building_id=? AND month=?',bid,body.month);
  }
 }
 if(parts[1]==='invoices'&&parts[2]==='check'&&method==='GET'){
  const buildingId=Number(url.searchParams.get('buildingId')),month=url.searchParams.get('month');
  authorize(user,buildingId,false);
  if(!monthValid(month))throw fail(400,'Invalid billing month');
  return inspectPeriod(buildingId,month);
 }
 if(parts[1]==='invoices'){
  if(method==='GET'&&parts.length===3&&Number.isSafeInteger(id)){
   const invoice=one('SELECT i.*,p.month,p.building_id,r.code room_code,b.code building_code,b.name building_name,b.address FROM invoices i JOIN periods p ON p.id=i.period_id JOIN rooms r ON r.id=i.room_id JOIN buildings b ON b.id=p.building_id WHERE i.id=?',id);
   if(!invoice)throw fail(404,'Invoice missing');authorize(user,invoice.building_id,false);return detail(invoice);
  }
  if(method==='GET'&&parts.length===2){const bid=Number(url.searchParams.get('buildingId'));authorize(user,bid,false);const month=url.searchParams.get('month');if(!monthValid(month))throw fail(400,'Invalid billing month');return query(`SELECT i.*,r.code room_code,p.month,b.code building_code FROM invoices i JOIN periods p ON p.id=i.period_id JOIN rooms r ON r.id=i.room_id JOIN buildings b ON b.id=p.building_id WHERE b.id=? AND p.month=? ORDER BY r.code`,bid,month).map(detail);}
  if(method==='POST'&&parts.length===2){
   requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
   const room=one('SELECT r.*,COALESCE(r.electric_rate,b.electric_rate) electric_rate_effective,COALESCE(r.water_rate,b.water_rate) water_rate_effective FROM rooms r JOIN buildings b ON b.id=r.building_id WHERE r.id=?',body.roomId);if(!room)throw fail(404,'Room missing');authorize(user,room.building_id);
   room.electric_rate=room.electric_rate_effective;room.water_rate=room.water_rate_effective;
   const period=one('SELECT * FROM periods WHERE building_id=? AND month=?',room.building_id,body.month);if(!period)throw fail(400,'Create billing period first');if(period.locked)throw fail(409,'Period locked');
   if(one('SELECT id FROM invoices WHERE period_id=? AND room_id=?',period.id,room.id))throw fail(409,'Invoice exists');
   const overrides=invoiceOverrides(body.input);
   const conflicts=inheritedMeterChanges(room,body.month,overrides);
   const reason=String(body.reason||'').trim();
   if(conflicts.length&&!reason)throw fail(409,`Chỉ số cũ khác kỳ trước (${conflicts.join(', ')}), cần nêu lý do trong trường reason`);
   const input=initialInvoiceInput(room,body.month,overrides);
   const total=calculateInvoice(input);
   db.exec('BEGIN IMMEDIATE');let iid;try{
    const fresh=one('SELECT locked FROM periods WHERE id=?',period.id);if(fresh.locked)throw fail(409,'Period locked');
    const inserted=run('INSERT INTO invoices(period_id,room_id,input,total) VALUES(?,?,?,?)',period.id,room.id,JSON.stringify(input),total);iid=Number(inserted.lastInsertRowid);
    run('INSERT INTO invoice_versions(invoice_id,version,input,total,reason,actor_id) VALUES(?,?,?,?,?,?)',iid,1,JSON.stringify(input),total,reason||'Created',user.id);
    audit(user,'CREATE','invoice',iid,null,{input,total},reason);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return detail(one('SELECT * FROM invoices WHERE id=?',iid));
  }
  if(parts.length===4&&parts[3]==='preview'&&method==='POST'){
   requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
   const current=one('SELECT i.*,p.building_id,p.locked,p.month FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.id=?',id);
   if(!current)throw fail(404,'Invoice missing');authorize(user,current.building_id);
   if(current.locked)throw fail(409,'Period locked');
   if(body.expectedVersion!==undefined&&body.expectedVersion!==current.version)throw fail(409,'Hóa đơn đã thay đổi, cần tải lại trước khi sửa');
   if(!body.input||typeof body.input!=='object'||Array.isArray(body.input))throw fail(400,'Invalid invoice input');
   const before=JSON.parse(current.input);
   const keys=Object.keys(body.input);
   if(keys.some(key=>!Object.hasOwn(before,key)))throw fail(400,'Unexpected invoice field');
   const next={...before,...body.input};const total=calculateInvoice(next),paymentTotal=paid(id);
   return {invoiceId:id,version:current.version,input:next,changed:JSON.stringify(before)!==JSON.stringify(next),oldTotal:current.total,newTotal:total,delta:total-current.total,paid:paymentTotal,...balance(total,paymentTotal),carryover:carryoverConflict(current.room_id,current.month,before,next)};
  }
  if(parts.length===4&&parts[3]==='revise'&&method==='POST'){
   requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
   const current=one('SELECT i.*,p.building_id,p.locked,p.month FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.id=?',id);if(!current)throw fail(404,'Invoice missing');authorize(user,current.building_id);if(current.locked)throw fail(409,'Period locked');const reason=String(requireValue(body.reason,'reason')).trim();if(!reason||reason.length>500)throw fail(400,'Reason required (max 500 characters)');if(body.expectedVersion!==undefined&&body.expectedVersion!==current.version)throw fail(409,'Hóa đơn đã thay đổi, cần tải lại trước khi sửa');if(!body.input||typeof body.input!=='object'||Array.isArray(body.input))throw fail(400,'Invalid invoice input');const before=JSON.parse(current.input);if(Object.keys(body.input).some(key=>!Object.hasOwn(before,key)))throw fail(400,'Unexpected invoice field');const input={...before,...body.input};const total=calculateInvoice(input);if(JSON.stringify(before)===JSON.stringify(input))throw fail(409,'Không có dữ liệu thay đổi để tạo phiên bản mới');const next=current.version+1;
   db.exec('BEGIN IMMEDIATE');try{
    if(one('SELECT locked FROM periods WHERE id=?',current.period_id).locked)throw fail(409,'Period locked');
    const impact=carryoverConflict(current.room_id,current.month,before,input);
    if(impact&&body.acknowledgeCarryover!==true)throw fail(409,`Chỉ số ảnh hưởng hóa đơn tháng ${impact.month}; xác nhận đối soát kỳ sau bằng acknowledgeCarryover=true`);
    const updated=run('UPDATE invoices SET input=?,total=?,version=? WHERE id=? AND version=?',JSON.stringify(input),total,next,id,current.version);if(!updated.changes)throw fail(409,'Concurrent edit');
    run('INSERT INTO invoice_versions(invoice_id,version,input,total,reason,actor_id) VALUES(?,?,?,?,?,?)',id,next,JSON.stringify(input),total,reason,user.id);
    audit(user,'REVISE','invoice',id,{input:before,total:current.total},{input,total,carryoverReview:impact||undefined},reason);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}return detail(one('SELECT * FROM invoices WHERE id=?',id));
  }
  if(parts.length===4&&parts[3]==='versions'&&method==='GET'){const inv=one('SELECT i.id,p.building_id FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.id=?',id);if(!inv)throw fail(404,'Missing');authorize(user,inv.building_id,false);return query('SELECT * FROM invoice_versions WHERE invoice_id=? ORDER BY version DESC',id);}
 }
 if(parts[1]==='payments'&&method==='GET'){
  const bid=Number(url.searchParams.get('buildingId')),month=url.searchParams.get('month');authorize(user,bid,false);
  if(!monthValid(month))throw fail(400,'Invalid billing month');
  const entries=paymentJournal(bid,month);
  sumMoney(entries,'net_amount');return entries;
 }
 if(parts[1]==='payments'&&parts.length===4&&parts[3]==='reverse'&&method==='POST'){
  requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT']);
  const paymentId=Number(parts[2]);if(!Number.isSafeInteger(paymentId)||paymentId<=0)throw fail(400,'Invalid payment ID');
  const reason=String(requireValue(body.reason,'reason')).trim();if(reason.length<5||reason.length>500)throw fail(400,'Reason must contain 5-500 characters');
  db.exec('BEGIN IMMEDIATE');try{
   const payment=one(`SELECT t.*,p.building_id,p.locked FROM payments t JOIN invoices i ON i.id=t.invoice_id JOIN periods p ON p.id=i.period_id WHERE t.id=?`,paymentId);
   if(!payment)throw fail(404,'Payment missing');authorize(user,payment.building_id);
   if(payment.locked)throw fail(409,'Period locked');
   if(one('SELECT id FROM payment_reversals WHERE payment_id=?',paymentId))throw fail(409,'Payment already reversed');
   run('INSERT INTO payment_reversals(payment_id,actor_id,reason) VALUES(?,?,?)',paymentId,user.id,reason);
   audit(user,'REVERSE_PAYMENT','payment',paymentId,{invoiceId:payment.invoice_id,amount:payment.amount,method:payment.method,reference:payment.reference},{effectiveAmount:0},reason);
   db.exec('COMMIT');return {paymentId,reversed:true,invoice:detail(one('SELECT * FROM invoices WHERE id=?',payment.invoice_id))};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 if(parts[1]==='payments'&&parts.length===2&&method==='POST'){
  requireRole(user,['SUPER_ADMIN','MANAGER','ACCOUNTANT','COLLECTOR']);const inv=one('SELECT i.*,p.building_id,p.locked FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.id=?',body.invoiceId);if(!inv)throw fail(404,'Invoice missing');authorize(user,inv.building_id);const amount=safeInt(body.amount,'amount');if(!amount)throw fail(400,'Amount must be positive');if(!['CASH','TRANSFER'].includes(body.method))throw fail(400,'Invalid payment method');const reference=String(requireValue(body.reference,'reference')).trim();if(!reference||reference.length>120)throw fail(400,'Invalid payment reference');const receivedAt=String(body.receivedAt||new Date().toISOString());if(Number.isNaN(Date.parse(receivedAt)))throw fail(400,'Invalid date');
  db.exec('BEGIN IMMEDIATE');try{
   const existing=one('SELECT * FROM payments WHERE reference=?',reference);
   if(existing){
    if(one('SELECT id FROM payment_reversals WHERE payment_id=?',existing.id))throw fail(409,'Payment reference belongs to a reversed transaction; use a new reference');
    if(existing.invoice_id!==inv.id||existing.amount!==amount||existing.method!==body.method||existing.collector_id!==user.id)throw fail(409,'Payment reference already used for different payment');
    db.exec('COMMIT');return {id:existing.id,duplicate:true,invoice:detail(one('SELECT * FROM invoices WHERE id=?',inv.id))};
   }
   if(one('SELECT p.locked FROM invoices i JOIN periods p ON p.id=i.period_id WHERE i.id=?',inv.id).locked)throw fail(409,'Period locked');
   if(!Number.isSafeInteger(paid(inv.id)+amount))throw fail(400,'Payment total exceeds integer limit');
   const inserted=run('INSERT INTO payments(invoice_id,amount,method,collector_id,reference,received_at) VALUES(?,?,?,?,?,?)',inv.id,amount,body.method,user.id,reference,receivedAt);audit(user,'PAYMENT','invoice',inv.id,null,{amount,method:body.method,reference});db.exec('COMMIT');return {id:Number(inserted.lastInsertRowid),duplicate:false,invoice:detail(one('SELECT * FROM invoices WHERE id=?',inv.id))};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 if(parts[1]==='reports'&&parts[2]==='collectors'&&method==='GET'){
  const month=url.searchParams.get('month');if(!monthValid(month))throw fail(400,'Invalid billing month');
  const report=query(`SELECT b.id building_id,b.code building_code,u.email collector,t.method,CAST(SUM(t.amount) AS TEXT) amount,COUNT(*) transactions
   FROM payments t JOIN invoices i ON i.id=t.invoice_id JOIN periods p ON p.id=i.period_id
   JOIN buildings b ON b.id=p.building_id JOIN users u ON u.id=t.collector_id
   WHERE p.month=? AND NOT EXISTS(SELECT 1 FROM payment_reversals v WHERE v.payment_id=t.id)
    AND (?='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM user_buildings ub WHERE ub.building_id=b.id AND ub.user_id=?))
   GROUP BY b.id,u.id,t.method ORDER BY b.code,u.email,t.method`,month,user.role,user.id);
  for(const row of report)row.amount=safeSqlMoney(row.amount,'Collector report sum');
  sumMoney(report,'amount');
  return report;
 }
 if(parts[1]==='reports'&&parts[2]==='reconciliation'&&method==='GET'){
  const buildingId=Number(url.searchParams.get('buildingId')),month=url.searchParams.get('month');
  authorize(user,buildingId,false);
  if(!monthValid(month))throw fail(400,'Invalid billing month');
  return reconcileBuilding(buildingId,month);
 }
 if(parts[1]==='users'){
  requireRole(user,['SUPER_ADMIN']);
  if(method==='GET')return query('SELECT id,email,role FROM users ORDER BY id');
  if(method==='POST'&&parts.length===2){
   const email=String(requireValue(body.email,'email')).trim().toLowerCase(),password=String(requireValue(body.password,'password')),role=String(requireValue(body.role,'role'));
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||!['MANAGER','ACCOUNTANT','COLLECTOR','VIEWER'].includes(role))throw fail(400,'Invalid user input');
   const bids=body.buildingIds;if(!Array.isArray(bids)||!bids.every(x=>Number.isSafeInteger(x)&&x>0))throw fail(400,'Invalid building access');
   db.exec('BEGIN IMMEDIATE');try{const created=run('INSERT INTO users(email,password_hash,role) VALUES(?,?,?)',email,hashPassword(password),role);const uid=Number(created.lastInsertRowid);for(const bid of new Set(bids))run('INSERT INTO user_buildings(user_id,building_id) VALUES(?,?)',uid,bid);audit(user,'CREATE_USER','user',uid,null,{email,role,buildingIds:bids});db.exec('COMMIT');return {id:uid,email,role};}catch(e){db.exec('ROLLBACK');throw e;}
  }
 }
 if(parts[1]==='dashboard'&&parts[2]==='summary'&&method==='GET'){
  const month=url.searchParams.get('month');if(!monthValid(month))throw fail(400,'Invalid billing month');
  const accessible=query(user.role==='SUPER_ADMIN'?'SELECT b.id,b.code,b.name,(SELECT COUNT(*) FROM rooms r WHERE r.building_id=b.id) rooms FROM buildings b ORDER BY b.code':'SELECT b.id,b.code,b.name,(SELECT COUNT(*) FROM rooms r WHERE r.building_id=b.id) rooms FROM buildings b JOIN user_buildings ub ON ub.building_id=b.id WHERE ub.user_id=? ORDER BY b.code',...(user.role==='SUPER_ADMIN'?[]:[user.id]));
  const invoiceRows=query(`SELECT i.*,p.building_id FROM invoices i JOIN periods p ON p.id=i.period_id WHERE p.month=? AND (?='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM user_buildings ub WHERE ub.building_id=p.building_id AND ub.user_id=?))`,month,user.role,user.id);
  const buildings=accessible.map(b=>({buildingId:b.id,code:b.code,name:b.name,...financialStats(invoiceRows.filter(i=>i.building_id===b.id),b.rooms)}));
  const totals={rooms:sumMoney(buildings,'rooms'),invoiced:sumMoney(buildings,'invoiced'),total:sumMoney(buildings,'total'),paid:sumMoney(buildings,'paid'),due:sumMoney(buildings,'due'),overpaid:sumMoney(buildings,'overpaid'),unpaid:sumMoney(buildings,'unpaid'),partial:sumMoney(buildings,'partial'),complete:sumMoney(buildings,'complete')};
  return {month,totals,buildings};
 }
 if(parts[1]==='dashboard'&&method==='GET'){const bid=Number(url.searchParams.get('buildingId'));authorize(user,bid,false);const month=url.searchParams.get('month');if(!monthValid(month))throw fail(400,'Invalid billing month');const list=query('SELECT i.* FROM invoices i JOIN periods p ON p.id=i.period_id WHERE p.building_id=? AND p.month=?',bid,month);return {month,buildingId:bid,...financialStats(list,one('SELECT COUNT(*) as n FROM rooms WHERE building_id=?',bid).n)};}
 if(parts[1]==='audit'&&method==='GET'){if(user.role!=='SUPER_ADMIN')throw fail(403,'Admin only');return query('SELECT a.*,u.email FROM audit_logs a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100');}
 throw fail(404,'Endpoint not found');
}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');const method=req.method;
  if(url.pathname==='/healthz'&&method==='GET'){
   one('SELECT 1 AS healthy');
   return json(res,200,{ok:true});
  }
  if(url.pathname.startsWith('/api/')){
   if(!['GET','POST'].includes(method))throw fail(405,'Method not allowed');
   let body={};if(method==='POST'){
    const chunks=[];let bytes=0,tooLarge=false;
    for await(const chunk of req){
     bytes+=chunk.length;
     if(bytes>1_000_000){tooLarge=true;chunks.length=0;}
     else if(!tooLarge)chunks.push(chunk);
    }
    if(tooLarge)throw fail(413,'Request too large');
    const raw=Buffer.concat(chunks).toString('utf8');
    try{body=JSON.parse(raw||'{}');}catch{throw fail(400,'Invalid JSON');}
   }
   if(method==='POST'){
    // Fetch metadata is supplied by browsers and cannot be set by cross-site scripts.
    if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Cross-site request blocked');
    const origin=req.headers.origin;
    if(origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)throw fail(403,'Invalid origin');
   }
   if(url.pathname==='/api/login'&&method==='POST'){
    const key=req.socket.remoteAddress||'unknown',now=Date.now(),failures=loginFailures.get(key)||{count:0,until:now+15*60_000};
    if(failures.until<now){failures.count=0;failures.until=now+15*60_000;}
    if(failures.count>=8)throw fail(429,'Too many login attempts; try again later');
    const user=one('SELECT * FROM users WHERE email=?',body.email);
    if(!user||!checkPassword(String(body.password||''),user.password_hash)){
     failures.count++;loginFailures.set(key,failures);throw fail(401,'Invalid credentials');
    }
    loginFailures.delete(key);
    const token=randomBytes(32).toString('hex');run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',createHash('sha256').update(token).digest('hex'),user.id,Date.now()+8*3600_000);res.setHeader('Set-Cookie',`session=${token}; ${cookieFlags}; Max-Age=28800`);return json(res,200,{email:user.email,role:user.role});
   }
   const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);const user=token?one('SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',createHash('sha256').update(token).digest('hex'),Date.now()):null;if(!user)throw fail(401,'Login required');
   if(url.pathname==='/api/logout'&&method==='POST'){run('DELETE FROM sessions WHERE token_hash=?',createHash('sha256').update(token).digest('hex'));res.setHeader('Set-Cookie',`session=; ${cookieFlags}; Max-Age=0`);return json(res,200,{ok:true});}
   if(url.pathname==='/api/payments/export'&&method==='GET'){
    const buildingId=Number(url.searchParams.get('buildingId'));
    const month=url.searchParams.get('month');
    authorize(user,buildingId,false);
    if(!monthValid(month))throw fail(400,'Invalid billing month');
    const entries=paymentJournal(buildingId,month);
    sumMoney(entries,'net_amount');
    const csv=exportCsv([
     ['Mã giao dịch','id'],['Phòng','room_code'],['Mã hóa đơn','invoice_id'],
     ['Thời điểm thực thu','received_at'],['Thời điểm ghi nhận','created_at'],
     ['Người thu','collector'],['Phương thức','method'],['Mã tham chiếu','reference'],['Số tiền gốc (VND)','amount'],
     ['Đã đảo giao dịch','reversed'],['Thực thu hiệu lực (VND)','net_amount'],['Lý do đảo','reversal_reason'],['Thời điểm đảo','reversed_at'],['Người đảo','reversed_by']
    ],entries);
    res.writeHead(200,{
     'Content-Type':'text/csv; charset=utf-8',
     'Content-Disposition':`attachment; filename="nhat-ky-thu-${buildingId}-${month}.csv"`,
     'Cache-Control':'no-store',
     'X-Content-Type-Options':'nosniff'
    });
    res.end('\uFEFF'+csv);
    return;
   }
   if(url.pathname==='/api/reports/reconciliation/export'&&method==='GET'){
    const buildingId=Number(url.searchParams.get('buildingId'));
    const month=url.searchParams.get('month');
    authorize(user,buildingId,false);
    if(!monthValid(month))throw fail(400,'Invalid billing month');
    const report=reconcileBuilding(buildingId,month);
    const byInvoice=new Map(report.rows.map(row=>[row.invoiceId,row]));
    const rows=report.checks.map(check=>{
     const inv=byInvoice.get(check.invoiceId);
     return {
      room:check.room,status:check.status,version:inv?.version??'',
      total:inv?.total??'',paid:inv?.paid??'',due:inv?.due??'',overpaid:inv?.overpaid??'',
      transactions:inv?.transactionCount??0,
      issues:check.issues.join('; '),warnings:check.warnings.join('; ')
     };
    });
    rows.push({room:'TỔNG',status:'',version:'',...report.totals,transactions:report.activeTransactions,
     issues:report.issues.join('; '),warnings:''});
    const csv=exportCsv([
     ['Phòng','room'],['Trạng thái kiểm tra','status'],['Phiên bản','version'],
     ['Phải thu (VND)','total'],['Đã thu (VND)','paid'],['Còn thiếu (VND)','due'],
     ['Thu dư (VND)','overpaid'],['Giao dịch hiệu lực','transactions'],
     ['Lỗi đối soát','issues'],['Cảnh báo','warnings']
    ],rows);
    res.writeHead(200,{
     'Content-Type':'text/csv; charset=utf-8',
     'Content-Disposition':`attachment; filename="doi-soat-${buildingId}-${month}.csv"`,
     'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
    });
    res.end('\uFEFF'+csv);
    return;
   }
   return json(res,200,await handle(method,url,body,user));
  }
  const pathname=url.pathname==='/'?'/index.html':url.pathname;
  const staticAssets=new Set([
   '/index.html','/app.js','/ui-pages.js','/import-view.js','/edit-invoice.js','/invoice-images.js',
   '/style.css','/invoice-print.css','/pwa-install.js','/manifest.webmanifest','/sw.js',
   '/icons/icon-192.png','/icons/icon-512.png','/icons/icon-maskable-512.png'
  ]);
  if(!staticAssets.has(pathname))throw fail(404,'Not found');
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png'};
  res.writeHead(200,{'Content-Type':mime[extname(pathname)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"});
  res.end(readFileSync(join(base,'public',pathname)));
 }catch(e){json(res,e.status||(String(e.message).includes('UNIQUE constraint')?409:400),{error:e.status||String(e.message).includes('UNIQUE constraint')?e.message:'Request could not be processed'});}
});
const port=Number(process.env.PORT||3000);
const host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Vincent ART: http://${host}:${port}`));
