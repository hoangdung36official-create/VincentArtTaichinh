// Deterministic Vietnamese command router; all writes require a server preview.
const fold=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().trim();
const amount=(text,label)=>{const m=text.match(new RegExp(`(?:${label})\\s*(?::|=|la|bang)?\\s*([\\d][\\d.,]*)`));return m?Number(m[1].replace(/[.,]/g,'')):undefined;};
// A building can be requested together with a per-floor room layout. Keep the
// layout structured so a partial natural-language match cannot create rooms.
function floorLayout(text){
 const heading=text.match(/(?:^|[,;\s])(\d{1,3})\s*phong\b\s*([\s\S]*)$/);
 if(!heading)return {totalRooms:null,floors:[],layoutError:'Cần ghi tổng số phòng trước cấu trúc từng tầng.'};
 const floors=[];
 const segments=heading[2].split(/\s*[,;]\s*|\s+va\s+/).map(x=>x.trim()).filter(Boolean);
 if(!segments.length)return {totalRooms:Number(heading[1]),floors,layoutError:'Cần ghi số phòng của từng tầng.'};
 for(const segment of segments){
  const range=segment.match(/^tang\s*(\d{1,2})\s*(?:->|=>|den|-)\s*(\d{1,2})\s*(?:(?:la|co|gom|moi tang)\s*)?(\d{1,3})\s*(?:phong|p)\s*(?:(?:1|\/|moi)\s*tang)?$/);
  const countFirst=segment.match(/^(\d{1,3})\s*(?:phong|p)\s*(?:o\s*)?tang\s*(\d{1,2})$/);
  const floorFirst=segment.match(/^tang\s*(\d{1,2})\s*(?:(?:co|gom|la)\s*)?(\d{1,3})\s*(?:phong|p)$/);
  if(range){
   const start=Number(range[1]),end=Number(range[2]),count=Number(range[3]);
   if(start<1||end>99||end<start||end-start>=100)return {totalRooms:Number(heading[1]),floors,layoutError:`Khoảng tầng không hợp lệ: ${segment}`};
   for(let floor=start;floor<=end;floor++)floors.push({floor,count});
  }else if(countFirst)floors.push({floor:Number(countFirst[2]),count:Number(countFirst[1])});
  else if(floorFirst)floors.push({floor:Number(floorFirst[1]),count:Number(floorFirst[2])});
  else return {totalRooms:Number(heading[1]),floors,layoutError:`Chưa hiểu cấu trúc tầng: ${segment}. Ví dụ: 3 phòng tầng 1, tầng 2->7 là 9p 1 tầng, tầng 8 có 5p.`};
 }
 return {totalRooms:Number(heading[1]),floors};
}
export function parseCommand(text,defaultYear=new Date().getFullYear()) {
 const s=fold(text);
 const buildings=[...new Set([...s.matchAll(/\b([av]\d{1,3})\b/g)].map(m=>m[1].toUpperCase()))];
 const roomMatch=s.match(/\b([av]\d{1,3})\s*[.\-/]\s*(\d{2,5})\b/)||s.match(/\b(?:nha\s*)?([av]\d{1,3})\s+phong\s+(\d{2,5})\b/);
 const room=roomMatch?.[2],building=roomMatch?.[1]?.toUpperCase()||buildings[0];
 const month=s.match(/thang\s*(1[0-2]|0?[1-9])(?:\s*(?:nam|\/|-)\s*(20\d\d))?/);
 const targetMonth=month?`${month[2]||defaultYear}-${String(month[1]).padStart(2,'0')}`:null;
 const valueMatch=s.match(/(?:thanh|len|la|bang|sang)\s*(\d[\d.]*)\b/);
 const value=valueMatch?Number(valueMatch[1].replace(/\./g,'')):null;
 const isCreate=/\b(?:them|tao)\b/.test(s);
 if(/\b(?:huong dan|tro giup|help|lenh ai)\b/.test(s))return {type:'help'};
 if(/\b(?:import|nhap (?:file|excel|csv|xlsx)|tai file)\b/.test(s))return {type:'import_help',building};
 if(isCreate&&/\b(?:toa nha|nha moi|toa moi)\b/.test(s)){
  const name=String(text).match(/\btên\s+(.+?)(?=\s+(?:địa\s+chỉ|giá\s+điện|giá\s+nước)(?:\s|$)|$)/iu)?.[1]?.trim()
    ||s.match(/\bten\s+(.+?)(?=\s+(?:dia chi|gia dien|gia nuoc)(?:\s|$)|$)/)?.[1]?.trim();
  const address=String(text).match(/địa\s+chỉ\s+(.+?)(?=\s+(?:giá\s+điện|giá\s+nước)(?:\s|$)|$)/iu)?.[1]?.trim()
    ||s.match(/\bdia chi\s+(.+?)(?=\s+(?:gia dien|gia nuoc)(?:\s|$)|$)/)?.[1]?.trim();
  if(/\b\d+\s*phong\b/.test(s)&&/\btang\b/.test(s)){
   const layout=floorLayout(s);
   const trimLayout=value=>String(value||'').replace(/\s*[,;]?\s*\d{1,3}\s*(?:phòng|phong)\b[\s\S]*$/iu,'').trim();
   return {type:'create_building_floors',code:building,name:trimLayout(name)||`Nhà ${building||''}`.trim(),address:trimLayout(address),electricRate:amount(s,'gia dien'),waterRate:amount(s,'gia nuoc'),...layout};
  }
  return {type:'create_building',code:building,name:name||`Nhà ${building||''}`.trim(),address:address||'',electricRate:amount(s,'gia dien'),waterRate:amount(s,'gia nuoc')};
 }
 if(isCreate&&/\bphong\b/.test(s)){
  const listed=s.match(/\b(?:cac\s+)?phong\s+((?:\d{2,5}\s*[,;]\s*)+\d{2,5}|\d{2,5}\s*-\s*\d{2,5}|\d{2,5})\b/);
  let numbers=listed?.[1]?.split(/\s*[,;]\s*/)||(room?[room]:[]);
  if(listed?.[1]?.includes('-')){const [start,end]=listed[1].split('-').map(Number);numbers=end>=start&&end-start<100?Array.from({length:end-start+1},(_,i)=>String(start+i)):[];}
  return {type:'create_rooms',building,codes:numbers,rent:amount(s,'gia (?:phong|thue)|tien phong'),internet:amount(s,'internet'),cleaning:amount(s,'ve sinh'),parking:amount(s,'tien xe'),occupants:amount(s,'so nguoi')};
 }
 if(/\b(?:xuat|tai|luu)\b/.test(s)&&/\b(?:anh|png|hinh)\b/.test(s)&&/hoa don/.test(s))return {type:'invoice_images',building:room?roomMatch[1].toUpperCase():building,buildings,room,month:targetMonth};
 if(/\b(?:xoa|huy)\b/.test(s)&&/hoa don/.test(s))return {type:'delete_invoice',building:room?roomMatch[1].toUpperCase():building,room,month:targetMonth};
 if(/\bchua\b/.test(s)&&/\b(?:co|xuat|tao)\b/.test(s)&&/hoa don/.test(s))return {type:'missing_invoices',building,month:targetMonth};
 if(/\b(?:tim|tra|xem|liet ke|thong ke)\b/.test(s)&&/\b(?:cong no|chua thu|da thu)\b/.test(s))return {type:'debt_search',building,room,month:targetMonth};
 if(/\b(?:no nhieu|no lon|no cao)\b/.test(s)&&building)return {type:'high_debt',building,month:targetMonth};
 if(/\b(?:tong hop|thong ke|bao cao|tom tat)\b/.test(s)&&building)return {type:'summary',building,month:targetMonth};
 if(/\b(?:tim|tra|xem|liet ke|danh sach)\b/.test(s)&&/\b(?:phong|toa|nha)\b/.test(s)&&!/hoa don/.test(s))return {type:'entity_search',building,room};
 if(/hoa don/.test(s)&&!/(?:sua|doi|xoa|huy)/.test(s)&&!/\bchua\b/.test(s))return {type:'invoice_lookup',building,room,month:targetMonth};
 // Bulk entry: "Nhập điện mới nhà A1: 201=130, 202=140 tháng 10/2026".
 const batch=s.match(/\b(?:nhap|cap nhat)\s+(?:chi so\s+|so\s+)?(dien|nuoc)\s+moi\s+(?:nha\s+)?[av]\d{1,3}\s*:\s*((?:\d{2,5}\s*=\s*\d+\s*[,;]\s*)*\d{2,5}\s*=\s*\d+)/);
 if(batch)return {type:'meter_batch',building,field:batch[1]==='dien'?'currentElectric':'currentWater',month:targetMonth,readings:[...batch[2].matchAll(/(\d{2,5})\s*=\s*(\d+)/g)].map(m=>({room:m[1],value:Number(m[2])}))};
 if(/gia dien/.test(s)&&/(?:sua|doi|cap nhat|tang|chinh|thay)/.test(s)){
  const v=s.match(/(\d[\d.,]*)\s*(?:d|dong|vnd)?\s*\/\s*kwh/);
  return {type:'electric_rate',buildings,value:v?Number(v[1].replace(/[.,]/g,'')):value};
 }
 if(/(?:so nguoi|so cu dan|so nhan khau|dinh muc nhan khau)/.test(s)&&/(?:sua|doi|cap nhat|thay|dieu chinh)/.test(s))return {type:'occupants',building:roomMatch?.[1]?.toUpperCase(),room,value};
 if(/(?:nuoc moi|so nuoc moi)/.test(s)&&/(?:sua|doi|cap nhat|thay|la)/.test(s))return {type:'water_reading',building:roomMatch?.[1]?.toUpperCase(),room,value,month:targetMonth};
 if(/(?:dien moi|so dien moi|chi so dien moi)/.test(s)&&/(?:sua|doi|cap nhat|thay|la|len)/.test(s))return {type:'electric_reading',building:roomMatch?.[1]?.toUpperCase(),room,value,month:targetMonth};
 // Toggle service: "Bật internet phòng A1.201", "Tắt sạc xe điện A1.301"
 if(/\b(bat|tat)\b(?!\s+ca\b)/.test(s)){
  const svcMap={'sac xe dien':'evCharging','sac xe':'evCharging','gui xe':'parking','tien xe':'parking','dich vu':'service','ve sinh':'service','phi dich vu':'service','internet':'internet','mang':'internet','dien':'electric','nuoc':'water'};
  const on=/\bbat\b/.test(s);
  for(const [key,svc] of Object.entries(svcMap)){
   if(s.includes(key))return {type:'toggle_service',building:roomMatch?.[1]?.toUpperCase()||buildings[0],room:roomMatch?.[2],service:svc,enabled:on};
  }
 }
 // Bulk service rate / rent update: "Cập nhật giá dịch vụ tất cả phòng nhà A1 lên 170.000"
 if(/\b(?:tat ca|toan bo|moi)\s+phong\b/.test(s)&&/(?:sua|doi|cap nhat|thay|chinh|tang|ha)/.test(s)&&building){
  const updates={};
  let sr=amount(s,'gia (?:dich vu|ve sinh|dv)');if(sr===undefined&&/(?:gia (?:dich vu|ve sinh|dv)|dich vu)/.test(s)&&value!==null)sr=value;if(sr!==undefined)updates.serviceRate=sr;
  let pr=amount(s,'gia (?:gui xe|tien xe)');if(pr===undefined&&/(?:gia (?:gui xe|tien xe)|tien xe)/.test(s)&&value!==null)pr=value;if(pr!==undefined)updates.parkingRate=pr;
  let er=amount(s,'gia (?:sac(?: xe)?(?: dien)?)');if(er===undefined&&/(?:gia sac|sac xe)/.test(s)&&value!==null)er=value;if(er!==undefined)updates.evChargingRate=er;
  let ir=amount(s,'gia (?:internet|mang)');if(ir===undefined&&/(?:gia (?:internet|mang)|internet|mang)/.test(s)&&value!==null)ir=value;if(ir!==undefined)updates.internetRate=ir;
  let rt=amount(s,'(?:tien phong|gia phong|gia thue)');if(rt===undefined&&/(?:tien phong|gia phong|gia thue)/.test(s)&&value!==null)rt=value;if(rt!==undefined)updates.rent=rt;
  if(Object.keys(updates).length)return {type:'bulk_service_update',building,updates};
 }
 // Single room config update: "Sửa giá dịch vụ A1.201 lên 170.000", "Sửa số xe A1.201 thành 2"
 if(/(?:sua|doi|cap nhat|thay|chinh|dieu chinh)/.test(s)&&roomMatch&&/(?:gia dich vu|gia ve sinh|gia gui xe|gia tien xe|gia sac|gia internet|gia mang|so xe|tien phong|gia phong|gia thue)/.test(s)){
  const updates={};
  let sr=amount(s,'gia (?:dich vu|ve sinh|dv)');if(sr===undefined&&/(?:gia (?:dich vu|ve sinh|dv)|dich vu)/.test(s)&&value!==null)sr=value;if(sr!==undefined)updates.serviceRate=sr;
  let pr=amount(s,'gia (?:gui xe|tien xe)');if(pr===undefined&&/(?:gia (?:gui xe|tien xe)|tien xe)/.test(s)&&value!==null)pr=value;if(pr!==undefined)updates.parkingRate=pr;
  let er=amount(s,'gia (?:sac(?: xe)?(?: dien)?)');if(er===undefined&&/(?:gia sac|sac xe)/.test(s)&&value!==null)er=value;if(er!==undefined)updates.evChargingRate=er;
  let ir=amount(s,'gia (?:internet|mang)');if(ir===undefined&&/(?:gia (?:internet|mang)|internet|mang)/.test(s)&&value!==null)ir=value;if(ir!==undefined)updates.internetRate=ir;
  let rt=amount(s,'(?:tien phong|gia phong|gia thue)');if(rt===undefined&&/(?:tien phong|gia phong|gia thue)/.test(s)&&value!==null)rt=value;if(rt!==undefined)updates.rent=rt;
  let evc=amount(s,'so xe dien');if(evc===undefined&&/so xe dien/.test(s)&&value!==null)evc=value;if(evc!==undefined)updates.evChargingCount=evc;
  if(evc===undefined){let vc=amount(s,'so xe');if(vc===undefined&&/so xe\b/.test(s)&&!/so xe dien/.test(s)&&value!==null)vc=value;if(vc!==undefined)updates.parkingCount=vc;}
  if(Object.keys(updates).length)return {type:'update_room_config',building:roomMatch[1].toUpperCase(),room:roomMatch[2],updates};
 }
 return {type:'unsupported'};
}
