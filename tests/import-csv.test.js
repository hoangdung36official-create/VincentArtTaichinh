import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,parseVndInteger,importedMonth} from '../src/import-csv.js';

test('CSV imports accept Vietnamese headers, quotes, BOM and mixed separators',()=>{
  const rows=parseCsv('\uFEFFPhòng;Tháng;Điện cũ;Điện mới;Nước cũ;Nước mới;Tiền phòng;Tổng\r\n"A12.201";10/2026;86;125;0;0;"4.300.000";"4.698.200"\r\n');
  assert.equal(rows.length,1);
  assert.equal(rows[0].room,'A12.201');
  assert.equal(rows[0].previousElectric,'86');
  assert.equal(rows[0].total,'4.698.200');
  assert.equal(importedMonth(rows[0].month),'2026-10');
  assert.equal(parseVndInteger(rows[0].rent,'rent'),4300000);
});

test('CSV strict validation detects ambiguous numbers, missing columns, extra cells and limits',()=>{
  for(const value of ['4,5','4.5','-1','1.000,50','5e3','3/2','9007199254740993'])
    assert.throws(()=>parseVndInteger(value,'rate'));
  assert.equal(parseVndInteger('0','reading'),0);
  assert.equal(parseVndInteger('', 'optional',true),undefined);
  assert.throws(()=>parseVndInteger('','reading'));
  assert.throws(()=>parseCsv('Phòng,Điện cũ\n201,1'),/Thiếu cột/);
  assert.throws(()=>parseCsv('Phòng,Điện cũ,Điện mới,Nước cũ,Nước mới\n201,1,2,3,4,5'),/số cột/);
  assert.throws(()=>parseCsv('Phòng,Điện cũ,Điện mới,Nước cũ,Nước mới\n'+Array(501).fill('201,1,2,3,4').join('\n')),/500 dòng/);
  assert.equal(importedMonth('13/2026'),null);
  assert.equal(importedMonth('2026-12'),'2026-12');
});
