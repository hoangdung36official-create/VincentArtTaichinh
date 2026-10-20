import {inflateRawSync} from 'node:zlib';
import {posix} from 'node:path';
import {parseCsv,importedMonth} from './import-csv.js';

// Read the small, standard OOXML subset used by Excel/Google Sheets exports.
// This module is read-only, bounded, and deliberately refuses ambiguous sheets.
const MAX_COMPRESSED=700_000,MAX_ENTRY=2_000_000,MAX_TOTAL=8_000_000;
function crc32(buffer){
 let crc=0xffffffff;
 for(const byte of buffer){
  crc^=byte;
  for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);
 }
 return (crc^0xffffffff)>>>0;
}
const xmlText=s=>String(s).replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,(_,num,entity)=>{
 if(entity)return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity.toLowerCase()];
 const code=num[0].toLowerCase()==='x'?parseInt(num.slice(1),16):Number(num);
 return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';
});
const attr=(source,name)=>xmlText(source.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`))?.[1]||'');

function unzip(buffer){
 if(buffer.length>MAX_COMPRESSED||buffer.length<22)throw Error('Excel quá lớn hoặc không hợp lệ (giới hạn 700 KB)');
 let eocd=-1;
 for(let p=buffer.length-22;p>=Math.max(0,buffer.length-65557);p--)if(buffer.readUInt32LE(p)===0x06054b50){eocd=p;break;}
 if(eocd<0)throw Error('Không tìm thấy cấu trúc ZIP của file XLSX');
 const count=buffer.readUInt16LE(eocd+10),offset=buffer.readUInt32LE(eocd+16);
 if(count>1000||offset>=buffer.length)throw Error('Tệp Excel có cấu trúc không hợp lệ');
 let pos=offset,total=0;const entries=new Map();
 for(let i=0;i<count;i++){
  if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50)throw Error('Bảng mục lục XLSX bị lỗi');
  const method=buffer.readUInt16LE(pos+10),flags=buffer.readUInt16LE(pos+8);
  const expectedCrc=buffer.readUInt32LE(pos+16);
  const packed=buffer.readUInt32LE(pos+20),unpacked=buffer.readUInt32LE(pos+24);
  const nameLength=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32);
  const local=buffer.readUInt32LE(pos+42),end=pos+46+nameLength+extra+comment;
  if(end>buffer.length)throw Error('Tên tệp ZIP không hợp lệ');
  const name=buffer.subarray(pos+46,pos+46+nameLength).toString('utf8');pos=end;
  if(name.includes('..')||name.startsWith('/')||name.includes('\\')||entries.has(name)||flags&1)throw Error('Đường dẫn ZIP không an toàn');
  if(unpacked>MAX_ENTRY||(total+=unpacked)>MAX_TOTAL)throw Error('File XLSX giải nén vượt giới hạn an toàn');
  if(!name.startsWith('xl/')||!(name.endsWith('.xml')||name.endsWith('.rels')))continue;
  if(![0,8].includes(method)||local+30>buffer.length||buffer.readUInt32LE(local)!==0x04034b50)throw Error('Định dạng nén XLSX chưa hỗ trợ');
  const localNameLength=buffer.readUInt16LE(local+26);
  const start=local+30+localNameLength+buffer.readUInt16LE(local+28);
  if(start+packed>offset||buffer.readUInt16LE(local+8)!==method||
     buffer.subarray(local+30,local+30+localNameLength).toString('utf8')!==name)throw Error('Tên tệp hoặc cấu trúc ZIP không khớp');
  const raw=buffer.subarray(start,start+packed);
  const out=method===8?inflateRawSync(raw,{maxOutputLength:MAX_ENTRY}):raw;
  if(out.length!==unpacked)throw Error('Kích thước nội dung XLSX không khớp');
  if(crc32(out)!==expectedCrc)throw Error('Kiểm tra CRC dữ liệu Excel thất bại');
  entries.set(name,out.toString('utf8'));
 }
 return entries;
}

function workbook(base64){
 if(typeof base64!=='string'||!base64||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('Dữ liệu XLSX không hợp lệ');
 const files=unzip(Buffer.from(base64,'base64'));
 const manifest=files.get('xl/workbook.xml'),rels=files.get('xl/_rels/workbook.xml.rels');
 if(!manifest||!rels)throw Error('Thiếu thông tin workbook.xlsx');
 const targets=new Map([...rels.matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)].map(m=>[attr(m[1],'Id'),attr(m[1],'Target')]));
 const sheets=[...manifest.matchAll(/<sheet\b([^>]*?)\/?\s*>/g)].map(m=>{
  const name=attr(m[1],'name'),ref=attr(m[1],'r:id'),target=targets.get(ref);
  if(!name||!target)throw Error('Không xác định được sheet Excel');
  const path=target.startsWith('/')?target.slice(1):posix.normalize(posix.join('xl',target));
  if(!path.startsWith('xl/')||!files.has(path))throw Error(`Không tìm thấy nội dung sheet ${name}`);
  return {name,path};
 });
 if(!sheets.length||sheets.length>60||new Set(sheets.map(x=>x.name)).size!==sheets.length)throw Error('Danh sách sheet Excel không hợp lệ');
 const strings=[...(files.get('xl/sharedStrings.xml')||'').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>xmlText(x[1])).join(''));
 return {files,sheets,strings};
}

function sheetMonth(name){
 const normalized=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const iso=normalized.match(/\b(20\d{2})[-./_ ](0?[1-9]|1[0-2])\b/);
 const local=normalized.match(/(?:thang\s*|\bt\s*)?(0?[1-9]|1[0-2])[-./_ ](20\d{2})\b/);
 return iso?`${iso[1]}-${iso[2].padStart(2,'0')}`:local?`${local[2]}-${local[1].padStart(2,'0')}`:importedMonth(name);
}

function sheetRows(xml,strings){
 const rows=[];
 for(const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
  const cells=[];
  for(const cell of row[1].matchAll(/<c\b([^>]*?)>([\s\S]*?)<\/c>/g)){
   const reference=attr(cell[1],'r'),letters=reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
   if(!letters)throw Error('Ô dữ liệu Excel thiếu địa chỉ');
   let col=0;for(const letter of letters)col=col*26+letter.charCodeAt(0)-64;col--;
   if(col>=80)throw Error('Bảng dữ liệu quá 80 cột');
   const type=attr(cell[1],'t'),value=cell[2].match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
   const inline=[...cell[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>xmlText(x[1])).join('');
   cells[col]=type==='s'?strings[Number(value)]??'':type==='inlineStr'?inline:xmlText(value??inline);
  }
  if(cells.some(x=>String(x??'').trim()!==''))rows.push(cells);
  if(rows.length>515)throw Error('Sheet vượt quá 500 dòng dữ liệu');
 }
 return rows;
}

const csvCell=value=>`"${String(value??'').replace(/"/g,'""')}"`;
export function xlsxSheets(base64){return workbook(base64).sheets.map(x=>({name:x.name,month:sheetMonth(x.name)}));}
// Keep the original cell positions for multi-level invoice headers (for example A12 Th.10).
// The selected year comes from the explicit billing period, never from a guessed file date.
export function xlsxTable(base64,month,sheetName){
 if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Tháng cần nhập không hợp lệ');
 const wb=workbook(base64);
 const shortMonth=Number(month.slice(5));
 const matches=name=>{
  const found=sheetMonth(name);
  if(found)return found===month;
  const simplified=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const short=simplified.match(/^(?:th\.?|thang\s*|t\.?\s*)(0?[1-9]|1[0-2])$/);
  return !!short&&Number(short[1])===shortMonth;
 };
 let selected;
 if(sheetName){selected=wb.sheets.find(s=>s.name===sheetName);if(!selected)throw Error('Sheet đã chọn không tồn tại');if(!matches(selected.name))throw Error(`Sheet ${selected.name} không khớp kỳ ${month}`);}
 else {const found=wb.sheets.filter(s=>matches(s.name));if(found.length!==1)throw Error('Không nhận diện duy nhất sheet của tháng đã chọn. Hãy chọn sheet thủ công.');selected=found[0];}
 return {sheetName:selected.name,rows:sheetRows(wb.files.get(selected.path),wb.strings)};
}
export function xlsxCsv(base64,month,sheetName){
 const wb=workbook(base64);
 if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Tháng cần nhập không hợp lệ');
 let selected;
 if(sheetName){selected=wb.sheets.find(x=>x.name===sheetName);if(!selected)throw Error('Sheet đã chọn không tồn tại');}
 else if(wb.sheets.length===1)selected=wb.sheets[0];
 else{
  const matches=wb.sheets.filter(x=>sheetMonth(x.name)===month);
  if(matches.length!==1)throw Error(`Không thể tự chọn chính xác sheet kỳ ${month}. Hãy chọn một sheet trong: ${wb.sheets.map(s=>s.name).join(', ')}`);
  selected=matches[0];
 }
 const encoded=sheetMonth(selected.name);
 if(encoded&&encoded!==month)throw Error(`Sheet ${selected.name} thuộc kỳ ${encoded}, không phải kỳ ${month}`);
 const rows=sheetRows(wb.files.get(selected.path),wb.strings);
 if(rows.length<2)throw Error('Sheet chưa có bảng dữ liệu hóa đơn');
 for(let start=0;start<Math.min(rows.length-1,25);start++){
  const width=rows[start].length;
  if(width<5)continue;
  const csv=rows.slice(start).map(cells=>Array.from({length:width},(_,i)=>csvCell(cells[i])).join(',')).join('\n');
  try{parseCsv(csv);return {csv,sheetName:selected.name,skippedHeaderRows:start};}catch(e){
   if(!/Thiếu cột bắt buộc|CSV có cột cùng ý nghĩa bị trùng/.test(e.message))throw e;
  }
 }
 throw Error('Không nhận diện được dòng tiêu đề Phòng/Điện cũ/Điện mới/Nước cũ/Nước mới; cần chọn file chuẩn hoặc xuất CSV');
}
