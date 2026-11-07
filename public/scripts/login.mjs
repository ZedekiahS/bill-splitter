import './login-i18n.mjs';
import {t,translateError,translatePage} from './i18n.mjs';
import {apiRequest,currentSession} from './api-store.mjs';
const form=document.querySelector('#emailLoginForm'),submit=document.querySelector('#loginButton'),toggle=document.querySelector('#signupButton'),error=document.querySelector('#login-error'),nameField=document.querySelector('#signup-name');
let registering=false,busy=false,recovering=false,pendingRecovery=null;
const recoveryToggle=document.querySelector('#recoverButton');
const recoveryLabel=document.createElement('label');recoveryLabel.className='form-field';recoveryLabel.hidden=true;
recoveryLabel.innerHTML='<span class="field-label" data-i18n="恢复码">恢复码</span><input class="form-input" name="code" autocomplete="off" spellcheck="false" maxlength="32"><small class="form-hint" data-i18n="输入注册时或账号设置中保存的一次性恢复码。">输入注册时或账号设置中保存的一次性恢复码。</small>';
form.insertBefore(recoveryLabel,error);
const recoverySaved=document.createElement('section');recoverySaved.hidden=true;
recoverySaved.innerHTML='<label class="form-field"><span class="field-label" data-i18n="恢复码">恢复码</span><input class="form-input" readonly></label><button class="button primary full-width" type="button" data-i18n="已保存，进入账本">已保存，进入账本</button>';
form.parentNode.append(recoverySaved);
recoverySaved.querySelector('button').addEventListener('click',()=>location.replace(destination()));
function destination(){
  const raw=new URLSearchParams(location.search).get('next');
  try {const url=new URL(raw||'/app.html',location.origin);if(url.origin===location.origin&&url.pathname==='/app.html')return url.pathname+url.search+url.hash;}catch{}
  return '/app.html';
}
function render(){
  if(pendingRecovery){form.hidden=true;toggle.hidden=true;recoveryToggle.hidden=true;recoverySaved.hidden=false;recoverySaved.querySelector('input').value=pendingRecovery;
    const heading=document.querySelector('.login-form h2'),subtitle=document.querySelector('.login-form > p');heading.dataset.i18n='保存恢复码';heading.textContent=t('保存恢复码');subtitle.dataset.i18n='恢复码只显示这一次。请保存在密码管理器或其他安全位置，不要分享给他人。';subtitle.textContent=t(subtitle.dataset.i18n);translatePage();return;}
  nameField.hidden=!registering;form.elements.displayName.required=registering;
  const passwordLabel=form.elements.password.closest('label').querySelector('.field-label');
  passwordLabel.dataset.i18n=recovering?'新密码':'密码';
  form.elements.password.autocomplete=registering?'new-password':'current-password';
  submit.dataset.i18n=busy?(registering?'正在创建账号…':'正在登录…'):registering?'创建账号':'登录并继续';submit.textContent=t(submit.dataset.i18n);
  const heading=document.querySelector('.login-form h2');
  heading.dataset.i18n=registering?'创建账号':'欢迎回来';heading.textContent=t(heading.dataset.i18n);
  const subtitle=document.querySelector('.login-form > p');
  subtitle.dataset.i18n=registering?'创建账号，开始你们共同的账本。':'登录后，继续你们共同的账本。';subtitle.textContent=t(subtitle.dataset.i18n);
  toggle.dataset.i18n=registering?'已有账号？登录':'注册新账号';toggle.textContent=t(toggle.dataset.i18n);
  submit.disabled=busy;toggle.disabled=busy;
  recoveryLabel.hidden=!recovering;form.elements.code.required=recovering;recoveryToggle.disabled=busy;
  recoveryToggle.textContent=t(recovering?'返回登录':'忘记密码？');recoveryToggle.dataset.i18n=recovering?'返回登录':'忘记密码？';
  if(recovering){heading.textContent=t('重设密码');heading.dataset.i18n='重设密码';subtitle.textContent=t('使用恢复码验证身份，并设置新密码。');subtitle.dataset.i18n='使用恢复码验证身份，并设置新密码。';submit.textContent=t('保存新密码');submit.dataset.i18n='保存新密码';form.elements.password.autocomplete='new-password';}
  translatePage();
}
toggle.addEventListener('click',()=>{recovering=false;registering=!registering;error.hidden=true;render();});
recoveryToggle.addEventListener('click',()=>{recovering=!recovering;registering=false;form.elements.password.value='';error.hidden=true;render();});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;render();error.hidden=true;
  const data=new FormData(form),body={email:data.get('email'),password:data.get('password')};
  if(registering)body.displayName=data.get('displayName');
  try {if(recovering){await apiRequest('/api/auth/recover',{method:'POST',body:{...body,code:data.get('code').trim()}});recovering=false;form.elements.password.value='';form.elements.code.value='';error.textContent=t('密码已更新，请使用新密码登录。');error.hidden=false;}else{const result=await apiRequest(`/api/auth/${registering?'register':'login'}`,{method:'POST',body});if(registering&&result.recoveryCode){pendingRecovery=result.recoveryCode;form.elements.password.value='';}else location.replace(destination());}}
  catch(problem){error.textContent=translateError(problem);error.hidden=false;}
  finally{busy=false;render();}
});
document.addEventListener('languagechange',render);
render();
try {const {user}=await currentSession();if(user)location.replace(destination());}
catch(problem){error.textContent=translateError(problem);error.hidden=false;}
