import test from 'node:test';import assert from 'node:assert/strict';import {parseCommand} from '../src/ai-command.js';
test('bulk electric rate',()=>assert.deepEqual(parseCommand('Sửa giá điện toàn bộ phòng nhà A1,A2 lên 4.000đ/kwh'),{type:'electric_rate',buildings:['A1','A2'],value:4000}));
test('occupants',()=>assert.deepEqual(parseCommand('sửa số người ở phòng A2.504 thành 3'),{type:'occupants',building:'A2',room:'504',value:3}));
test('Gemini occupancy phrasing is understood locally',()=>assert.deepEqual(parseCommand('Thay đổi định mức nhân khẩu căn hộ A2.504 thành 3'),{type:'occupants',building:'A2',room:'504',value:3}));
test('Gemini alternative occupancy phrasing is supported',()=>assert.deepEqual(parseCommand('Cập nhật số cư dân phòng A2.504 thành 3'),{type:'occupants',building:'A2',room:'504',value:3}));
test('meter',()=>assert.deepEqual(parseCommand('số nước mới của A4.301 là 50 tháng 10/2026'),{type:'water_reading',building:'A4',room:'301',value:50,month:'2026-10'}));
test('electric meter in natural-language command',()=>assert.deepEqual(parseCommand('Sửa chỉ số điện mới phòng A1.201 thành 130 tháng 10/2026'),{type:'electric_reading',building:'A1',room:'201',value:130,month:'2026-10'}));
test('electric meter with selected month',()=>assert.deepEqual(parseCommand('điện mới của A4.301 là 50'),{type:'electric_reading',building:'A4',room:'301',value:50,month:null}));
test('month without a year inherits the selected billing year',()=>{
 assert.equal(parseCommand('Sửa điện mới phòng A1.201 thành 130 tháng 10',2027).month,'2027-10');
 assert.equal(parseCommand('Sửa điện mới phòng A1.201 thành 130 tháng 10/2026',2027).month,'2026-10');
 assert.equal(parseCommand('Lấy hóa đơn A4.301 tháng 12',2025).month,'2025-12');
});
test('invoice lookup',()=>assert.equal(parseCommand('Lấy hóa đơn A4.301 tháng 10/2026').type,'invoice_lookup'));

test('parse Vietnamese building with 62 rooms distributed by floors without swallowing the address',()=>{
 const command='Tạo tòa nhà v27 địa chỉ 11 ngõ 21/50/7 Yên xá, 62 phòng 3 phòng tầng 1, tầng 2-> 7 là 9p 1 tầng, tầng 8 có 5p';
 const result=parseCommand(command);
 assert.equal(result.type,'create_building_floors');
 assert.equal(result.code,'V27');
 assert.equal(result.name,'Nhà V27');
 assert.equal(result.address,'11 ngõ 21/50/7 Yên xá');
 assert.equal(result.totalRooms,62);
 assert.deepEqual(result.floors,[{floor:1,count:3},...Array.from({length:6},(_,i)=>({floor:i+2,count:9})),{floor:8,count:5}]);
});

test('partial or conflicting floor text produces explicit validation data',()=>{
 const base='Tạo tòa nhà V27 địa chỉ Yên Xá, ';
 assert.match(parseCommand(base+'62 phòng tầng 2->7 là 9p 1 tầng, tầng 8 có 5p').totalRooms.toString(),/62/);
 assert.match(parseCommand(base+'62 phòng tầng 2->7 là 9p 1 tầng, tầng 8 có 5p').floors.length.toString(),/7/);
 assert.match(parseCommand(base+'62 phòng 3 phòng tầng 1, tầng 8 có vài phòng').layoutError,/Chưa hiểu cấu trúc tầng/);
 assert.match(parseCommand(base+'62 phòng tầng 8 có 5p, tầng 8 có 5p').floors.length.toString(),/2/);
});

test('AI commands recognize Vietnamese building names, rooms, money, meters, debt and exports',()=>{
 const building=parseCommand('Thêm tòa nhà A15 tên Tòa A15 địa chỉ 20 Lê Lợi giá điện 4.000');
 assert.deepEqual(building,{type:'create_building',code:'A15',name:'Tòa A15',address:'20 Lê Lợi',electricRate:4000,waterRate:undefined});
 const rooms=parseCommand('Thêm các phòng 201,202,203 nhà A15 giá phòng 4.300.000 internet 100.000 vệ sinh 150.000');
 assert.deepEqual(rooms,{type:'create_rooms',building:'A15',codes:['201','202','203'],rent:4300000,internet:100000,cleaning:150000,parking:undefined,occupants:undefined});
 assert.deepEqual(parseCommand('Thêm phòng A15.401 giá phòng 3.000.000').codes,['401']);
 assert.deepEqual(parseCommand('Nhập điện mới nhà A15: 201=130, 202=140 tháng 10/2026'),{type:'meter_batch',building:'A15',field:'currentElectric',month:'2026-10',readings:[{room:'201',value:130},{room:'202',value:140}]});
 assert.equal(parseCommand('Nhập nước mới nhà A15: 201=10, 202=11 tháng 10/2026').field,'currentWater');
 assert.deepEqual(parseCommand('Tìm công nợ nhà A15 tháng 10/2026'),{type:'debt_search',building:'A15',room:undefined,month:'2026-10'});
 assert.equal(parseCommand('Xuất ảnh hóa đơn nhà A15 tháng 10/2026').type,'invoice_images');
 assert.deepEqual(parseCommand('Lấy hóa đơn nhà A15 tháng 10/2026'),{type:'invoice_lookup',building:'A15',room:undefined,month:'2026-10'});
 assert.equal(parseCommand('Import Excel nhà A15').type,'import_help');
 assert.deepEqual(parseCommand('Tìm phòng A15.201'),{type:'entity_search',building:'A15',room:'201'});
});
