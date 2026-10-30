// One read at a time. Writes are never retried by this scheduler.
export function createAutoSync({check,onUnauthorized,visible=()=>!document.hidden,
  setTimer=setTimeout,clearTimer=clearTimeout,interval=3000,maxDelay=30000}) {
  let active=false,running=false,timer=null,delay=interval,again=false;
  function schedule(ms){clearTimer(timer);timer=setTimer(run,ms);}
  async function run(){
    if(!active||running)return;
    if(!visible())return;
    running=true;
    try {await check();delay=interval;}
    catch(error){
      if(error.status===401){stop();onUnauthorized(error);}
      else delay=Math.min(delay*2,maxDelay);
    } finally {
      running=false;
      if(active&&visible())schedule(again?0:delay);
      again=false;
    }
  }
  function wake(){if(!active)return;clearTimer(timer);if(running)again=true;else if(visible())schedule(0);}
  function start(){if(active)return;active=true;delay=interval;wake();}
  function stop(){active=false;again=false;clearTimer(timer);}
  return {start,stop,wake};
}
