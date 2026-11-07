import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMemberNames,previewMemberNames} from '../public/scripts/participant-groups.mjs';
import {createStateStore} from '../public/scripts/ledger-domain.mjs';
import {ledgerExport} from '../public/scripts/ledger-export.mjs';
import {restoreState} from '../server/ledger-import.mjs';

async function fixture(){
  const state={ledgers:{},members:{},expenses:{},payments:{},templates:{},occurrences:{},invites:{},claims:{}};
  const owner={uid:'owner-user',displayName:'Owner'},other={uid:'other-user',displayName:'Other'};
  const store=user=>createStateStore({user,read:()=>state,mutate:fn=>fn(state,user,'2026-11-07T12:00:00.000Z')});
  const a=store(owner),b=store(other),id=await a.createLedger({title:'Trip',currency:'CNY'});
  state.ledgers[id].memberUids.push(other.uid);state.members[id].other={name:'Other',uid:other.uid,createdAt:'2026-11-07T12:00:00.000Z'};
  return {state,id,a,b,outsider:store({uid:'outsider'}),owner};
}
test('batch parser preserves full names, handles common separators and reviews duplicates once',()=>{
  assert.deepEqual(parseMemberNames(' 张三、李四，Jane Doe\n张三;Alex\t ALEX '),{names:['张三','李四','Jane Doe','Alex'],duplicates:2});
  for(const value of ['', 'a'.repeat(41),Array.from({length:51},(_,i)=>`Person ${i}`).join('\n')])assert.throws(()=>parseMemberNames(value));
  const rows=previewMemberNames(['张三','Alex','New'],[{id:'a',name:'张三'},{id:'b',name:'Alex'},{id:'c',name:'Alex'},{id:'d',name:'New',status:'inactive'}]);
  assert.deepEqual(rows.map(row=>row.memberId),['a','','new']);
});
test('mixed batch reuses identities and validates every row before mutating',async()=>{
  const f=await fixture(),before=structuredClone(f.state);
  await assert.rejects(f.a.addMembers(f.id,[{name:'New',create:true,expectedMatches:[]},{name:'No one',memberId:'foreign'}]));assert.deepEqual(f.state,before);
  const result=await f.b.addMembers(f.id,[{name:'Owner',memberId:'owner'},{name:'New',create:true,expectedMatches:[]}]);
  assert.equal(result[0].id,'owner');assert.equal(result[1].uid,null);assert.equal(result[1].createdByUid,'other-user');
  await assert.rejects(f.a.addMembers(f.id,[{name:'undefined',memberId:'__proto__'}]));
});
test('concurrent same-name creation requires fresh review, while explicit same-name creation is possible',async()=>{
  const f=await fixture();const old=[{name:'Sam',create:true,expectedMatches:[]}];
  const [sam]=await f.a.addMembers(f.id,old);
  await assert.rejects(f.b.addMembers(f.id,old),e=>e.statusCode===409);
  const [second]=await f.b.addMembers(f.id,[{name:'Sam',create:true,expectedMatches:[sam.id]}]);assert.notEqual(second.id,sam.id);
  const [reused]=await f.a.addMembers(f.id,[{name:'Sam',memberId:sam.id}]);assert.equal(reused.id,sam.id);
  await f.a.setMemberStatus(f.id,sam.id,'inactive');await assert.rejects(f.a.addMembers(f.id,[{name:'Sam',memberId:sam.id}]));
});
test('groups share across members but edits require creator/owner, version and active ledger',async()=>{
  const f=await fixture();const g=await f.b.saveParticipantGroup(f.id,{name:'Dinner',memberIds:['owner','other']});
  assert.deepEqual((await f.a.loadLedger(f.id)).participantGroups,[g]);
  const own=await f.a.saveParticipantGroup(f.id,{name:'Owner group',memberIds:['owner']});
  await assert.rejects(f.b.deleteParticipantGroup(f.id,own.id,own.version));await assert.rejects(f.outsider.loadLedger(f.id));
  await assert.rejects(f.a.saveParticipantGroup(f.id,{name:'dinner',memberIds:['owner']}));
  const edited=await f.a.saveParticipantGroup(f.id,{name:'Evening',memberIds:['other'],expectedVersion:1},g.id);assert.equal(edited.version,2);
  await assert.rejects(f.b.saveParticipantGroup(f.id,{name:'Stale',memberIds:['owner'],expectedVersion:1},g.id),e=>e.statusCode===409);
  await assert.rejects(f.b.deleteParticipantGroup(f.id,g.id,1),e=>e.statusCode===409);
  await f.a.setLedgerStatus(f.id,'archived');await assert.rejects(f.b.saveParticipantGroup(f.id,{name:'Archive',memberIds:['other']}));await assert.rejects(f.a.addMembers(f.id,[{name:'New',create:true,expectedMatches:[]}]));
});
test('deactivation stays visible in groups; unused member removal removes references and invalidates old edits',async()=>{
  const f=await fixture(),[m]=await f.a.addMembers(f.id,[{name:'Guest',create:true,expectedMatches:[]}]);
  const g=await f.a.saveParticipantGroup(f.id,{name:'Guests',memberIds:[m.id]});
  await f.a.setMemberStatus(f.id,m.id,'inactive');assert.deepEqual((await f.a.loadLedger(f.id)).participantGroups[0].memberIds,[m.id]);
  await assert.rejects(f.a.saveParticipantGroup(f.id,{name:'Guests',memberIds:[m.id],expectedVersion:1},g.id));
  await f.a.removeMember(f.id,m.id);const updated=(await f.a.loadLedger(f.id)).participantGroups[0];assert.deepEqual(updated.memberIds,[]);assert.equal(updated.version,2);
  await assert.rejects(f.a.deleteParticipantGroup(f.id,g.id,1));await f.a.deleteParticipantGroup(f.id,g.id,2);assert.equal((await f.a.loadLedger(f.id)).participantGroups.length,0);
});
test('full export/import restores group names and remaps member identities; older backups remain valid',async()=>{
  const f=await fixture();await f.a.saveParticipantGroup(f.id,{name:'Trip',memberIds:['owner','other']});
  const {data}=ledgerExport(await f.a.loadLedger(f.id));
  const restored=restoreState({data,files:new Map()},f.owner,{memberId:'owner'});
  const groups=Object.values(restored.state.participantGroups[restored.id]);assert.equal(groups[0].name,'Trip');assert.equal(groups[0].memberIds.length,2);assert.ok(groups[0].memberIds.every(id=>Object.hasOwn(restored.state.members[restored.id],id)));
  const corrupt=structuredClone(data);corrupt.participantGroups[0].memberIds=['missing'];assert.throws(()=>restoreState({data:corrupt,files:new Map()},f.owner,{memberId:'owner'}));
  delete data.participantGroups;assert.deepEqual(Object.values(restoreState({data,files:new Map()},f.owner,{memberId:'owner'}).state.participantGroups).flatMap(Object.values),[]);
});
