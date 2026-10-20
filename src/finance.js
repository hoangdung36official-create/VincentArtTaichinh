export const integer = (value, name = 'amount') => { if (!Number.isSafeInteger(value)) throw Error(`${name} must be a safe integer`); return value; };
// Meter readings may contain up to 3 decimal places. Scale first and do
// all monetary calculations as integers, rejecting fractional VND.
const meterMilli = (value, name) => {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER/1000)throw Error(`${name} must be a nonnegative meter reading`);
  const scaled=value*1000;
  if(!Number.isSafeInteger(Math.round(scaled))||Math.abs(scaled-Math.round(scaled))>0.000001)throw Error(`${name} has too many decimal places`);
  return BigInt(Math.round(scaled));
};
const meterCharge=(usage,rate,name)=>{
  const exact=usage*BigInt(rate);
  if(exact%1000n!==0n)throw Error(`${name} must be whole VND`);
  const v=exact/1000n;
  if(v>BigInt(Number.MAX_SAFE_INTEGER))throw Error(`${name} must be a safe integer`);
  return Number(v);
};
export function calculateInvoice(input) {
  const rent = integer(input.rent ?? 0,'rent');
  const previousElectric = meterMilli(input.previousElectric,'previousElectric');
  const currentElectric = meterMilli(input.currentElectric,'currentElectric');
  const previousWater = meterMilli(input.previousWater,'previousWater');
  const currentWater = meterMilli(input.currentWater,'currentWater');
  const electricRate = integer(input.electricRate ?? 0,'electricRate');
  const waterRate = integer(input.waterRate ?? 0,'waterRate');
  const internet = integer(input.internet ?? 0,'internet');
  const cleaning = integer(input.cleaning ?? 0,'cleaning');
  const parking = integer(input.parking ?? 0,'parking');
  const extras = integer(input.extras ?? 0,'extras');
  const discount = integer(input.discount ?? 0,'discount');
  for (const [name,value] of Object.entries({rent,electricRate,waterRate,internet,cleaning,parking,extras,discount})) if (value<0) throw Error(`${name} cannot be negative`);
  if (currentElectric<previousElectric || currentWater<previousWater) throw Error('Meter reading cannot decrease');
  const electricity=meterCharge(currentElectric-previousElectric,electricRate,'electricity');
  const water=meterCharge(currentWater-previousWater,waterRate,'water');
  // A positive subtotal may exceed 2^53 before a discount brings it back
  // into range. Keep every intermediate VND calculation exact.
  const exactTotal=[rent,electricity,water,internet,cleaning,parking,extras]
    .reduce((sum,value)=>sum+BigInt(value),0n)-BigInt(discount);
  if(exactTotal<0n)throw Error('Invoice total cannot be negative');
  if(exactTotal>BigInt(Number.MAX_SAFE_INTEGER))throw Error('total must be a safe integer');
  return Number(exactTotal);
}
export function paymentStatus(total,paid){integer(total);integer(paid);if(total<0||paid<0)throw Error('Balance cannot be negative');return paid===0?'UNPAID':paid<total?'PARTIAL':paid===total?'PAID':'OVERPAID';}
export function balance(total,paid){return {due:Math.max(total-paid,0),overpaid:Math.max(paid-total,0),status:paymentStatus(total,paid)};}
