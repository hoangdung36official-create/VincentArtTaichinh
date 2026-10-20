import {deflateRawSync} from 'node:zlib';

const xmlEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function crc32(buffer){let c=0xffffffff;for(const b of buffer){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return (c^0xffffffff)>>>0;}

function zip(entries){
 let position=0;const locals=[],centrals=[];
 for(const [name,content] of Object.entries(entries)){
  const label=Buffer.from(name),raw=Buffer.from(content),compressed=deflateRawSync(raw),crc=crc32(raw);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(label.length,26);
  locals.push(local,label,compressed);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(label.length,28);central.writeUInt32LE(position,42);
  centrals.push(central,label);position+=local.length+label.length+compressed.length;
 }
 const index=Buffer.concat(centrals),eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50);eocd.writeUInt16LE(Object.keys(entries).length,8);eocd.writeUInt16LE(Object.keys(entries).length,10);eocd.writeUInt32LE(index.length,12);eocd.writeUInt32LE(position,16);
 return Buffer.concat([...locals,index,eocd]);
}
function column(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function sheet(rows){
 return `<?xml version="1.0"?><worksheet><sheetData>${rows.map((cells,i)=>`<row r="${i+1}">${cells.map((v,j)=>v===null||v===undefined?'':`<c r="${column(j)}${i+1}" ${typeof v==='number'?'':'t="inlineStr"'}>${typeof v==='number'?`<v>${v}</v>`:`<is><t>${xmlEsc(v)}</t></is>`}</c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
export function sampleXlsx({room='A12.203',month='12/2026',total=2038000}={}){
 const header=['Phòng','Tháng','Điện cũ','Điện mới','Nước cũ','Nước mới','Tiền phòng','Giá điện','Tổng'];
 const november=[header,['A12.999','11/2026',0,10,0,0,2000000,3800,total]];
 const december=[['DỮ LIỆU THÁNG 12/2026'],['Tổng hợp đơn giá'],header,[room,month,0,10,0,0,2000000,3800,total]];
 const names=['Tháng 11-2026','Tháng 12-2026'];
 const manifest=`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name,i)=>`<sheet name="${xmlEsc(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
 const rels=`<Relationships>${names.map((_,i)=>`<Relationship Id="rId${i+1}" Target="worksheets/sheet${i+1}.xml" Type="worksheet"/>`).join('')}</Relationships>`;
 return zip({'xl/workbook.xml':manifest,'xl/_rels/workbook.xml.rels':rels,'xl/worksheets/sheet1.xml':sheet(november),'xl/worksheets/sheet2.xml':sheet(december)}).toString('base64');
}
