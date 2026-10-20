import test from 'node:test';import assert from 'node:assert/strict';import {calculateInvoice,balance} from '../src/finance.js';
test('A12/202 reference must reveal 800 VND difference',()=>{const x={rent:4300000,previousElectric:86,currentElectric:125,electricRate:3800,previousWater:0,currentWater:0,waterRate:0,internet:100000,cleaning:150000};assert.equal(calculateInvoice(x),4698200);assert.equal(4699000-calculateInvoice(x),800);assert.equal(calculateInvoice({...x,currentElectric:130})-calculateInvoice(x),19000);});
test('payments: partial, complete, overpayment',()=>{assert.deepEqual(balance(1000,400),{due:600,overpaid:0,status:'PARTIAL'});assert.equal(balance(1000,1000).status,'PAID');assert.deepEqual(balance(1000,1200),{due:0,overpaid:200,status:'OVERPAID'});});
test('reject negative consumption and fractions',()=>{assert.throws(()=>calculateInvoice({previousElectric:7,currentElectric:6,previousWater:0,currentWater:0}));assert.throws(()=>calculateInvoice({previousElectric:0,currentElectric:1,previousWater:0,currentWater:0,rent:1.5}));});
test('invoice totals preserve exact VND when charges exceed safe integer before discounts',()=>{
 const base={rent:Number.MAX_SAFE_INTEGER,previousElectric:0,currentElectric:0,previousWater:0,currentWater:0,internet:2,discount:2};
 assert.equal(calculateInvoice(base),Number.MAX_SAFE_INTEGER);
 assert.equal(calculateInvoice({...base,discount:3}),Number.MAX_SAFE_INTEGER-1);
 assert.throws(()=>calculateInvoice({...base,discount:0}),/safe integer/);
});
