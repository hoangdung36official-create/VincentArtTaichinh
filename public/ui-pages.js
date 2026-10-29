// Real-data operational views, intentionally separate from the compact dashboard module.
export async function renderReconciliationReport({api,heading,content,table,esc,money,bid,month,buildings}){
 const building=buildings.find(x=>x.id===bid());
 heading('Đối soát tài chính','Kiểm tra hóa đơn, các khoản thu và sai lệch theo từng phòng.');
 const r=await api(`reports/reconciliation?buildingId=${encodeURIComponent(bid())}&month=${encodeURIComponent(month())}`);
 const t=r.totals;
 const metrics=[['Tổng phải thu',t.total],['Thực thu',t.paid],['Công nợ',t.due],['Thu dư',t.overpaid]];
 const metricHtml=metrics.map(([name,amount],index)=>`<div class="metric ${index===0?'dark':''}"><div class="label">${name}</div><div class="value">${money(amount)}</div></div>`).join('');
 const invoiceMap=new Map(r.rows.map(row=>[row.invoiceId,row]));
 const statuses={VALID:'Hợp lệ',WARNING:'Cần xem lại',ERROR:'Có lỗi',MISSING:'Thiếu hóa đơn'};
 const rows=r.checks.map(check=>{
  const invoice=invoiceMap.get(check.invoiceId);
  const label=statuses[check.status]||'Chưa xác định';
  const notes=[...check.issues,...check.warnings].join('; ');
  const tag=check.status==='VALID'?'PAID':check.status==='ERROR'||check.status==='MISSING'?'PARTIAL':'OVERPAID';
  return {room:check.room,invoice,notes,label,tag};
 });
 const tableRows=rows.map(x=>`<tr><td><b>${esc(x.room)}</b></td><td><span class="tag ${x.tag}">${esc(x.label)}</span></td><td class="num">${x.invoice?money(x.invoice.total):'—'}</td><td class="num">${x.invoice?money(x.invoice.paid):'—'}</td><td class="num">${x.invoice?money(x.invoice.due):'—'}</td><td class="num">${x.invoice?money(x.invoice.overpaid):'—'}</td><td>${x.invoice?x.invoice.transactionCount:0}</td><td class="recon-notes">${esc(x.notes||'Đã khớp')}</td></tr>`);
 const mobileCards=rows.map(x=>`<article class="recon-card"><div class="recon-card-head"><strong>Phòng ${esc(x.room)}</strong><span class="tag ${x.tag}">${esc(x.label)}</span></div><div class="recon-card-grid"><span>Phải thu <b>${x.invoice?money(x.invoice.total):'—'}</b></span><span>Đã thu <b>${x.invoice?money(x.invoice.paid):'—'}</b></span><span>Còn thiếu <b>${x.invoice?money(x.invoice.due):'—'}</b></span><span>Thu dư <b>${x.invoice?money(x.invoice.overpaid):'—'}</b></span></div><small>${esc(x.notes||'Đã khớp')} · ${x.invoice?x.invoice.transactionCount:0} giao dịch hiệu lực</small></article>`).join('');
 content.innerHTML=`<div class="metrics">${metricHtml}</div>
 <section class="panel"><div class="panel-title"><h2>${esc(building?.code||'Tòa nhà')} · Kỳ ${esc(month())}</h2><span class="tag ${r.locked?'PARTIAL':'PAID'}">${!r.periodExists?'Chưa tạo kỳ':r.locked?'Đã khóa kỳ':'Kỳ đang mở'}</span></div>
 <div class="recon-summary"><span>${r.invoiced}/${r.rooms} phòng có hóa đơn</span><span>${r.missing} thiếu hóa đơn</span><span>${r.errors} có lỗi</span><span>${r.warnings} cần xem lại</span><span>${r.activeTransactions} giao dịch hiệu lực</span><span>${r.reversedTransactions} đã đảo</span></div>
 <p><a class="secondary recon-export" href="/api/reports/reconciliation/export?buildingId=${encodeURIComponent(bid())}&month=${encodeURIComponent(month())}" download="doi-soat-${esc(month())}.csv">Tải đối soát CSV · Excel</a></p>
 <p class="muted">Tiền mặt: <b>${money(r.paymentMethods.cash)}</b> · Chuyển khoản: <b>${money(r.paymentMethods.transfer)}</b>. Các khoản đã đảo được loại khỏi thực thu nhưng vẫn tính vào số giao dịch lịch sử.</p></section>
 <section class="panel"><div class="panel-title"><h2>Vấn đề cần xử lý</h2><span class="muted">${r.issues.length} mục đối soát</span></div>${r.issues.length?`<div role="alert" class="recon-alert">${r.issues.map(issue=>`<p>${esc(issue)}</p>`).join('')}</div>`:'<p class="muted">Sổ thanh toán và tổng hóa đơn đã khớp; kiểm tra các cảnh báo ở từng phòng nếu có.</p>'}</section>
 <section class="panel"><div class="panel-title"><h2>Đối soát từng phòng</h2><span class="muted">${r.rooms} phòng · dữ liệu trực tiếp từ database</span></div>
 <div class="recon-desktop">${table(['Phòng','Kiểm tra','Phải thu','Đã thu','Còn thiếu','Thu dư','Giao dịch','Ghi chú'],tableRows)}</div>
 <div class="recon-mobile">${mobileCards||'<p class="muted">Chưa có phòng trong tòa nhà.</p>'}</div></section>`;
}

export async function renderCollectorReport({api,heading,month,buildings,content,table,esc,money}){
 heading('Báo cáo theo người thu','Đối soát tiền mặt và chuyển khoản theo từng nhà, từng nhân viên.');
 const entries=await api('reports/collectors?month='+encodeURIComponent(month()));
 const collectors=[...new Set(entries.map(x=>x.collector))].sort();
 const totals=collectors.map(name=>entries.filter(x=>x.collector===name).reduce((s,x)=>s+x.amount,0));
 const cash=entries.filter(x=>x.method==='CASH').reduce((s,x)=>s+x.amount,0);
 const transfer=entries.filter(x=>x.method==='TRANSFER').reduce((s,x)=>s+x.amount,0);
 const byBuilding=buildings.map(building=>{
  const cells=collectors.map(collector=>entries.filter(x=>x.building_id===building.id&&x.collector===collector).reduce((s,x)=>s+x.amount,0));
  const total=cells.reduce((s,x)=>s+x,0);
  return `<tr><td><b>${esc(building.code)}</b></td>${cells.map(n=>`<td class="num">${money(n)}</td>`).join('')}<td class="num"><b>${money(total)}</b></td></tr>`;
 });
 const all=totals.reduce((s,x)=>s+x,0);
 content.innerHTML=`<div class="metrics report-metrics"><div class="metric dark"><div class="label">Tổng đã thu · ${esc(month())}</div><div class="value">${money(all)}</div></div><div class="metric"><div class="label">Tiền mặt</div><div class="value">${money(cash)}</div></div><div class="metric"><div class="label">Chuyển khoản</div><div class="value">${money(transfer)}</div></div><div class="metric"><div class="label">Giao dịch</div><div class="value">${entries.reduce((s,x)=>s+x.transactions,0)}</div></div></div><section class="panel"><div class="panel-title"><h2>Ma trận thu tiền theo tòa</h2><span class="muted">Chỉ tính giao dịch thực tế, có lưu tại database.</span></div>${table(['Tòa',...collectors.map(esc),'Tổng'],[...byBuilding,`<tr class="summary-row"><td><b>TỔNG</b></td>${totals.map(n=>`<td class="num"><b>${money(n)}</b></td>`).join('')}<td class="num"><b>${money(all)}</b></td></tr>`])}</section><section class="panel"><h2>Chi tiết theo phương thức</h2>${table(['Nhà','Người thu','Phương thức','Giao dịch','Đã thu'],entries.map(x=>`<tr><td>${esc(x.building_code)}</td><td>${esc(x.collector)}</td><td>${x.method==='CASH'?'Tiền mặt':'Chuyển khoản'}</td><td>${x.transactions}</td><td class="num">${money(x.amount)}</td></tr>`))}</section>`;
}

export async function renderPaymentJournal({api,post,content,table,esc,money,bid,month,user,locked,render,notice}){
 const payments=await api(`payments?buildingId=${bid()}&month=${month()}`);
 const total=payments.reduce((s,x)=>s+BigInt(x.net_amount),0n);
 const canReverse=!locked&&['SUPER_ADMIN','MANAGER','ACCOUNTANT'].includes(user.role);
 const element=document.createElement('section');element.className='panel';
 element.innerHTML=`<div class="panel-title"><h2>Nhật ký giao dịch</h2><span class="muted">${payments.length} giao dịch gốc · Thực thu ${money(total)}</span></div><p><a class="secondary" href="/api/payments/export?buildingId=${encodeURIComponent(bid())}&month=${encodeURIComponent(month())}" download="nhat-ky-thu-${esc(month())}.csv">Tải nhật ký CSV · Excel</a></p>${table(['Thực thu','Phòng','Người thu','Hình thức','Tham chiếu','Số tiền gốc','Trạng thái','Thao tác'],payments.map(x=>`<tr><td>${esc(new Date(x.received_at).toLocaleString('vi-VN'))}</td><td>${esc(x.room_code)}</td><td>${esc(x.collector)}</td><td>${x.method==='CASH'?'Tiền mặt':'Chuyển khoản'}</td><td>${esc(x.reference)}</td><td class="num">${money(x.amount)}</td><td>${x.reversed?`<span class="tag PARTIAL">Đã đảo</span><br><small>${esc(x.reversal_reason||'')} · ${esc(x.reversed_by||'')}</small>`:'Đã ghi nhận'}</td><td>${canReverse&&!x.reversed?`<button class="secondary" data-reverse="${x.id}">Đảo giao dịch</button>`:'—'}</td></tr>`))}`;
 content.append(element);
 element.querySelectorAll('[data-reverse]').forEach(button=>button.addEventListener('click',async()=>{
  const payment=payments.find(x=>x.id===Number(button.dataset.reverse));
  const reason=prompt(`Lý do đảo giao dịch ${payment.reference} (bắt buộc, tối thiểu 5 ký tự):`);
  if(!reason?.trim())return;
  if(reason.trim().length<5){notice('Lý do phải có ít nhất 5 ký tự.');return;}
  if(!confirm(`Đảo khoản thu ${money(payment.amount)} của phòng ${payment.room_code}? Giao dịch gốc sẽ được giữ để đối soát.`))return;
  button.disabled=true;
  try{await post(`payments/${payment.id}/reverse`,{reason:reason.trim()});notice('Đã đảo giao dịch và cập nhật công nợ.');await render();}
  catch(error){button.disabled=false;notice(error.message);}
 }));
}

export async function renderPeriodControls({api,post,content,bid,month,user,render,notice}){
 const periods=await api('periods?buildingId='+bid());
 const period=periods.find(x=>x.month===month());
 const panel=document.createElement('section');panel.className='panel';
 const canLock=['SUPER_ADMIN','MANAGER'].includes(user.role);
 const canUnlock=user.role==='SUPER_ADMIN';
 panel.innerHTML=`<div class="panel-title"><h2>Trạng thái kỳ thu</h2><span class="tag ${period?.locked?'PARTIAL':'PAID'}">${!period?'Chưa tạo kỳ':period.locked?'Đã khóa':'Đang mở'}</span></div><p class="muted">Khóa kỳ sẽ chặn sửa hóa đơn và ghi nhận thêm thanh toán. Khi mở lại, hệ thống lưu người thực hiện cùng lý do.</p>${period&&((period.locked&&canUnlock)||(!period.locked&&canLock))?`<button id="periodToggle" class="secondary">${period.locked?'Mở khóa kỳ':'Chốt / Khóa kỳ'}</button>`:''}`;
 content.prepend(panel);
 panel.querySelector('#periodToggle')?.addEventListener('click',async()=>{
  const reason=prompt('Lý do thực hiện (bắt buộc):');if(!reason?.trim())return;
  try{
   const payload={buildingId:bid(),month:month(),locked:!period.locked,reason:reason.trim()};
   if(!period.locked){
    const review=await api(`invoices/check?buildingId=${bid()}&month=${month()}`);
    if(review.errors){notice(`Chưa thể chốt: ${review.errors} hóa đơn lỗi. Hãy kiểm tra và sửa trước.`);return;}
    if(review.missing||review.warnings){
     if(!confirm(`Có ${review.missing} phòng chưa có hóa đơn và ${review.warnings} hóa đơn có cảnh báo. Bạn đã đối soát và xác nhận chốt kỳ ${month()} với các trường hợp này?`))return;
     payload.acknowledgeMissing=review.missing>0;
     payload.acknowledgeWarnings=review.warnings>0;
    }else if(!confirm(`Xác nhận khóa kỳ ${month()}?`))return;
   }else if(!confirm(`Xác nhận mở khóa kỳ ${month()}?`))return;
   await post('periods/lock',payload);notice('Đã cập nhật trạng thái kỳ thu.');await render();
  }catch(e){notice(e.message);}
 });
 return period;
}

export async function renderUserManagement({api,post,heading,content,table,buildings,esc,notice}){
 heading('Tài khoản & phân quyền','Tạo tài khoản và cấp quyền theo từng nhà.');
 const users=await api('users');
 content.innerHTML=`<section class="panel"><h2>Thêm nhân sự</h2><form id="createUser" class="form"><label>Email đăng nhập<input type="email" name="email" required autocomplete="off"></label><label>Mật khẩu ban đầu (tối thiểu 12 ký tự)<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><label>Vai trò<select name="role"><option value="MANAGER">Quản lý tòa</option><option value="ACCOUNTANT">Kế toán</option><option value="COLLECTOR">Người thu</option><option value="VIEWER">Chỉ xem</option></select></label><fieldset class="buildings-field"><legend>Nhà được truy cập</legend>${buildings.map(x=>`<label><input type="checkbox" name="access" value="${x.id}"> ${esc(x.code)}</label>`).join('')}</fieldset><button class="primary">Tạo tài khoản</button></form></section><section class="panel"><div class="panel-title"><h2>Danh sách tài khoản</h2><span class="muted">${users.length} tài khoản</span></div>${table(['Email','Vai trò'],users.map(x=>`<tr><td>${esc(x.email)}</td><td>${esc(x.role)}</td></tr>`))}</section>`;
 content.querySelector('#createUser').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const data=new FormData(form);
  const buildingIds=data.getAll('access').map(Number);
  if(!buildingIds.length){notice('Chọn tối thiểu một tòa nhà cho nhân sự.');return;}
  try{await post('users',{email:data.get('email'),password:data.get('password'),role:data.get('role'),buildingIds});notice('Đã tạo tài khoản.');await renderUserManagement({api,post,heading,content,table,buildings,esc,notice});}catch(e){notice(e.message);}
 });
}

export async function renderRoomsSpreadsheet({api,post,heading,content,table,buildings,bid,month,user,esc,money,notice,render,action}){
  const b=buildings.find(x=>x.id===bid());
  heading('Danh sách phòng','Thông tin phòng và bảng tính chi phí thu tiền theo tháng.');
  const sheetData=await api(`rooms/sheet?buildingId=${bid()}&month=${encodeURIComponent(month())}`);
  const rooms=sheetData.rows||[];
  const isLocked=Boolean(sheetData.locked);
  const canEdit=!isLocked&&['SUPER_ADMIN','MANAGER','ACCOUNTANT'].includes(user.role);

  const fmtNum=n=>(n!=null&&n!==''?Number(n).toLocaleString('vi-VN'):'0');
  const parseNum=s=>{const n=parseInt(String(s||'').replace(/[^\d-]/g,''),10);return isNaN(n)?0:n;};

  const tbodyHtml=rooms.length?rooms.map((r,idx)=>`
    <tr data-room-id="${r.id}" data-row-index="${idx}">
      <td class="sticky-col"><b>${esc(r.code)}</b>${r.tenant?`<br><small class="muted">${esc(r.tenant)}</small>`:''}</td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="1" data-field="rent" value="${fmtNum(r.rent)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="2" data-field="occupants" value="${fmtNum(r.occupants)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="3" data-field="previousElectric" value="${fmtNum(r.previousElectric)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="4" data-field="currentElectric" value="${fmtNum(r.currentElectric)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="5" data-field="electricRate" value="${fmtNum(r.electricRate)}" /></td>
      <td class="sheet-calc" data-col="6"><span class="calc-val">0</span></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="7" data-field="previousWater" value="${fmtNum(r.previousWater)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="8" data-field="currentWater" value="${fmtNum(r.currentWater)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="9" data-field="waterRate" value="${fmtNum(r.waterRate)}" /></td>
      <td class="sheet-calc" data-col="10"><span class="calc-val">0</span></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="11" data-field="internetRate" value="${fmtNum(r.internetRate)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="12" data-field="serviceRate" value="${fmtNum(r.serviceRate)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="13" data-field="evChargingCount" value="${fmtNum(r.evChargingCount)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="14" data-field="evChargingRate" value="${fmtNum(r.evChargingRate)}" /></td>
      <td class="sheet-calc" data-col="15"><span class="calc-val">0</span></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="16" data-field="parkingCount" value="${fmtNum(r.parkingCount)}" /></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="17" data-field="parkingRate" value="${fmtNum(r.parkingRate)}" /></td>
      <td class="sheet-calc" data-col="18"><span class="calc-val">0</span></td>
      <td><input class="sheet-cell" ${!canEdit?'disabled':''} data-col="19" data-field="extras" value="${fmtNum(r.extras)}" /></td>
      <td class="sheet-calc cell-total" data-col="20"><b class="calc-val">0</b></td>
    </tr>`).join('')
    :`<tr><td colspan="21" class="empty">Chưa có phòng nào trong tòa nhà này. Hãy nhấn "+ Tạo phòng" để bắt đầu.</td></tr>`;

  content.innerHTML=`
  ${['SUPER_ADMIN','MANAGER'].includes(user.role)?`
  <div class="action-bar" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <button type="button" class="primary" id="toggleRoomBtn">+ Tạo phòng</button>
    ${canEdit?`<button type="button" class="primary" id="saveSheetBtn">💾 Lưu bảng tính</button>`:''}
    <span class="sheet-save-badge" id="sheetSaveStatus"><span style="color:#10b981">✓ Đã lưu tất cả</span></span>
    ${isLocked?`<span class="tag PARTIAL">Kỳ ${esc(month())} đã khóa (Chỉ xem)</span>`:''}
  </div>
  <div class="panel" id="roomFormContainer" hidden>
    <div class="panel-title">
      <h2>Thêm phòng vào ${esc(b?.code||'')}</h2>
      <button type="button" class="secondary" id="closeRoomBtn">Đóng</button>
    </div>
    <form id="addRoom" class="form">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label>Số phòng<input name="code" placeholder="201" required></label>
        <label>Tiền phòng (VND)<input name="rent" type="number" min="0" required></label>
      </div>
      <label>Khách thuê<input name="tenant" placeholder="Họ và tên khách thuê"></label>

      <fieldset style="border:1px solid #e0e0e0;padding:12px;border-radius:6px;margin-top:8px">
        <legend><b>1. Tiền điện</b></legend>
        <label><input type="checkbox" name="electricEnabled" checked> Dùng điện</label>
        <label>Đơn giá điện riêng (VND/kWh, để trống dùng giá tòa: ${money(b?.electric_rate||3800)})<input name="electricRate" type="number" min="0" placeholder="${b?.electric_rate||3800}"></label>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:12px;border-radius:6px;margin-top:8px">
        <legend><b>2. Tiền nước</b></legend>
        <label><input type="checkbox" name="waterEnabled" checked> Dùng nước</label>
        <label>Đơn giá nước riêng (VND/m³, để trống dùng giá tòa: ${money(b?.water_rate||0)})<input name="waterRate" type="number" min="0" placeholder="${b?.water_rate||0}"></label>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:12px;border-radius:6px;margin-top:8px">
        <legend><b>3. Tiền mạng (Internet)</b></legend>
        <label><input type="checkbox" name="internetEnabled" checked> Dùng mạng Internet</label>
        <label>Đơn giá mạng (VND/phòng)<input name="internetRate" type="number" min="0" value="0" placeholder="100000"></label>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:12px;border-radius:6px;margin-top:8px">
        <legend><b>4. Phí dịch vụ (theo số người)</b></legend>
        <label><input type="checkbox" name="serviceEnabled" checked> Dùng dịch vụ</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label>Số người<input name="serviceCount" type="number" min="0" value="0" placeholder="1"></label>
          <label>Đơn giá DV (VND/người)<input name="serviceRate" type="number" min="0" value="0" placeholder="150000"></label>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button type="button" class="secondary btn-sm" id="roomQuickService150">150.000đ</button>
          <button type="button" class="secondary btn-sm" id="roomQuickService170">170.000đ</button>
        </div>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:12px;border-radius:6px;margin-top:8px">
        <legend><b>5. Phí gửi xe</b></legend>
        <label><input type="checkbox" name="parkingEnabled" checked> Gửi xe</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label>Số lượng xe<input name="parkingCount" type="number" min="0" value="0" placeholder="1"></label>
          <label>Đơn giá gửi xe (VND/xe)<input name="parkingRate" type="number" min="0" value="0" placeholder="100000"></label>
        </div>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:12px;border-radius:6px;margin-top:8px">
        <legend><b>6. Phí sạc xe điện</b></legend>
        <label><input type="checkbox" name="evChargingEnabled"> Sạc xe điện</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label>Số xe điện<input name="evChargingCount" type="number" min="0" value="0"></label>
          <label>Đơn giá sạc (VND/xe điện)<input name="evChargingRate" type="number" min="0" value="0" placeholder="100000"></label>
        </div>
      </fieldset>

      <button class="primary" style="margin-top:12px">+ Tạo phòng</button>
    </form>
  </div>`:''}

  <div class="panel spreadsheet-panel">
    <div class="panel-title">
      <div>
        <h2>Phòng đang quản lý</h2>
        <span class="muted">${rooms.length} phòng · Trang tính kỳ ${esc(month())}</span>
      </div>
      <div>
        <small class="muted">Enter / Mũi tên để di chuyển ô · Tự động tính & đồng bộ</small>
      </div>
    </div>
    <div class="spreadsheet-wrap">
      <table class="spreadsheet-table" id="roomSpreadsheet">
        <thead>
          <tr>
            <th class="sticky-col">Phòng</th>
            <th>[1] Giá thuê</th>
            <th>[2] Số người ở</th>
            <th>[3] Số điện cũ</th>
            <th>[4] Số điện mới</th>
            <th>[5] Đơn giá (Điện)</th>
            <th>[6] Thành tiền (Điện)</th>
            <th>[7] Số nước cũ</th>
            <th>[8] Số nước mới</th>
            <th>[9] Đơn giá (Nước)</th>
            <th>[10] Thành tiền (Nước)</th>
            <th>[11] Tiền mạng</th>
            <th>[12] Phí dịch vụ</th>
            <th>[13] Số xe sạc</th>
            <th>[14] Đơn giá (Sạc xe)</th>
            <th>[15] Thành tiền (Sạc xe)</th>
            <th>[16] Xe thứ 3</th>
            <th>[17] Đơn giá (Xe thứ 3)</th>
            <th>[18] Thành tiền (Xe thứ 3)</th>
            <th>[19] Phát sinh</th>
            <th>[20] Tổng tiền</th>
          </tr>
          <tr class="summary-header-row">
            <th class="sticky-col"><b>TỔNG CỘNG</b></th>
            <th class="num" id="sumCol1">0</th>
            <th class="num" id="sumCol2">0</th>
            <th class="num" id="sumCol3">0</th>
            <th class="num" id="sumCol4">0</th>
            <th class="num" id="sumCol5" style="text-align:center">—</th>
            <th class="num" id="sumCol6">0</th>
            <th class="num" id="sumCol7">0</th>
            <th class="num" id="sumCol8">0</th>
            <th class="num" id="sumCol9" style="text-align:center">—</th>
            <th class="num" id="sumCol10">0</th>
            <th class="num" id="sumCol11">0</th>
            <th class="num" id="sumCol12" style="text-align:center">—</th>
            <th class="num" id="sumCol13">0</th>
            <th class="num" id="sumCol14" style="text-align:center">—</th>
            <th class="num" id="sumCol15">0</th>
            <th class="num" id="sumCol16">0</th>
            <th class="num" id="sumCol17" style="text-align:center">—</th>
            <th class="num" id="sumCol18">0</th>
            <th class="num" id="sumCol19">0</th>
            <th class="num sum-total" id="sumCol20">0</th>
          </tr>
        </thead>
        <tbody>
          ${tbodyHtml}
        </tbody>
      </table>
    </div>
  </div>`;

  const sheetTable=document.getElementById('roomSpreadsheet');

  function calcRow(tr){
    const getVal=col=>{
      const inp=tr.querySelector(`input[data-col="${col}"]`);
      if(!inp)return 0;
      return parseNum(inp.value);
    };
    const setCalc=(col,val)=>{
      const cell=tr.querySelector(`td[data-col="${col}"] .calc-val`);
      if(cell)cell.textContent=(val||0).toLocaleString('vi-VN');
      tr.dataset[`c${col}`]=val||0;
    };

    const c1=getVal(1);
    const c2=getVal(2);
    const c3=getVal(3);
    const c4=getVal(4);
    const c5=getVal(5);
    const c6=Math.max(0,c4-c3)*c5;
    setCalc(6,c6);

    const c7=getVal(7);
    const c8=getVal(8);
    const c9=getVal(9);
    const c10=Math.max(0,c8-c7)*c9;
    setCalc(10,c10);

    const c11=getVal(11);
    const c12=getVal(12);
    const c13=getVal(13);
    const c14=getVal(14);
    const c15=c13*c14;
    setCalc(15,c15);

    const c16=getVal(16);
    const c17=getVal(17);
    const c18=c16*c17;
    setCalc(18,c18);

    const c19=getVal(19);
    const c20=c1+c6+c10+c11+(c12*c2)+c15+c18+c19;
    setCalc(20,c20);
  }

  function calcSummary(){
    if(!sheetTable)return;
    const rows=[...sheetTable.querySelectorAll('tbody tr')].filter(r=>r.dataset.roomId);
    const sums={1:0,2:0,3:0,4:0,6:0,7:0,8:0,10:0,11:0,13:0,15:0,16:0,18:0,19:0,20:0};

    for(const tr of rows){
      const getVal=col=>{
        const inp=tr.querySelector(`input[data-col="${col}"]`);
        if(inp)return parseNum(inp.value);
        return Number(tr.dataset[`c${col}`])||0;
      };
      sums[1]+=getVal(1);
      sums[2]+=getVal(2);
      sums[3]+=getVal(3);
      sums[4]+=getVal(4);
      sums[6]+=getVal(6);
      sums[7]+=getVal(7);
      sums[8]+=getVal(8);
      sums[10]+=getVal(10);
      sums[11]+=getVal(11);
      sums[13]+=getVal(13);
      sums[15]+=getVal(15);
      sums[16]+=getVal(16);
      sums[18]+=getVal(18);
      sums[19]+=getVal(19);
      sums[20]+=getVal(20);
    }

    const setSum=(col,val,isMoney=true)=>{
      const el=document.getElementById(`sumCol${col}`);
      if(el)el.textContent=isMoney?money(val):val.toLocaleString('vi-VN');
    };

    setSum(1,sums[1],true);
    setSum(2,sums[2],false);
    setSum(3,sums[3],false);
    setSum(4,sums[4],false);
    setSum(6,sums[6],true);
    setSum(7,sums[7],false);
    setSum(8,sums[8],false);
    setSum(10,sums[10],true);
    setSum(11,sums[11],true);
    setSum(13,sums[13],false);
    setSum(15,sums[15],true);
    setSum(16,sums[16],false);
    setSum(18,sums[18],true);
    setSum(19,sums[19],true);
    setSum(20,sums[20],true);
  }

  // Initial calculation for all rows and header summary
  if(sheetTable){
    sheetTable.querySelectorAll('tbody tr').forEach(tr=>{
      if(tr.dataset.roomId)calcRow(tr);
    });
    calcSummary();
  }

  let saveTimer=null;
  let isDirty=false;

  function setSaveStatus(type,text){
    const el=document.getElementById('sheetSaveStatus');
    if(!el)return;
    if(type==='saved')el.innerHTML=`<span style="color:#10b981">✓ ${text||'Đã lưu tất cả'}</span>`;
    else if(type==='saving')el.innerHTML=`<span style="color:#3b82f6">⏳ ${text||'Đang lưu...'}</span>`;
    else if(type==='dirty')el.innerHTML=`<span style="color:#f59e0b">● ${text||'Có thay đổi chưa lưu'}</span>`;
    else if(type==='error')el.innerHTML=`<span style="color:#ef4444">✕ ${text||'Lỗi lưu dữ liệu'}</span>`;
  }

  async function saveSpreadsheet(showNotice=false){
    if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
    if(!sheetTable)return;
    const trList=[...sheetTable.querySelectorAll('tbody tr')].filter(r=>r.dataset.roomId);
    if(!trList.length)return;

    const payloadRows=trList.map(tr=>{
      const getVal=col=>{
        const inp=tr.querySelector(`input[data-col="${col}"]`);
        return inp?parseNum(inp.value):0;
      };
      return {
        roomId:Number(tr.dataset.roomId),
        rent:getVal(1),
        occupants:getVal(2),
        previousElectric:getVal(3),
        currentElectric:getVal(4),
        electricRate:getVal(5),
        previousWater:getVal(7),
        currentWater:getVal(8),
        waterRate:getVal(9),
        internetRate:getVal(11),
        serviceRate:getVal(12),
        evChargingCount:getVal(13),
        evChargingRate:getVal(14),
        parkingCount:getVal(16),
        parkingRate:getVal(17),
        extras:getVal(19)
      };
    });

    setSaveStatus('saving');
    try{
      await post('rooms/sheet',{buildingId:bid(),month:month(),rows:payloadRows});
      isDirty=false;
      setSaveStatus('saved');
      trList.forEach(tr=>{
        tr.classList.remove('cell-saved');
        void tr.offsetWidth;
        tr.classList.add('cell-saved');
      });
      if(showNotice)notice('Đã lưu toàn bộ bảng tính vào máy chủ thành công.');
    }catch(err){
      setSaveStatus('error',err.message);
      if(showNotice)notice('Lỗi lưu bảng tính: '+err.message);
    }
  }

  function queueAutoSave(){
    isDirty=true;
    setSaveStatus('dirty');
    if(saveTimer)clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      saveSpreadsheet(false);
    },1000);
  }

  if(sheetTable&&canEdit){
    sheetTable.addEventListener('focusin',e=>{
      const input=e.target.closest('.sheet-cell');
      if(!input)return;
      const raw=parseNum(input.value);
      input.value=raw===0?'':String(raw);
      input.select();
    });

    sheetTable.addEventListener('focusout',e=>{
      const input=e.target.closest('.sheet-cell');
      if(!input)return;
      const raw=parseNum(input.value);
      input.value=raw.toLocaleString('vi-VN');
      if(isDirty){
        saveSpreadsheet(false);
      }
    });

    sheetTable.addEventListener('input',e=>{
      const input=e.target.closest('.sheet-cell');
      if(!input)return;
      const tr=input.closest('tr');
      calcRow(tr);
      calcSummary();
      queueAutoSave();
    });

    sheetTable.addEventListener('keydown',e=>{
      const input=e.target.closest('.sheet-cell');
      if(!input)return;
      const tr=input.closest('tr');
      const rowIdx=Number(tr.dataset.rowIndex);
      const colIdx=Number(input.dataset.col);

      if(e.key==='Enter'||e.key==='ArrowDown'){
        e.preventDefault();
        const next=sheetTable.querySelector(`tr[data-row-index="${rowIdx+1}"] input[data-col="${colIdx}"]`);
        if(next){next.focus();next.select();}
      }else if(e.key==='ArrowUp'){
        e.preventDefault();
        const prev=sheetTable.querySelector(`tr[data-row-index="${rowIdx-1}"] input[data-col="${colIdx}"]`);
        if(prev){prev.focus();prev.select();}
      }
    });
  }

  document.getElementById('saveSheetBtn')?.addEventListener('click',()=>{
    saveSpreadsheet(true);
  });

  document.getElementById('toggleRoomBtn')?.addEventListener('click',()=>{
    const c=document.getElementById('roomFormContainer');
    if(c)c.hidden=!c.hidden;
  });
  document.getElementById('closeRoomBtn')?.addEventListener('click',()=>{
    const c=document.getElementById('roomFormContainer');
    if(c)c.hidden=true;
  });
  document.getElementById('roomQuickService150')?.addEventListener('click',()=>{
    const inp=document.querySelector('#addRoom [name="serviceRate"]');
    if(inp)inp.value='150000';
    const cnt=document.querySelector('#addRoom [name="serviceCount"]');
    if(cnt&&Number(cnt.value)===0)cnt.value='1';
  });
  document.getElementById('roomQuickService170')?.addEventListener('click',()=>{
    const inp=document.querySelector('#addRoom [name="serviceRate"]');
    if(inp)inp.value='170000';
    const cnt=document.querySelector('#addRoom [name="serviceCount"]');
    if(cnt&&Number(cnt.value)===0)cnt.value='1';
  });
  document.getElementById('addRoom')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const formEl=e.target;
    const f=formEl.elements;
    const payload={
      buildingId: bid(),
      code: f.code.value.trim(),
      rent: Number(f.rent.value),
      tenant: f.tenant.value.trim(),
      electricEnabled: f.electricEnabled.checked,
      electricRate: f.electricRate.value !== '' ? Number(f.electricRate.value) : null,
      waterEnabled: f.waterEnabled.checked,
      waterRate: f.waterRate.value !== '' ? Number(f.waterRate.value) : null,
      internetEnabled: f.internetEnabled.checked,
      internetRate: Number(f.internetRate.value || 0),
      serviceEnabled: f.serviceEnabled.checked,
      serviceCount: Number(f.serviceCount.value || 0),
      serviceRate: Number(f.serviceRate.value || 0),
      parkingEnabled: f.parkingEnabled.checked,
      parkingCount: Number(f.parkingCount.value || 0),
      parkingRate: Number(f.parkingRate.value || 0),
      evChargingEnabled: f.evChargingEnabled.checked,
      evChargingCount: Number(f.evChargingCount.value || 0),
      evChargingRate: Number(f.evChargingRate.value || 0)
    };
    await action(async()=>{
      await post('rooms', payload);
      await render();
    });
  });
}

