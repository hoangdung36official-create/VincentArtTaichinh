import {parseVndInteger} from './import-csv.js';
import {calculateInvoice} from './finance.js';

const normalized=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/[^a-z0-9]/g,'');
// XLSX numeric cells can be represented as "4300000.0" and "201.0".
const cleanInteger=value=>/^\d+\.0+$/.test(String(value??'').trim())?String(value).trim().replace(/\.0+$/,''):value;
const number=(value,name)=>parseVndInteger(cleanInteger(value),name,false);
const optional=(value,name)=>parseVndInteger(cleanInteger(value),name,true);
const reading=(value,name)=>{
 const text=String(value??'').trim();
 if(!/^\d+(?:\.\d{1,3})?$/.test(text))throw Error(`${name} không phải chỉ số hợp lệ (tối đa 3 số thập phân)`);
 const result=Number(text);
 if(!Number.isFinite(result)||result>Number.MAX_SAFE_INTEGER/1000)throw Error(`${name} vượt giới hạn`);
 return result;
};
const freq=values=>{
 const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);
 return [...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??null;
};

// Detect only the known A12-style spreadsheet: two header rows and fixed cell positions.
// Do not reinterpret unknown columns as additional income or payments.
export function analyzeA12Table(rows){
 const header=rows.findIndex((row,i)=>i<30&&normalized(row[1])==='phong'&&['songuoi','songo'].some(x=>normalized(row[2]).includes(x))&&
  normalized(row[3])==='tienphong'&&normalized(row[17]).includes('tongtien'));
 if(header<0||!rows[header+1])throw Error('Chưa xác định được bảng A12 với tiêu đề Phòng, Số người, Tiền phòng, Tổng tiền');
 const top=rows[header],bottom=rows[header+1];
 if(!normalized(top[4]).includes('tiendien')||normalized(top[14])!=='nuoc'||
  normalized(bottom[5])!=='socu'||normalized(bottom[6])!=='so'||normalized(bottom[7])!=='tien'||
  normalized(bottom[8])!=='somoi'||normalized(bottom[9])!=='socu'||normalized(bottom[10])!=='so'||normalized(bottom[11])!=='tien'||
  normalized(top[15])!=='mang'||normalized(top[16])!=='vesinh')
  throw Error('Cột điện, nước, Internet hoặc vệ sinh chưa khớp mẫu A12. Cần xác nhận bố cục trước khi nhập');
 const parsed=[],seen=new Set(),rateE=[],rateW=[];
 let sourceSummary=null;
 for(let index=header+2;index<rows.length;index++){
  const cells=rows[index];const label=String(cells[1]??'').trim().replace(/\.0+$/,'');
  if(normalized(label)==='tong'||normalized(cells[0])==='tong'){
   sourceSummary={rooms:parsed.length,occupants:optional(cells[1],'Tổng số người'),rent:optional(cells[3],'Tổng tiền phòng'),electricity:optional(cells[7],'Tổng tiền điện'),water:optional(cells[11],'Tổng tiền nước'),internet:optional(cells[15],'Tổng Internet'),cleaning:optional(cells[16],'Tổng vệ sinh'),total:optional(cells[17],'Tổng bảng Excel')};
   continue;
  }
  if(!label)continue;
  if(!/^\d{2,5}$/.test(label))continue;
  const errors=[],warnings=[];
  if(seen.has(label))errors.push('Phòng trùng trong sheet');seen.add(label);
  let item={code:label,line:index+1,errors,warnings};
  try{
   const occupants=number(cells[2],'Số người'),rent=number(cells[3],'Tiền phòng');
   const currentElectric=reading(cells[4],'Điện mới'),previousElectric=reading(cells[5],'Điện cũ');
   const electricUsage=number(cells[6],'Số điện'),electricity=number(cells[7],'Tiền điện');
   const currentWater=reading(cells[8],'Nước mới'),previousWater=reading(cells[9],'Nước cũ');
   const waterUsage=number(cells[10],'Số nước'),water=number(cells[11],'Tiền nước');
   const cars=optional(cells[13],'Số xe')??0;
   const duplicateM=String(cells[12]??'').trim(),duplicateO=String(cells[14]??'').trim();
   // Some A12 source rows (notably 101) have the total in P instead of R.
   // Recognize only the unambiguous case: no services, total equals rent.
   const shiftedTotal=(cells[17]===undefined||cells[17]===null||cells[17]==='')&&
     (cells[16]===undefined||cells[16]===null||cells[16]==='')&&
     number(cells[15],'Giá trị ô P')===rent&&electricity===0&&water===0;
   const internet=shiftedTotal?0:number(cells[15],'Internet');
   const cleaning=shiftedTotal?0:number(cells[16],'Vệ sinh');
   const stated=number(shiftedTotal?cells[15]:cells[17],'Tổng tiền Excel');
   if(shiftedTotal)warnings.push('Ô R trống, tổng tiền nằm tại P và khớp tiền phòng; xác nhận dữ liệu gốc trước khi nhập');
   if(occupants>100)errors.push('Số người vượt giới hạn hợp lý');
   if(Math.abs((currentElectric-previousElectric)-electricUsage)>0.0000001)errors.push('Số điện không khớp điện mới - điện cũ');
   if(Math.abs((currentWater-previousWater)-waterUsage)>0.0000001)errors.push('Số nước không khớp nước mới - nước cũ');
   const unknownM=duplicateM&&Number(duplicateM)!==water?duplicateM:'';
   const unknownO=duplicateO&&Number(duplicateO)!==water?duplicateO:'';
   if(unknownM||unknownO)warnings.push('Cột M/O khác số tiền nước; cần xác nhận ý nghĩa trước khi nhập');
   if(cars>0)errors.push('Có số xe nhưng chưa xác định đơn giá tiền xe');
   const electricRate=electricUsage>0&&electricity%electricUsage===0?electricity/electricUsage:null;
   const waterRate=waterUsage>0&&water%waterUsage===0?water/waterUsage:null;
   if(electricUsage>0&&electricRate===null||electricUsage===0&&electricity!==0)errors.push('Không suy ra được đơn giá điện nguyên VND/kWh');
   if(waterUsage>0&&waterRate===null||waterUsage===0&&water!==0)errors.push('Không suy ra được đơn giá nước nguyên VND/m³');
   if(electricRate!==null)rateE.push(electricRate);
   if(waterRate!==null)rateW.push(waterRate);
   item={...item,occupants,rent,previousElectric,currentElectric,previousWater,currentWater,electricity,water,internet,cleaning,stated,cars,electricRate,waterRate,unmapped:{M:unknownM,O:unknownO}};
  }catch(e){errors.push(e.message);}
  parsed.push(item);
 }
 if(!parsed.length)throw Error('Không tìm thấy phòng trong sheet được chọn');
 if(!rateE.length||!rateW.length)throw Error('Không thể xác định đơn giá điện/nước từ các dòng có tiêu thụ. Cần nhập cấu hình trước');
 const defaults={electricRate:freq(rateE),waterRate:freq(rateW)};
 const totals={rooms:parsed.length,occupants:0,rent:0,electricity:0,water:0,internet:0,cleaning:0,stated:0,computed:0};
 for(const item of parsed){
  if(item.rent===undefined)continue;
  const electricRate=item.electricRate??defaults.electricRate;
  const waterRate=item.waterRate??defaults.waterRate;
  if(item.electricRate===null)item.warnings.push(`Điện không phát sinh: tạm dùng đơn giá tòa ${electricRate}đ`);
  if(item.waterRate===null)item.warnings.push(`Nước không phát sinh: tạm dùng đơn giá tòa ${waterRate}đ`);
  const input={rent:item.rent,previousElectric:item.previousElectric,currentElectric:item.currentElectric,
   previousWater:item.previousWater,currentWater:item.currentWater,electricRate,waterRate,
   internet:item.internet,cleaning:item.cleaning,parking:0,extras:0,discount:0};
  try{
   item.total=calculateInvoice(input);item.input=input;item.difference=item.stated-item.total;
   if(item.difference)item.errors.push(`Lệch tổng tiền ${item.difference}đ (Excel ${item.stated}đ, tính lại ${item.total}đ)`);
  }catch(e){item.errors.push('Tính tiền: '+e.message);}
  for(const key of ['occupants','rent','electricity','water','internet','cleaning','stated'])totals[key]+=item[key];
  totals.computed+=item.total??0;
  if(Object.values(totals).some(v=>!Number.isSafeInteger(v)))throw Error('Tổng tòa vượt giới hạn số nguyên an toàn');
 }
 const summaryIssues=[];
 if(sourceSummary){for(const key of ['occupants','rent','electricity','water','internet','cleaning','total']){
  const actual=key==='total'?totals.stated:totals[key];if(sourceSummary[key]!==undefined&&sourceSummary[key]!==actual)summaryIssues.push(`Dòng TỔNG ${key}: Excel ${sourceSummary[key]}, cộng các phòng ${actual}`);
 }}
 if(totals.stated!==totals.computed)summaryIssues.push(`Tổng các phòng Excel chênh ${totals.stated-totals.computed}đ so với công thức`);
 return {rows:parsed,defaults,totals,sourceSummary,summaryIssues};
}
