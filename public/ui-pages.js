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
