import './login-i18n.mjs';
import {t,translateError} from './i18n.mjs';
import {apiRequest,currentSession} from './api-store.mjs';
const form=document.querySelector('#emailLoginForm'),submit=document.querySelector('#loginButton'),toggle=document.querySelector('#signupButton'),error=document.querySelector('#login-error'),nameField=document.querySelector('#signup-name');
let registering=false,busy=false;
function destination(){
  const raw=new URLSearchParams(location.search).get('next');
  try {const url=new URL(raw||'/app.html',location.origin);if(url.origin===location.origin&&url.pathname==='/app.html')return url.pathname+url.search+url.hash;}catch{}
  return '/app.html';
}
function render(){
  nameField.hidden=!registering;form.elements.displayName.required=registering;
  form.elements.password.autocomplete=registering?'new-password':'current-password';
  submit.dataset.i18n=busy?(registering?'正在创建账号…':'正在登录…'):registering?'创建账号':'登录并继续';submit.textContent=t(submit.dataset.i18n);
  const heading=document.querySelector('.login-form h2');
  heading.dataset.i18n=registering?'创建账号':'欢迎回来';heading.textContent=t(heading.dataset.i18n);
  const subtitle=document.querySelector('.login-form > p');
  subtitle.dataset.i18n=registering?'创建账号，开始你们共同的账本。':'登录后，继续你们共同的账本。';subtitle.textContent=t(subtitle.dataset.i18n);
  toggle.dataset.i18n=registering?'已有账号？登录':'注册新账号';toggle.textContent=t(toggle.dataset.i18n);
  submit.disabled=busy;toggle.disabled=busy;
}
toggle.addEventListener('click',()=>{registering=!registering;error.hidden=true;render();});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;render();error.hidden=true;
  const data=new FormData(form),body={email:data.get('email'),password:data.get('password')};
  if(registering)body.displayName=data.get('displayName');
  try {await apiRequest(`/api/auth/${registering?'register':'login'}`,{method:'POST',body});location.replace(destination());}
  catch(problem){error.textContent=translateError(problem);error.hidden=false;}
  finally{busy=false;render();}
});
document.addEventListener('languagechange',render);
render();
try {const {user}=await currentSession();if(user)location.replace(destination());}
catch(problem){error.textContent=translateError(problem);error.hidden=false;}
