import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAutoSync} from '../public/scripts/auto-sync.mjs';

function fixture(check){
  let task,delay,shown=true,expired=0;
  const sync=createAutoSync({check,visible:()=>shown,onUnauthorized:()=>expired++,setTimer(fn,ms){task=fn;delay=ms;return fn;},clearTimer(){task=null;}});
  return {sync,get delay(){return delay;},get pending(){return Boolean(task);},get expired(){return expired;},show(value){shown=value;},async tick(){const fn=task;task=null;await fn?.();}};
}
test('checks immediately then every three seconds without overlapping reads',async()=>{
  let calls=0,release;const gate=new Promise(r=>release=r);
  const f=fixture(async()=>{calls++;if(calls===1)await gate;});f.sync.start();assert.equal(f.delay,0);
  const first=f.tick();f.sync.wake();f.sync.wake();assert.equal(calls,1);release();await first;
  assert.equal(f.delay,0);await f.tick();assert.equal(calls,2);assert.equal(f.delay,3000);f.sync.stop();assert.equal(f.pending,false);
});
test('hidden pages pause and returning pages check immediately',async()=>{
  let calls=0;const f=fixture(async()=>calls++);f.sync.start();await f.tick();f.show(false);await f.tick();assert.equal(calls,1);assert.equal(f.pending,false);
  f.show(true);f.sync.wake();assert.equal(f.delay,0);await f.tick();assert.equal(calls,2);
});
test('network failures back off, recovery resets the interval, and no writes are retried',async()=>{
  let failing=true,calls=0;const f=fixture(async()=>{calls++;if(failing)throw Error('offline');});f.sync.start();await f.tick();assert.equal(f.delay,6000);
  await f.tick();assert.equal(f.delay,12000);await f.tick();await f.tick();assert.equal(f.delay,30000);
  failing=false;f.sync.wake();assert.equal(f.delay,0);await f.tick();assert.equal(f.delay,3000);assert.equal(calls,5);
});
test('expired sessions stop checking and clear authenticated UI once',async()=>{
  const f=fixture(async()=>{throw Object.assign(Error('expired'),{status:401});});f.sync.start();await f.tick();assert.equal(f.expired,1);assert.equal(f.pending,false);f.sync.wake();assert.equal(f.pending,false);
});
test('leaving a page during a read does not restart its timer',async()=>{
  let release;const f=fixture(()=>new Promise(r=>release=r));f.sync.start();const first=f.tick();f.sync.stop();release();await first;assert.equal(f.pending,false);
  f.sync.start();assert.equal(f.delay,0);
});
