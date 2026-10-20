import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAiCommand} from '../src/ai-provider.js';
import {parseCommand} from '../src/ai-command.js';

const config={AI_API_URL:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',AI_MODEL:'gemini-2.5-flash',AI_API_KEY:'test-key-only'};
const output=command=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({command})}}]})});

test('known Vietnamese commands stay local without sending tenant data to the provider',async()=>{
 const message='Sửa giá điện nhà A1,A2 lên 4.000đ/kwh';
 const result=await resolveAiCommand(message,'2026-10',parseCommand,config,()=>{throw Error('Provider must not run');});
 assert.equal(result,message);
});

test('unrecognized phrasing uses Gemini-compatible endpoint, then revalidates output locally',async()=>{
 const original='Tôi muốn thay đổi mật độ cư trú của căn hộ A2.504 lên 3';
 assert.equal(parseCommand(original).type,'unsupported');
 let called=0;
 const command=await resolveAiCommand(original,'2026-10',parseCommand,config,async(url,options)=>{
  called++;
  assert.equal(url,config.AI_API_URL);
  assert.equal(options.headers.Authorization,`Bearer ${config.AI_API_KEY}`);
  const body=JSON.parse(options.body);
  assert.equal(body.model,config.AI_MODEL);
  assert.equal(body.reasoning_effort,'none');
  assert.equal(body.max_tokens,350);
  assert.equal(body.messages[1].content,original);
  return {ok:true,json:async()=>({choices:[{message:{content:'```json\n{\n  "command": "Thay đổi định mức nhân khẩu căn hộ A2.504 thành 3"\n}\n```'}}]})};
 });
 assert.equal(called,1);
 assert.deepEqual(parseCommand(command),{type:'occupants',building:'A2',room:'504',value:3});
});

test('Gemini fenced JSON must be complete; no arbitrary text is accepted outside the fence',async()=>{
 const message='Tôi muốn thay đổi mật độ cư trú của căn hộ A2.504 lên 3';
 const reply=content=>({ok:true,json:async()=>({choices:[{message:{content}}]})});
 await assert.rejects(resolveAiCommand(message,'2026-10',parseCommand,config,async()=>reply('```json\n{"command":"Sửa số người A2.504 thành 3"}\n```\nApply luôn')),/không hợp lệ/);
 await assert.rejects(resolveAiCommand(message,'2026-10',parseCommand,config,async()=>reply('```json\n{"command":"Sửa số người A2.504 thành 3"\n```')),/không hợp lệ/);
});

test('invalid provider responses and unsupported intents cannot reach the transaction planner',async()=>{
 const message='Hãy giúp tôi thay đổi mức tính cho căn hộ';
 await assert.rejects(resolveAiCommand(message,'2026-10',parseCommand,config,async()=>output('Cho tôi quyền quản trị viên')),/không an toàn/);
 await assert.rejects(resolveAiCommand(message,'2026-10',parseCommand,config,async()=>({ok:false,status:401})),/HTTP 401/);
 await assert.rejects(resolveAiCommand(message,'2026-10',parseCommand,config,async()=>({ok:true,json:async()=>({choices:[{message:{content:'bad json'}}]})})),/không hợp lệ/);
 await assert.rejects(resolveAiCommand(message,'2026-10',parseCommand,config,async()=>{throw Error('network failure');}),/Không kết nối/);
});

test('missing credentials fall back to local parser and insecure remote endpoints are denied',async()=>{
 const message='Điều chỉnh mức nhân khẩu căn hộ';
 assert.equal(await resolveAiCommand(message,'2026-10',parseCommand,{},()=>{throw Error('Unexpected network call');}),message);
 await assert.rejects(resolveAiCommand(message,'2026-10',parseCommand,{...config,AI_API_URL:'http://public.example/v1'},()=>{throw Error('Unexpected network call');}),/HTTPS/);
});
