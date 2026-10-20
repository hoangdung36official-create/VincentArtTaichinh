import test from 'node:test';
import assert from 'node:assert/strict';
import {xlsxCsv,xlsxSheets} from '../src/import-xlsx.js';
import {parseCsv} from '../src/import-csv.js';
import {sampleXlsx} from './xlsx-fixture.js';

test('Excel multi-sheet detection, explicit month matching and title row detection',()=>{
 const buffer=sampleXlsx();
 assert.deepEqual(xlsxSheets(buffer),[{name:'Tháng 11-2026',month:'2026-11'},{name:'Tháng 12-2026',month:'2026-12'}]);
 const selected=xlsxCsv(buffer,'2026-12');
 assert.equal(selected.sheetName,'Tháng 12-2026');
 assert.equal(selected.skippedHeaderRows,2);
 const parsed=parseCsv(selected.csv);
 assert.equal(parsed.length,1);
 assert.deepEqual([parsed[0].room,parsed[0].currentElectric,parsed[0].rent,parsed[0].total],['A12.203','10','2000000','2038000']);
 assert.throws(()=>xlsxCsv(buffer,'2026-10'),/Hãy chọn một sheet/);
 assert.throws(()=>xlsxCsv(buffer,'2026-12','Tháng 11-2026'),/không phải kỳ 2026-12/);
 assert.throws(()=>xlsxCsv(buffer,'2026-12','Không tồn tại'),/không tồn tại/);
});

test('Excel corrupt data and mismatched figures are never silently accepted',()=>{
 assert.throws(()=>xlsxSheets('not base64!'),/không hợp lệ/);
 assert.throws(()=>xlsxSheets(Buffer.from('Not a ZIP').toString('base64')),/không hợp lệ/);
 const parsed=parseCsv(xlsxCsv(sampleXlsx({total:2039000}),'2026-12').csv);
 assert.equal(parsed[0].total,'2039000'); // backend must flag 1,000-VND discrepancy
});

test('Excel ZIP entries must pass CRC checks before invoice data can be imported',()=>{
 const altered=Buffer.from(sampleXlsx(),'base64');
 const central=altered.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
 assert.ok(central>0);
 altered.writeUInt32LE((altered.readUInt32LE(central+16)^1)>>>0,central+16);
 assert.throws(()=>xlsxSheets(altered.toString('base64')),/CRC|toàn vẹn|integrity/i);
});

test('Excel ZIP central filenames must agree with local entry filenames',()=>{
 const altered=Buffer.from(sampleXlsx(),'base64');
 const local=altered.indexOf(Buffer.from('xl/workbook.xml'));
 assert.ok(local>0);
 altered[local]='z'.charCodeAt(0);
 assert.throws(()=>xlsxSheets(altered.toString('base64')),/ZIP|tên tệp|không khớp/i);
});
