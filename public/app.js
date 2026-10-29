import {renderCollectorReport,renderReconciliationReport,renderPaymentJournal,renderPeriodControls,renderUserManagement} from './ui-pages.js';
import {renderImportPage} from './import-view.js';
import {openInvoiceEditor} from './edit-invoice.js';
const $=s=>document.querySelector(s),money=n=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(n||0),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aiHost=document.createElement('div');aiHost.innerHTML='<button class="ai-launch" id="aiOpen" hidden>✦ Trợ lý AI</button><section class="ai-panel" id="aiPanel" hidden><div class="ai-head"><span>✦ Trợ lý VINCENT ART</span><div style="display:flex;align-items:center;gap:4px"><button id="aiConfigToggle" title="Cài đặt AI" type="button" class="ai-head-btn">⚙️</button><button id="aiClose">✕</button></div></div><div class="ai-config-drawer" id="aiConfigDrawer" hidden><div style="font-weight:600;margin-bottom:6px">⚙️ Cấu hình API Trợ lý AI</div><form id="aiConfigForm"><label style="font-size:11px">API Key (Gemini / LLM)<input id="aiCfgKey" type="password" placeholder="Dán API Key"></label><label style="font-size:11px">Model<input id="aiCfgModel" value="gemini-2.5-flash"></label><div style="display:flex;gap:6px;margin-top:8px"><button class="primary" type="submit" style="padding:4px 10px;font-size:11px;min-height:28px">Lưu</button><button type="button" id="aiCfgClose" class="secondary" style="padding:4px 10px;font-size:11px">Đóng</button></div></form></div><div class="ai-log" id="aiLog"><p>Nhập yêu cầu bằng tiếng Việt hoặc chọn lệnh nhanh bên dưới để thao tác nhanh.</p></div><div class="ai-quick-prompts" id="aiQuickPrompts"><button type="button" class="ai-chip" data-cmd="summary">📊 Tổng hợp</button><button type="button" class="ai-chip" data-cmd="debt">💰 Công nợ</button><button type="button" class="ai-chip" data-cmd="missing">⚠️ Chưa có HĐ</button><button type="button" class="ai-chip" data-cmd="high_debt">🔥 Nợ nhiều</button><button type="button" class="ai-chip" data-cmd="electric">⚡ Điện mới</button><button type="button" class="ai-chip" data-cmd="water">💧 Nước mới</button><button type="button" class="ai-chip" data-cmd="help">❓ Trợ giúp</button></div><form class="ai-controls" id="aiForm"><input id="aiMessage" placeholder="Nhập yêu cầu bằng tiếng Việt..." required><button class="primary">Gửi</button></form></section>';document.body.append(aiHost);
let pendingAi=null;$('#aiOpen').onclick=()=>$('#aiPanel').hidden=false;$('#aiClose').onclick=()=>$('#aiPanel').hidden=true;
$('#aiConfigToggle').onclick=async()=>{const d=$('#aiConfigDrawer');d.hidden=!d.hidden;if(!d.hidden){try{const cfg=await api('settings/ai');if(cfg.maskedKey)$('#aiCfgKey').placeholder=`Đã lưu (${cfg.maskedKey})`;if(cfg.model)$('#aiCfgModel').value=cfg.model;}catch(_){}}};
$('#aiCfgClose').onclick=()=>{$('#aiConfigDrawer').hidden=true;};
$('#aiConfigForm').onsubmit=async(e)=>{e.preventDefault();try{await post('settings/ai',{key:$('#aiCfgKey').value.trim(),model:$('#aiCfgModel').value.trim()});$('#aiConfigDrawer').hidden=true;aiSay('Trợ lý: Đã lưu cấu hình AI thành công.');}catch(err){aiSay('Lỗi: '+err.message);}};
document.addEventListener('click',e=>{const chip=e.target.closest('.ai-chip');if(!chip)return;const cmd=chip.dataset.cmd;const b=buildings.find(x=>x.id===bid());const bCode=b?b.code:'A1';const m=month();let txt='';if(cmd==='summary')txt=`Tổng hợp tài chính nhà ${bCode} tháng ${m}`;else if(cmd==='debt')txt=`Tìm công nợ nhà ${bCode} tháng ${m}`;else if(cmd==='missing')txt=`Phòng nào chưa có hóa đơn nhà ${bCode} tháng ${m}`;else if(cmd==='high_debt')txt=`Phòng nào nợ nhiều nhất nhà ${bCode} tháng ${m}`;else if(cmd==='electric')txt=`Nhập điện mới nhà ${bCode}: `;else if(cmd==='water')txt=`Nhập nước mới nhà ${bCode}: `;else if(cmd==='help')txt=`Hướng dẫn AI`;const inp=$('#aiMessage');if(inp){inp.value=txt;inp.focus();if(['summary','debt','missing','high_debt','help'].includes(cmd))$('#aiForm')?.requestSubmit();}});
const aiSay=(value)=>{const p=document.createElement('p');p.textContent=value;$('#aiLog').append(p);$('#aiLog').scrollTop=$('#aiLog').scrollHeight;};
async function showInvoice(id){const popup=window.open('','_blank');if(!popup){notice('Trình duyệt đã chặn cửa sổ hóa đơn. Hãy cho phép popup để xem/in.');return;}try{popup.document.write('<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đang tải hóa đơn</title></head><body><p>Đang tải hóa đơn…</p></body></html>');popup.document.close();const inv=await api('invoices/'+id),x=inv.input;
const elOn=x.electricEnabled!==false;
const wtOn=x.waterEnabled!==false;
const netOn=x.internetEnabled!==false;
const srvOn=x.serviceEnabled!==false;
const pkOn=x.parkingEnabled!==false;
const evOn=!!x.evChargingEnabled;
const elAmount=elOn&&x.currentElectric!=null&&x.previousElectric!=null?(x.currentElectric-x.previousElectric)*(x.electricRate||0):0;
const wtAmount=wtOn&&x.currentWater!=null&&x.previousWater!=null?(x.currentWater-x.previousWater)*(x.waterRate||0):0;
const netRate=x.internetRate??x.internet??0;
const netAmount=netOn?netRate:0;
const srvCount=x.serviceCount??x.occupants??1;
const srvRate=x.serviceRate??(x.cleaning?Math.round(x.cleaning/srvCount):150000);
const srvAmount=srvOn?(x.serviceRate!==undefined||x.serviceCount!==undefined?srvCount*srvRate:(x.cleaning??0)):0;
const pkCount=x.parkingCount??(x.parking?1:0);
const pkRate=x.parkingRate??(x.parking||100000);
const pkAmount=pkOn?(x.parkingRate!==undefined||x.parkingCount!==undefined?pkCount*pkRate:(x.parking??0)):0;
const evCount=x.evChargingCount??0;
const evRate=x.evChargingRate??100000;
const evAmount=evOn?evCount*evRate:0;
const rows=[
  ['Tiền phòng','',x.rent],
  ['Điện',elOn?`${x.previousElectric} → ${x.currentElectric} × ${money(x.electricRate)}`:'Không dùng',elAmount],
  ['Nước',wtOn?`${x.previousWater} → ${x.currentWater} × ${money(x.waterRate)}`:'Không dùng',wtAmount],
  ['Internet',netOn?`1 phòng × ${money(netRate)}`:'Không dùng',netAmount],
  ['Phí dịch vụ',srvOn?`${srvCount} người × ${money(srvRate)}`:'Không dùng',srvAmount],
  ['Phí gửi xe',pkOn?`${pkCount} xe × ${money(pkRate)}`:'Không dùng',pkAmount],
  ['Phí sạc xe điện',evOn?`${evCount} xe điện × ${money(evRate)}`:'Không dùng',evAmount],
  ['Phụ phí','',x.extras||0],
  ['Giảm trừ','',-(x.discount||0)]
];
const body=rows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="amount">${money(r[2])}</td></tr>`).join('');popup.document.open();popup.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Thông báo tiền thuê ${esc(inv.building_code)}.${esc(inv.room_code)}</title><link rel="stylesheet" href="/invoice-print.css"></head><body><div class="actions"><button type="button" id="invoicePrintBtn">In / Lưu PDF</button></div><small>VINCENT ART TÀI CHÍNH · THÔNG BÁO THU TIỀN NỘI BỘ</small><h1>Thông báo tiền thuê nhà</h1><p><b>${esc(inv.building_code)} · Phòng ${esc(inv.room_code)}</b><br>${esc(inv.building_name)} · ${esc(inv.address)}<br>Kỳ ${esc(inv.month)} · Phiên bản ${inv.version}</p><table><thead><tr><th>Khoản mục</th><th>Chỉ số</th><th class="amount">Thành tiền</th></tr></thead><tbody>${body}</tbody></table><p class="total">Tổng phải thu: ${money(inv.total)}</p><p class="total">Đã thu: ${money(inv.paid)} · Còn thiếu: ${money(inv.due)}</p><small>Đây là thông báo thu tiền nội bộ, không phải hóa đơn điện tử hợp lệ về thuế.</small></body></html>`);popup.document.close();popup.document.getElementById('invoicePrintBtn')?.addEventListener('click',()=>popup.print());}catch(error){popup.close();notice(error.message);}}
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
const del=(p,data={})=>api(p,{method:'DELETE',body:JSON.stringify(data)});
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
 let insightsHtml='';
 try{
  const ins=await api(`assistant/insights?buildingId=${bid()}&month=${month()}`);
  if(ins.missingInvoices.length>0||ins.highDebts.length>0){
   insightsHtml=`<div class="panel" style="border-left:4px solid #171717"><div class="panel-title"><h2>✦ Nhắc nhở thông minh AI · ${esc(b.code)}</h2><button type="button" class="secondary" style="font-size:11px;padding:3px 8px" onclick="document.querySelector('#aiOpen')?.click()">Mở Trợ lý AI</button></div><div style="display:flex;flex-direction:column;gap:8px">${ins.missingInvoices.length>0?`<div style="display:flex;align-items:center;gap:8px"><span>⚠️</span><span>Còn <b>${ins.missingInvoices.length}</b> phòng chưa có hóa đơn (${esc(ins.missingInvoices.slice(0,6).join(', '))}${ins.missingInvoices.length>6?'…':''}).</span></div>`:''}${ins.highDebts.length>0?`<div style="display:flex;align-items:center;gap:8px"><span>🔥</span><span><b>${ins.highDebts.length}</b> phòng nợ nhiều nhất (Tổng nợ: ${money(ins.totalDue)}). Phòng nợ cao nhất: P.${esc(ins.highDebts[0].room)} (${money(ins.highDebts[0].due)}).</span></div>`:''}</div></div>`;
  }
 }catch(_){}
 content.innerHTML=`<div class="metrics">${items.map((item,i)=>`<div class="metric ${i===0?'dark':''}"><div class="label">${item[0]}</div><div class="value">${money(item[1])}</div><div class="hint">${item[2]}</div></div>`).join('')}</div>
 ${insightsHtml}
 <div class="panel"><div class="panel-title"><h2>Toàn hệ thống · Tiến độ từng tòa</h2><span class="muted">${esc(month())} · ${summary.buildings.length} tòa</span></div>${table(['Tòa','Đã có hóa đơn / Phòng','Phải thu','Đã thu','Còn thiếu','Phòng đã đủ'],byBuilding)}<p class="muted">${all.complete} phòng đã đủ · ${all.partial} thu một phần · ${all.unpaid} chưa thu · ${all.invoiced}/${all.rooms} phòng có hóa đơn.</p></div>
 <div class="panel"><div class="panel-title"><h2>Chi tiết tòa đang chọn · ${esc(b.code)}</h2><span class="muted">${esc(month())}</span></div><div class="progress"><div style="width:${d.total?Math.min(100,d.paid/d.total*100):0}%"></div></div><div class="progress-meta"><span>${d.total?Math.round(d.paid/d.total*100):0}% chỉ tiêu · ${money(d.paid)}/${money(d.total)}</span><span>${d.complete} đã đủ · ${d.partial} thu thiếu · ${d.unpaid} chưa thu</span></div></div>
 <div class="panel"><div class="panel-title"><h2>Độ phủ hóa đơn · ${esc(b.code)}</h2><span class="muted">${d.invoiced} / ${d.rooms} phòng đã có hóa đơn</span></div><p class="muted">Các phòng chưa có hóa đơn chưa được tính vào số phải thu. Hãy kiểm tra trước khi chốt báo cáo.</p></div>`;
}
if(page==='reports')await renderCollectorReport({api,heading,month,buildings,content,table,esc,money});
if(page==='reconciliation')await renderReconciliationReport({api,heading,month,bid,buildings,content,table,esc,money});
if(page==='imports')await renderImportPage({post,heading,content,buildings,bid,month,esc,money,notice,refresh:async(buildingId,importedMonth)=>{await loadBuildings();if(buildings.some(b=>b.id===buildingId))$('#buildingSelect').value=String(buildingId);$('#monthSelect').value=importedMonth;await render();}});
if(page==='users')await renderUserManagement({api,post,heading,content,table,buildings,esc,notice});
if(page==='buildings'){
  heading('Quản lý tòa nhà','Danh mục tòa nhà và đơn giá dịch vụ.');
  content.innerHTML=`
  ${user.role==='SUPER_ADMIN'?`
  <div class="action-bar" style="margin-bottom:16px">
    <button type="button" class="primary" id="toggleBuildingBtn">+ Tạo tòa nhà</button>
  </div>
  <div class="panel" id="buildingFormContainer" hidden>
    <div class="panel-title">
      <h2>Thêm tòa nhà</h2>
      <button type="button" class="secondary" id="closeBuildingBtn">Đóng</button>
    </div>
    <form class="form" id="addBuilding">
      <label>Mã nhà<input name="code" placeholder="A12" required></label>
      <label>Tên tòa nhà<input name="name" placeholder="Tòa A12" required></label>
      <label>Địa chỉ<input name="address"></label>
      <label>Giá điện (VND/kWh)<input name="electricRate" type="number" min="0" value="3800" required></label>
      <label>Giá nước (VND/m³)<input name="waterRate" type="number" min="0" value="0" required></label>
      <button class="primary">+ Lưu tòa nhà</button>
    </form>
  </div>`:''}
  <div class="panel"><div class="panel-title"><h2>Danh sách tòa nhà</h2><span class="muted">${buildings.length} tòa</span></div>${table(['Mã nhà','Tên','Địa chỉ','Giá điện','Giá nước'],buildings.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td>${esc(x.address)}</td><td>${money(x.electric_rate)}</td><td>${money(x.water_rate)}</td></tr>`))}</div>`;

  $('#toggleBuildingBtn')?.addEventListener('click',()=>{
    const c=$('#buildingFormContainer');
    if(c)c.hidden=!c.hidden;
  });
  $('#closeBuildingBtn')?.addEventListener('click',()=>{
    const c=$('#buildingFormContainer');
    if(c)c.hidden=true;
  });
  $('#addBuilding')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const x=formData(e.target);
    await action(async()=>{
      await post('buildings',{...x,electricRate:Number(x.electricRate),waterRate:Number(x.waterRate)});
      await loadBuildings();
      await render();
    });
  });
}
if(page==='rooms'){
  heading('Danh sách phòng','Thông tin phòng và các khoản phí cố định.');
  const rooms=await api(`rooms?buildingId=${bid()}`);
  content.innerHTML=`
  ${['SUPER_ADMIN','MANAGER'].includes(user.role)?`
  <div class="action-bar" style="margin-bottom:16px">
    <button type="button" class="primary" id="toggleRoomBtn">+ Tạo phòng</button>
  </div>
  <div class="panel" id="roomFormContainer" hidden>
    <div class="panel-title">
      <h2>Thêm phòng vào ${esc(b.code)}</h2>
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
        <label>Đơn giá điện riêng (VND/kWh, để trống dùng giá tòa: ${money(b.electric_rate)})<input name="electricRate" type="number" min="0" placeholder="${b.electric_rate}"></label>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:12px;border-radius:6px;margin-top:8px">
        <legend><b>2. Tiền nước</b></legend>
        <label><input type="checkbox" name="waterEnabled" checked> Dùng nước</label>
        <label>Đơn giá nước riêng (VND/m³, để trống dùng giá tòa: ${money(b.water_rate)})<input name="waterRate" type="number" min="0" placeholder="${b.water_rate}"></label>
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
  <div class="panel">
    <div class="panel-title"><h2>Phòng đang quản lý</h2><span class="muted">${rooms.length} phòng</span></div>
    ${table(['Phòng','Khách thuê','Giá phòng','Internet','Vệ sinh'],rooms.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.tenant||'—')}</td><td class="num">${money(x.rent)}</td><td class="num">${money(x.internet_rate??x.internet)}</td><td class="num">${money((x.service_count??1)*(x.service_rate??x.cleaning??0))}</td></tr>`))}
  </div>`;

  $('#toggleRoomBtn')?.addEventListener('click',()=>{
    const c=$('#roomFormContainer');
    if(c)c.hidden=!c.hidden;
  });
  $('#closeRoomBtn')?.addEventListener('click',()=>{
    const c=$('#roomFormContainer');
    if(c)c.hidden=true;
  });
  $('#roomQuickService150')?.addEventListener('click',()=>{
    const inp=document.querySelector('#addRoom [name="serviceRate"]');
    if(inp)inp.value='150000';
    const cnt=document.querySelector('#addRoom [name="serviceCount"]');
    if(cnt&&Number(cnt.value)===0)cnt.value='1';
  });
  $('#roomQuickService170')?.addEventListener('click',()=>{
    const inp=document.querySelector('#addRoom [name="serviceRate"]');
    if(inp)inp.value='170000';
    const cnt=document.querySelector('#addRoom [name="serviceCount"]');
    if(cnt&&Number(cnt.value)===0)cnt.value='1';
  });
  $('#addRoom')?.addEventListener('submit',async e=>{
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
if(page==='invoices'||page==='payments'){
  const rooms=await api(`rooms?buildingId=${bid()}`);
  const invoices=await api(`invoices?buildingId=${bid()}&month=${month()}`);
  heading(page==='invoices'?'Hóa đơn theo tháng':'Ghi nhận thu tiền',page==='invoices'?'Tạo và đối chiếu hóa đơn từng phòng.':'Lưu từng lần thu tiền, không ghi đè giao dịch trước.');
  content.innerHTML=`
  ${page==='invoices'?`
  <div class="action-bar" style="margin-bottom:16px">
    <button type="button" class="primary" id="toggleInvoiceBtn">+ Tạo hóa đơn</button>
  </div>
  <div class="panel" id="invoiceFormContainer" hidden>
    <div class="panel-title">
      <h2>Tạo kỳ và hóa đơn</h2>
      <button type="button" class="secondary" id="closeInvoiceBtn">Đóng</button>
    </div>
    <p class="muted">Nhập đủ điện/nước. Tự động lấy cấu hình bật/tắt, số lượng và đơn giá mặc định của phòng được chọn.</p>
    <form id="makeInvoice" class="form">
      <label>Phòng
        <select name="roomId" id="invoiceRoomSelect">
          ${rooms.map(x=>`<option value="${x.id}">${esc(x.code)}</option>`).join('')}
        </select>
      </label>
      <div id="invoiceRoomConfig"></div>
      <button class="primary" style="margin-top:12px">+ Tạo hóa đơn</button>
    </form>
  </div>`:
  `<div class="panel"><h2>Ghi nhận thanh toán</h2><form class="form" id="makePayment"><label>Hóa đơn<select name="invoiceId">${invoices.map(x=>`<option value="${x.id}">Phòng ${esc(x.room_code)} · Còn ${money(x.due)}</option>`).join('')}</select></label><label>Số tiền (VND)<input name="amount" type="number" min="1" required></label><label>Hình thức<select name="method"><option value="TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option></select></label><label>Mã tham chiếu duy nhất<input name="reference" required placeholder="CK-20261019-001"></label><button class="primary">+ Ghi nhận</button></form></div>`}
  <div class="panel">
    <div class="panel-title"><h2>Hóa đơn · ${esc(month())}</h2><span class="muted">${invoices.length} hóa đơn</span></div>
    ${table(['Phòng','Phiên bản','Tổng phải thu','Đã thu','Còn thiếu','Trạng thái','Thao tác'],invoices.map(x=>`<tr><td><b>${esc(x.room_code)}</b></td><td>v${x.version}</td><td class="num">${money(x.total)}</td><td class="num">${money(x.paid)}</td><td class="num">${money(x.due)}</td><td><span class="tag ${x.status}">${{UNPAID:'Chưa thu',PARTIAL:'Thu thiếu',PAID:'Đã đủ',OVERPAID:'Thu dư'}[x.status]}</span></td><td><button class="secondary" data-view="${x.id}">Xem / In</button> <button class="secondary" data-revise="${x.id}">Sửa</button> <button class="secondary danger" data-delete="${x.id}">Xóa</button></td></tr>`))}
  </div>`;

  if(page==='invoices'){
    $('#toggleInvoiceBtn')?.addEventListener('click',()=>{
      const c=$('#invoiceFormContainer');
      if(c)c.hidden=!c.hidden;
    });
    $('#closeInvoiceBtn')?.addEventListener('click',()=>{
      const c=$('#invoiceFormContainer');
      if(c)c.hidden=true;
    });

    function updateInvoiceRoomConfig(){
      const rid=Number($('#invoiceRoomSelect')?.value);
      const r=rooms.find(x=>x.id===rid);
      if(!r)return;
      const cfg=$('#invoiceRoomConfig');
      if(!cfg)return;
      cfg.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <label>Tiền phòng (VND)
          <input name="rent" type="number" min="0" value="${esc(r.rent)}" required>
        </label>
      </div>

      <fieldset style="border:1px solid #e0e0e0;padding:10px;border-radius:6px;margin-bottom:10px">
        <legend style="font-weight:600">1. Tiền điện</legend>
        <label style="font-size:12px"><input type="checkbox" name="electricEnabled" ${r.electric_enabled!==0?'checked':''}> Dùng điện</label>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:6px">
          <label>Điện cũ<input name="previousElectric" type="number" step="0.001" min="0" placeholder="Tự kế thừa"></label>
          <label>Điện mới<input name="currentElectric" type="number" step="0.001" min="0" required></label>
          <label>Đơn giá (đ/kWh)<input name="electricRate" type="number" min="0" value="${esc(r.electric_rate??b.electric_rate)}"></label>
        </div>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:10px;border-radius:6px;margin-bottom:10px">
        <legend style="font-weight:600">2. Tiền nước</legend>
        <label style="font-size:12px"><input type="checkbox" name="waterEnabled" ${r.water_enabled!==0?'checked':''}> Dùng nước</label>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:6px">
          <label>Nước cũ<input name="previousWater" type="number" step="0.001" min="0" placeholder="Tự kế thừa"></label>
          <label>Nước mới<input name="currentWater" type="number" step="0.001" min="0" required></label>
          <label>Đơn giá (đ/m³)<input name="waterRate" type="number" min="0" value="${esc(r.water_rate??b.water_rate)}"></label>
        </div>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:10px;border-radius:6px;margin-bottom:10px">
        <legend style="font-weight:600">3. Tiền mạng (Internet)</legend>
        <label style="font-size:12px"><input type="checkbox" name="internetEnabled" ${r.internet_enabled!==0?'checked':''}> Dùng Internet</label>
        <label style="margin-top:6px">Đơn giá mạng (VND/phòng)<input name="internetRate" type="number" min="0" value="${esc(r.internet_rate??r.internet??0)}"></label>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:10px;border-radius:6px;margin-bottom:10px">
        <legend style="font-weight:600">4. Phí dịch vụ</legend>
        <label style="font-size:12px"><input type="checkbox" name="serviceEnabled" ${r.service_enabled!==0?'checked':''}> Dùng dịch vụ</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
          <label>Số người<input name="serviceCount" type="number" min="0" value="${esc(r.service_count??(r.occupants>0?r.occupants:1))}"></label>
          <label>Đơn giá (đ/người)<input name="serviceRate" type="number" min="0" value="${esc(r.service_rate??150000)}"></label>
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button type="button" class="secondary btn-sm" id="invQuickService150">150.000đ</button>
          <button type="button" class="secondary btn-sm" id="invQuickService170">170.000đ</button>
        </div>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:10px;border-radius:6px;margin-bottom:10px">
        <legend style="font-weight:600">5. Phí gửi xe</legend>
        <label style="font-size:12px"><input type="checkbox" name="parkingEnabled" ${r.parking_enabled!==0?'checked':''}> Gửi xe</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
          <label>Số lượng xe<input name="parkingCount" type="number" min="0" value="${esc(r.parking_count??(r.parking>0?1:0))}"></label>
          <label>Đơn giá (đ/xe)<input name="parkingRate" type="number" min="0" value="${esc(r.parking_rate??(r.parking||100000))}"></label>
        </div>
      </fieldset>

      <fieldset style="border:1px solid #e0e0e0;padding:10px;border-radius:6px;margin-bottom:10px">
        <legend style="font-weight:600">6. Phí sạc xe điện</legend>
        <label style="font-size:12px"><input type="checkbox" name="evChargingEnabled" ${r.ev_charging_enabled?'checked':''}> Sạc xe điện</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
          <label>Số xe điện<input name="evChargingCount" type="number" min="0" value="${esc(r.ev_charging_count??0)}"></label>
          <label>Đơn giá sạc (đ/xe)<input name="evChargingRate" type="number" min="0" value="${esc(r.ev_charging_rate??100000)}"></label>
        </div>
      </fieldset>
      `;

      $('#invQuickService150')?.addEventListener('click',()=>{
        const inp=document.querySelector('#makeInvoice [name="serviceRate"]');
        if(inp)inp.value='150000';
      });
      $('#invQuickService170')?.addEventListener('click',()=>{
        const inp=document.querySelector('#makeInvoice [name="serviceRate"]');
        if(inp)inp.value='170000';
      });
    }

    $('#invoiceRoomSelect')?.addEventListener('change',updateInvoiceRoomConfig);
    updateInvoiceRoomConfig();
  }

  $('#makeInvoice')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const f=e.target.elements;
    const input={
      rent: Number(f.rent?.value ?? 0),
      electricEnabled: f.electricEnabled?.checked ?? true,
      previousElectric: f.previousElectric?.value !== '' ? Number(f.previousElectric.value) : null,
      currentElectric: f.currentElectric?.value !== '' ? Number(f.currentElectric.value) : null,
      electricRate: Number(f.electricRate?.value || 0),
      waterEnabled: f.waterEnabled?.checked ?? true,
      previousWater: f.previousWater?.value !== '' ? Number(f.previousWater.value) : null,
      currentWater: f.currentWater?.value !== '' ? Number(f.currentWater.value) : null,
      waterRate: Number(f.waterRate?.value || 0),
      internetEnabled: f.internetEnabled?.checked ?? true,
      internetRate: Number(f.internetRate?.value || 0),
      internet: Number(f.internetRate?.value || 0),
      serviceEnabled: f.serviceEnabled?.checked ?? true,
      serviceCount: Number(f.serviceCount?.value || 0),
      serviceRate: Number(f.serviceRate?.value || 0),
      cleaning: Number(f.serviceCount?.value || 0) * Number(f.serviceRate?.value || 0),
      parkingEnabled: f.parkingEnabled?.checked ?? true,
      parkingCount: Number(f.parkingCount?.value || 0),
      parkingRate: Number(f.parkingRate?.value || 0),
      parking: Number(f.parkingCount?.value || 0) * Number(f.parkingRate?.value || 0),
      evChargingEnabled: f.evChargingEnabled?.checked ?? false,
      evChargingCount: Number(f.evChargingCount?.value || 0),
      evChargingRate: Number(f.evChargingRate?.value || 0),
      extras: Number(f.extras?.value || 0),
      discount: Number(f.discount?.value || 0)
    };
    await action(async()=>{
      await post('periods',{buildingId:bid(),month:month()});
      await post('invoices',{roomId:Number(f.roomId.value),month:month(),input});
      await render();
    });
  });

  $('#makePayment')?.addEventListener('submit',async e=>{e.preventDefault();const x=formData(e.target);await action(async()=>{await post('payments',{invoiceId:Number(x.invoiceId),amount:Number(x.amount),method:x.method,reference:x.reference});await render();});});
  document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>showInvoice(Number(btn.dataset.view))));
  document.querySelectorAll('[data-revise]').forEach(btn=>btn.addEventListener('click',()=>{const invoice=invoices.find(x=>x.id===Number(btn.dataset.revise));openInvoiceEditor({invoice,api,post,refresh:render,notice,esc,money}).catch(error=>notice(error.message));}));
  document.querySelectorAll('[data-delete]').forEach(btn=>btn.addEventListener('click',async()=>{
    const invoice=invoices.find(x=>x.id===Number(btn.dataset.delete));
    if(!window.confirm(`Bạn có chắc muốn xóa hóa đơn phòng ${invoice?.room_code||''} kỳ ${month()}? Thao tác này sẽ xóa an toàn cùng các bản ghi liên quan.`))return;
    btn.disabled=true;
    try{
      await del(`invoices/${btn.dataset.delete}`);
      notice('Đã xóa hóa đơn thành công.');
      await render();
    }catch(err){
      btn.disabled=false;
      notice('Không thể xóa: '+err.message);
    }
  }));
  if(page==='payments'||!['SUPER_ADMIN','MANAGER','ACCOUNTANT'].includes(user.role))document.querySelectorAll('[data-revise],[data-delete]').forEach(btn=>btn.hidden=true);
}
if(page==='payments'){
 const periods=await api('periods?buildingId='+bid());
 const locked=periods.some(x=>x.month===month()&&x.locked);
 await renderPaymentJournal({api,post,content,table,esc,money,bid,month,user,locked,render,notice});
 if(locked||user.role==='VIEWER')document.querySelector('#makePayment')?.closest('.panel')?.remove();
 if(locked){const note=document.createElement('p');note.className='muted';note.textContent='Kỳ thu đã khóa. Mở khóa theo quyền và ghi lý do trước khi thu thêm.';content.prepend(note);}
}
if(page==='rooms'&&!['SUPER_ADMIN','MANAGER'].includes(user.role)){
 document.querySelector('#addRoom')?.closest('.panel')?.remove();
 document.querySelector('#toggleRoomBtn')?.closest('.action-bar')?.remove();
}
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
  document.querySelector('#toggleInvoiceBtn')?.closest('.action-bar')?.remove();
  document.querySelectorAll('[data-revise],[data-delete]').forEach(btn=>btn.hidden=true);
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
