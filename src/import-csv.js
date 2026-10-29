// Strict, dependency-free CSV parser for reviewed monthly rental-billing imports.
// It never guesses missing financial columns or converts invalid values to zero.
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');

const aliases = {
  room: ['phong', 'sophong', 'maphong', 'room', 'roomcode'],
  building: ['nha', 'toa', 'toanha', 'building', 'buildingcode'],
  month: ['thang', 'ky', 'month', 'billingmonth'],
  previousElectric: ['diencu', 'chisodiencu', 'electricold', 'previouselectric'],
  currentElectric: ['dienmoi', 'chisodienmoi', 'electricnew', 'currentelectric'],
  previousWater: ['nuoccu', 'chisonuoccu', 'waterold', 'previouswater'],
  currentWater: ['nuocmoi', 'chisonuocmoi', 'waternew', 'currentwater'],
  rent: ['tienphong', 'rent'],
  internet: ['internet', 'tieninternet'],
  cleaning: ['vesinh', 'tienvesinh', 'cleaning', 'phidichvu', 'dichvu'],
  parking: ['tienxe', 'parking', 'phixe', 'guixe'],
  electricRate: ['giadien', 'dongiadien', 'electricrate'],
  waterRate: ['gianuoc', 'dongianuoc', 'waterrate'],
  internetRate: ['dongiamang', 'giamang', 'internetrate'],
  serviceRate: ['dongiadichvu', 'giadichvu', 'servicerate'],
  serviceCount: ['songuoi', 'nguoi', 'servicecount', 'occupants'],
  parkingRate: ['dongiaxe', 'dongiaguixe', 'parkingrate', 'giaxe'],
  parkingCount: ['soxe', 'soluongxe', 'parkingcount'],
  evChargingRate: ['dongiasacxe', 'dongiasacxedien', 'evchargingrate', 'giasacxe'],
  evChargingCount: ['soxedien', 'evchargingcount'],
  electricEnabled: ['dungdien', 'batdien', 'electricenabled'],
  waterEnabled: ['dungnuoc', 'batnuoc', 'waterenabled'],
  internetEnabled: ['dunginternet', 'dungmang', 'internetenabled'],
  serviceEnabled: ['dungdichvu', 'serviceenabled'],
  parkingEnabled: ['dungguixe', 'parkingenabled'],
  evChargingEnabled: ['dungsacxedien', 'sacxedien', 'evchargingenabled'],
  extras: ['phuthu', 'extras', 'phikhac'],
  discount: ['giamtru', 'discount'],
  total: ['tong', 'tongtien', 'tongphaithu', 'total']
};
const aliasMap = new Map(Object.entries(aliases).flatMap(([key,values])=>values.map(x=>[x,key])));
const required = ['room','previousElectric','currentElectric','previousWater','currentWater'];

export function parseCsv(content) {
  if(typeof content!=='string'||!content.trim()||content.length>900_000)throw Error('CSV trống hoặc vượt quá 900 KB');
  const text=content.replace(/^\uFEFF/,'');
  const header=text.split(/\r?\n/,1)[0];
  const separators=[',',';','\t'];
  const delimiter=separators.map(sep=>[sep,header.split(sep).length-1]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}
      else if(quoted){quoted=false;}
      else if(!field){quoted=true;}
      else throw Error('Dấu nháy CSV không hợp lệ');
    }else if(c===delimiter&&!quoted){row.push(field.trim());field='';}
    else if((c==='\r'||c==='\n')&&!quoted){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(field.trim());field='';
      if(row.some(x=>x!==''))rows.push(row);
      row=[];
      if(rows.length>502)throw Error('CSV vượt quá 500 dòng dữ liệu');
    }else field+=c;
  }
  if(quoted)throw Error('Dấu nháy CSV chưa đóng');
  row.push(field.trim());if(row.some(x=>x!==''))rows.push(row);
  if(rows.length<2)throw Error('CSV phải có tiêu đề và dữ liệu');
  if(rows.length>501)throw Error('CSV vượt quá 500 dòng dữ liệu');
  const columns=rows[0].map(x=>aliasMap.get(normalize(x))||null);
  for(const key of required)if(!columns.includes(key))throw Error(`Thiếu cột bắt buộc: ${key}`);
  const present=columns.filter(Boolean);
  if(new Set(present).size!==present.length)throw Error('CSV có cột cùng ý nghĩa bị trùng');
  return rows.slice(1).map((cells,index)=>{
    if(cells.length!==columns.length)throw Error(`Dòng ${index+2}: số cột không khớp tiêu đề`);
    return {line:index+2,...Object.fromEntries(columns.flatMap((key,i)=>key?[[key,cells[i]]]:[]))};
  });
}

export function parseVndInteger(value, name, optional=false) {
  if((value===undefined||value==='')&&optional)return undefined;
  const s=String(value??'').trim();
  // Only integer VND, optionally grouped by thousands. "4,5" is ambiguous
  // and must never be silently interpreted as either 45 or 4.5.
  if(!/^(?:\d+|\d{1,3}(?:[., ]\d{3})+)$/.test(s))throw Error(`${name} không phải số nguyên không âm`);
  const n=Number(s.replace(/[., ]/g,''));
  if(!Number.isSafeInteger(n))throw Error(`${name} ngoài giới hạn số nguyên`);
  return n;
}

export function importedMonth(value){
  const s=String(value??'').trim();
  const iso=s.match(/^(20\d\d)-(0[1-9]|1[0-2])$/);
  if(iso)return s;
  const local=s.match(/^(0?[1-9]|1[0-2])[/-](20\d\d)$/);
  return local?`${local[2]}-${local[1].padStart(2,'0')}`:null;
}
