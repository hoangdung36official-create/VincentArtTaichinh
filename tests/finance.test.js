import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {calculateInvoice,calculateItemAmounts,balance,deleteInvoiceRecord,migrateSchema} from '../src/finance.js';

test('A12/202 reference must reveal 800 VND difference',()=>{const x={rent:4300000,previousElectric:86,currentElectric:125,electricRate:3800,previousWater:0,currentWater:0,waterRate:0,internet:100000,cleaning:150000};assert.equal(calculateInvoice(x),4698200);assert.equal(4699000-calculateInvoice(x),800);assert.equal(calculateInvoice({...x,currentElectric:130})-calculateInvoice(x),19000);});
test('payments: partial, complete, overpayment',()=>{assert.deepEqual(balance(1000,400),{due:600,overpaid:0,status:'PARTIAL'});assert.equal(balance(1000,1000).status,'PAID');assert.deepEqual(balance(1000,1200),{due:0,overpaid:200,status:'OVERPAID'});});
test('reject negative consumption and fractions',()=>{assert.throws(()=>calculateInvoice({previousElectric:7,currentElectric:6,previousWater:0,currentWater:0}));assert.throws(()=>calculateInvoice({previousElectric:0,currentElectric:1,previousWater:0,currentWater:0,rent:1.5}));});
test('invoice totals preserve exact VND when charges exceed safe integer before discounts',()=>{
 const base={rent:Number.MAX_SAFE_INTEGER,previousElectric:0,currentElectric:0,previousWater:0,currentWater:0,internet:2,discount:2};
 assert.equal(calculateInvoice(base),Number.MAX_SAFE_INTEGER);
 assert.equal(calculateInvoice({...base,discount:3}),Number.MAX_SAFE_INTEGER-1);
 assert.throws(()=>calculateInvoice({...base,discount:0}),/safe integer/);
});

test('calculateItemAmounts calculates all 6 standardized categories with toggles',()=>{
  const allEnabled = {
    rent: 3000000,
    electricEnabled: true, previousElectric: 100, currentElectric: 150, electricRate: 3500, // 50 * 3500 = 175,000
    waterEnabled: true, previousWater: 10, currentWater: 15, waterRate: 20000, // 5 * 20000 = 100,000
    internetEnabled: true, internetRate: 80000, // 80,000
    serviceEnabled: true, serviceCount: 2, serviceRate: 170000, // 2 * 170,000 = 340,000
    parkingEnabled: true, parkingCount: 3, parkingRate: 90000, // 3 * 90,000 = 270,000
    evChargingEnabled: true, evChargingCount: 1, evChargingRate: 120000, // 1 * 120,000 = 120,000
  };
  const amounts = calculateItemAmounts(allEnabled);
  assert.equal(amounts.rent, 3000000);
  assert.equal(amounts.electricity, 175000);
  assert.equal(amounts.water, 100000);
  assert.equal(amounts.internet, 80000);
  assert.equal(amounts.service, 340000);
  assert.equal(amounts.parking, 270000);
  assert.equal(amounts.evCharging, 120000);
  assert.equal(amounts.total, 3000000 + 175000 + 100000 + 80000 + 340000 + 270000 + 120000);

  // When all toggled off, only rent remains
  const allDisabled = {
    ...allEnabled,
    electricEnabled: false,
    waterEnabled: false,
    internetEnabled: false,
    serviceEnabled: false,
    parkingEnabled: false,
    evChargingEnabled: false
  };
  const disabledAmounts = calculateItemAmounts(allDisabled);
  assert.equal(disabledAmounts.electricity, 0);
  assert.equal(disabledAmounts.water, 0);
  assert.equal(disabledAmounts.internet, 0);
  assert.equal(disabledAmounts.service, 0);
  assert.equal(disabledAmounts.parking, 0);
  assert.equal(disabledAmounts.evCharging, 0);
  assert.equal(disabledAmounts.total, 3000000);
});

test('deleteInvoiceRecord cascades and audits properly',()=>{
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE buildings(id INTEGER PRIMARY KEY, code TEXT, name TEXT);
    CREATE TABLE rooms(id INTEGER PRIMARY KEY, building_id INTEGER, code TEXT, rent INTEGER DEFAULT 0);
    CREATE TABLE periods(id INTEGER PRIMARY KEY, building_id INTEGER, month TEXT, locked INTEGER DEFAULT 0);
    CREATE TABLE invoices(id INTEGER PRIMARY KEY, period_id INTEGER, room_id INTEGER, version INTEGER DEFAULT 1, input TEXT, total INTEGER);
    CREATE TABLE invoice_versions(id INTEGER PRIMARY KEY, invoice_id INTEGER, version INTEGER, input TEXT, total INTEGER, reason TEXT, actor_id INTEGER);
    CREATE TABLE invoice_charge_rules(id INTEGER PRIMARY KEY, invoice_id INTEGER, version INTEGER, details TEXT);
    CREATE TABLE payments(id INTEGER PRIMARY KEY, invoice_id INTEGER, amount INTEGER);
    CREATE TABLE payment_reversals(id INTEGER PRIMARY KEY, payment_id INTEGER);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER, before_data TEXT, after_data TEXT, reason TEXT);
  `);
  migrateSchema(db);

  db.prepare("INSERT INTO buildings(id, code, name) VALUES(1, 'B1', 'Tòa 1')").run();
  db.prepare("INSERT INTO rooms(id, building_id, code, rent) VALUES(1, 1, '101', 3000000)").run();
  db.prepare("INSERT INTO periods(id, building_id, month, locked) VALUES(1, 1, '2026-10', 0)").run();
  db.prepare("INSERT INTO invoices(id, period_id, room_id, version, input, total) VALUES(10, 1, 1, 1, '{}', 3000000)").run();
  db.prepare("INSERT INTO invoice_versions(invoice_id, version, input, total) VALUES(10, 1, '{}', 3000000)").run();
  db.prepare("INSERT INTO invoice_charge_rules(invoice_id, version, details) VALUES(10, 1, '{}')").run();
  db.prepare("INSERT INTO payments(id, invoice_id, amount) VALUES(100, 10, 1000000)").run();
  db.prepare("INSERT INTO payment_reversals(payment_id) VALUES(100)").run();

  const user = { id: 1, email: 'admin@test.com', role: 'SUPER_ADMIN' };
  const res = deleteInvoiceRecord(db, 10, user, 'Deleted for unit test');
  assert.equal(res.ok, true);
  assert.equal(res.id, 10);

  // Assert records deleted
  assert.equal(db.prepare('SELECT count(*) as c FROM invoices WHERE id=10').get().c, 0);
  assert.equal(db.prepare('SELECT count(*) as c FROM invoice_versions WHERE invoice_id=10').get().c, 0);
  assert.equal(db.prepare('SELECT count(*) as c FROM invoice_charge_rules WHERE invoice_id=10').get().c, 0);
  assert.equal(db.prepare('SELECT count(*) as c FROM payments WHERE invoice_id=10').get().c, 0);
  assert.equal(db.prepare('SELECT count(*) as c FROM payment_reversals WHERE payment_id=100').get().c, 0);

  // Assert audit log created
  const log = db.prepare("SELECT * FROM audit_logs WHERE action='DELETE' AND entity='invoice'").get();
  assert.ok(log);
  assert.equal(log.entity_id, 10);
  assert.equal(log.reason, 'Deleted for unit test');
  db.close();
});

