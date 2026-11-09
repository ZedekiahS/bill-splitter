import {t,translateError} from './i18n.mjs';
import {parseMemberNames,previewMemberNames,nameKey} from './participant-groups.mjs';

// One inline workflow shared by bulk entry and saved participant groups.
export function mountParticipantTools(c){
  const {host,escape}=c;
  host.insertAdjacentHTML('afterend',`<section class="participant-shortcuts"><details id="batch-member-tools"><summary>${t('批量添加')}</summary><label class="form-field"><span class="field-label">${t('成员名单')}</span><textarea id="batch-member-names" class="form-input" rows="3" maxlength="5000" placeholder="${t('每行一个名字，也可用逗号或顿号分隔')}"></textarea></label><button type="button" class="button secondary" data-member-tool="preview-batch">${t('核对名单')}</button><div id="batch-member-review"></div></details><details id="saved-group-tools"><summary>${t('常用组合')}</summary><div class="group-toolbar"><label class="form-field"><span class="field-label">${t('选择组合')}</span><select class="form-select" id="participant-group-picker"><option value="">${t('选择组合')}</option></select></label><button type="button" class="text-link" data-member-tool="refresh-groups">${t('刷新组合')}</button></div><div id="participant-group-review"></div><details id="new-participant-group"><summary>${t('将当前选择存为组合')}</summary><p id="group-current-members" class="form-hint"></p><label class="form-field"><span class="field-label">${t('组合名称')}</span><input id="participant-group-name" class="form-input" maxlength="40" placeholder="${t('例如：晚餐四人')}"></label><button type="button" class="button secondary" data-member-tool="save-group">${t('保存组合')}</button></details></details><p class="form-error" id="participant-tools-error" role="alert" hidden></p><p class="form-hint" id="participant-tools-status" role="status" hidden></p></section>`);
  const root=host.nextElementSibling,$=s=>root.querySelector(s),batch=$('#batch-member-names'),review=$('#batch-member-review'),picker=$('#participant-group-picker'),groupReview=$('#participant-group-review'),error=$('#participant-tools-error'),status=$('#participant-tools-status');
  let directory={members:c.members,participantGroups:[]},rows=[],busy=false,renderedGroup=null;
  const edits=structuredClone(c.recovered?.groupEdits||{});
  const sameIds=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  function captureEdit(){
    const input=$('#edit-group-name');if(!input||!renderedGroup)return;
    const base=edits[renderedGroup.id]?.base||{name:renderedGroup.name,memberIds:[...renderedGroup.memberIds],version:renderedGroup.version};
    const memberIds=[...groupReview.querySelectorAll('[data-edit-group-member]:checked')].map(box=>box.value),name=input.value;
    // Returning to old field values does not acknowledge a newer remote version.
    if(name===base.name&&sameIds(memberIds,base.memberIds)&&base.version===renderedGroup.version)delete edits[renderedGroup.id];
    else edits[renderedGroup.id]={base,name,memberIds};
  }
  batch.value=c.recovered?.batchNames||'';
  $('#participant-group-name').value=c.recovered?.groupName||'';
  const say=message=>{status.textContent=message;status.hidden=!message;};
  const fail=problem=>{error.textContent=translateError(problem);error.hidden=false;};
  async function run(action){
    if(busy||c.busy())return;const focus=document.activeElement;busy=true;error.hidden=true;say('');c.setBusy(true);
    try{await action();}catch(problem){if(root.isConnected)fail(problem);}
    finally{busy=false;if(root.isConnected){c.setBusy(false);c.changed();if(focus?.isConnected&&!focus.disabled)focus.focus();else if($('#saved-group-tools').open)picker.focus();else batch.focus();}}
  }
  const memberLabel=m=>{if(!m)return t('已移除成员');const same=directory.members.filter(row=>nameKey(row.name)===nameKey(m.name));return m.name+(same.length>1?` · ${t(m.uid?'已加入':'临时成员')} ${same.findIndex(row=>row.id===m.id)+1}`:'');};
  const group=()=>directory.participantGroups.find(row=>row.id===picker.value);
  const active=id=>directory.members.find(m=>m.id===id&&m.status!=='inactive');
  const selectedGroupIds=()=>[...groupReview.querySelectorAll('[data-group-member]:checked')].map(box=>box.value);
  function itemChoices(prefix){
    const items=c.items();if(!items)return '';
    return `<fieldset class="shortcut-items"><legend>${t('加入哪些消费项目？')}</legend>${items.map((row,i)=>`<label><input type="checkbox" data-${prefix}-item="${i}"><span>${escape(row.title)||t('项目 {number}',{number:i+1})}</span></label>`).join('')}</fieldset>`;
  }
  function itemIndexes(prefix){
    if(!c.items())return null;
    const ids=[...root.querySelectorAll(`[data-${prefix}-item]:checked`)].map(box=>Number(box.getAttribute(`data-${prefix}-item`)));
    if(!ids.length)throw new Error('请至少选择一个消费项目。');return ids;
  }
  function renderBatch(duplicates=0){
    review.innerHTML=`${duplicates?`<p class="form-hint">${t('已合并 {count} 个重复名字。',{count:duplicates})}</p>`:''}<div class="batch-review-list">${rows.map((row,i)=>`<div class="batch-review-row"><label class="batch-name"><input type="checkbox" data-batch-include="${i}" checked><span>${escape(row.name)}</span></label><label><span class="sr-only">${t('{name}的成员身份',{name:escape(row.name)})}</span><select class="form-select" data-batch-choice="${i}">${row.matches.length>1?`<option value="">${t('请选择同名成员')}</option>`:''}${row.matches.map((m,index)=>`<option value="${escape(m.id)}" ${row.memberId===m.id?'selected':''}>${t('复用：{name}',{name:escape(m.name)})}${row.matches.length>1?` · ${t(m.uid?'已加入':'临时成员')} ${index+1}`:''}</option>`).join('')}<option value="new" ${row.memberId==='new'?'selected':''}>${t(row.matches.length?'另建同名成员':'新建成员')}</option></select></label></div>`).join('')}</div>${itemChoices('batch')}<button type="button" class="button primary" data-member-tool="confirm-batch">${t('确认添加并选择')}</button>`;
  }
  function renderGroup(){
    captureEdit();
    const g=group();renderedGroup=g||null;if(!g){groupReview.innerHTML='';const selected=picker.value;if(!group()&&edits[selected])groupReview.innerHTML=`<p class="form-hint">${t('这个组合已删除，未保存的编辑仍保留在草稿中。')}</p><p>${escape(edits[selected].name)}</p><button type="button" class="text-link" data-member-tool="discard-group-edit">${t('放弃组合修改')}</button>`;return;}
    const edit=edits[g.id],values=edit||g;
    const editMembers=[...directory.members,...values.memberIds.filter(id=>!directory.members.some(m=>m.id===id)).map(id=>({id,name:t('已移除成员'),status:'inactive'}))];
    const editable=c.owner||g.createdByUid===c.user.uid;
    groupReview.innerHTML=`<div class="group-members">${g.memberIds.length?g.memberIds.map(id=>{const m=directory.members.find(row=>row.id===id);return `<label><input type="checkbox" data-group-member value="${escape(id)}" ${active(id)?'checked':'disabled'}><span>${escape(memberLabel(m))}${!active(id)?` · ${t(m?'已停用':'已移除')}`:''}</span></label>`;}).join(''):`<p class="form-hint">${t('组合中暂无可选成员。')}</p>`}</div>${itemChoices('group')}<div class="group-actions"><button type="button" class="button secondary" data-member-tool="apply-group">${t(c.items()?'加入所选项目':'替换本笔参与人')}</button>${c.items()?'':`<button type="button" class="text-link" data-member-tool="append-group">${t('加入本笔参与人')}</button>`}</div>${editable?`<details class="group-edit" ${edit?'open':''}><summary>${t('编辑组合')}</summary><label class="form-field"><span class="field-label">${t('组合名称')}</span><input class="form-input" id="edit-group-name" value="${escape(values.name)}" maxlength="40"></label><fieldset class="group-edit-members"><legend>${t('组合成员')}</legend><div class="group-members">${editMembers.map(m=>`<label><input type="checkbox" data-edit-group-member value="${escape(m.id)}" ${values.memberIds.includes(m.id)?'checked':''} ${m.status==='inactive'&&!g.memberIds.includes(m.id)&&!values.memberIds.includes(m.id)?'disabled':''}><span>${escape(memberLabel(m))}${m.status==='inactive'?` · ${t('已停用')}`:''}</span></label>`).join('')}</div></fieldset><button type="button" class="text-link" data-member-tool="copy-selection">${t('使用本笔参与人')}</button><div class="group-actions"><button type="button" class="button secondary" data-member-tool="update-group">${t('更新组合')}</button><button type="button" class="text-link danger-link" data-member-tool="ask-delete-group">${t('删除组合')}</button></div><button type="button" class="text-link" data-member-tool="discard-group-edit">${t('放弃组合修改')}</button>${edit&&edit.base.version!==g.version?`<div class="form-hint"><p>${t('组合已被更新，请核对最新内容后再保存。')}</p><p>${t('最新组合：{name}',{name:escape(g.name)})} · ${g.memberIds.map(id=>escape(memberLabel(directory.members.find(m=>m.id===id)))).join('、')}</p><button type="button" class="button secondary" data-member-tool="review-group-edit">${t('已核对，保留我的编辑')}</button></div>`:''}<div id="delete-group-confirm" hidden><p>${t('删除这个组合？成员和已有账单会保留。')}</p><button type="button" class="button danger" data-member-tool="delete-group">${t('确认删除组合')}</button><button type="button" class="text-link" data-member-tool="cancel-delete-group">${t('取消')}</button></div></details>`:''}`;
  }
  async function loadGroups(selected=picker.value){
    captureEdit();
    directory=await c.loadDirectory();if(!root.isConnected)return;
    directory.participantGroups||=[];
    picker.innerHTML=`<option value="">${t('选择组合')}</option>${directory.participantGroups.map(g=>`<option value="${escape(g.id)}">${escape(g.name)} · ${g.memberIds.length}</option>`).join('')}`;
    for(const [id,edit] of Object.entries(edits))if(!directory.participantGroups.some(g=>g.id===id))picker.insertAdjacentHTML('beforeend',`<option value="${escape(id)}">${escape(edit.name)} · ${t('已删除')}</option>`);
    picker.value=selected;renderGroup();
  }
  function currentGroup(){
    const ids=c.selected();if(!ids.length||ids.length>50)throw new Error('每个组合请选择 1 至 50 位不同成员。');return ids;
  }
  batch.addEventListener('input',()=>{rows=[];review.innerHTML='';error.hidden=true;say('');});
  review.addEventListener('change',event=>{if(event.target.hasAttribute('data-batch-include'))review.querySelector(`[data-batch-choice="${event.target.dataset.batchInclude}"]`).disabled=!event.target.checked;});
  picker.addEventListener('change',()=>{error.hidden=true;say('');renderGroup();c.changed();});
  for(const type of ['input','change'])groupReview.addEventListener(type,()=>{captureEdit();c.changed();});
  $('#saved-group-tools').addEventListener('toggle',()=>{if($('#saved-group-tools').open&&!busy)run(()=>loadGroups());});
  $('#new-participant-group').addEventListener('toggle',()=>{if($('#new-participant-group').open)updateCurrent();});
  function updateCurrent(){const ids=c.selected();$('#group-current-members').textContent=ids.map(id=>c.members.find(m=>m.id===id)?.name).filter(Boolean).join('、')||t('请先选择参与人。');}
  root.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.matches('#participant-group-name,#edit-group-name')){event.preventDefault();root.querySelector(`[data-member-tool="${event.target.id==='edit-group-name'?'update-group':'save-group'}"]`).click();}});
  root.addEventListener('click',event=>{
    const action=event.target.closest('[data-member-tool]')?.dataset.memberTool;if(!action)return;
    if(action==='copy-selection'){const ids=c.selected();groupReview.querySelectorAll('[data-edit-group-member]').forEach(box=>box.checked=!box.disabled&&ids.includes(box.value));captureEdit();c.changed();return;}
    if(action==='discard-group-edit'){delete edits[picker.value];renderedGroup=null;renderGroup();c.changed();return;}
    if(action==='review-group-edit'){const g=group(),edit=edits[g?.id];if(edit){edit.base={name:g.name,memberIds:[...g.memberIds],version:g.version};renderedGroup=null;renderGroup();c.changed();}return;}
    if(action==='ask-delete-group'){$('#delete-group-confirm').hidden=false;return;}
    if(action==='cancel-delete-group'){$('#delete-group-confirm').hidden=true;return;}
    run(async()=>{
      if(action==='preview-batch'){
        const parsed=parseMemberNames(batch.value);directory=await c.loadDirectory();
        if(!root.isConnected)return;rows=previewMemberNames(parsed.names,directory.members);renderBatch(parsed.duplicates);return;
      }
      if(action==='confirm-batch'){
        const entries=[...review.querySelectorAll('[data-batch-include]:checked')].map(box=>{
          const i=Number(box.dataset.batchInclude),row=rows[i],choice=review.querySelector(`[data-batch-choice="${i}"]`).value;
          if(!choice)throw new Error('请先选择同名成员，或明确另建一位。');
          return choice==='new'?{name:row.name,create:true,expectedMatches:row.expectedMatches}:{name:row.name,memberId:choice};
        });
        if(!entries.length)throw new Error('请至少选择一位成员。');
        const indexes=itemIndexes('batch');c.validateSelection(entries.map((row,i)=>row.memberId||`new:${i}`),false,indexes);
        let members;try{members=await c.addMembers(entries);}catch(problem){if(problem.status===409||problem.statusCode===409){directory=await c.loadDirectory();rows=previewMemberNames(parseMemberNames(batch.value).names,directory.members);renderBatch();}throw problem;}
        if(!root.isConnected)return;c.apply(members,false,indexes);rows=[];batch.value='';review.innerHTML='';say(t(indexes?'已将 {count} 位成员加入所选项目。':'已选择 {count} 位成员。',{count:members.length}));return;
      }
      if(action==='refresh-groups'){await loadGroups();return;}
      if(action==='save-group'){
        const g=await c.saveGroup({name:$('#participant-group-name').value,memberIds:currentGroup()});
        if(!root.isConnected)return;$('#participant-group-name').value='';$('#new-participant-group').open=false;await loadGroups(g.id);say(t('组合已保存。'));return;
      }
      const g=group();if(!g)throw new Error('请先选择组合。');
      if(action==='apply-group'||action==='append-group'){
        const ids=selectedGroupIds();if(!ids.length)throw new Error('请至少选择一位成员。');
        const indexes=itemIndexes('group'),replace=action==='apply-group'&&!indexes;
        const latest=await c.loadDirectory(),fresh=latest.participantGroups?.find(row=>row.id===g.id);
        if(!fresh||fresh.version!==g.version||ids.some(id=>!latest.members.some(m=>m.id===id&&m.status!=='inactive'))){await loadGroups(g.id);throw new Error('组合或成员已变化，请重新核对后选择。');}
        c.validateSelection(ids,replace,indexes);c.apply(ids.map(id=>latest.members.find(m=>m.id===id)),replace,indexes);say(t(indexes?'已将 {count} 位成员加入所选项目。':'已选择 {count} 位成员。',{count:ids.length}));return;
      }
      if(action==='update-group'){
        captureEdit();const edit=edits[g.id];
        try{await c.saveGroup({name:edit?.name??g.name,memberIds:edit?.memberIds??g.memberIds,expectedVersion:edit?.base.version??g.version},g.id);}
        catch(problem){if(problem.status===409||problem.statusCode===409)await loadGroups(g.id);throw problem;}
        delete edits[g.id];renderedGroup=null;await loadGroups(g.id);say(t('组合已保存。'));return;
      }
      if(action==='delete-group'){await c.deleteGroup(g.id,g.version);delete edits[g.id];renderedGroup=null;await loadGroups('');say(t('组合已删除。'));}
    });
  });
  if(c.recovered?.selectedGroup||Object.keys(edits).length){$('#saved-group-tools').open=true;run(()=>loadGroups(c.recovered?.selectedGroup||Object.keys(edits)[0]));}
  return {capture:()=>{captureEdit();return {batchNames:batch.value,groupName:$('#participant-group-name').value,selectedGroup:picker.value,groupEdits:structuredClone(edits)};},updateCurrent,
    readyToSave(){
      captureEdit();const unsaved=Object.keys(edits)[0];
      if(unsaved){fail(new Error('组合修改尚未保存，请先更新组合或放弃修改。'));$('#saved-group-tools').open=true;picker.value=unsaved;renderGroup();if($('.group-edit'))$('.group-edit').open=true;$('#edit-group-name')?.focus();return false;}
      if(batch.value.trim()){fail(new Error('名单尚未确认，请先确认添加，或清空名单。'));$('#batch-member-tools').open=true;root.querySelector('[data-member-tool="preview-batch"]').focus();return false;}
      if($('#participant-group-name').value.trim()){fail(new Error('组合尚未保存，请先保存组合，或清空名称。'));$('#saved-group-tools').open=true;$('#new-participant-group').open=true;$('#participant-group-name').focus();return false;}
      return true;
    },modeChanged(){rows=[];review.innerHTML='';renderGroup();}};
}
