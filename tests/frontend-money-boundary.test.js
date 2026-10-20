import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPaymentJournal} from '../public/ui-pages.js';

test('payment journal displays an exact total when safe individual payments exceed Number safe range together', async()=>{
 const previousDocument=globalThis.document;
 const appended=[];
 globalThis.document={createElement(){return {className:'',innerHTML:'',querySelectorAll(){return [];}};}};
 const money=n=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(n||0);
 const payments=[
  {id:1,received_at:'2026-10-19T08:00:00Z',room_code:'201',collector:'collector@example.com',method:'TRANSFER',reference:'SAFE-1',amount:4_503_599_627_370_496,net_amount:4_503_599_627_370_496,reversed:0},
  {id:2,received_at:'2026-10-19T08:01:00Z',room_code:'202',collector:'collector@example.com',method:'CASH',reference:'SAFE-2',amount:4_503_599_627_370_497,net_amount:4_503_599_627_370_497,reversed:0},
  {id:3,received_at:'2026-10-19T08:02:00Z',room_code:'203',collector:'collector@example.com',method:'CASH',reference:'REVERSED',amount:200,net_amount:0,reversed:1,reversal_reason:'Reversed test payment',reversed_by:'admin@example.com'}
 ];
 try{
  await renderPaymentJournal({
   api:async()=>payments,post:async()=>{throw Error('should not post');},
   content:{append:el=>appended.push(el)},table:(columns,rows)=>rows.join(''),
   esc:value=>String(value??''),money,bid:()=>1,month:()=> '2026-10',
   user:{role:'VIEWER'},locked:true,render:()=>{},notice:()=>{}
  });
  assert.equal(appended.length,1);
  const exact=4_503_599_627_370_496n+4_503_599_627_370_497n;
  assert.ok(appended[0].innerHTML.includes(`Thực thu ${money(exact)}`),
   `journal total must equal exact ${money(exact)}, got: ${appended[0].innerHTML.slice(0,180)}`);
 } finally {
  if(previousDocument===undefined)delete globalThis.document;
  else globalThis.document=previousDocument;
 }
});
