// CSV values intended for Excel: always quote, and neutralize formulas in user text.
export function exportCsv(columns,rows){
 if(!Array.isArray(columns)||!columns.length||!Array.isArray(rows))throw Error('Invalid CSV export');
 const encode=(value)=>{
  let text=String(value??'');
  if(typeof value!=='number'&&/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;
  return `"${text.replace(/"/g,'""')}"`;
 };
 return [columns.map(([label])=>encode(label)).join(','),...rows.map(row=>columns.map(([,key])=>encode(row[key])).join(','))].join('\r\n');
}
