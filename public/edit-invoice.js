// Invoice correction workflow: preview before committing and preserve version history.
const FIELDS=[
 ['rent','Tiền phòng (VND)'],['previousElectric','Điện cũ'],['currentElectric','Điện mới'],
 ['electricRate','Đơn giá điện (VND/kWh)'],['previousWater','Nước cũ'],['currentWater','Nước mới'],
 ['waterRate','Đơn giá nước (VND/m³)'],['internet','Internet (VND)'],
 ['cleaning','Vệ sinh (VND)'],['parking','Tiền xe (VND)'],
 ['extras','Phụ phí (VND)'],['discount','Giảm trừ (VND)']
];

export async function openInvoiceEditor({invoice,api,post,refresh,notice,esc,money}){
 const dialog=document.createElement('dialog');dialog.className='invoice-editor';
 dialog.innerHTML=`<div class="editor-heading"><div><small>VINCENT ART · HIỆU CHỈNH CÓ LỊCH SỬ</small><h2>Hóa đơn ${esc(invoice.building_code)}.${esc(invoice.room_code)} · ${esc(invoice.month)}</h2><p class="muted">Phiên bản hiện tại: v${invoice.version} · Đã thu: ${money(invoice.paid)}. Các giao dịch đã thu được giữ nguyên.</p></div><button type="button" id="editorClose" class="secondary" aria-label="Đóng">✕</button></div>
 <form id="invoiceEditForm"><div class="form editor-fields">${FIELDS.map(([name,label])=>`<label>${label}<input name="${name}" type="number" step="1" min="0" required value="${esc(invoice.input[name])}"></label>`).join('')}</div>
 <label class="editor-reason">Lý do điều chỉnh (bắt buộc)<textarea name="reason" rows="2" maxlength="500" placeholder="Ví dụ: Đối chiếu lại chỉ số công tơ ngày 19/10" required></textarea></label>
 <div id="editorPreview" class="editor-preview" aria-live="polite">Tổng đang lưu: <strong>${money(invoice.total)}</strong>. Bấm “Kiểm tra chênh lệch” trước khi lưu.</div>
 <label class="editor-ack" id="editorCarryover" hidden><input type="checkbox" name="carryoverAck"> Tôi đã kiểm tra ảnh hưởng đến chỉ số kỳ sau và sẽ đối soát thủ công. Kỳ sau được giữ nguyên.</label>
 <div class="editor-actions"><button type="button" id="editorReview" class="secondary">Kiểm tra chênh lệch</button><button type="submit" id="editorSave" class="primary" disabled>Lưu phiên bản mới</button></div></form>
 <div class="editor-history"><h3>Lịch sử hóa đơn</h3><div id="editorVersions" class="muted">Đang tải lịch sử…</div></div>`;
 document.body.append(dialog);
 const close=()=>dialog.close(),form=dialog.querySelector('#invoiceEditForm'),summary=dialog.querySelector('#editorPreview'),save=dialog.querySelector('#editorSave'),review=dialog.querySelector('#editorReview'),carryover=dialog.querySelector('#editorCarryover');
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.querySelector('#editorClose').addEventListener('click',close);
 dialog.showModal();
 const versions=dialog.querySelector('#editorVersions');
 api(`invoices/${invoice.id}/versions`).then(rows=>{
  if(!dialog.isConnected)return;
  versions.innerHTML=rows.map(row=>`<p><b>v${row.version}</b> · ${money(row.total)} · ${esc(row.reason||'Không có lý do')} · ${esc(row.created_at)}</p>`).join('')||'Chưa có lịch sử.';
 }).catch(error=>{if(dialog.isConnected)versions.textContent='Lỗi đọc lịch sử: '+error.message;});

 let verified=null;
 function payload(){
  const data=new FormData(form),input={};
  for(const [name] of FIELDS){const raw=data.get(name);const value=Number(raw);if(raw===''||!Number.isSafeInteger(value)||value<0)throw Error(`Giá trị ${name} phải là số nguyên không âm`);input[name]=value;}
  return {input,reason:String(data.get('reason')||'').trim(),expectedVersion:invoice.version};
 }
 function invalidate(){verified=null;save.disabled=true;carryover.hidden=true;carryover.querySelector('input').checked=false;summary.textContent='Dữ liệu đã thay đổi. Hãy kiểm tra chênh lệch trước khi lưu.';}
 form.querySelectorAll('input[type=number]').forEach(input=>input.addEventListener('input',invalidate));
 review.addEventListener('click',async()=>{
  review.disabled=true;save.disabled=true;verified=null;summary.textContent='Đang kiểm tra trên máy chủ…';
  try{
   const current=payload();const result=await post(`invoices/${invoice.id}/preview`,current);
   if(JSON.stringify(current.input)!==JSON.stringify(payload().input))throw Error('Dữ liệu vừa thay đổi, hãy kiểm tra lại');
   verified=JSON.stringify(current.input);
   summary.textContent=`Tổng cũ: ${money(result.oldTotal)} · Tổng mới: ${money(result.newTotal)} · Chênh lệch: ${result.delta>0?'+':''}${money(result.delta)} · Còn thiếu: ${money(result.due)}. ${result.carryover?'Có ảnh hưởng kỳ '+result.carryover.month+'; cần xác nhận đối soát.':''}${!result.changed?' Chưa thay đổi thông tin hóa đơn.':''}`;
   carryover.hidden=!result.carryover;
   save.disabled=!result.changed;
  }catch(error){summary.textContent='Không thể xem trước: '+error.message;}
  finally{review.disabled=false;}
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();save.disabled=true;
  try{
   const current=payload();
   if(verified!==JSON.stringify(current.input))throw Error('Cần kiểm tra lại chênh lệch trước khi lưu');
   if(!current.reason)throw Error('Phải nhập lý do điều chỉnh');
   if(!carryover.hidden&&!carryover.querySelector('input').checked)throw Error('Cần xác nhận việc đối soát kỳ sau');
   await post(`invoices/${invoice.id}/revise`,{...current,acknowledgeCarryover:!carryover.hidden&&carryover.querySelector('input').checked});
   close();notice('Đã lưu phiên bản hóa đơn mới và lịch sử điều chỉnh.');await refresh();
  }catch(error){summary.textContent='Không thể lưu: '+error.message;save.disabled=false;}
 });
}
