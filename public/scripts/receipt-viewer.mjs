import {t} from './i18n.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function receiptUrl(file){
  if(typeof file.url==='string'&&/^\/api\/ledgers\/[a-f0-9-]+\/receipts\/[a-f0-9-]+$/.test(file.url))return file.url;
  if(typeof file.dataUrl==='string'&&/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(file.dataUrl))return file.dataUrl;
  return '';
}
export function receiptMarkup(files){
  return (files||[]).map(file=>{const url=receiptUrl(file);if(!url)return '';
    return `<div class="receipt-row">${file.type.startsWith('image/')?`<button type="button" class="receipt-preview" data-view-receipt="${escape(url)}" data-receipt-name="${escape(file.name)}" aria-label="${t('查看附件 {name}',{name:escape(file.name)})}"><img src="${escape(url)}" alt="${escape(file.name)}" loading="lazy"></button>`:''}<span class="receipt-caption">${escape(file.name)}</span><a href="${escape(url)}" download="${escape(file.name)}" class="text-link">${t('下载收据')}</a></div>`;
  }).join('');
}
export function closeReceiptViewer(){document.querySelector('#receipt-viewer')?.close();}
export function openReceiptViewer(url,name,trigger){
  if(!receiptUrl({url,dataUrl:url}))return;
  let dialog=document.querySelector('#receipt-viewer');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='receipt-viewer';dialog.className='receipt-viewer';document.body.append(dialog);}
  dialog.setAttribute('aria-label',t('查看附件 {name}',{name}));
  dialog.innerHTML=`<header class="receipt-viewer-header"><strong>${escape(name)}</strong><button type="button" class="button secondary" data-viewer-close>${t('关闭')}</button></header><div class="receipt-toolbar"><button type="button" class="button secondary" data-zoom="out">${t('缩小')}</button><output aria-live="polite">100%</output><button type="button" class="button secondary" data-zoom="in">${t('放大')}</button><button type="button" class="text-link" data-zoom="fit">${t('适应宽度')}</button><a class="text-link" href="${escape(url)}" download="${escape(name)}">${t('下载收据')}</a></div><div class="receipt-stage" tabindex="0" aria-label="${t('附件图片')}"><img src="${escape(url)}" alt="${escape(name)}"></div><p class="form-error" hidden>${t('图片暂时无法加载，请关闭后重试。')}</p>`;
  let zoom=100;
  const image=dialog.querySelector('img');
  image.addEventListener('error',()=>{dialog.querySelector('.form-error').hidden=false;});
  dialog.onclick=event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-viewer-close'))dialog.close();
    if(button.dataset.zoom){zoom=button.dataset.zoom==='fit'?100:Math.max(50,Math.min(300,zoom+(button.dataset.zoom==='in'?25:-25)));image.style.width=`${zoom}%`;dialog.querySelector('output').value=`${zoom}%`;dialog.querySelector('[data-zoom="out"]').disabled=zoom===50;dialog.querySelector('[data-zoom="in"]').disabled=zoom===300;}
  };
  dialog.addEventListener('close',()=>{dialog.innerHTML='';if(trigger?.isConnected)trigger.focus();},{once:true});
  dialog.showModal();
}
