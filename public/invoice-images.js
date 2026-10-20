// Canvas-based PNG invoice export with a small, dependency-free ZIP container.
const format=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(n??0)+' đ';
const filename=invoice=>`hoa-don-${String(invoice.building_code).replace(/[^\w-]/g,'')}-${String(invoice.room_code).replace(/[^\w-]/g,'')}-${invoice.month}-v${invoice.version}.png`;
const crc32=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let k=0;k<8;k++)c=(c>>>1)^(c&1?0xedb88320:0);}return (c^0xffffffff)>>>0;};
export function zipFiles(files){
 const encoder=new TextEncoder(),parts=[];let offset=0;const entries=[];
 for(const file of files){
  const name=encoder.encode(file.name),data=file.data instanceof Uint8Array?file.data:new Uint8Array(file.data),crc=crc32(data);
  if(name.length>65535||data.length>0xffffffff)throw Error('Tệp vượt giới hạn ZIP');
  const head=new Uint8Array(30+name.length),v=new DataView(head.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);
  v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);head.set(name,30);
  parts.push(head,data);
  const central=new Uint8Array(46+name.length),w=new DataView(central.buffer);
  w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);
  w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);
  w.setUint16(28,name.length,true);w.setUint32(42,offset,true);central.set(name,46);entries.push(central);
  offset+=head.length+data.length;
 }
 const dirLength=entries.reduce((n,part)=>n+part.length,0);
 const end=new Uint8Array(22),e=new DataView(end.buffer);
 e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);
 e.setUint32(12,dirLength,true);e.setUint32(16,offset,true);
 return new Blob([...parts,...entries,end],{type:'application/zip'});
}
const drawInvoice=invoice=>{
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1580;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Thiết bị không hỗ trợ xuất PNG');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111';
 const txt=(value,x,y,size=29,bold=false)=>{ctx.font=`${bold?'700':'400'} ${size}px Arial, sans-serif`;ctx.fillText(String(value??''),x,y);};
 const line=y=>{ctx.strokeStyle='#ddd';ctx.beginPath();ctx.moveTo(65,y);ctx.lineTo(1135,y);ctx.stroke();};
 txt('VINCENT ART TÀI CHÍNH',65,90,36,true);txt('THÔNG BÁO THU TIỀN NỘI BỘ',65,153,34,true);
 line(183);txt(`Nhà ${invoice.building_code}  •  Phòng ${invoice.room_code}`,65,242,33,true);
 txt(`Kỳ: ${invoice.month}  •  Phiên bản: ${invoice.version}`,65,292);
 txt(`Tòa: ${invoice.building_name||''}`,65,342,27);
 txt(`Địa chỉ: ${(invoice.address||'').slice(0,64)}`,65,392,25);
 line(420);txt('KHOẢN THU',70,475,25,true);txt('THÀNH TIỀN',870,475,25,true);line(500);
 const x=invoice.input;
 const rows=[['Tiền phòng',x.rent],
  [`Điện (${x.previousElectric} → ${x.currentElectric}) × ${format(x.electricRate)}`, (x.currentElectric-x.previousElectric)*x.electricRate],
  [`Nước (${x.previousWater} → ${x.currentWater}) × ${format(x.waterRate)}`,(x.currentWater-x.previousWater)*x.waterRate],
  ['Internet',x.internet],['Vệ sinh',x.cleaning],['Tiền xe',x.parking],['Phụ phí',x.extras],['Giảm trừ',-(x.discount??0)]];
 ctx.textAlign='left';let y=554;
 for(const [label,sum] of rows){txt(label,70,y,25);ctx.textAlign='right';txt(format(sum),1125,y,25,true);ctx.textAlign='left';line(y+22);y+=83;}
 y+=36;txt('TỔNG PHẢI THU',70,y,32,true);ctx.textAlign='right';txt(format(invoice.total),1125,y,34,true);
 y+=78;txt('ĐÃ THU',70,y,29);txt(format(invoice.paid),1125,y,29);y+=62;
 txt('CÒN THIẾU',70,y,29,true);txt(format(invoice.due),1125,y,30,true);
 ctx.textAlign='left';line(1450);txt('Chứng từ nội bộ, không phải hóa đơn điện tử hợp lệ về thuế.',65,1503,22);
 return canvas;
};
const png=invoice=>new Promise((resolve,reject)=>drawInvoice(invoice).toBlob(blob=>blob?resolve(blob):reject(Error('Không tạo được PNG')),'image/png'));
const download=(blob,name)=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
export async function downloadInvoiceImages(ids,api){
 const unique=[...new Set(ids)];if(!unique.length||unique.length>100)throw Error('Chọn 1–100 hóa đơn');
 const files=[];
 for(const id of unique){const inv=await api('invoices/'+id);const blob=await png(inv);files.push({name:filename(inv),data:new Uint8Array(await blob.arrayBuffer()),blob});}
 if(files.length===1){download(files[0].blob,files[0].name);return 1;}
 const archive=zipFiles(files);download(archive,`hoa-don-hang-loat-${files.length}-phong.zip`);return files.length;
}
