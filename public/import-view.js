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
  initial.addEventListener('submit',async event=>{
    event.preventDefault();initialTarget.textContent='Đang phân tích toàn bộ phòng và tính lại hóa đơn…';
    try{
      const file=initial.elements.file.files[0];
      if(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>700_000)throw Error('Cần chọn Excel .xlsx không quá 700 KB');
      const source={buildingCode:initial.elements.buildingCode.value.trim().toUpperCase(),buildingName:initial.elements.buildingName.value.trim(),
        address:initial.elements.address.value.trim(),month:initial.elements.month.value,
        xlsxBase64:initialExcel?.file===file?initialExcel.encoded:await excelSource(file),sheetName:initial.elements.sheetName.value||undefined};
      const result=await post('imports/initial/preview',source);
      const preview=document.createElement('section');preview.className='initial-preview';
      const rowDetails=r=>[...(r.errors||[]),...(r.warnings||[]),...(r.roomChange?['Cấu hình phòng cũ sẽ thay đổi (cần xác nhận riêng)']:[])].join('; ');
      preview.innerHTML=`<h3>Đối soát ${esc(result.building.code)} · ${esc(result.month)} · ${esc(result.sheetName)}</h3>
        <p><b>${result.rows.length}</b> phòng · <b>${result.ready}</b> hợp lệ · <b>${result.errors}</b> lỗi/điểm cần xử lý · <b>${result.roomChanges||0}</b> phòng có cấu hình thay đổi.</p>
        <p>Tổng Excel: <b>${money(result.totals.stated)}</b> · Tính lại: <b>${money(result.totals.computed)}</b> · Chênh lệch: <b>${money(result.totals.stated-result.totals.computed)}</b></p>
        ${result.summaryIssues?.length?`<div class="recon-alert">${result.summaryIssues.map(s=>`<p>${esc(s)}</p>`).join('')}</div>`:''}
        <div class="table-wrap"><table><thead><tr><th>Phòng</th><th>Người</th><th>Điện / Nước mới</th><th>Excel</th><th>Tính lại</th><th>Lệch</th><th>Kiểm tra</th></tr></thead><tbody>
        ${result.rows.map(r=>`<tr><td><b>${esc(r.code)}</b></td><td>${r.occupants??'—'}</td><td>${esc(r.currentElectric??'—')} / ${esc(r.currentWater??'—')}</td><td>${r.stated===undefined?'—':money(r.stated)}</td><td>${r.total===undefined?'—':money(r.total)}</td><td>${r.difference===undefined?'—':money(r.difference)}</td><td class="import-status">${r.status==='READY'?'✓ Hợp lệ':'⚠ Cần đối soát'}${rowDetails(r)?`<br><small>${esc(rowDetails(r))}</small>`:''}</td></tr>`).join('')}</tbody></table></div>
        ${result.unmapped?`<label class="import-check"><input type="checkbox" id="ackUnmapped"> Tôi đã đối chiếu các cột chưa xác định và xác nhận không tính vào hóa đơn.</label>`:''}
        ${result.roomChanges?`<label class="import-check"><input type="checkbox" id="ackRooms"> Tôi đồng ý cập nhật cấu hình ${result.roomChanges} phòng đã tồn tại theo giá trị Excel.</label>`:''}
        ${result.previewId?'<button class="primary" id="initialConfirm" type="button">Xác nhận nhập tòa/phòng/hóa đơn</button>':'<p class="import-blocked">Chưa thể ghi dữ liệu: cần chỉnh hoặc xác minh sai lệch trong Excel trước khi nhập lại.</p>'}`;
      initialTarget.replaceChildren(preview);
      preview.querySelector('#initialConfirm')?.addEventListener('click',async e=>{
        if(result.unmapped&&!preview.querySelector('#ackUnmapped')?.checked||result.roomChanges&&!preview.querySelector('#ackRooms')?.checked){notice('Cần tích xác nhận các thay đổi/cột chưa xác định.');return;}
        if(!window.confirm(`Nhập ${result.ready} phòng vào ${result.building.code} tháng ${result.month}?`))return;
        const btn=e.currentTarget;btn.disabled=true;
        try{
          const saved=await post('imports/initial/apply',{previewId:result.previewId,
            acknowledgeUnmapped:!!preview.querySelector('#ackUnmapped')?.checked,acknowledgeRoomChanges:!!preview.querySelector('#ackRooms')?.checked});
          notice(`Đã nhập ${saved.count} phòng và hóa đơn ${saved.month}.`);
          await refresh?.(saved.buildingId,saved.month);btn.remove();
        }catch(error){notice('Không thể nhập: '+error.message);btn.disabled=false;}
      });
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
      preview.innerHTML=`<h2>Kết quả kiểm tra · ${esc(source.month)}${result.sheetName?' · Sheet '+esc(result.sheetName):''}</h2>
        <p><b>${result.ready}</b> phòng hợp lệ · <b>${result.errors}</b> dòng lỗi · <b>${result.skippedMonth}</b> dòng thuộc tháng khác.</p>
        <p class="muted">${esc(result.reply)}</p>
        <div class="table-wrap"><table><thead><tr><th>Dòng</th><th>Phòng</th><th>Trạng thái</th><th>Tổng tính lại</th><th>Đối soát</th></tr></thead>
        <tbody>${result.rows.map(r=>`<tr><td>${r.line+(result.skippedHeaderRows||0)}</td><td>${esc(r.room)}</td><td>${r.status==='READY'?'Hợp lệ':'Lỗi'}</td><td>${r.total===undefined?'—':money(r.total)}</td><td>${esc(r.message||'Khớp công thức')}</td></tr>`).join('')}</tbody></table></div>
        ${result.previewId?'<button type="button" class="primary" id="csvConfirm">Xác nhận nhập các hóa đơn đã kiểm tra</button>':''}`;
      target.replaceChildren(preview);
      const confirm=preview.querySelector('#csvConfirm');
      if(confirm)confirm.addEventListener('click',async()=>{
        if(!window.confirm(`Ghi ${result.ready} hóa đơn vào tòa đã chọn, kỳ ${source.month}?`))return;
        confirm.disabled=true;
        try{const applied=await post('imports/apply',{previewId:result.previewId});notice(`Đã nhập ${applied.count} hóa đơn kỳ ${applied.month}.`);confirm.remove();}
        catch(e){notice('Không thể nhập: '+e.message);confirm.disabled=false;}
      });
    }catch(e){target.textContent='Lỗi kiểm tra: '+e.message;}
  });
}
