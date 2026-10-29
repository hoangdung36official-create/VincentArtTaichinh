export const integer = (value, name = 'amount') => { if (!Number.isSafeInteger(value)) throw Error(`${name} must be a safe integer`); return value; };
// Meter readings may contain up to 3 decimal places. Scale first and do
// all monetary calculations as integers, rejecting fractional VND.
const meterMilli = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 1000) throw Error(`${name} must be a nonnegative meter reading`);
  const scaled = value * 1000;
  if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 0.000001) throw Error(`${name} has too many decimal places`);
  return BigInt(Math.round(scaled));
};
const meterCharge = (usage, rate, name) => {
  const exact = usage * BigInt(rate);
  if (exact % 1000n !== 0n) throw Error(`${name} must be whole VND`);
  const v = exact / 1000n;
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw Error(`${name} must be a safe integer`);
  return Number(v);
};

export function calculateItemAmounts(input) {
  const rent = integer(input.rent ?? 0, 'rent');
  const electricEnabled = input.electricEnabled !== false && input.electricEnabled !== 0 && input.electricEnabled !== '0';
  const waterEnabled = input.waterEnabled !== false && input.waterEnabled !== 0 && input.waterEnabled !== '0';
  const internetEnabled = input.internetEnabled !== false && input.internetEnabled !== 0 && input.internetEnabled !== '0';
  const serviceEnabled = input.serviceEnabled !== false && input.serviceEnabled !== 0 && input.serviceEnabled !== '0';
  const parkingEnabled = input.parkingEnabled !== false && input.parkingEnabled !== 0 && input.parkingEnabled !== '0';
  const evChargingEnabled = input.evChargingEnabled === true || input.evChargingEnabled === 1 || input.evChargingEnabled === '1';

  let electricity = 0;
  if (electricEnabled) {
    const previousElectric = meterMilli(input.previousElectric, 'previousElectric');
    const currentElectric = meterMilli(input.currentElectric, 'currentElectric');
    const electricRate = integer(input.electricRate ?? 0, 'electricRate');
    if (currentElectric < previousElectric) throw Error('Meter reading cannot decrease');
    if (electricRate < 0) throw Error('electricRate cannot be negative');
    electricity = meterCharge(currentElectric - previousElectric, electricRate, 'electricity');
  }

  let water = 0;
  if (waterEnabled) {
    const previousWater = meterMilli(input.previousWater, 'previousWater');
    const currentWater = meterMilli(input.currentWater, 'currentWater');
    const waterRate = integer(input.waterRate ?? 0, 'waterRate');
    if (currentWater < previousWater) throw Error('Meter reading cannot decrease');
    if (waterRate < 0) throw Error('waterRate cannot be negative');
    water = meterCharge(currentWater - previousWater, waterRate, 'water');
  }

  let internet = 0;
  if (internetEnabled) {
    const internetRate = integer(input.internetRate !== undefined ? input.internetRate : (input.internet ?? 0), 'internetRate');
    if (internetRate < 0) throw Error('internetRate cannot be negative');
    internet = internetRate;
  }

  let service = 0;
  if (serviceEnabled) {
    if (input.serviceRate !== undefined) {
      const serviceRate = integer(input.serviceRate, 'serviceRate');
      const serviceCount = integer(input.serviceCount ?? input.occupants ?? (serviceRate > 0 ? 1 : 0), 'serviceCount');
      if (serviceRate < 0 || serviceCount < 0) throw Error('service charge cannot be negative');
      const exactService = BigInt(serviceCount) * BigInt(serviceRate);
      if (exactService > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('service charge must be a safe integer');
      service = Number(exactService);
    } else {
      const cleaning = integer(input.cleaning ?? 0, 'cleaning');
      if (cleaning < 0) throw Error('cleaning cannot be negative');
      service = cleaning;
    }
  }

  let parking = 0;
  if (parkingEnabled) {
    if (input.parkingRate !== undefined) {
      const parkingRate = integer(input.parkingRate, 'parkingRate');
      const parkingCount = integer(input.parkingCount ?? (parkingRate > 0 ? 1 : 0), 'parkingCount');
      if (parkingRate < 0 || parkingCount < 0) throw Error('parking charge cannot be negative');
      const exactParking = BigInt(parkingCount) * BigInt(parkingRate);
      if (exactParking > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('parking charge must be a safe integer');
      parking = Number(exactParking);
    } else {
      const p = integer(input.parking ?? 0, 'parking');
      if (p < 0) throw Error('parking cannot be negative');
      parking = p;
    }
  }

  let evCharging = 0;
  if (evChargingEnabled) {
    const evRate = integer(input.evChargingRate ?? 0, 'evChargingRate');
    const evCount = integer(input.evChargingCount ?? 0, 'evChargingCount');
    if (evRate < 0 || evCount < 0) throw Error('ev charging charge cannot be negative');
    const exactEv = BigInt(evCount) * BigInt(evRate);
    if (exactEv > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('ev charging charge must be a safe integer');
    evCharging = Number(exactEv);
  }

  const extras = integer(input.extras ?? 0, 'extras');
  const discount = integer(input.discount ?? 0, 'discount');
  if (rent < 0 || extras < 0 || discount < 0) throw Error('charges cannot be negative');

  const exactTotal = [rent, electricity, water, internet, service, parking, evCharging, extras]
    .reduce((sum, value) => sum + BigInt(value), 0n) - BigInt(discount);

  if (exactTotal < 0n) throw Error('Invoice total cannot be negative');
  if (exactTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('total must be a safe integer');

  return {
    rent,
    electricity,
    water,
    internet,
    service,
    parking,
    evCharging,
    extras,
    discount,
    total: Number(exactTotal),
    electricEnabled,
    waterEnabled,
    internetEnabled,
    serviceEnabled,
    parkingEnabled,
    evChargingEnabled
  };
}

export function calculateInvoice(input) {
  return calculateItemAmounts(input).total;
}

export function paymentStatus(total, paid) {
  integer(total);
  integer(paid);
  if (total < 0 || paid < 0) throw Error('Balance cannot be negative');
  return paid === 0 ? 'UNPAID' : paid < total ? 'PARTIAL' : paid === total ? 'PAID' : 'OVERPAID';
}

export function balance(total, paid) {
  return { due: Math.max(total - paid, 0), overpaid: Math.max(paid - total, 0), status: paymentStatus(total, paid) };
}

export function migrateSchema(db) {
  const roomColumns = new Set(db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name));
  const roomColsToAdd = [
    { name: 'occupants', sql: 'ALTER TABLE rooms ADD COLUMN occupants INTEGER NOT NULL DEFAULT 0' },
    { name: 'electric_rate', sql: 'ALTER TABLE rooms ADD COLUMN electric_rate INTEGER DEFAULT NULL CHECK(electric_rate>=0)' },
    { name: 'water_rate', sql: 'ALTER TABLE rooms ADD COLUMN water_rate INTEGER DEFAULT NULL CHECK(water_rate>=0)' },
    { name: 'electric_enabled', sql: 'ALTER TABLE rooms ADD COLUMN electric_enabled INTEGER NOT NULL DEFAULT 1' },
    { name: 'water_enabled', sql: 'ALTER TABLE rooms ADD COLUMN water_enabled INTEGER NOT NULL DEFAULT 1' },
    { name: 'internet_enabled', sql: 'ALTER TABLE rooms ADD COLUMN internet_enabled INTEGER NOT NULL DEFAULT 1' },
    { name: 'internet_rate', sql: 'ALTER TABLE rooms ADD COLUMN internet_rate INTEGER DEFAULT NULL CHECK(internet_rate>=0)' },
    { name: 'service_enabled', sql: 'ALTER TABLE rooms ADD COLUMN service_enabled INTEGER NOT NULL DEFAULT 1' },
    { name: 'service_count', sql: 'ALTER TABLE rooms ADD COLUMN service_count INTEGER NOT NULL DEFAULT 1 CHECK(service_count>=0)' },
    { name: 'service_rate', sql: 'ALTER TABLE rooms ADD COLUMN service_rate INTEGER NOT NULL DEFAULT 150000 CHECK(service_rate>=0)' },
    { name: 'parking_enabled', sql: 'ALTER TABLE rooms ADD COLUMN parking_enabled INTEGER NOT NULL DEFAULT 1' },
    { name: 'parking_count', sql: 'ALTER TABLE rooms ADD COLUMN parking_count INTEGER NOT NULL DEFAULT 0 CHECK(parking_count>=0)' },
    { name: 'parking_rate', sql: 'ALTER TABLE rooms ADD COLUMN parking_rate INTEGER NOT NULL DEFAULT 100000 CHECK(parking_rate>=0)' },
    { name: 'ev_charging_enabled', sql: 'ALTER TABLE rooms ADD COLUMN ev_charging_enabled INTEGER NOT NULL DEFAULT 0' },
    { name: 'ev_charging_count', sql: 'ALTER TABLE rooms ADD COLUMN ev_charging_count INTEGER NOT NULL DEFAULT 0 CHECK(ev_charging_count>=0)' },
    { name: 'ev_charging_rate', sql: 'ALTER TABLE rooms ADD COLUMN ev_charging_rate INTEGER NOT NULL DEFAULT 100000 CHECK(ev_charging_rate>=0)' },
    { name: 'previous_electric', sql: 'ALTER TABLE rooms ADD COLUMN previous_electric INTEGER DEFAULT NULL' },
    { name: 'current_electric', sql: 'ALTER TABLE rooms ADD COLUMN current_electric INTEGER DEFAULT NULL' },
    { name: 'previous_water', sql: 'ALTER TABLE rooms ADD COLUMN previous_water INTEGER DEFAULT NULL' },
    { name: 'current_water', sql: 'ALTER TABLE rooms ADD COLUMN current_water INTEGER DEFAULT NULL' },
    { name: 'extras', sql: 'ALTER TABLE rooms ADD COLUMN extras INTEGER NOT NULL DEFAULT 0' }
  ];
  for (const col of roomColsToAdd) {
    if (!roomColumns.has(col.name)) {
      db.exec(col.sql);
      roomColumns.add(col.name);
    }
  }

  const invoiceColumns = new Set(db.prepare('PRAGMA table_info(invoices)').all().map(c => c.name));
  const invoiceColsToAdd = [
    { name: 'service_details', sql: 'ALTER TABLE invoices ADD COLUMN service_details TEXT DEFAULT NULL' }
  ];
  for (const col of invoiceColsToAdd) {
    if (!invoiceColumns.has(col.name)) {
      db.exec(col.sql);
      invoiceColumns.add(col.name);
    }
  }

  db.exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);');
}

export function deleteInvoiceRecord(db, invoiceId, user, reason = '', inTransaction = false) {
  const current = db.prepare('SELECT i.*, p.building_id, p.locked, r.code as room_code, p.month FROM invoices i JOIN periods p ON p.id=i.period_id JOIN rooms r ON r.id=i.room_id WHERE i.id=?').get(invoiceId);
  if (!current) throw Object.assign(new Error('Invoice missing'), { status: 404 });
  if (current.locked) throw Object.assign(new Error('Period locked'), { status: 409 });

  if (!inTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    const period = db.prepare('SELECT locked FROM periods WHERE id=?').get(current.period_id);
    if (period.locked) throw Object.assign(new Error('Period locked'), { status: 409 });

    db.prepare('DELETE FROM payment_reversals WHERE payment_id IN (SELECT id FROM payments WHERE invoice_id=?)').run(invoiceId);
    db.prepare('DELETE FROM payments WHERE invoice_id=?').run(invoiceId);
    db.prepare('DELETE FROM invoice_charge_rules WHERE invoice_id=?').run(invoiceId);
    db.prepare('DELETE FROM invoice_versions WHERE invoice_id=?').run(invoiceId);
    db.prepare('DELETE FROM invoices WHERE id=?').run(invoiceId);

    const beforeData = {
      room: current.room_code,
      month: current.month,
      total: current.total,
      input: JSON.parse(current.input)
    };
    db.prepare('INSERT INTO audit_logs(user_id, action, entity, entity_id, before_data, after_data, reason) VALUES(?,?,?,?,?,?,?)')
      .run(user.id, 'DELETE', 'invoice', invoiceId, JSON.stringify(beforeData), null, reason || 'Deleted invoice');

    if (!inTransaction) db.exec('COMMIT');
    return { ok: true, id: invoiceId };
  } catch (e) {
    if (!inTransaction) db.exec('ROLLBACK');
    throw e;
  }
}
