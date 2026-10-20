import {renderCollectorReport,renderReconciliationReport,renderPaymentJournal,renderPeriodControls,renderUserManagement} from './ui-pages.js';
import {renderImportPage} from './import-view.js';
import {openInvoiceEditor} from './edit-invoice.js';
const $=s=>document.querySelector(s),money=n=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(n||0),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aiHost=document.createElement('div');aiHost.innerHTML='<button class="ai-launch" id="aiOpen" hidden>✦ Trợ lý AI</button><section class="ai-panel" id="aiPanel" hidden><div class="ai-head">✦ Trợ lý VINCENT ART <button id="aiClose">✕</button></div><div class="ai-log" id="aiLog"><p>Nhập yêu cầu, ví dụ: “Sửa giá điện nhà A1,A2 lên 4.000đ/kwh”, “Sửa số người A2.504 thành 3”, “Sửa nước mới A4.301 thành 50 tháng 10/2026”, “Sửa điện mới A1.201 thành 130” hoặc “Lấy hóa đơn A4.301”. Nếu không nêu năm, hệ thống dùng năm của kỳ đang chọn. Mỗi thao tác sửa đều cần xác nhận.</p></div><form class="ai-controls" id="aiForm"><input id="aiMessage" placeholder="Nhập yêu cầu bằng tiếng Việt..." required><button class="primary">Gửi</button></form></section>';document.body.append(aiHost);
let pendingAi=null;$('#aiOpen').onclick=()=>$('#aiPanel').hidden=false;$('#aiClose').onclick=()=>$('#aiPanel').hidden=true;
const aiSay=(value)=>{const p=document.createElement('p');p.textContent=value;$('#aiLog').append(p);$('#aiLog').scrollTop=$('#aiLog').scrollHeight;};
async function showInvoice(id){const popup=window.open('','_blank');if(!popup){notice('Trình duyệt đã chặn cửa sổ hóa đơn. Hãy cho phép popup để xem/in.');return;}try{popup.document.write('<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đang tải hóa đơn</title></head><body><p>Đang tải hóa đơn…</p></body></html>');popup.document.close();const inv=await api('invoices/'+id),x=inv.input;const rows=[['Tiền phòng',x.rent],['Điện',`${x.previousElectric} → ${x.currentElectric} × ${money(x.electricRate)}`, (x.currentElectric-x.previousElectric)*x.electricRate],['Nước',`${x.previousWater} → ${x.currentWater} × ${money(x.waterRate)}`,(x.currentWater-x.previousWater)*x.waterRate],['Internet',x.internet],['Vệ sinh',x.cleaning],['Tiền xe',x.parking],['Phụ phí',x.extras],['Giảm trừ',-x.discount]];const body=rows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r.length===3?r[1]:'')}</td><td class="amount">${money(r.length===3?r[2]:r[1])}</td></tr>`).join('');popup.document.open();popup.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Thông báo tiền thuê ${esc(inv.building_code)}.${esc(inv.room_code)}</title><link rel="stylesheet" href="/invoice-print.css"></head><body><div class="actions"><button type="button" id="invoicePrintBtn">In / Lưu PDF</button></div><small>VINCENT ART TÀI CHÍNH · THÔNG BÁO THU TIỀN NỘI BỘ</small><h1>Thông báo tiền thuê nhà</h1><p><b>${esc(inv.building_code)} · Phòng ${esc(inv.room_code)}</b><br>${esc(inv.building_name)} · ${esc(inv.address)}<br>Kỳ ${esc(inv.month)} · Phiên bản ${inv.version}</p><table><thead><tr><th>Khoản mục</th><th>Chỉ số</th><th class="amount">Thành tiền</th></tr></thead><tbody>${body}</tbody></table><p class="total">Tổng phải thu: ${money(inv.total)}</p><p class="total">Đã thu: ${money(inv.paid)} · Còn thiếu: ${money(inv.due)}</p><small>Đây là thông báo thu tiền nội bộ, không phải hóa đơn điện tử hợp lệ về thuế.</small></body></html>`);popup.document.close();popup.document.getElementById('invoicePrintBtn')?.addEventListener('click',()=>popup.print());}catch(error){popup.close();notice(error.message);}}
const aiButton=(label,callback)=>{const btn=document.createElement('button');btn.type='button';btn.className='ai-confirm';btn.textContent=label;btn.onclick=callback;$('#aiLog').append(btn);return btn;};
async function exportAiInvoices(ids){try{aiSay(`Đang tạo ${ids.length} ảnh hóa đơn…`);const {downloadInvoiceImages}=await import('./invoice-images.js');const count=await downloadInvoiceImages(ids,api);aiSay(`Đã tạo tệp ảnh cho ${count} hóa đơn.`);}catch(err){aiSay('Không xuất được ảnh: '+err.message);}}
$('#aiForm').onsubmit=async event=>{
 event.preventDefault();const message=$('#aiMessage').value.trim();if(!message)return;
 $('#aiMessage').value='';$('#aiPending')?.remove();aiSay('Bạn: '+message);
 try{
  const plan=await post('assistant/preview',{message,month:month()});aiSay('Trợ lý: '+plan.reply);
  if(plan.readOnly){
   if(plan.records?.length){for(const row of plan.records.slice(0,30))aiSay('• '+Object.entries(row).map(([key,value])=>`${key}: ${value??'—'}`).join(' | '));if(plan.records.length>30)aiSay(`Đang hiển thị 30/${plan.records.length} kết quả; hãy tìm cụ thể hơn.`);}
   if(plan.invoices?.length){for(const inv of plan.invoices.slice(0,30)){
    aiSay(`Hóa đơn ${inv.building||''}.${inv.room||inv.room_code||''} #${inv.id} • ${inv.month} • Tổng ${money(inv.total)}${inv.paid!==undefined?' • Đã thu '+money(inv.paid):''}`);
    aiButton('Xem / In #'+inv.id,()=>showInvoice(inv.id));
    aiButton('Tải PNG #'+inv.id,()=>exportAiInvoices([inv.id]));
   }
   if(plan.invoices.length>1)aiButton('Tải ZIP ảnh '+plan.invoices.length+' hóa đơn',()=>exportAiInvoices(plan.invoices.map(inv=>inv.id)));
   if(plan.invoices.length>30)aiSay('Chỉ hiển thị 30 hóa đơn đầu; nút ZIP xuất toàn bộ kết quả.');
   }
   if(plan.navigate==='imports')aiButton('Mở trang Import',()=>document.querySelector('[data-page="imports"]')?.click());
   return;
  }
  const previewId=plan.previewId,carryover=!!plan.items?.some(item=>item.impact);
  const div=document.createElement('div');div.id='aiPending';
  div.innerHTML=(carryover?'<label class="carryover-ack"><input type="checkbox" id="carryoverAck"> Tôi xác nhận sẽ đối soát chỉ số kỳ sau. Hóa đơn kỳ sau được giữ nguyên.</label>':'')+'<button class="ai-confirm" id="aiAccept" type="button">Xác nhận thay đổi</button><button class="ai-reject" id="aiReject" type="button">Hủy</button>';
  $('#aiLog').append(div);
  div.querySelector('#aiAccept').onclick=async()=>{
   const acknowledgeCarryover=!!div.querySelector('#carryoverAck')?.checked;
   if(carryover&&!acknowledgeCarryover){aiSay('Cần xác nhận đối soát kỳ sau trước khi lưu.');return;}
   div.querySelector('#aiAccept').disabled=true;
   try{const result=await post('assistant/apply',{previewId,acknowledgeCarryover});div.remove();aiSay('Trợ lý: '+result.reply);await loadBuildings();await render();
    if(result.invoiceId)aiButton('Xem / In hóa đơn vừa sửa',()=>showInvoice(result.invoiceId));
    if(result.invoiceIds?.length)aiButton(result.invoiceIds.length>1?'Tải ZIP ảnh hóa đơn vừa sửa':'Tải PNG hóa đơn vừa sửa',()=>exportAiInvoices(result.invoiceIds));
   }catch(err){aiSay('Lỗi: '+err.message);div.querySelector('#aiAccept').disabled=false;}
  };
  div.querySelector('#aiReject').onclick=()=>{div.remove();aiSay('Đã hủy yêu cầu.');};
 }catch(err){aiSay('Trợ lý: '+err.message);}
};
let user=null,buildings=[],page='dashboard';const period=new Date();$('#monthSelect').value=`${period.getFullYear()}-${String(period.getMonth()+1).padStart(2,'0')}`;
async function api(path,options={}){const r=await fetch('/api/'+path,{headers:{'Content-Type':'application/json'},...options});const data=await r.json();if(!r.ok)throw Error(data.error||'Có lỗi xảy ra');return data;}
const post=(p,data)=>api(p,{method:'POST',body:JSON.stringify(data)});
function notice(message){$('#notice').textContent=message;setTimeout(()=>{if($('#notice').textContent===message)$('#notice').textContent='';},6500)}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
const bid=()=>Number($('#buildingSelect').value),month=()=>$('#monthSelect').value;
const table=(columns,rows)=>`<div class="table-wrap"><table><thead><tr>${columns.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${columns.length}" class="empty">Chưa có dữ liệu. Hãy thêm dữ liệu để bắt đầu.</td></tr>`}</tbody></table></div>`;
const heading=(name,description)=>{$('#title').textContent=name;$('#subtitle').textContent=description;$('#crumb').textContent=name;};
async function loadBuildings(){buildings=await api('buildings');const prior=bid();$('#buildingSelect').innerHTML=buildings.map(b=>`<option value="${b.id}">${esc(b.code)} · ${esc(b.name)}</option>`).join('');if(buildings.some(x=>x.id===prior))$('#buildingSelect').value=prior;}
async function render(){const content=$('#content');content.innerHTML='<div class="panel empty">Đang tải dữ liệu…</div>';const b=buildings.find(x=>x.id===bid());if(!b&&!['buildings','imports'].includes(page)){content.innerHTML='<div class="panel empty">Chưa có tòa nhà. Hãy thêm tòa nhà tại mục Quản lý tòa nhà hoặc nhập Excel A12.</div>';return;}
try{if(page==='dashboard'){
 heading('Tổng quan tài chính','Thống kê toàn bộ tòa nhà bạn có quyền truy cập, đối chiếu trực tiếp từ giao dịch.');
 const [d,summary]=await Promise.all([api(`dashboard?buildingId=${bid()}&month=${month()}`),api(`dashboard/summary?month=${month()}`)]);
 const all=summary.totals;
 const items=[['Tổng phải thu',all.total,'Toàn bộ nhà được phân quyền'],['Đã thu',all.paid,'Tiền đã ghi nhận'],['Công nợ',all.due,'Còn thiếu từ hóa đơn'],['Thu dư',all.overpaid,'Đã thu vượt hóa đơn']];
 const byBuilding=summary.buildings.map(row=>`<tr><td><b>${esc(row.code)}</b></td><td class="num">${row.invoiced}/${row.rooms}</td><td class="num">${money(row.total)}</td><td class="num">${money(row.paid)}</td><td class="num">${money(row.due)}</td><td class="num">${row.complete}</td></tr>`);
 content.innerHTML=`<div class="metrics">${items.map((item,i)=>`<div class="metric ${i===0?'dark':''}"><div class="label">${item[0]}</div><div class="value">${money(item[1])}</div><div class="hint">${item[2]}</div></div>`).join('')}</div>
 <div class="panel"><div class="panel-title"><h2>Toàn hệ thống · Tiến độ từng tòa</h2><span class="muted">${esc(month())} · ${summary.buildings.length} tòa</span></div>${table(['Tòa','Đã có hóa đơn / Phòng','Phải thu','Đã thu','Còn thiếu','Phòng đã đủ'],byBuilding)}<p class="muted">${all.complete} phòng đã đủ · ${all.partial} thu một phần · ${all.unpaid} chưa thu · ${all.invoiced}/${all.rooms} phòng có hóa đơn.</p></div>
 <div class="panel"><div class="panel-title"><h2>Chi tiết tòa đang chọn · ${esc(b.code)}</h2><span class="muted">${esc(month())}</span></div><div class="progress"><div style="width:${d.total?Math.min(100,d.paid/d.total*100):0}%"></div></div><div class="progress-meta"><span>${d.total?Math.round(d.paid/d.total*100):0}% chỉ tiêu · ${money(d.paid)}/${money(d.total)}</span><span>${d.complete} đã đủ · ${d.partial} thu thiếu · ${d.unpaid} chưa thu</span></div></div>
 <div class="panel"><div class="panel-title"><h2>Độ phủ hóa đơn · ${esc(b.code)}</h2><span class="muted">${d.invoiced} / ${d.rooms} phòng đã có hóa đơn</span></div><p class="muted">Các phòng chưa có hóa đơn chưa được tính vào số phải thu. Hãy kiểm tra trước khi chốt báo cáo.</p></div>`;
}
if(page==='reports')await renderCollectorReport({api,heading,month,buildings,content,table,esc,money});
if(page==='reconciliation')await renderReconciliationReport({api,heading,month,bid,buildings,content,table,esc,money});
if(page==='imports')await renderImportPage({post,heading,content,buildings,bid,month,esc,money,notice,refresh:async(buildingId,importedMonth)=>{await loadBuildings();if(buildings.some(b=>b.id===buildingId))$('#buildingSelect').value=String(buildingId);$('#monthSelect').value=importedMonth;await render();}});
if(page==='users')await renderUserManagement({api,post,heading,content,table,buildings,esc,notice});
if(page==='buildings'){heading('Quản lý tòa nhà','Danh mục tòa nhà và đơn giá dịch vụ.');content.innerHTML=`${user.role==='SUPER_ADMIN'?`<div class="panel"><h2>Thêm tòa nhà</h2><form class="form" id="addBuilding"><label>Mã nhà<input name="code" placeholder="A12" required></label><label>Tên tòa nhà<input name="name" placeholder="Tòa A12" required></label><label>Địa chỉ<input name="address"></label><label>Giá điện (VND/kWh)<input name="electricRate" type="number" min="0" value="3800" required></label><label>Giá nước (VND/m³)<input name="waterRate" type="number" min="0" value="0" required></label><button class="primary">+ Lưu tòa nhà</button></form></div>`:''}<div class="panel"><div class="panel-title"><h2>Danh sách tòa nhà</h2><span class="muted">${buildings.length} tòa</span></div>${table(['Mã nhà','Tên','Địa chỉ','Giá điện','Giá nước'],buildings.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td>${esc(x.address)}</td><td>${money(x.electric_rate)}</td><td>${money(x.water_rate)}</td></tr>`))}</div>`;$('#addBuilding')?.addEventListener('submit',async e=>{e.preventDefault();const x=formData(e.target);await action(async()=>{await post('buildings',{...x,electricRate:Number(x.electricRate),waterRate:Number(x.waterRate)});await loadBuildings();await render();});});}
if(page==='rooms'){heading('Danh sách phòng','Thông tin phòng và các khoản phí cố định.');const rooms=await api(`rooms?buildingId=${bid()}`);content.innerHTML=`<div class="panel"><h2>Thêm phòng vào ${esc(b.code)}</h2><form id="addRoom" class="form"><label>Số phòng<input name="code" placeholder="201" required></label><label>Tiền phòng<input name="rent" type="number" min="0" required></label><label>Internet<input name="internet" type="number" min="0" value="0"></label><label>Vệ sinh<input name="cleaning" type="number" min="0" value="0"></label><label>Tiền xe<input name="parking" type="number" min="0" value="0"></label><label>Khách thuê<input name="tenant"></label><button class="primary">+ Tạo phòng</button></form></div><div class="panel"><div class="panel-title"><h2>Phòng đang quản lý</h2><span class="muted">${rooms.length} phòng</span></div>${table(['Phòng','Khách thuê','Giá phòng','Internet','Vệ sinh'],rooms.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.tenant||'—')}</td><td class="num">${money(x.rent)}</td><td class="num">${money(x.internet)}</td><td class="num">${money(x.cleaning)}</td></tr>`))}</div>`;$('#addRoom').addEventListener('submit',async e=>{e.preventDefault();const x=formData(e.target);await action(async()=>{await post('rooms',{buildingId:bid(),...x,rent:Number(x.rent),internet:Number(x.internet),cleaning:Number(x.cleaning),parking:Number(x.parking)});await render();});});}
if(page==='invoices'||page==='payments'){const rooms=await api(`rooms?buildingId=${bid()}`);const invoices=await api(`invoices?buildingId=${bid()}&month=${month()}`);heading(page==='invoices'?'Hóa đơn theo tháng':'Ghi nhận thu tiền',page==='invoices'?'Tạo và đối chiếu hóa đơn từng phòng.':'Lưu từng lần thu tiền, không ghi đè giao dịch trước.');content.innerHTML=`${page==='invoices'?`<div class="panel"><h2>Tạo kỳ và hóa đơn</h2><p class="muted">Nhập đủ điện/nước. Nếu tháng trước đã có hóa đơn, chỉ số mới sẽ tự chuyển thành chỉ số cũ của tháng hiện tại.</p><form id="makeInvoice" class="form"><label>Phòng<select name="roomId">${rooms.map(x=>`<option value="${x.id}">${esc(x.code)}</option>`).join('')}</select></label><label>Điện cũ<input name="previousElectric" type="number" min="0" placeholder="Tự kế thừa"></label><label>Điện mới<input name="currentElectric" type="number" min="0" required></label><label>Nước cũ<input name="previousWater" type="number" min="0" placeholder="Tự kế thừa"></label><label>Nước mới<input name="currentWater" type="number" min="0" required></label><button class="primary">+ Tạo hóa đơn</button></form></div>`:`<div class="panel"><h2>Ghi nhận thanh toán</h2><form class="form" id="makePayment"><label>Hóa đơn<select name="invoiceId">${invoices.map(x=>`<option value="${x.id}">Phòng ${esc(x.room_code)} · Còn ${money(x.due)}</option>`).join('')}</select></label><label>Số tiền (VND)<input name="amount" type="number" min="1" required></label><label>Hình thức<select name="method"><option value="TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option></select></label><label>Mã tham chiếu duy nhất<input name="reference" required placeholder="CK-20261019-001"></label><button class="primary">+ Ghi nhận</button></form></div>`}<div class="panel"><div class="panel-title"><h2>Hóa đơn · ${esc(month())}</h2><span class="muted">${invoices.length} hóa đơn</span></div>${table(['Phòng','Phiên bản','Tổng phải thu','Đã thu','Còn thiếu','Trạng thái','Thao tác'],invoices.map(x=>`<tr><td><b>${esc(x.room_code)}</b></td><td>v${x.version}</td><td class="num">${money(x.total)}</td><td class="num">${money(x.paid)}</td><td class="num">${money(x.due)}</td><td><span class="tag ${x.status}">${{UNPAID:'Chưa thu',PARTIAL:'Thu thiếu',PAID:'Đã đủ',OVERPAID:'Thu dư'}[x.status]}</span></td><td><button class="secondary" data-view="${x.id}">Xem / In</button> <button class="secondary" data-revise="${x.id}">Sửa</button></td></tr>`))}</div>`;
$('#makeInvoice')?.addEventListener('submit',async e=>{e.preventDefault();const x=formData(e.target),input={currentElectric:Number(x.currentElectric),currentWater:Number(x.currentWater)};if(x.previousElectric!=='')input.previousElectric=Number(x.previousElectric);if(x.previousWater!=='')input.previousWater=Number(x.previousWater);await action(async()=>{await post('periods',{buildingId:bid(),month:month()});await post('invoices',{roomId:Number(x.roomId),month:month(),input});await render();});});
$('#makePayment')?.addEventListener('submit',async e=>{e.preventDefault();const x=formData(e.target);await action(async()=>{await post('payments',{invoiceId:Number(x.invoiceId),amount:Number(x.amount),method:x.method,reference:x.reference});await render();});});
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>showInvoice(Number(btn.dataset.view))));
document.querySelectorAll('[data-revise]').forEach(btn=>btn.addEventListener('click',()=>{const invoice=invoices.find(x=>x.id===Number(btn.dataset.revise));openInvoiceEditor({invoice,api,post,refresh:render,notice,esc,money}).catch(error=>notice(error.message));}));
if(page==='payments'||!['SUPER_ADMIN','MANAGER','ACCOUNTANT'].includes(user.role))document.querySelectorAll('[data-revise]').forEach(btn=>btn.hidden=true);
}
if(page==='payments'){
 const periods=await api('periods?buildingId='+bid());
 const locked=periods.some(x=>x.month===month()&&x.locked);
 await renderPaymentJournal({api,post,content,table,esc,money,bid,month,user,locked,render,notice});
 if(locked||user.role==='VIEWER')document.querySelector('#makePayment')?.closest('.panel')?.remove();
 if(locked){const note=document.createElement('p');note.className='muted';note.textContent='Kỳ thu đã khóa. Mở khóa theo quyền và ghi lý do trước khi thu thêm.';content.prepend(note);}
}
if(page==='rooms'&&!['SUPER_ADMIN','MANAGER'].includes(user.role))document.querySelector('#addRoom')?.closest('.panel')?.remove();
if(page==='invoices'){
 const selectedPeriod=await renderPeriodControls({api,post,content,bid,month,user,render,notice});
 const review=await api(`invoices/check?buildingId=${bid()}&month=${month()}`);
 const reviewRows=review.rooms.map(r=>`<tr><td><b>${esc(r.room)}</b></td><td><span class="tag ${r.status==='VALID'?'PAID':r.status==='ERROR'?'UNPAID':'PARTIAL'}">${({VALID:'Hợp lệ',MISSING:'Thiếu hóa đơn',WARNING:'Cảnh báo',ERROR:'Có lỗi'})[r.status]||'Cần kiểm tra'}</span></td><td>${esc([...r.issues,...r.warnings].join('; ')||'Đã khớp dữ liệu')}</td><td>${r.invoiceId?`<button class="secondary" data-view="${r.invoiceId}">Xem / In</button>`:'—'}</td></tr>`);
 const checkPanel=document.createElement('section');checkPanel.className='panel';
 checkPanel.innerHTML=`<div class="panel-title"><h2>Kiểm tra hóa đơn toàn tòa · ${esc(month())}</h2><span class="muted">${review.valid} hợp lệ · ${review.warnings} cảnh báo · ${review.errors} có lỗi · ${review.missing} chưa có hóa đơn</span></div><p class="muted">Đối soát tất cả ${review.rooms.length} phòng, chỉ số điện/nước, đơn giá, tổng phải thu và lịch sử phiên bản. Hóa đơn lỗi phải được sửa; phòng thiếu và cảnh báo cần xác nhận rõ trước khi chốt tháng.</p>${table(['Phòng','Kiểm tra','Kết quả','Thao tác'],reviewRows)}`;
 content.append(checkPanel);
 checkPanel.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>showInvoice(Number(btn.dataset.view))));
 if(selectedPeriod?.locked||!['SUPER_ADMIN','MANAGER','ACCOUNTANT'].includes(user.role)){
  document.querySelector('#makeInvoice')?.closest('.panel')?.remove();
  document.querySelectorAll('[data-revise]').forEach(btn=>btn.hidden=true);
 }
}
if(page==='audit'){heading('Lịch sử hoạt động','Các thao tác được lưu tại máy chủ.');if(user.role!=='SUPER_ADMIN'){content.innerHTML='<div class="panel empty">Chỉ quản trị viên được truy cập.</div>';return}const logs=await api('audit');content.innerHTML=`<div class="panel">${table(['Thời gian','Tài khoản','Hành động','Đối tượng','ID','Lý do'],logs.map(x=>`<tr><td>${esc(x.created_at)}</td><td>${esc(x.email)}</td><td>${esc(x.action)}</td><td>${esc(x.entity)}</td><td>${x.entity_id}</td><td>${esc(x.reason)}</td></tr>`))}</div>`;}
}catch(e){content.innerHTML=`<div class="panel empty">${esc(e.message)}</div>`;}}
async function action(fn){try{await fn();notice('Đã cập nhật dữ liệu thành công.');}catch(e){notice('Lỗi: '+e.message);}}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{page=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b));$('#sidebar').classList.remove('open');render();}));
$('#menu').onclick=()=>$('#sidebar').classList.add('open');$('#closeMenu').onclick=()=>$('#sidebar').classList.remove('open');$('#theme').onclick=()=>document.body.classList.toggle('darkmode');$('#refresh').onclick=()=>render();$('#buildingSelect').onchange=()=>render();$('#monthSelect').onchange=()=>render();$('#logout').onclick=async()=>{await post('logout',{});location.reload();};
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();try{const data=formData(e.target);await post('login',data);await init();}catch(err){$('#loginError').textContent=err.message;}});
let initSequence=0;
async function init(){
 const current=++initSequence;
 try{
  const authenticated=await api('me');
  if(current!==initSequence)return;
  user=authenticated;
  $('#userEmail').textContent=user.email;$('#userRole').textContent=user.role;
  $('#login').hidden=true;$('#shell').hidden=false;$('#aiOpen').hidden=false;
  document.querySelector('[data-page="users"]')?.toggleAttribute('hidden',user.role!=='SUPER_ADMIN');
  document.querySelector('[data-page="audit"]')?.toggleAttribute('hidden',user.role!=='SUPER_ADMIN');
  document.querySelector('[data-page="imports"]')?.toggleAttribute('hidden',!['SUPER_ADMIN','MANAGER','ACCOUNTANT'].includes(user.role));
  await loadBuildings();
  if(current===initSequence)await render();
 }catch(error){
  if(current!==initSequence)return;
  if(user){notice('Không thể tải dữ liệu: '+error.message);return;}
  $('#shell').hidden=true;$('#login').hidden=false;$('#aiOpen').hidden=true;$('#aiPanel').hidden=true;
 }
}
document.documentElement.dataset.appReady='true';
init();
