import {test} from 'node:test';
import assert from 'node:assert/strict';
import {continuationOptions,memberEntryMatch,assignItemMember} from '../public/scripts/entry-context.mjs';
import {completePercentages} from '../public/scripts/percentage-entry.mjs';

test('continue carries context and percentage intent, never the previous bill contents',()=>{
 const payload={payerMemberId:'b',date:'2026-11-01',title:'Dinner',amountCents:10000,note:'Private',receipts:[{id:'file'}],items:[{title:'Old item'}]};
 const options=continuationOptions(payload,{splitType:'percent',participantIds:['a','b'],percentages:{a:'60',b:'40',unused:'80'},percentEdited:['a','unused']});
 assert.deepEqual(options,{participantIds:['a','b'],continuation:{payerMemberId:'b',date:'2026-11-01',splitType:'percent',percentages:{a:'60',b:'40'},percentEdited:['a']}});
 for(const splitType of ['equal','amount','items'])assert.deepEqual(continuationOptions(payload,{splitType,participantIds:['a','b']}),{participantIds:['a','b'],continuation:{payerMemberId:'b',date:'2026-11-01',splitType}});
});
test('Enter reuses a unique exact match, asks for ambiguous names, and excludes inactive people',()=>{
 const members=[{id:'a',name:'小林'},{id:'b',name:'Alex'},{id:'c',name:'Alex'},{id:'d',name:'小雨',status:'inactive'}];
 assert.equal(memberEntryMatch(members,' 小林 ').member.id,'a');
 assert.equal(memberEntryMatch(members,'alex').action,'choose');
 assert.equal(memberEntryMatch(members,'小').action,'create');
 assert.equal(memberEntryMatch(members,'小雨').action,'create');
 assert.equal(memberEntryMatch(members,' ').action,'empty');
});
test('item assignment changes only explicitly chosen items and enforces the participant cap',()=>{
 const items=[{title:'Dinner',amount:'90',memberIds:['a']},{title:'Parking',amount:'10',memberIds:['a','b']}];
 const selected=assignItemMember(items,'c',0,true);
 assert.deepEqual(selected[0].memberIds,['a','c']);assert.deepEqual(selected[1],items[1]);assert.deepEqual(items[0].memberIds,['a']);
 assert.deepEqual(assignItemMember(selected,'c',0,false),items);
 const full=[{title:'Group',memberIds:Array.from({length:50},(_,i)=>String(i))}];
 assert.throws(()=>assignItemMember(full,'extra',0,true),/50/);
});
test('restoring one manual percentage to automatic preserves the other manual shares',()=>{
 const values={a:'50',b:'20',c:'20',d:'10'};
 assert.deepEqual(completePercentages(['a','b','c','d'],values,['a','b']),{a:'50',b:'20',c:'15.00',d:'15.00'});
});
