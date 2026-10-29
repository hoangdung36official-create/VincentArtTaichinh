// Reviewed CSV/XLSX imports: explicit period, sheet and row-by-row reconciliation.
export async function renderImportPage({post,heading,content,buildings,bid,month,esc,money,notice,refresh}) {
  heading('Nhập Excel / CSV & đối soát', 'Chọn đúng tòa, tháng và sheet, kiểm tra từng dòng trước khi ghi dữ liệu.');
  const selected=buildings.find(b=>b.id===bid());
  content.innerHTML = `<section class="panel"><h2>Khởi tạo tòa, phòng và hóa đơn từ Excel A12</h2>
    <p class="muted">Dành cho bảng Excel gốc có cột điện/nước, giá phòng, dịch vụ và dòng TỔNG. Hệ thống đọc đúng sheet tháng, nhận diện phòng và kiểm tra chênh lệch trước khi lưu. Không nhập giao dịch thanh toán từ cột Thực thu.</p>
    <form class="form" id="initialImport">
      <label>Mã tòa nhà<input name="buildingCode" maxlength="10" value="${esc(selected?.code||'A12')}" required></label>
      <label>Tên tòa (nếu tạo mới)<input name="buildingName" maxlength="150" value="${esc(selected?.name||'Tòa nhà A12')}" required></label>
      <label>Địa chỉ (nếu tạo mới)<input name="address" maxlength="300" value="${esc(selected?.address||'')}"></label>
      <label>Tháng/năm<input type="month" name="month" value="${esc(month())}" required></label>
      <label>File Excel A12 (.xlsx, tối đa 700 KB)<input name="file" type="file" accept=".xlsx" required></label>
      <label id="initialSheetPicker" hidden>Sheet cần nhập<select name="sheetName"><option value="">Tự chọn đúng tháng</option></select></label>
      <button class="primary">Phân tích & đối soát</button>
    </form>
    <div id="initialResult" aria-live="polite"></div>
  </section><section class="panel" ${buildings.length?'':'hidden'}><h2>Nhập dữ liệu hóa đơn theo tòa có sẵn</h2>
    <p class="muted">Hỗ trợ XLSX nhiều sheet và CSV UTF-8 xuất từ Excel/Google Sheets. Bảng cần có Phòng, Điện cũ, Điện mới, Nước cũ, Nước mới. Có thể thêm Nhà, Tháng, Tiền phòng, Giá điện, Internet, Vệ sinh, Tổng. Chỉ dữ liệu đúng tháng được xét; không ghi đè hóa đơn đã tồn tại.</p>
    <form class="form" id="csvUpload">
      <label>Tòa nhà<select name="buildingId" required>${buildings.map(b=>`<option value="${b.id}" ${b.id===bid()?'selected':''}>${esc(b.code)} · ${esc(b.name)}</option>`).join('')}</select></label>
      <label>Tháng/năm<input type="month" name="month" value="${esc(month())}" required></label>
      <label>File Excel (.xlsx tối đa 700 KB) hoặc CSV (900 KB), tối đa 500 dòng<input name="file" type="file" accept=".xlsx,.csv,text/csv" required></label>
      <label id="sheetPicker" hidden>Sheet Excel<select name="sheetName"><option value="">Tự nhận diện theo tháng</option></select></label>
      <button class="primary">Kiểm tra & xem trước</button>
    </form>
  </section><section id="csvResult" aria-live="polite"></section>`;
  const form=content.querySelector('#csvUpload'),target=content.querySelector('#csvResult');
  async function excelSource(file){
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Không đọc được Excel'));reader.readAsDataURL(file);});
    return data;
  }
  const initial=content.querySelector('#initialImport'),initialTarget=content.querySelector('#initialResult');
  let initialExcel=null;
  initial.elements.file.addEventListener('change',async()=>{
    initialExcel=null;
    initial.querySelector('#initialSheetPicker').hidden=true;
    initialTarget.replaceChildren();
    const file=initial.elements.file.files[0];
    if(!file)return;
    try{
      if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>700_000)throw Error('Cần Excel .xlsx không quá 700 KB');
      const encoded=await excelSource(file);
      const result=await post('imports/initial/sheets',{xlsxBase64:encoded});
      if(initial.elements.file.files[0]!==file)return;
      initialExcel={file,encoded};
      initial.elements.sheetName.innerHTML='<option value="">Tự chọn đúng tháng</option>'+result.sheets.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}${s.month?' · '+esc(s.month):''}</option>`).join('');
      initial.querySelector('#initialSheetPicker').hidden=false;
    }catch(error){initialTarget.textContent='Không đọc được Excel: '+error.message;}
  });
  let edits={},source=null;
  async function showInitialPreview(){
    initialTarget.textContent='Đang đối chiếu và tính lại từng khoản phí…';
    try{
      if(!source)throw Error('Cần chọn file Excel trước');
      const result=await post('imports/initial/preview',{...source,edits});
      const fields=[['occupants','Số người',1],['rent','Tiền phòng',1],['previousElectric','Điện cũ',.001],['currentElectric','Điện mới',.001],['electricRate','Đơn giá điện',1],['previousWater','Nước cũ',.001],['currentWater','Nước mới',.001],['waterRate','Đơn giá nước',1]];
      const fees=[['internet','Internet'],['cleaning','Vệ sinh'],['parking','Tiền xe'],['extras','Dịch vụ khác']];
      const rowDetails=r=>[...(r.errors||[]),...(r.warnings||[]),...(r.roomChange?['Cấu hình phòng cũ sẽ thay đổi']:[]),...(r.impact?['Chỉ số kỳ sau cần đối soát']:[])].join('; ');
      const editMarkup=r=>r.input?`<div class="form" data-editor="${esc(r.code)}">
        ${fields.map(([key,label,step])=>`<label>${label}<input name="${key}" type="number" min="0" step="${step}" value="${r[key]??r.input[key]??0}" required></label>`).join('')}
        ${fees.map(([key,label])=>{const charge=r.charges?.[key]||{basis:'ROOM',unitPrice:r.input[key],quantity:1};return `<fieldset style="border:1px solid #ddd;padding:10px"><legend>${label}: ${money(r.input[key])}</legend><label>Phương án tính<select name="${key}Basis">${[['ROOM','Theo phòng'],['PERSON','Theo số người'],['QUANTITY','Theo số lượng']].map(([value,title])=>`<option value="${value}" ${charge.basis===value?'selected':''}>${title}</option>`).join('')}</select></label><label>Đơn giá (đ)<input name="${key}Price" type="number" min="0" step="1" value="${charge.unitPrice}" required></label><label>Số lượng (khi chọn theo số lượng)<input name="${key}Qty" type="number" min="0" max="100000" step="1" value="${charge.basis==='QUANTITY'?charge.quantity:1}" required></label></fieldset>`;}).join('')}
        <button class="primary" type="button" data-save-edit="${esc(r.code)}">Lưu chỉnh sửa & tính lại</button></div>`:'<p class="muted">Không phân tích được dòng gốc; vui lòng sửa Excel rồi nhập lại.</p>';
      const preview=document.createElement('section');preview.className='initial-preview';
      preview.innerHTML=`<h3>Đối soát ${esc(result.building.code)} · ${esc(result.month)} · ${esc(result.sheetName)}</h3>
        <p><b>${result.rows.length}</b> phòng · <b>${result.ready}</b> có thể xác nhận · <b>${result.errors}</b> phòng lỗi · <b>${result.roomChanges||0}</b> thay đổi cấu hình · <b>${result.differences||0}</b> chênh lệch.</p>
        <p>Tổng Excel: <b>${money(result.totals.stated)}</b> · Tổng tính lại: <b>${money(result.totals.computed)}</b> · Chênh lệch: <b>${money(result.totals.stated-result.totals.computed)}</b></p>
        ${result.summaryIssues?.length?`<div class="recon-alert">${result.summaryIssues.map(s=>`<p>${esc(s)}</p>`).join('')}</div>`:''}
        <div class="table-wrap"><table><thead><tr><th>Xác nhận</th><th>Phòng</th><th>Người</th><th>Điện/Nước mới</th><th>Excel</th><th>Tính lại</th><th>Lệch</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        ${result.rows.map(r=>`<tr><td><input aria-label="Đã kiểm tra phòng ${esc(r.code)}" type="checkbox" data-reviewed="${esc(r.code)}" ${r.status==='READY'?'':'disabled'}></td><td><b>${esc(r.code)}</b></td><td>${r.occupants??'—'}</td><td>${esc(r.currentElectric??'—')} / ${esc(r.currentWater??'—')}</td><td>${r.stated===undefined?'—':money(r.stated)}</td><td>${r.total===undefined?'—':money(r.total)}</td><td>${r.difference===undefined?'—':money(r.difference)}</td><td class="import-status">${esc(r.invoiceAction)} · ${r.status==='READY'?'✓':'⚠'}<br><small>${esc(rowDetails(r))}</small></td><td><button type="button" class="secondary" data-toggle-edit="${esc(r.code)}">Sửa</button></td></tr><tr data-detail="${esc(r.code)}" hidden><td colspan="9">${editMarkup(r)}</td></tr>`).join('')}</tbody></table></div>
        <label class="import-check"><input type="checkbox" id="reviewAll"> Đã kiểm tra toàn bộ phòng hợp lệ</label>
        ${result.differences||result.summaryIssues?.length?`<label class="import-check"><input type="checkbox" id="ackDifferences"> Tôi đã đối chiếu các sai lệch với Excel; đồng ý dùng số tiền tính lại, không tự cộng khoản chênh lệch.</label>`:''}
        ${result.unmapped?`<label class="import-check"><input type="checkbox" id="ackUnmapped"> Tôi xác nhận các cột chưa xác định không tính vào hóa đơn.</label>`:''}
        ${result.roomChanges?`<label class="import-check"><input type="checkbox" id="ackRooms"> Đồng ý cập nhật cấu hình ${result.roomChanges} phòng đang có.</label>`:''}
        ${result.carryovers?`<label class="import-check"><input type="checkbox" id="ackCarryover"> Tôi sẽ đối soát kỳ sau, hệ thống giữ nguyên dữ liệu kỳ sau.</label>`:''}
        ${result.previewId?'<button class="primary" id="initialConfirm" type="button">Xác nhận nhập tòa/phòng/hóa đơn</button>':'<p class="import-blocked">Vẫn còn phòng lỗi: vui lòng chỉnh sửa hoặc sửa Excel trước khi xác nhận.</p>'}`;
      initialTarget.replaceChildren(preview);
      preview.querySelector('#reviewAll').addEventListener('change',event=>preview.querySelectorAll('[data-reviewed]:not(:disabled)').forEach(input=>input.checked=event.target.checked));
      preview.querySelectorAll('[data-toggle-edit]').forEach(btn=>btn.addEventListener('click',()=>{const detail=preview.querySelectorAll('[data-detail]');const row=[...detail].find(x=>x.dataset.detail===btn.dataset.toggleEdit);row.hidden=!row.hidden;}));
      preview.querySelectorAll('[data-save-edit]').forEach(btn=>btn.addEventListener('click',async()=>{
        const editor=[...preview.querySelectorAll('[data-editor]')].find(x=>x.dataset.editor===btn.dataset.saveEdit);
        const code=btn.dataset.saveEdit,values=Object.fromEntries([...editor.querySelectorAll('[name]')].map(el=>[el.name,el.value]));
        if([...editor.querySelectorAll('input')].some(el=>!el.checkValidity())){notice('Các ô nhập phải hợp lệ, không âm và đúng số lượng.');return;}
        const changed={};
        for(const [key] of fields)changed[key]=Number(values[key]);
        changed.charges={};
        for(const [key] of fees)changed.charges[key]={basis:values[key+'Basis'],unitPrice:Number(values[key+'Price']),quantity:Number(values[key+'Qty'])};
        edits[code]=changed;
        await showInitialPreview();
      }));
      preview.querySelector('#initialConfirm')?.addEventListener('click',async e=>{
        const reviewedRooms=[...preview.querySelectorAll('[data-reviewed]:checked')].map(el=>el.dataset.reviewed);
        if(reviewedRooms.length!==result.ready){notice('Hãy đánh dấu đã kiểm tra từng phòng hoặc chọn tất cả.');return;}
        for(const [count,ack] of [[result.differences+result.summaryIssues.length,'ackDifferences'],[result.unmapped,'ackUnmapped'],[result.roomChanges,'ackRooms'],[result.carryovers,'ackCarryover']]){
          if(count&&!preview.querySelector('#'+ack)?.checked){notice('Cần xác nhận riêng các chênh lệch và thay đổi trước khi lưu.');return;}
        }
        if(!window.confirm(`Lưu ${result.ready} phòng nhà ${result.building.code} kỳ ${result.month}, cập nhật hóa đơn thay đổi và giữ nguyên tiền đã thu?`))return;
        const btn=e.currentTarget;btn.disabled=true;
        try{
          const saved=await post('imports/initial/apply',{previewId:result.previewId,reviewedRooms,acknowledgeDifferences:!!preview.querySelector('#ackDifferences')?.checked,
            acknowledgeUnmapped:!!preview.querySelector('#ackUnmapped')?.checked,acknowledgeRoomChanges:!!preview.querySelector('#ackRooms')?.checked,
            acknowledgeCarryover:!!preview.querySelector('#ackCarryover')?.checked});
          notice(`Đã xử lý ${saved.count} phòng: ${saved.invoicesCreated} hóa đơn mới, ${saved.revised} sửa, ${saved.unchanged} giữ nguyên.`);
          await refresh?.(saved.buildingId,saved.month);btn.remove();
        }catch(error){notice('Không thể nhập: '+error.message);btn.disabled=false;}
      });
    }catch(error){initialTarget.textContent='Không thể đối soát: '+error.message;}
  }
  initial.addEventListener('submit',async event=>{
    event.preventDefault();initialTarget.textContent='Đang phân tích toàn bộ phòng và tính lại hóa đơn…';
    try{
      const file=initial.elements.file.files[0];
      if(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>700_000)throw Error('Cần chọn Excel .xlsx không quá 700 KB');
      source={buildingCode:initial.elements.buildingCode.value.trim().toUpperCase(),buildingName:initial.elements.buildingName.value.trim(),
        address:initial.elements.address.value.trim(),month:initial.elements.month.value,
        xlsxBase64:initialExcel?.file===file?initialExcel.encoded:await excelSource(file),sheetName:initial.elements.sheetName.value||undefined};
      edits={};
      await showInitialPreview();
    }catch(error){initialTarget.textContent='Không thể đối soát: '+error.message;}
  });
  let loadedExcel=null;
  form.elements.file.addEventListener('change',async()=>{
    loadedExcel=null;form.querySelector('#sheetPicker').hidden=true;
    const file=form.elements.file.files[0];
    if(!file||!file.name.toLowerCase().endsWith('.xlsx'))return;
    try{
      if(file.size>700_000)throw Error('Excel vượt giới hạn 700 KB');
      const encoded=await excelSource(file);
      const result=await post('imports/sheets',{buildingId:Number(form.elements.buildingId.value),xlsxBase64:encoded});
      if(form.elements.file.files[0]!==file)return;
      loadedExcel={file,encoded};
      const sheet=form.elements.sheetName;
      sheet.innerHTML='<option value="">Tự nhận diện theo tháng</option>'+result.sheets.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}${s.month?' · '+esc(s.month):''}</option>`).join('');
      form.querySelector('#sheetPicker').hidden=false;
    }catch(error){target.textContent='Lỗi đọc Excel: '+error.message;}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();target.textContent='Đang kiểm tra dữ liệu…';
    try{
      const selected=form.elements.file.files[0];
      if(!selected)throw Error('Chưa chọn file');
      const isExcel=selected.name.toLowerCase().endsWith('.xlsx');
      if(selected.size>(isExcel?700_000:900_000))throw Error('File vượt giới hạn');
      const source={buildingId:Number(form.elements.buildingId.value),month:form.elements.month.value,
        ...(isExcel?{xlsxBase64:loadedExcel?.file===selected?loadedExcel.encoded:await excelSource(selected),sheetName:form.elements.sheetName.value||undefined}:{csv:await selected.text()})};
      const result=await post('imports/preview',source);
      const preview=document.createElement('section');preview.className='panel';
      const items=result.items||[];

      const rowHtml=items.map(item=>{
        const inp=item.input||{};
        const elOn=inp.electricEnabled!==false;
        const wtOn=inp.waterEnabled!==false;
        const netOn=inp.internetEnabled!==false;
        const srvOn=inp.serviceEnabled!==false;
        const pkOn=inp.parkingEnabled!==false;
        const evOn=!!inp.evChargingEnabled;

        const elAmount=elOn&&inp.currentElectric>=inp.previousElectric?(inp.currentElectric-inp.previousElectric)*(inp.electricRate||0):0;
        const wtAmount=wtOn&&inp.currentWater>=inp.previousWater?(inp.currentWater-inp.previousWater)*(inp.waterRate||0):0;
        const netAmount=netOn?(inp.internetRate??inp.internet??0):0;
        const srvCount=inp.serviceCount??inp.occupants??1;
        const srvRate=inp.serviceRate??(inp.cleaning?Math.round(inp.cleaning/srvCount):150000);
        const srvAmount=srvOn?srvCount*srvRate:0;
        const pkCount=inp.parkingCount??(inp.parking?1:0);
        const pkRate=inp.parkingRate??(inp.parking||100000);
        const pkAmount=pkOn?pkCount*pkRate:0;
        const evCount=inp.evChargingCount??0;
        const evRate=inp.evChargingRate??100000;
        const evAmount=evOn?evCount*evRate:0;

        return `<tr class="import-row" data-room-id="${item.roomId}" data-code="${esc(item.code)}">
          <td><b>${esc(item.code)}</b></td>
          <td>
            <input type="number" data-name="rent" min="0" step="1" value="${esc(inp.rent??0)}" style="width:105px" title="Tiền phòng">
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:3px">
              <label style="font-size:11px"><input type="checkbox" data-name="electricEnabled" ${elOn?'checked':''}> Dùng</label>
              <div style="display:flex;gap:3px;align-items:center">
                <input type="number" data-name="previousElectric" step="0.001" min="0" value="${inp.previousElectric??''}" placeholder="Cũ" style="width:55px" title="Chỉ số cũ">
                <span>→</span>
                <input type="number" data-name="currentElectric" step="0.001" min="0" value="${inp.currentElectric??''}" placeholder="Mới" style="width:55px" title="Chỉ số mới">
                <input type="number" data-name="electricRate" min="0" step="1" value="${esc(inp.electricRate??3800)}" placeholder="Đơn giá" style="width:65px" title="Đơn giá điện">
              </div>
              <small class="amount-electric muted">${money(elAmount)}</small>
            </div>
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:3px">
              <label style="font-size:11px"><input type="checkbox" data-name="waterEnabled" ${wtOn?'checked':''}> Dùng</label>
              <div style="display:flex;gap:3px;align-items:center">
                <input type="number" data-name="previousWater" step="0.001" min="0" value="${inp.previousWater??''}" placeholder="Cũ" style="width:55px" title="Chỉ số cũ">
                <span>→</span>
                <input type="number" data-name="currentWater" step="0.001" min="0" value="${inp.currentWater??''}" placeholder="Mới" style="width:55px" title="Chỉ số mới">
                <input type="number" data-name="waterRate" min="0" step="1" value="${esc(inp.waterRate??0)}" placeholder="Đơn giá" style="width:65px" title="Đơn giá nước">
              </div>
              <small class="amount-water muted">${money(wtAmount)}</small>
            </div>
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:3px">
              <label style="font-size:11px"><input type="checkbox" data-name="internetEnabled" ${netOn?'checked':''}> Dùng</label>
              <input type="number" data-name="internetRate" min="0" step="1" value="${esc(inp.internetRate??inp.internet??0)}" style="width:85px" title="Đơn giá Internet">
              <small class="amount-internet muted">${money(netAmount)}</small>
            </div>
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:3px">
              <label style="font-size:11px"><input type="checkbox" data-name="serviceEnabled" ${srvOn?'checked':''}> Dùng</label>
              <div style="display:flex;gap:3px;align-items:center">
                <input type="number" data-name="serviceCount" min="0" step="1" value="${esc(srvCount)}" placeholder="Người" style="width:45px" title="Số người">
                <span>×</span>
                <input type="number" data-name="serviceRate" min="0" step="1" value="${esc(srvRate)}" placeholder="Đơn giá" style="width:80px" title="Đơn giá DV">
              </div>
              <div style="display:flex;gap:2px">
                <button type="button" class="btn-xs secondary" data-set-service="150000" style="padding:1px 4px;font-size:10px">150k</button>
                <button type="button" class="btn-xs secondary" data-set-service="170000" style="padding:1px 4px;font-size:10px">170k</button>
              </div>
              <small class="amount-service muted">${money(srvAmount)}</small>
            </div>
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:3px">
              <label style="font-size:11px"><input type="checkbox" data-name="parkingEnabled" ${pkOn?'checked':''}> Dùng</label>
              <div style="display:flex;gap:3px;align-items:center">
                <input type="number" data-name="parkingCount" min="0" step="1" value="${esc(pkCount)}" placeholder="Xe" style="width:45px" title="Số xe">
                <span>×</span>
                <input type="number" data-name="parkingRate" min="0" step="1" value="${esc(pkRate)}" placeholder="Đơn giá" style="width:75px" title="Đơn giá xe">
              </div>
              <small class="amount-parking muted">${money(pkAmount)}</small>
            </div>
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:3px">
              <label style="font-size:11px"><input type="checkbox" data-name="evChargingEnabled" ${evOn?'checked':''}> Dùng</label>
              <div style="display:flex;gap:3px;align-items:center">
                <input type="number" data-name="evChargingCount" min="0" step="1" value="${esc(evCount)}" placeholder="Xe" style="width:45px" title="Số xe điện">
                <span>×</span>
                <input type="number" data-name="evChargingRate" min="0" step="1" value="${esc(evRate)}" placeholder="Đơn giá" style="width:75px" title="Đơn giá sạc">
              </div>
              <small class="amount-ev muted">${money(evAmount)}</small>
            </div>
          </td>
          <td class="num"><strong class="amount-total">${money(item.total)}</strong></td>
        </tr>`;
      }).join('');

      preview.innerHTML=`<h2>Kết quả kiểm tra · ${esc(source.month)}${result.sheetName?' · Sheet '+esc(result.sheetName):''}</h2>
        <p><b>${result.ready}</b> phòng hợp lệ · <b>${result.errors}</b> dòng lỗi · <b>${result.skippedMonth}</b> dòng thuộc tháng khác.</p>
        <p class="muted">${esc(result.reply)}</p>
        ${items.length?`
        <div style="margin:12px 0;padding:10px;background:#eef6ff;border-radius:6px;font-size:13px">
          💡 <strong>Xem trước & Chỉnh sửa trực tiếp:</strong> Bạn có thể sửa trực tiếp chỉ số, đơn giá, số lượng hoặc bật/tắt từng dịch vụ. Hệ thống sẽ tính lại ngay thành tiền và tổng tiền.
        </div>
        <div class="table-wrap">
          <table class="import-preview-table">
            <thead>
              <tr>
                <th>Phòng</th>
                <th>Tiền phòng</th>
                <th>Điện (Cũ → Mới × Giá)</th>
                <th>Nước (Cũ → Mới × Giá)</th>
                <th>Mạng</th>
                <th>Dịch vụ (Người × Giá)</th>
                <th>Gửi xe (Xe × Giá)</th>
                <th>Sạc xe điện (Xe × Giá)</th>
                <th>Tổng tính lại</th>
              </tr>
            </thead>
            <tbody>${rowHtml}</tbody>
          </table>
        </div>`:''}
        ${result.rows.filter(r=>r.status==='ERROR').length?`
        <div style="margin-top:16px">
          <h3>Các dòng lỗi cần kiểm tra lại file</h3>
          <div class="table-wrap"><table><thead><tr><th>Dòng</th><th>Phòng</th><th>Lỗi</th></tr></thead>
          <tbody>${result.rows.filter(r=>r.status==='ERROR').map(r=>`<tr><td>${r.line+(result.skippedHeaderRows||0)}</td><td>${esc(r.room)}</td><td class="error">${esc(r.message||'Lỗi dữ liệu')}</td></tr>`).join('')}</tbody></table></div>
        </div>`:''}
        ${result.previewId?`<div style="margin-top:16px"><button type="button" class="primary" id="csvConfirm">Lưu hóa đơn</button></div>`:''}`;

      target.replaceChildren(preview);

      function recalcRow(tr){
        const rent=Number(tr.querySelector('[data-name="rent"]')?.value||0);
        const elOn=tr.querySelector('[data-name="electricEnabled"]')?.checked;
        const elOld=Number(tr.querySelector('[data-name="previousElectric"]')?.value||0);
        const elNew=Number(tr.querySelector('[data-name="currentElectric"]')?.value||0);
        const elRate=Number(tr.querySelector('[data-name="electricRate"]')?.value||0);
        const elAmount=elOn&&elNew>=elOld?(elNew-elOld)*elRate:0;
        tr.querySelector('.amount-electric').textContent=money(elAmount);

        const wtOn=tr.querySelector('[data-name="waterEnabled"]')?.checked;
        const wtOld=Number(tr.querySelector('[data-name="previousWater"]')?.value||0);
        const wtNew=Number(tr.querySelector('[data-name="currentWater"]')?.value||0);
        const wtRate=Number(tr.querySelector('[data-name="waterRate"]')?.value||0);
        const wtAmount=wtOn&&wtNew>=wtOld?(wtNew-wtOld)*wtRate:0;
        tr.querySelector('.amount-water').textContent=money(wtAmount);

        const netOn=tr.querySelector('[data-name="internetEnabled"]')?.checked;
        const netRate=Number(tr.querySelector('[data-name="internetRate"]')?.value||0);
        const netAmount=netOn?netRate:0;
        tr.querySelector('.amount-internet').textContent=money(netAmount);

        const srvOn=tr.querySelector('[data-name="serviceEnabled"]')?.checked;
        const srvCount=Number(tr.querySelector('[data-name="serviceCount"]')?.value||0);
        const srvRate=Number(tr.querySelector('[data-name="serviceRate"]')?.value||0);
        const srvAmount=srvOn?srvCount*srvRate:0;
        tr.querySelector('.amount-service').textContent=money(srvAmount);

        const pkOn=tr.querySelector('[data-name="parkingEnabled"]')?.checked;
        const pkCount=Number(tr.querySelector('[data-name="parkingCount"]')?.value||0);
        const pkRate=Number(tr.querySelector('[data-name="parkingRate"]')?.value||0);
        const pkAmount=pkOn?pkCount*pkRate:0;
        tr.querySelector('.amount-parking').textContent=money(pkAmount);

        const evOn=tr.querySelector('[data-name="evChargingEnabled"]')?.checked;
        const evCount=Number(tr.querySelector('[data-name="evChargingCount"]')?.value||0);
        const evRate=Number(tr.querySelector('[data-name="evChargingRate"]')?.value||0);
        const evAmount=evOn?evCount*evRate:0;
        tr.querySelector('.amount-ev').textContent=money(evAmount);

        const total=rent+elAmount+wtAmount+netAmount+srvAmount+pkAmount+evAmount;
        tr.querySelector('.amount-total').textContent=money(total);
      }

      preview.querySelectorAll('.import-row').forEach(tr=>{
        tr.querySelectorAll('input').forEach(inp=>{
          inp.addEventListener('input',()=>recalcRow(tr));
          inp.addEventListener('change',()=>recalcRow(tr));
        });
        tr.querySelectorAll('[data-set-service]').forEach(btn=>{
          btn.addEventListener('click',()=>{
            const srvInput=tr.querySelector('[data-name="serviceRate"]');
            if(srvInput){
              srvInput.value=btn.dataset.setService;
              recalcRow(tr);
            }
          });
        });
      });

      const confirm=preview.querySelector('#csvConfirm');
      if(confirm)confirm.addEventListener('click',async()=>{
        if(!window.confirm(`Ghi ${items.length||result.ready} hóa đơn vào tòa đã chọn, kỳ ${source.month}?`))return;
        confirm.disabled=true;
        try{
          const editedItems=[...preview.querySelectorAll('.import-row')].map(tr=>{
            const roomId=Number(tr.dataset.roomId);
            const code=tr.dataset.code;
            const rent=Number(tr.querySelector('[data-name="rent"]')?.value||0);
            const elOn=tr.querySelector('[data-name="electricEnabled"]')?.checked;
            const elOld=tr.querySelector('[data-name="previousElectric"]')?.value===''?null:Number(tr.querySelector('[data-name="previousElectric"]')?.value);
            const elNew=tr.querySelector('[data-name="currentElectric"]')?.value===''?null:Number(tr.querySelector('[data-name="currentElectric"]')?.value);
            const elRate=Number(tr.querySelector('[data-name="electricRate"]')?.value||0);

            const wtOn=tr.querySelector('[data-name="waterEnabled"]')?.checked;
            const wtOld=tr.querySelector('[data-name="previousWater"]')?.value===''?null:Number(tr.querySelector('[data-name="previousWater"]')?.value);
            const wtNew=tr.querySelector('[data-name="currentWater"]')?.value===''?null:Number(tr.querySelector('[data-name="currentWater"]')?.value);
            const wtRate=Number(tr.querySelector('[data-name="waterRate"]')?.value||0);

            const netOn=tr.querySelector('[data-name="internetEnabled"]')?.checked;
            const netRate=Number(tr.querySelector('[data-name="internetRate"]')?.value||0);

            const srvOn=tr.querySelector('[data-name="serviceEnabled"]')?.checked;
            const srvCount=Number(tr.querySelector('[data-name="serviceCount"]')?.value||0);
            const srvRate=Number(tr.querySelector('[data-name="serviceRate"]')?.value||0);

            const pkOn=tr.querySelector('[data-name="parkingEnabled"]')?.checked;
            const pkCount=Number(tr.querySelector('[data-name="parkingCount"]')?.value||0);
            const pkRate=Number(tr.querySelector('[data-name="parkingRate"]')?.value||0);

            const evOn=tr.querySelector('[data-name="evChargingEnabled"]')?.checked;
            const evCount=Number(tr.querySelector('[data-name="evChargingCount"]')?.value||0);
            const evRate=Number(tr.querySelector('[data-name="evChargingRate"]')?.value||0);

            const input={
              rent,
              electricEnabled:elOn,
              previousElectric:elOld,
              currentElectric:elNew,
              electricRate:elRate,
              waterEnabled:wtOn,
              previousWater:wtOld,
              currentWater:wtNew,
              waterRate:wtRate,
              internetEnabled:netOn,
              internetRate:netRate,
              internet:netRate,
              serviceEnabled:srvOn,
              serviceCount:srvCount,
              serviceRate:srvRate,
              cleaning:srvCount*srvRate,
              parkingEnabled:pkOn,
              parkingCount:pkCount,
              parkingRate:pkRate,
              parking:pkCount*pkRate,
              evChargingEnabled:evOn,
              evChargingCount:evCount,
              evChargingRate:evRate,
              extras:0,
              discount:0
            };
            return {roomId,code,input};
          });

          const applied=await post('imports/apply',{previewId:result.previewId,items:editedItems.length?editedItems:undefined});
          notice(`Đã nhập ${applied.count} hóa đơn kỳ ${applied.month}.`);
          confirm.remove();
        }catch(e){
          notice('Không thể nhập: '+e.message);
          confirm.disabled=false;
        }
      });
    }catch(e){target.textContent='Lỗi kiểm tra: '+e.message;}
  });
}
