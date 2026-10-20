import test from 'node:test';
import assert from 'node:assert/strict';
import {exportCsv} from '../src/export-csv.js';

test('CSV exported for Excel preserves exact VND and escapes untrusted formula strings',()=>{
 const csv=exportCsv([['Mã tham chiếu','reference'],['Số tiền (VND)','amount']],[
  {reference:'=HYPERLINK("https://example.test","click")',amount:4698200},
  {reference:' \t@SUM(1,2)',amount:19000},
  {reference:'A1,"điện"',amount:0}
 ]);
 assert.equal(csv.split('\r\n').length,4);
 assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test"",""click"")"'));
 assert.ok(csv.includes('"\' \t@SUM(1,2)"'));
 assert.ok(csv.includes('"A1,""điện"""'));
 assert.ok(csv.includes('"4698200"'));
 assert.ok(csv.includes('"19000"'));
});
