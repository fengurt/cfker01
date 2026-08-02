(function adminInteractions(){
  const tooltip=document.getElementById("interaction-tooltip"),help=document.getElementById("shortcut-dialog"),helpButton=document.getElementById("shortcut-help");
  if(!tooltip||!help||!helpButton)return;
  const mac=/Mac|iPhone|iPad/.test(navigator.platform),meta=mac?"⌘":"Ctrl",alt=mac?"⌥":"Alt";
  const workspaces=["manage-tasks","manage-projects","manage-servers","manage-cloud","manage-repositories"];
  const labels={
    "zh-CN":{open:"打开",newTab:"新标签打开",details:"查看详情",server:"查看服务器",switchView:"切换视图",toggle:"展开或收起",activate:"执行操作",search:"聚焦当前视图搜索",newTask:"新建任务",help:"快捷键帮助",language:"切换语言",close:"关闭弹窗",sections:["任务","项目","服务器与部署","云资源","仓库"]},
    en:{open:"Open",newTab:"Open in new tab",details:"View details",server:"View server",switchView:"Switch view",toggle:"Expand or collapse",activate:"Run action",search:"Focus current search",newTask:"New task",help:"Keyboard shortcuts",language:"Switch language",close:"Close dialog",sections:["Tasks","Projects","Servers and deployments","Cloud resources","Repositories"]}
  };
  function copy(){return labels[document.documentElement.lang==="en"?"en":"zh-CN"];}
  function shortcutRows(){const text=copy();return [[`${meta} K`,text.newTask],["/",text.search],...text.sections.map((name,index)=>[`${alt} ${index+1}`,name]),["?",text.help],["Esc",text.close]];}
  function renderHelp(){const text=copy(),english=document.documentElement.lang==="en",target=document.getElementById("shortcut-list");document.getElementById("shortcut-dialog-title").textContent=text.help;document.getElementById("shortcut-dialog-help").textContent=english?"Switch views, search, and create tasks without leaving the keyboard.":"无需离开键盘即可切换视图、搜索和新建任务。";help.querySelector('.dialog-head button[value="cancel"]').setAttribute("aria-label",english?"Close keyboard help":"关闭快捷键帮助");help.querySelector('.dialog-actions button[value="cancel"]').textContent=english?"Close":"关闭";target.replaceChildren();for(const[key,label]of shortcutRows()){const row=document.createElement("div"),name=document.createElement("span"),keycap=document.createElement("kbd");row.className="shortcut-row";name.textContent=label;keycap.textContent=key;row.append(name,keycap);target.append(row);}}
  function editable(target){return target instanceof HTMLElement&&(target.matches("input,textarea,select")||target.isContentEditable);}
  function dashboardReady(){return !document.getElementById("dashboard")?.hidden;}
  function candidate(target){return target instanceof Element?target.closest('a[href],button:not(:disabled),summary,[role="button"],[data-interaction-hint]'):null;}
  function hintFor(node){
    const text=copy(),index=workspaces.indexOf(node.id);
    if(index>=0)return{label:`${text.switchView}: ${text.sections[index]}`,key:`${alt} ${index+1}`};
    if(node.id==="quick-task-open")return{label:text.newTask,key:`${meta} K`};
    if(node.id==="shortcut-help")return{label:text.help,key:"?"};
    if(node.id==="language")return{label:text.language,key:"Enter"};
    if(node.matches("summary"))return{label:text.toggle,key:"Space"};
    if(node.matches('a[target="_blank"]'))return{label:text.newTab,key:"Enter"};
    if(node.classList.contains("local-path-link"))return{label:document.documentElement.lang==="en"?"Open in VS Code, right-click to copy":"在 VS Code 打开，右键复制",key:"Enter"};
    if(node.classList.contains("fleet-server-tile")||node.classList.contains("server-inline-link"))return{label:text.server,key:"Enter"};
    if(node.matches(".task-title-button,.task-board-card,.resource-name-link,.manage-compact"))return{label:text.details,key:"Enter"};
    const explicit=node.dataset.interactionHint;if(explicit)return{label:explicit,key:node.dataset.shortcut||"Enter"};
    if(node.matches("a[href]"))return{label:text.open,key:"Enter"};
    return{label:text.activate,key:"Enter"};
  }
  let active=null;
  function show(node){if(!matchMedia("(hover:hover) and (pointer:fine)").matches)return;active=node;const hint=hintFor(node),label=tooltip.querySelector("span"),key=tooltip.querySelector("kbd");label.textContent=hint.label;key.textContent=hint.key;tooltip.hidden=false;node.setAttribute("aria-describedby","interaction-tooltip");position(node);}
  function position(node){if(tooltip.hidden)return;const rect=node.getBoundingClientRect(),tip=tooltip.getBoundingClientRect(),gap=8;let top=rect.bottom+gap;if(top+tip.height>innerHeight-8)top=Math.max(8,rect.top-tip.height-gap);const left=Math.min(innerWidth-tip.width/2-8,Math.max(tip.width/2+8,rect.left+rect.width/2));tooltip.style.left=`${left+scrollX}px`;tooltip.style.top=`${top+scrollY}px`;}
  function hide(node=active){if(node)node.removeAttribute("aria-describedby");active=null;tooltip.hidden=true;}
  document.addEventListener("pointerover",event=>{const node=candidate(event.target);if(node&&node!==active)show(node);});
  document.addEventListener("pointerout",event=>{if(active&&!active.contains(event.relatedTarget))hide();});
  document.addEventListener("focusin",event=>{const node=candidate(event.target);if(node)show(node);});
  document.addEventListener("focusout",event=>{if(active&&!active.contains(event.relatedTarget))hide();});
  window.addEventListener("resize",()=>hide(),{passive:true});
  helpButton.addEventListener("click",()=>{renderHelp();if(!help.open)help.showModal();});
  workspaces.forEach((id,index)=>document.getElementById(id)?.setAttribute("aria-keyshortcuts",`Alt+${index+1}`));
  document.querySelectorAll('input[type="search"]').forEach(input=>input.setAttribute("aria-keyshortcuts","/"));
  document.getElementById("language")?.addEventListener("click",()=>helpButton.setAttribute("aria-label",copy().help));
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&help.open){help.close();helpButton.focus();return;}
    if(event.altKey&&/^Digit[1-5]$/.test(event.code)){if(!dashboardReady())return;event.preventDefault();const button=document.getElementById(workspaces[Number(event.code.at(-1))-1]);button?.click();button?.focus();return;}
    if(editable(event.target))return;
    if(event.key==="?"){event.preventDefault();renderHelp();if(!help.open)help.showModal();return;}
    if(event.key==="/"){if(!dashboardReady())return;event.preventDefault();const visible=["tasks-view","projects-view","servers-view","cloud-view","repositories-view"].map(id=>document.getElementById(id)).find(node=>node&&!node.hidden);let search=visible?.querySelector('input[type="search"]');if(!(search instanceof HTMLElement)){document.getElementById("manage-projects")?.click();search=document.querySelector('#project-filters input[type="search"]');}if(search instanceof HTMLElement)search.focus();return;}
  });
})();
