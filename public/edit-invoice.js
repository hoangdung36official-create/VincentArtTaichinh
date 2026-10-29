// Invoice correction workflow: preview before committing and preserve version history.
export async function openInvoiceEditor({invoice,api,post,refresh,notice,esc,money}){
 const inp = invoice.input || {};
 const electricEnabled = inp.electricEnabled !== false;
 const waterEnabled = inp.waterEnabled !== false;
 const internetEnabled = inp.internetEnabled !== false;
 const serviceEnabled = inp.serviceEnabled !== false;
 const parkingEnabled = inp.parkingEnabled !== false;
 const evChargingEnabled = !!inp.evChargingEnabled;

 const internetRate = inp.internetRate ?? inp.internet ?? 0;
 const serviceCount = inp.serviceCount ?? inp.occupants ?? 1;
 const serviceRate = inp.serviceRate ?? (inp.cleaning ? Math.round(inp.cleaning / serviceCount) : 150000);
 const parkingCount = inp.parkingCount ?? (inp.parking ? 1 : 0);
 const parkingRate = inp.parkingRate ?? (inp.parking || 100000);
 const evChargingCount = inp.evChargingCount ?? 0;
 const evChargingRate = inp.evChargingRate ?? 100000;

 const dialog=document.createElement('dialog');
 dialog.className='invoice-editor';
 dialog.innerHTML=`
 <div class="editor-heading">
  <div>
   <small>VINCENT ART · HIỆU CHỈNH CÓ LỊCH SỬ</small>
   <h2>Hóa đơn ${esc(invoice.building_code)}.${esc(invoice.room_code)} · ${esc(invoice.month)}</h2>
   <p class="muted">Phiên bản hiện tại: v${invoice.version} · Đã thu: ${money(invoice.paid)}. Các giao dịch đã thu được giữ nguyên.</p>
  </div>
  <button type="button" id="editorClose" class="secondary" aria-label="Đóng">✕</button>
 </div>

 <form id="invoiceEditForm" class="editor-content">
  <div class="editor-section">
   <h3>Tiền phòng & Dịch vụ cơ bản</h3>
   <div class="form editor-fields-grid">
    <label>Tiền phòng (VND)
     <input name="rent" type="number" step="1" min="0" required value="${esc(inp.rent ?? 0)}">
    </label>
   </div>
  </div>

  <div class="editor-section">
   <div class="section-title">
    <h3>1. Tiền điện</h3>
    <label class="toggle-label"><input type="checkbox" name="electricEnabled" ${electricEnabled ? 'checked' : ''}> Sử dụng điện</label>
   </div>
   <div class="form editor-fields-grid">
    <label>Điện cũ
     <input name="previousElectric" type="number" step="0.001" min="0" value="${inp.previousElectric ?? ''}">
    </label>
    <label>Điện mới
     <input name="currentElectric" type="number" step="0.001" min="0" value="${inp.currentElectric ?? ''}">
    </label>
    <label>Đơn giá điện (VND/kWh)
     <input name="electricRate" type="number" step="1" min="0" value="${esc(inp.electricRate ?? 3800)}">
    </label>
   </div>
  </div>

  <div class="editor-section">
   <div class="section-title">
    <h3>2. Tiền nước</h3>
    <label class="toggle-label"><input type="checkbox" name="waterEnabled" ${waterEnabled ? 'checked' : ''}> Sử dụng nước</label>
   </div>
   <div class="form editor-fields-grid">
    <label>Nước cũ
     <input name="previousWater" type="number" step="0.001" min="0" value="${inp.previousWater ?? ''}">
    </label>
    <label>Nước mới
     <input name="currentWater" type="number" step="0.001" min="0" value="${inp.currentWater ?? ''}">
    </label>
    <label>Đơn giá nước (VND/m³)
     <input name="waterRate" type="number" step="1" min="0" value="${esc(inp.waterRate ?? 0)}">
    </label>
   </div>
  </div>

  <div class="editor-section">
   <div class="section-title">
    <h3>3. Tiền mạng (Internet)</h3>
    <label class="toggle-label"><input type="checkbox" name="internetEnabled" ${internetEnabled ? 'checked' : ''}> Sử dụng Internet</label>
   </div>
   <div class="form editor-fields-grid">
    <label>Đơn giá mạng (VND/phòng)
     <input name="internetRate" type="number" step="1" min="0" value="${esc(internetRate)}">
    </label>
   </div>
  </div>

  <div class="editor-section">
   <div class="section-title">
    <h3>4. Phí dịch vụ</h3>
    <label class="toggle-label"><input type="checkbox" name="serviceEnabled" ${serviceEnabled ? 'checked' : ''}> Sử dụng dịch vụ</label>
   </div>
   <div class="form editor-fields-grid">
    <label>Số người
     <input name="serviceCount" type="number" step="1" min="0" value="${esc(serviceCount)}">
    </label>
    <label>Đơn giá dịch vụ (VND/người)
     <input name="serviceRate" type="number" step="1" min="0" value="${esc(serviceRate)}">
    </label>
    <div class="quick-rates">
     <span>Chọn nhanh:</span>
     <button type="button" class="secondary btn-sm" data-quick-service="150000">150.000đ</button>
     <button type="button" class="secondary btn-sm" data-quick-service="170000">170.000đ</button>
    </div>
   </div>
  </div>

  <div class="editor-section">
   <div class="section-title">
    <h3>5. Phí gửi xe</h3>
    <label class="toggle-label"><input type="checkbox" name="parkingEnabled" ${parkingEnabled ? 'checked' : ''}> Gửi xe</label>
   </div>
   <div class="form editor-fields-grid">
    <label>Số lượng xe
     <input name="parkingCount" type="number" step="1" min="0" value="${esc(parkingCount)}">
    </label>
    <label>Đơn giá gửi xe (VND/xe)
     <input name="parkingRate" type="number" step="1" min="0" value="${esc(parkingRate)}">
    </label>
   </div>
  </div>

  <div class="editor-section">
   <div class="section-title">
    <h3>6. Phí sạc xe điện</h3>
    <label class="toggle-label"><input type="checkbox" name="evChargingEnabled" ${evChargingEnabled ? 'checked' : ''}> Sạc xe điện</label>
   </div>
   <div class="form editor-fields-grid">
    <label>Số lượng xe điện
     <input name="evChargingCount" type="number" step="1" min="0" value="${esc(evChargingCount)}">
    </label>
    <label>Đơn giá sạc (VND/xe điện)
     <input name="evChargingRate" type="number" step="1" min="0" value="${esc(evChargingRate)}">
    </label>
   </div>
  </div>

  <div class="editor-section">
   <h3>Phụ phí & Giảm trừ</h3>
   <div class="form editor-fields-grid">
    <label>Phụ phí (VND)
     <input name="extras" type="number" step="1" min="0" value="${esc(inp.extras ?? 0)}">
    </label>
    <label>Giảm trừ (VND)
     <input name="discount" type="number" step="1" min="0" value="${esc(inp.discount ?? 0)}">
    </label>
   </div>
  </div>

  <label class="editor-reason">Lý do điều chỉnh (bắt buộc)
   <textarea name="reason" rows="2" maxlength="500" placeholder="Ví dụ: Đối chiếu lại chỉ số công tơ ngày 19/10" required></textarea>
  </label>

  <div id="editorPreview" class="editor-preview" aria-live="polite">
   Tổng đang lưu: <strong>${money(invoice.total)}</strong>. Bấm “Kiểm tra chênh lệch” trước khi lưu.
  </div>

  <label class="editor-ack" id="editorCarryover" hidden>
   <input type="checkbox" name="carryoverAck"> Tôi đã kiểm tra ảnh hưởng đến chỉ số kỳ sau và sẽ đối soát thủ công. Kỳ sau được giữ nguyên.
  </label>

  <div class="editor-actions">
   <button type="button" id="editorReview" class="secondary">Kiểm tra chênh lệch</button>
   <button type="submit" id="editorSave" class="primary" disabled>Lưu phiên bản mới</button>
  </div>
 </form>

 <div class="editor-history">
  <h3>Lịch sử hóa đơn</h3>
  <div id="editorVersions" class="muted">Đang tải lịch sử…</div>
 </div>`;

 document.body.append(dialog);
 const close=()=>dialog.close();
 const form=dialog.querySelector('#invoiceEditForm');
 const summary=dialog.querySelector('#editorPreview');
 const save=dialog.querySelector('#editorSave');
 const review=dialog.querySelector('#editorReview');
 const carryover=dialog.querySelector('#editorCarryover');

 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.querySelector('#editorClose').addEventListener('click',close);
 dialog.showModal();

 const versions=dialog.querySelector('#editorVersions');
 api(`invoices/${invoice.id}/versions`).then(rows=>{
  if(!dialog.isConnected)return;
  versions.innerHTML=rows.map(row=>`<p><b>v${row.version}</b> · ${money(row.total)} · ${esc(row.reason||'Không có lý do')} · ${esc(row.created_at)}</p>`).join('')||'Chưa có lịch sử.';
 }).catch(error=>{if(dialog.isConnected)versions.textContent='Lỗi đọc lịch sử: '+error.message;});

 form.querySelectorAll('[data-quick-service]').forEach(btn => {
  btn.addEventListener('click', () => {
   form.elements.serviceRate.value = btn.dataset.quickService;
   form.elements.serviceRate.dispatchEvent(new Event('input', { bubbles: true }));
  });
 });

 let verified=null;
 function payload(){
  const f = form.elements;
  const rent = Number(f.rent.value || 0);
  const electricEnabled = f.electricEnabled.checked;
  const previousElectric = f.previousElectric.value === '' ? null : Number(f.previousElectric.value);
  const currentElectric = f.currentElectric.value === '' ? null : Number(f.currentElectric.value);
  const electricRate = Number(f.electricRate.value || 0);

  const waterEnabled = f.waterEnabled.checked;
  const previousWater = f.previousWater.value === '' ? null : Number(f.previousWater.value);
  const currentWater = f.currentWater.value === '' ? null : Number(f.currentWater.value);
  const waterRate = Number(f.waterRate.value || 0);

  const internetEnabled = f.internetEnabled.checked;
  const internetRate = Number(f.internetRate.value || 0);

  const serviceEnabled = f.serviceEnabled.checked;
  const serviceCount = Number(f.serviceCount.value || 0);
  const serviceRate = Number(f.serviceRate.value || 0);

  const parkingEnabled = f.parkingEnabled.checked;
  const parkingCount = Number(f.parkingCount.value || 0);
  const parkingRate = Number(f.parkingRate.value || 0);

  const evChargingEnabled = f.evChargingEnabled.checked;
  const evChargingCount = Number(f.evChargingCount.value || 0);
  const evChargingRate = Number(f.evChargingRate.value || 0);

  const extras = Number(f.extras.value || 0);
  const discount = Number(f.discount.value || 0);

  const input = {
   rent,
   electricEnabled,
   previousElectric,
   currentElectric,
   electricRate,
   waterEnabled,
   previousWater,
   currentWater,
   waterRate,
   internetEnabled,
   internetRate,
   internet: internetRate,
   serviceEnabled,
   serviceCount,
   serviceRate,
   cleaning: serviceCount * serviceRate,
   parkingEnabled,
   parkingCount,
   parkingRate,
   parking: parkingCount * parkingRate,
   evChargingEnabled,
   evChargingCount,
   evChargingRate,
   extras,
   discount
  };
  return { input, reason: String(f.reason.value||'').trim(), expectedVersion: invoice.version };
 }

 function invalidate(){
  verified=null;
  save.disabled=true;
  carryover.hidden=true;
  carryover.querySelector('input').checked=false;
  summary.textContent='Dữ liệu đã thay đổi. Hãy kiểm tra chênh lệch trước khi lưu.';
 }

 form.querySelectorAll('input, select, textarea').forEach(el=>el.addEventListener('input',invalidate));
 form.querySelectorAll('input[type=checkbox]').forEach(el=>el.addEventListener('change',invalidate));

 review.addEventListener('click',async()=>{
  review.disabled=true;
  save.disabled=true;
  verified=null;
  summary.textContent='Đang kiểm tra trên máy chủ…';
  try{
   const current=payload();
   const result=await post(`invoices/${invoice.id}/preview`,current);
   if(JSON.stringify(current.input)!==JSON.stringify(payload().input))throw Error('Dữ liệu vừa thay đổi, hãy kiểm tra lại');
   verified=JSON.stringify(current.input);
   summary.textContent=`Tổng cũ: ${money(result.oldTotal)} · Tổng mới: ${money(result.newTotal)} · Chênh lệch: ${result.delta>0?'+':''}${money(result.delta)} · Còn thiếu: ${money(result.due)}. ${result.carryover?'Có ảnh hưởng kỳ '+result.carryover.month+'; cần xác nhận đối soát.':''}${!result.changed?' Chưa thay đổi thông tin hóa đơn.':''}`;
   carryover.hidden=!result.carryover;
   save.disabled=!result.changed;
  }catch(error){
   summary.textContent='Không thể xem trước: '+error.message;
  }finally{
   review.disabled=false;
  }
 });

 form.addEventListener('submit',async event=>{
  event.preventDefault();
  save.disabled=true;
  try{
   const current=payload();
   if(verified!==JSON.stringify(current.input))throw Error('Cần kiểm tra lại chênh lệch trước khi lưu');
   if(!current.reason)throw Error('Phải nhập lý do điều chỉnh');
   if(!carryover.hidden&&!carryover.querySelector('input').checked)throw Error('Cần xác nhận việc đối soát kỳ sau');
   await post(`invoices/${invoice.id}/revise`,{...current,acknowledgeCarryover:!carryover.hidden&&carryover.querySelector('input').checked});
   close();
   notice('Đã lưu phiên bản hóa đơn mới và lịch sử điều chỉnh.');
   await refresh();
  }catch(error){
   summary.textContent='Không thể lưu: '+error.message;
   save.disabled=false;
  }
 });
}
