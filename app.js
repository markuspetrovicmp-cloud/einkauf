/* Einkauf — eine kleine, offline-first Listen-App im Wohin-Stil.
   Lizenz: Eigener Beispielcode. Firebase ist optional; ohne Konfiguration lokal nutzbar.
   Datenmodell v1; ausschließlich einzelne Artikel für konfliktarme Synchronisierung. */
(()=>{
'use strict';
const KEY='einkauf.bento.v1';
const THEME_KEY = 'listen.theme';
const THEMES = [['blue-orange','Blau–Orange'], ['sage-olive','Sage–Olive']];

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'sage-olive' ? '#fff8e7' : '#ede9df';
}

try { applyTheme(localStorage.getItem(THEME_KEY) === 'sage-olive' ? 'sage-olive' : 'blue-orange'); }
catch { applyTheme('blue-orange'); }
// Handschrift-Scan: URL deines Cloudflare-Workers (siehe scan-worker.js und README). Leer = nur einfache Texterkennung.
const SCAN_URL='';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const STORES=['Alle Geschäfte','Gurkerl','Hofer','Billa','Spar','Lidl','Bipa','dm','Müller','OBI'];
const storeOptions=()=>STORES.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
const LIST_COLORS = new Map([
  ['terracotta', 'Orange'],
  ['sage', 'Türkis'],
  ['honey', 'Meeresblau'],
  ['clay', 'Korallrot'],
  ['petrol', 'Tiefblau'],
  ['cream', 'Schieferblau']
]);

function listColor(list, index = state.lists.indexOf(list)) {
  const defaults = ['terracotta', 'sage', 'honey', 'petrol', 'clay', 'cream'];
  return LIST_COLORS.has(list.color) ? list.color : defaults[Math.max(0, index) % defaults.length];
}

function colorField(selected) {
  const sageNames = ['Terracotta', 'Salbei', 'Olive', 'Braun', 'Dunkeloliv', 'Elfenbein'];
  const sage = document.documentElement.dataset.theme === 'sage-olive';
  const options = [...LIST_COLORS].map(([id, name], index) =>
    `<label class="color-choice"><input type="radio" name="listColor" value="${id}" ${selected === id ? 'checked' : ''}><span data-color="${id}" aria-hidden="true"></span>${sage ? sageNames[index] : name}</label>`
  ).join('');
  return `<fieldset class="list-colors"><legend>Kachelfarbe</legend>${options}</fieldset>`;
}

const initial=()=>({version:1,activeId:'woche',lists:[{id:'woche',name:'Wocheneinkauf',store:'Alle Geschäfte',sharedId:null},{id:'gurkerl',name:'Gurkerl',store:'Gurkerl',sharedId:null}],items:[],pending:[],entryBuffer:null});
let state=load(), showDone=false, firebaseReady=false, firebaseBusy=false, cloud=null, cloudUser=null, cloudError='',listeners=new Map(), scanStream=null,qrLoop=0,notifyTimer=null;
function load(){try{const a=JSON.parse(localStorage.getItem(KEY)); if(a && a.version===1 && Array.isArray(a.lists)&&Array.isArray(a.items))return {...initial(),...a,pending:Array.isArray(a.pending)?a.pending:[]};}catch(e){}return initial();}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));$('#saveStatus').textContent='Lokal gespeichert';}catch(e){$('#saveStatus').textContent='Achtung: Speichern im Browser gesperrt';}}
function alertToast(msg,ms=2800){const t=$('#toast');t.textContent=msg;t.classList.add('visible');clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>t.classList.remove('visible'),ms);}
function active(){return state.lists.find(x=>x.id===state.activeId)||state.lists[0];}
function listItems(id){return state.items.filter(x=>x.listId===id);}
function openModal(title,content){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=content;$('#overlay').hidden=false;}
function closeModal(){stopDictation();stopScan();$('#overlay').hidden=true;$('#modalBody').innerHTML='';}
function formVal(name){return document.querySelector(`[name="${name}"]`)?.value?.trim()||'';}
const openedLists=new Set(), shownDone=new Set();
// Store metadata travels with shared lists under the existing Firestore schema.
const TODO_STORE = 'Listen. · To-do';
const isTodo = list => list?.store === TODO_STORE;
const DISH_STORE = 'Listen. · Gerichte';
const isDishes = list => list?.store === DISH_STORE;
const isShopping = list => !isTodo(list) && !isDishes(list);

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const planDrafts = new Map();
const dishKey = name => name.trim().toLocaleLowerCase('de-AT').replace(/\s+/g, ' ');

function availableDishes(list, excluded = []) {
  const seen = new Set(excluded.filter(Boolean).map(dishKey));
  return listItems(list.id).map(item => item.text.trim()).filter(name => {
    const key = dishKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function drawDish(pool) {
  return pool.splice(Math.floor(Math.random() * pool.length), 1)[0] ?? '';
}

function newWeekPlan(list) {
  const pool = availableDishes(list);
  return WEEKDAYS.map(() => drawDish(pool));
}

function weekPlanHTML(list) {
  const draft = planDrafts.get(list.id);
  const plan = draft ?? list.weekPlan;
  if (!plan) return '<button type="button" class="secondary wide" data-card-action="new-week">Wochenplan erstellen</button>';
  const rows = WEEKDAYS.map((day, index) => `<li>
    <span><strong>${day}</strong><br>${esc(plan[index] || '—')}</span>
    <button type="button" data-card-action="reroll-day" data-day="${index}"
      aria-label="${day} neu würfeln" title="${day} neu würfeln"
      ${availableDishes(list, plan).length ? '' : 'disabled'}>⟳</button>
  </li>`).join('');
  return `<section class="week-plan item-department" aria-label="Wochenplan">
    <h3><span>Wochenplan</span></h3>
    <ul>${rows}</ul>
    <div class="modal-actions">
      <button type="button" class="secondary" data-card-action="new-week">Neu mischen</button>
      ${draft ? '<button type="button" class="primary" data-card-action="save-week">Speichern</button>' : ''}
      <button type="button" class="secondary" data-card-action="copy-week">Kopieren</button>
      <button type="button" class="secondary" data-card-action="share-week">Teilen</button>
    </div>
  </section>`;
}

async function weekAction(list, action, button) {
  const plan = planDrafts.get(list.id) ?? list.weekPlan;
  if (action === 'new-week') {
    if (!availableDishes(list).length) return alertToast('Füge zuerst ein Gericht hinzu.');
    const proposal = newWeekPlan(list);
    if (plan && proposal[1] && proposal.every((dish, index) => dish === plan[index])) {
      [proposal[0], proposal[1]] = [proposal[1], proposal[0]];
    }
    planDrafts.set(list.id, proposal);
    render();
  } else if (action === 'reroll-day') {
    const index = Number(button.dataset.day);
    const replacement = drawDish(availableDishes(list, plan));
    if (!replacement) return;
    const draft = [...plan];
    draft[index] = replacement;
    planDrafts.set(list.id, draft);
    render();
  } else if (action === 'save-week') {
    list.weekPlan = [...plan];
    planDrafts.delete(list.id);
    persist();
    alertToast('Wochenplan gespeichert');
  } else {
    const message = WEEKDAYS.map((day, index) => day + ': ' + (plan[index] || '—')).join('\n');
    if (action === 'share-week') return shareText('Wochenplan', message);
    try {
      await clipboardText(message);
      alertToast('Wochenplan kopiert');
    } catch {
      alertToast('Kopieren nicht verfügbar');
    }
  }
}



function render(){let a=active();if(!a){state=initial();a=active();save();}
 const host=$('#listCards');const typed={};host.querySelectorAll('.card-add input').forEach(i=>{if(i.value)typed[i.closest('.list-card').dataset.list]=i.value;});const focusList=document.activeElement?.closest?.('.card-add')?.closest('.list-card')?.dataset.list;host.innerHTML=state.lists.map((l,index)=>{const all=listItems(l.id),todo=all.filter(x=>!x.done),done=all.filter(x=>x.done);return `<details name="einkauf-lists" class="list-card" data-kind="${isDishes(l)?'dishes':isTodo(l)?'todo':'shopping'}" data-color="${listColor(l,index)}" data-list="${esc(l.id)}" ${openedLists.has(l.id)?'open':''}><summary><span class="list-name">${esc(l.name)}</span><span class="open-count">${isDishes(l)?all.length+' Gerichte':todo.length+' offen'}</span><span class="card-chevron" aria-hidden="true"></span></summary><div class="card-top"><div class="card-meta"><span>${esc(l.sharedId?(cloudUser?(navigator.onLine?'Gemeinsam · verbunden':'Gemeinsam · offline'):'Gemeinsam · Anmeldung nötig'):'Privat · auf diesem Gerät')}</span><button data-card-action="menu" aria-label="Liste verwalten">⋯</button></div><div class="card-actions" ${isDishes(l)?'hidden':''}><button data-card-action="scan">Zettel importieren</button><button class="gurkerl-copy" data-card-action="copy-gurkerl" ${todo.length ? '' : 'disabled'}>Für Gurkerl kopieren</button></div></div><div class="card-body"><form class="card-add"><input name="article" aria-label="${isDishes(l)?'Gericht':isTodo(l)?'Aufgabe':'Artikel'} für ${esc(l.name)}" placeholder="${isDishes(l)?'Gericht hinzufügen':isTodo(l)?'Aufgabe hinzufügen':'z. B. 500g Tofu'}" maxlength="140" autocomplete="off"><button class="dictation-mic" data-card-action="dictate" aria-label="Eintrag diktieren" type="button"><span aria-hidden="true">🎙</span></button><button aria-label="Eintrag hinzufügen" type="submit">+</button></form><div class="items">${isShopping(l)?departmentHTML(todo):all.map(item=>itemHTML(item,isDishes(l))).join('')}</div>${(isShopping(l)?!todo.length:!all.length)?`<p class="empty">${done.length?'Alles erledigt.':'Deine Liste ist noch leer.'}</p>`:''}${isShopping(l)&&done.length?`<details class="done-accordion" ${shownDone.has(l.id)?'open':''}><summary>Erledigt · ${done.length}<span class="card-chevron" aria-hidden="true"></span></summary><div class="items done-items">${done.map(item=>itemHTML(item)).join('')}</div></details>`:''}${isDishes(l)?weekPlanHTML(l):''}<div class="card-secondary" ${isDishes(l)?'hidden':''}><button data-card-action="recipe">Aus Rezept</button><button data-card-action="share">Teilen</button><button data-card-action="export">Weitere Exporte</button></div></div></details>`;}).join('');
 host.querySelectorAll('.list-card').forEach(c=>{const v=typed[c.dataset.list];if(v!=null)c.querySelector('.card-add input').value=v;if(focusList&&c.dataset.list===focusList)c.querySelector('.card-add input').focus();});
 host.querySelectorAll('.list-card').forEach(el=>el.addEventListener('toggle',()=>{const id=el.dataset.list;if(el.open){if(!openedLists.has(id)){openedLists.clear();openedLists.add(id);state.activeId=id;save();window.scrollTo(0,0);}}else openedLists.delete(id);}));
 host.querySelectorAll('.done-accordion').forEach(el=>el.addEventListener('toggle',()=>{const id=el.closest('.list-card').dataset.list;el.open?shownDone.add(id):shownDone.delete(id);}));
}
// Reihenfolge für den Einkauf. Die Zuordnung wird aus dem Artikelnamen berechnet.
const departments = [
  ['Obst & Gemüse', /^(obst|gem[uü]se|[aä]pfel|apfel|birne|banane|orange|mandarine|zitrone|limette|avocado|kiwi|mango|ananas|melone|traube|beeren|erdbeer|heidelbeer|himbeer|paprika|gurke|zucchini|paradeis|tomate|kartoffel|erdapfel|erd[aä]pfel|zwiebel|knoblauch|karotte|m[oö]hre|salat|rucola|brokkoli|karfiol|blumenkohl|kohl|kraut|k[uü]rbis|melanzani|aubergine|spargel|champignon|pilz|spinat|erbse|fisole|lauch|sellerie|radies|rettich|ingwer|petersil|schnittlauch|basilikum)/],
  ['Brot & Gebäck', /^(brot|semmel|br[oö]tchen|weckerl|kipferl|croissant|baguette|toast|geb[aä]ck|laugen)/],
  ['Kühlregal & Eier', /^(milch|joghurt|yoghurt|skyr|topfen|quark|obers|schlagobers|sahne|butter|k[aä]se|frischk[aä]se|mozzarella|feta|parmesan|gouda|haferdrink|sojadrink|tofu|tempeh|hummus|eier|ei$|kefir|sauerrahm|creme fraiche)/],
  ['Fleisch, Fisch & Wurst', /^(fleisch|faschiertes|hackfleisch|huhn|hendl|h[aä]hnchen|pute|rind|schwein|schnitzel|steak|wurst|schinken|speck|salami|lachs|forelle|kabeljau|garnelen)/],
  ['Vorrat & Backen', /^(nudel|pasta|spaghetti|reis|mehl|zucker|salz|pfeffer|gew[uü]rz|[oö]l|essig|haferflock|m[uü]sli|linsen|kichererbse|bohnen|konserve|dose|passata|tomatenmark|germ|hefe|backpulver|st[aä]rke|br[oü]sel|semmelbr[oö]sel|honig|marmelade|pesto)/],
  ['Süßes & Snacks', /^(schoko|keks|chips|cracker|waffel|gummib[aä]r|popcorn|n[uü]sse|mandeln)/],
  ['Getränke', /^(wasser|mineral|saft|apfelsaft|orangensaft|limonade|cola|bier|wein|kaffee|tee)/],
  ['Haushalt & Drogerie', /^(toilettenpapier|klopapier|k[uü]chenrolle|waschmittel|sp[uü]lmittel|seife|shampoo|zahnpasta|m[uü]llsack|windel|reiniger|tabs)/],
  ['Tiefkühl'],
  ['Sonstiges']
];

function departmentFor(text) {
  const name = text.toLocaleLowerCase('de').trim();
  if (/\b(?:tk|tiefk[uü]hl\w*|tiefgefroren\w*|gefroren\w*)\b/.test(name)) return 'Tiefkühl';
  if (/^(tomatenmark|semmelbr[oö]sel)\b/.test(name)) return 'Vorrat & Backen';
  return departments.find(([, matches]) => matches?.test(name))?.[0] || 'Sonstiges';
}

function itemDepartment(item) {
  return departments.some(([label]) => label === item.department)
    ? item.department : departmentFor(item.text);
}

function categoryModal(id) {
  const item = state.items.find(entry => entry.id === id);
  if (!item || !isShopping(state.lists.find(list => list.id === item.listId))) return;
  const options = departments.map(([label]) =>
    `<button class="category-choice" type="button" data-department="${esc(label)}"
      aria-pressed="${item.department === label}"><span>${esc(label)}</span></button>`
  ).join('');
  openModal('Kategorie ändern', `<p class="info">${esc(item.text)}</p>
    <div id="categoryChoices" class="item-department category-choices">${options}</div>
    <button id="automaticCategory" class="secondary wide" type="button"
      aria-pressed="${!item.department}">Automatisch · ${esc(departmentFor(item.text))}</button>`);

  const choose = department => {
    const current = state.items.find(entry => entry.id === id);
    if (current) {
      current.department = department;
      persist();
    }
    closeModal();
  };
  $('#categoryChoices').onclick = event => {
    const button = event.target.closest('[data-department]');
    if (button) choose(button.dataset.department);
  };
  $('#automaticCategory').onclick = () => choose(undefined);
}

function departmentHTML(items) {
  const grouped = new Map(departments.map(([label]) => [label, []]));
  for (const item of items) grouped.get(itemDepartment(item)).push(item);
  return [...grouped].filter(([, group]) => group.length).map(([label, group]) =>
    `<section class="item-department"><h3><span>${esc(label)}</span></h3>${group.map(item=>itemHTML(item)).join('')}</section>`
  ).join('');
}

function itemInput(item) {
  if (!item.amount) return item.text;
  const combined = `${item.amount} ${item.text}`;
  const parsed = splitQuantity(combined);
  return parsed.text === item.text && parsed.amount === item.amount
    ? combined
    : `${item.text} — ${item.amount}`;
}

function itemHTML(x,dish=false){return `<div class="item ${dish?'dish-item':x.done?'done':''}" data-id="${esc(x.id)}">${dish?'':`<button class="check ${x.done?'checked':''}" data-act="toggle" data-id="${esc(x.id)}" aria-label="${x.done?'Nicht erledigt':'Erledigt'}">${x.done?'✓':''}</button>`}<button class="item-main" data-act="edit" data-id="${esc(x.id)}">${esc(x.text)}${x.amount?`<em>${esc(x.amount)}</em>`:''}</button><button class="item-edit" data-act="edit" data-id="${esc(x.id)}" aria-label="Bearbeiten">⋯</button></div>`;}
function persist(){save();render();}
function useList(id){if(state.lists.some(x=>x.id===id)){state.activeId=id;persist();}}
function addItem(text,amount=''){const a=active(),t=text.trim();if(!t)return;const parsed=!isShopping(a)?{text:t,amount:''}:splitQuantity(t);let item={id:uid(),listId:a.id,text:(amount?t:parsed.text).slice(0,140),amount:String(amount||parsed.amount).trim().slice(0,100),done:false,updatedAt:Date.now()};state.items.push(item);persist();syncItem(a,item,'set');}
function editItem(id,text,amount){const item=state.items.find(i=>i.id===id);if(!item||!text.trim())return;item.text=text.trim().slice(0,140);item.amount=amount.trim().slice(0,100);item.updatedAt=Date.now();persist();syncItem(state.lists.find(l=>l.id===item.listId),item,'set');}
function toggleItem(id){const item=state.items.find(x=>x.id===id);if(!item)return;item.done=!item.done;item.updatedAt=Date.now();persist();syncItem(state.lists.find(l=>l.id===item.listId),item,'set');}
function deleteItem(id){const item=state.items.find(x=>x.id===id);if(!item)return;const l=state.lists.find(x=>x.id===item.listId);state.items=state.items.filter(x=>x.id!==id);persist();syncItem(l,item,'delete');}
function moveItem(id,targetListId){const item=state.items.find(x=>x.id===id),oldList=state.lists.find(x=>x.id===item?.listId),dest=state.lists.find(x=>x.id===targetListId);if(!item||!dest||!oldList||oldList.id===dest.id)return;syncItem(oldList,item,'delete');item.listId=dest.id;item.updatedAt=Date.now();syncItem(dest,item,'set');persist();alertToast('Artikel in „'+dest.name+'“ verschoben');}
function createList(name,store,color){if(!name.trim())return;const l={id:uid(),name:name.trim().slice(0,70),store:store.trim().slice(0,60)||'Alle Geschäfte',sharedId:null,color};state.lists.push(l);state.activeId=l.id;openedLists.clear();openedLists.add(l.id);persist();}
function newListModal(){
 openModal('Neue Liste',`<form id="listForm"><fieldset class="list-types item-department"><legend>Listentyp</legend><div class="list-type-options"><label><input type="radio" name="listType" value="shopping" checked><span class="category-choice"><span>Einkauf</span></span></label><label><input type="radio" name="listType" value="todo"><span class="category-choice"><span>To-do</span></span></label><label><input type="radio" name="listType" value="dishes"><span class="category-choice"><span>Gerichte</span></span></label></div></fieldset><label class="field">Name der Liste<input name="name" placeholder="z. B. Wocheneinkauf" maxlength="70" required autofocus></label><label class="field" id="newStoreLabel">Geschäft<select name="store" id="newStore">${storeOptions()}<option value="__custom__">Anderes Geschäft …</option></select></label><label class="field hidden" id="customStoreLabel">Geschäft eingeben<input name="customStore" maxlength="60" placeholder="z. B. Wochenmarkt"></label>${colorField(listColor({},state.lists.length))}<div class="modal-actions"><button class="primary wide" type="submit">Liste erstellen</button></div></form>`);
 const form=$('#listForm'), typeSelect=form.elements.listType, storeSelect=$('#newStore'), customLabel=$('#customStoreLabel');
 form.addEventListener('change',event=>{
   if(event.target.name!=='listType')return;
   const todo=typeSelect.value==='todo';
   const shopping=typeSelect.value==='shopping';
   $('#newStoreLabel').classList.toggle('hidden',!shopping);
   customLabel.classList.toggle('hidden',!shopping||storeSelect.value!=='__custom__');
   $('#listForm').elements.name.placeholder=shopping?'z. B. Wocheneinkauf':todo?'z. B. Schule':'z. B. Lieblingsgerichte';
 });
 storeSelect.onchange=()=>{customLabel.classList.toggle('hidden',storeSelect.value!=='__custom__');if(!customLabel.classList.contains('hidden'))customLabel.querySelector('input').focus();};
 $('#listForm').onsubmit=e=>{e.preventDefault();const store=typeSelect.value==='dishes'?DISH_STORE:typeSelect.value==='todo'?TODO_STORE:(storeSelect.value==='__custom__'?formVal('customStore'):storeSelect.value);if(!store||(typeSelect.value==='shopping'&&[TODO_STORE,DISH_STORE].includes(store))){alertToast('Bitte ein anderes Geschäft eingeben');return;}createList(formVal('name'),store,e.currentTarget.elements.listColor.value);closeModal();alertToast('Liste erstellt');};
}
function itemModal(id){const x=state.items.find(z=>z.id===id);if(!x)return;const list=state.lists.find(list=>list.id===x.listId), todo=isTodo(list), dish=isDishes(list);const otherListOptions=state.lists.map(l=>`<option value="${esc(l.id)}" ${l.id===x.listId?'selected':''}>${esc(l.name)} (${isDishes(l)?'Gerichte':isTodo(l)?'To-do':esc(l.store)})</option>`).join('');openModal(dish?'Gericht bearbeiten':todo?'Aufgabe bearbeiten':'Artikel bearbeiten',`<form id="itemForm"><label class="field">Artikel<input name="name" value="${esc(itemInput(x))}" maxlength="243" placeholder="z. B. 500g Tofu" required></label><label class="field">Liste<select name="targetList">${otherListOptions}</select></label><div class="modal-actions"><button class="primary" type="submit">Speichern</button>${todo||dish?'':'<button class="secondary" id="itemCategoryBtn" type="button">Kategorie ändern</button>'}<button class="danger" id="deleteItemBtn" type="button">Löschen</button></div></form>`);$('#itemForm').onsubmit=e=>{e.preventDefault();const value=formVal('name');if(value!==itemInput(x)){const parsed=todo||dish?{text:value,amount:''}:splitQuantity(value);editItem(id,parsed.text,parsed.amount);}const dest=formVal('targetList');if(dest && dest!==x.listId)moveItem(id,dest);closeModal();};if(!todo&&!dish)$('#itemCategoryBtn').onclick=()=>categoryModal(id);$('#deleteItemBtn').onclick=()=>{if(confirm('Artikel löschen?')){deleteItem(id);closeModal();}};}
function listModal(){let l=active();openModal('Liste verwalten',`
<div class="list-menu-grid">
  <button id="syncListBtn" class="menu-action" type="button"><span>♧</span> Liste mit Partnerin verbinden <small>QR-Code / Synchronisierung</small></button>
  <button id="cloneListBtn" class="menu-action" type="button"><span>▤</span> Liste klonen <small>Eine private Kopie für den nächsten Einkauf</small></button>
  <button id="copyEntriesBtn" class="menu-action" type="button"><span>⧉</span> Offene Einträge kopieren</button>
  <button id="cutEntriesBtn" class="menu-action" type="button"><span>↗</span> Offene Einträge verschieben <small>Dann andere Liste auswählen und einfügen</small></button>
  <button id="pasteEntriesBtn" class="menu-action" type="button"><span>↙</span> Einträge einfügen <small>Aus anderer Liste oder als Text</small></button>
  <button id="shareEntriesBtn" class="menu-action" type="button"><span>◇</span> Einträge teilen <small>Über das Android-Teilen-Menü</small></button>
  <button id="exportFromMenuBtn" ${!isShopping(l)?'hidden':''} class="menu-action" type="button"><span>⇧</span> Export für Gurkerl <small>Liste kopieren, Text oder CSV</small></button>
</div>
<hr class="divider">
<form id="listEditForm"><label class="field">Listenname<input name="name" maxlength="70" value="${esc(l.name)}" required></label>${!isShopping(l)?'':`<label class="field">Geschäft<input name="store" list="storeSuggestions" maxlength="60" value="${esc(l.store)}" autocomplete="off"><datalist id="storeSuggestions">${storeOptions()}</datalist></label>`}${colorField(listColor(l))}<div class="modal-actions"><button class="primary" type="submit">Speichern</button><button class="secondary" id="clearDoneBtn" type="button">Erledigte entfernen</button></div></form>
<hr class="divider"><button class="danger" id="clearListBtn" type="button">Liste leeren</button> <button class="danger" id="deleteListBtn" type="button">Liste löschen</button>
<p class="info">Bei einer geteilten Liste sehen alle verbundenen Personen Änderungen an den Artikeln. Synchronisierung funktioniert erst nach der Firebase-Einrichtung.</p>`);
 $('#listEditForm').onsubmit=e=>{e.preventDefault();l.name=formVal('name').slice(0,70);if(isShopping(l))l.store=formVal('store').slice(0,60)||'Alle Geschäfte';l.color=e.currentTarget.elements.listColor.value;persist();syncMeta(l);closeModal();};
 $('#clearDoneBtn').onclick=()=>{const done=listItems(l.id).filter(i=>i.done);if(!done.length){alertToast('Nichts zu entfernen');return;}if(confirm(`${done.length} erledigte Artikel löschen?`)){done.forEach(i=>{state.items=state.items.filter(z=>z.id!==i.id);syncItem(l,i,'delete');});persist();closeModal();}};
 $('#deleteListBtn').onclick=()=>{if(state.lists.length===1){alertToast('Mindestens eine Liste behalten');return;}if(confirm('Liste wirklich von diesem Gerät entfernen?')){planDrafts.delete(l.id);stopListen(l.sharedId);state.lists=state.lists.filter(z=>z.id!==l.id);state.items=state.items.filter(z=>z.listId!==l.id);state.activeId=state.lists[0].id;persist();closeModal();}};
 $('#cloneListBtn').onclick=cloneCurrentList;
 $('#clearListBtn').onclick=clearCurrentList;
 $('#copyEntriesBtn').onclick=()=>rememberEntries('copy');
 $('#cutEntriesBtn').onclick=()=>rememberEntries('cut');
 $('#pasteEntriesBtn').onclick=pasteEntries;
 $('#shareEntriesBtn').onclick=shareEntries;
 $('#syncListBtn').onclick=()=>{closeModal();pairModal();};
 $('#exportFromMenuBtn').onclick=()=>{closeModal();exportModal();};
}
// Die folgenden Aktionen sind eigenständig implementiert, nicht aus der Referenz-App kopiert.
function cloneCurrentList(){
 const source=active();
 const target={id:uid(),name:(source.name+' (Kopie)').slice(0,70),store:source.store||'Alle Geschäfte',sharedId:null};
 const copied=listItems(source.id).map(i=>({id:uid(),listId:target.id,text:i.text,amount:i.amount||'',done:false,updatedAt:Date.now()}));
 state.lists.push(target);state.items.push(...copied);state.activeId=target.id;
 persist();closeModal();alertToast('Private Kopie mit '+copied.length+' Artikeln erstellt');
}
function clearCurrentList(){
 const l=active(),items=listItems(l.id);
 if(!items.length){alertToast('Liste ist bereits leer');return;}
 if(!confirm('Alle '+items.length+' Artikel aus „'+l.name+'“ löschen?'))return;
 for(const item of items)syncItem(l,item,'delete');
 state.items=state.items.filter(i=>i.listId!==l.id);
 persist();closeModal();alertToast('Liste geleert');
}
function rememberEntries(mode){
 const l=active();const items=listItems(l.id).filter(i=>!i.done);
 if(!items.length){alertToast('Keine offenen Einträge');return;}
 state.entryBuffer={mode,sourceId:l.id,items:items.map(i=>({id:i.id,text:i.text,amount:i.amount||''}))};
 save();closeModal();
 if(mode==='cut')alertToast(items.length+' Einträge zum Verschieben vorgemerkt');
 else{clipboardText(textFor(l)).then(()=>alertToast(items.length+' Einträge kopiert')).catch(()=>alertToast('Für andere Listen vorgemerkt'));}
}
function pasteEntries(){
 const dest=active(),buffer=state.entryBuffer;
 if(!buffer?.items?.length){closeModal();recipeImportModal();return;}
 let count=0,skipped=0;
 const seen=new Set(listItems(dest.id).filter(i=>!i.done).map(i=>`${i.text.toLocaleLowerCase('de').trim()}|${(i.amount||'').toLocaleLowerCase('de').trim()}`));
 for(const original of buffer.items){
   const key=`${original.text.toLocaleLowerCase('de').trim()}|${original.amount.toLocaleLowerCase('de').trim()}`;
   if(seen.has(key)){skipped++;continue;}
   if(buffer.mode==='cut'){
     const current=state.items.find(i=>i.id===original.id && i.listId===buffer.sourceId);
     if(!current){skipped++;continue;}
     if(current.listId!==dest.id){const src=state.lists.find(l=>l.id===current.listId);syncItem(src,current,'delete');current.listId=dest.id;current.updatedAt=Date.now();syncItem(dest,current,'set');}
   } else {
     const item={id:uid(),listId:dest.id,text:original.text,amount:original.amount,done:false,updatedAt:Date.now()};
     state.items.push(item);syncItem(dest,item,'set');
   }
   seen.add(key);count++;
 }
 if(buffer.mode==='cut' && skipped===0)state.entryBuffer=null;
 persist();closeModal();alertToast(`${count} Einträge eingefügt${skipped?' · '+skipped+' übersprungen':''}`);
}
async function shareEntries(){
 const l=active(),text=textFor(l);
 if(!text){alertToast('Keine offenen Einträge');return;}
 const message=l.name+(!isShopping(l)?'':' ('+l.store+')')+'\n\n'+text;
 closeModal();
 return shareText(l.name,message);
}
async function shareText(title,message){
 if(window.AndroidEinkauf?.shareText){window.AndroidEinkauf.shareText(message);return;}
 if(navigator.share){try{await navigator.share({title,text:message});}catch(e){}return;}
 try{await clipboardText(message);alertToast('Einträge zum Teilen kopiert');}catch(e){alertToast('Teilen nicht verfügbar');}
}
function cleanLines(text){return String(text||'').replace(/\r/g,'').split('\n').map(s=>s.replace(/^\s*(?:[-•*☐☑✓]\s*|\d{1,3}[.)]\s+|\?\s+)/,'').replace(/[\s\-]+$/,'').trim()).filter(x=>x.length>0&&x.length<170).slice(0,150);}
const spokenNumbers = new Map([
  ['ein',1],['eine',1],['einen',1],['eins',1],['zwei',2],['drei',3],
  ['vier',4],['fünf',5],['sechs',6],['sieben',7],['acht',8],['neun',9],
  ['zehn',10],['elf',11],['zwölf',12],['zwanzig',20],['hundert',100]
]);

function splitSpokenProducts(line) {
  const words = line.split(/\s+/);
  const products = [];
  let start = 0;
  let hasProduct = false;

  for (let index = 0; index < words.length; index++) {
    const word = words[index].toLocaleLowerCase('de-AT');
    const next = words[index + 1]?.toLocaleLowerCase('de-AT') || '';
    const startsAmount = (/^\d+(?:[,.]\d+)?(?:kg|g|l|ml)?$/i.test(word)
      || spokenNumbers.has(word)) && next !== '';
    const startsFrozenProduct = /^(?:tk|tiefgekühlt(?:e|er|es)?)$/.test(word) && next !== '';
    const isProduct = departments.some(([, matches]) => matches?.test(word === 'creme' ? word + ' ' + next : word));

    if (hasProduct && (startsAmount || startsFrozenProduct || isProduct)) {
      products.push(words.slice(start, index).join(' '));
      start = index;
      hasProduct = false;
    }
    if (isProduct) hasProduct = true;
  }
  products.push(words.slice(start).join(' '));
  return products;
}

function dictationLines(text, inferProducts = false) {
  return text
    .replace(/\b(?:komma|neue zeile)\b/gi, '\n')
    .split(/(?<!\d)[,.]|[,.](?!\d)|[;\r\n]|\s+und\s+/i)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => inferProducts ? splitSpokenProducts(line) : [line])
    .map(line => line.replace(/^([\p{L}]+)\s+/u, (match, word) =>
      spokenNumbers.has(word.toLowerCase()) ? spokenNumbers.get(word.toLowerCase()) + ' ' : match
    ))
    .map(line => line.replace(/^(\d+(?:[,.]\d+)?)\s+(kilogramm|gramm|milliliter)\s+/i,
      (_, amount, unit) => amount + ' ' + {kilogramm:'kg', gramm:'g', milliliter:'ml'}[unit.toLowerCase()] + ' '
    ))
    .join('\n');
}

let activeDictation = null;

function stopDictation() {
  const recognition = activeDictation;
  activeDictation = null;
  recognition?.abort();
}

function dictationModal(listId) {
  const todo = !isShopping(state.lists.find(list => list.id === listId));
  openModal('Liste diktieren', `<p class="info">${todo?'Diktiere eine Aufgabe pro Satz. Du kannst die Zeilen vor dem Übernehmen korrigieren.':'Sprich die Artikel einfach hintereinander, etwa „Milch Brot 500 Gramm Tofu“. Du kannst die Zeilen vor dem Übernehmen korrigieren.'}</p>
    <p id="dictationStatus" class="scan-status" role="status"></p>
    <label class="field">Artikel prüfen<textarea id="dictationText" rows="6" placeholder="Ein Artikel pro Zeile"></textarea></label>
    <div class="modal-actions">
      <button id="dictationStart" class="secondary" type="button">Diktieren</button>
      <button id="dictationStop" class="secondary" type="button" hidden>Fertig</button>
      <button id="dictationAdd" class="primary" type="button">Artikel übernehmen</button>
    </div>`);
  const status = $('#dictationStatus');
  const input = $('#dictationText');
  const start = $('#dictationStart');
  const stop = $('#dictationStop');
  const add = $('#dictationAdd');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const keyboardHint = 'Tippe ins Textfeld und nutze das Mikro deiner Tastatur. Setze jeden Artikel in eine eigene Zeile.';
  add.onclick = () => {
    const count = addMultiple(todo ? input.value : dictationLines(input.value), listId);
    if (count) {
      closeModal();
      alertToast(count + ' Artikel hinzugefügt');
    } else {
      status.textContent = 'Keine neuen Artikel zum Übernehmen.';
    }
  };

  if (!Recognition) {
    start.hidden = true;
    status.textContent = keyboardHint;
    return;
  }

  start.onclick = () => {
    const recognition = new Recognition();
    recognition.lang = 'de-AT';
    recognition.continuous = true;
    const previousText = input.value.trim();
    const transcripts = [];
    let failure = false;
    activeDictation = recognition;
    start.disabled = add.disabled = input.readOnly = true;
    stop.hidden = false;
    stop.disabled = false;
    status.textContent = 'Ich höre zu …';
    stop.onclick = () => {
      stop.disabled = true;
      recognition.stop();
    };
    recognition.onresult = event => {
      if (activeDictation !== recognition) return;
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) transcripts[index] = todo ? result[0].transcript.trim().replace(/([.!?])\s+/g, '$1\n') : dictationLines(result[0].transcript, true);
      }
      input.value = [previousText, ...transcripts].filter(Boolean).join('\n');
    };
    recognition.onerror = () => {
      if (activeDictation !== recognition) return;
      failure = true;
      status.textContent = 'Spracherkennung nicht verfügbar. ' + keyboardHint;
    };
    recognition.onend = () => {
      if (activeDictation !== recognition) return;
      activeDictation = null;
      start.disabled = add.disabled = input.readOnly = false;
      stop.hidden = true;
      if (!failure) status.textContent = input.value.trim()
        ? 'Bitte prüfen und bei Bedarf korrigieren.'
        : 'Ich habe nichts verstanden. Du kannst es noch einmal versuchen.';
    };
    try {
      recognition.start();
    } catch {
      recognition.onerror();
      recognition.onend();
    }
  };
  start.click();
}

function splitQuantity(raw){const s=String(raw||'').trim();const note=s.match(/^(.+?)\s+—\s+(.+)$/);if(note)return {text:note[1].trim(),amount:note[2].trim()};const prefix=s.match(/^(\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml|stk\.?|st\.?|packungen?|stück|x|becher|flaschen?|dosen?|bund|päckchen|el|tl))\s+(.+)$/i);if(prefix)return {amount:prefix[1].trim(),text:prefix[2].trim()};const simple=s.match(/^(\d+(?:[,.]\d+)?)\s*[x×]\s+(.+)$/i);if(simple)return {amount:simple[1]+' ×',text:simple[2].trim()};const numeric=s.match(/^(\d+(?:[,.]\d+)?)\s+(.+)$/);if(numeric)return {amount:numeric[1],text:numeric[2].trim()};return {amount:'',text:s};}
function addMultiple(raw,listId){const lines=cleanLines(raw),l=state.lists.find(x=>x.id===listId)||active();let added=0,skipped=0;const seen=new Set(listItems(l.id).filter(i=>!i.done).map(i=>`${i.text.toLocaleLowerCase('de').trim()}|${i.amount.toLocaleLowerCase('de').trim()}`));for(const line of lines){const parsed=!isShopping(l)?{text:line,amount:''}:splitQuantity(line);const key=`${parsed.text.toLocaleLowerCase('de').trim()}|${parsed.amount.toLocaleLowerCase('de').trim()}`;if(seen.has(key)){skipped++;continue;}seen.add(key);const item={id:uid(),listId:l.id,text:parsed.text.slice(0,140),amount:parsed.amount.slice(0,100),done:false,updatedAt:Date.now()};state.items.push(item);syncItem(l,item,'set');added++;}persist();if(skipped)alertToast(`${skipped} doppelte Artikel übersprungen`);return added;}
function textFor(list,openOnly=true){const items=listItems(list.id).filter(x=>!openOnly||!x.done);return items.map(x=>`${x.amount?x.amount+' ':''}${x.text}`).join('\n');}
async function copyCurrent(){let t=textFor(active());if(!t){alertToast('Keine offenen Artikel zum Kopieren');return;}const full=`Finde bitte möglichst günstige passende Produkte für diese Einkaufsliste und füge sie meinem Warenkorb hinzu. Vergleiche den Grundpreis, beachte Mengen und frage bei Unklarheiten nach:\n\n${t}`;try{await clipboardText(full);alertToast('Für Gurkerl / Maia kopiert');}catch(e){openModal('Liste zum Kopieren',`<textarea class="editarea" readonly id="copyArea">${esc(full)}</textarea><p class="info">Text markieren und kopieren.</p>`);$('#copyArea').select();}}
function downloadFile(filename,text,type){if(window.AndroidEinkauf?.saveFile){window.AndroidEinkauf.saveFile(filename,text,type);return;}const b=new Blob([text],{type});let url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function exportModal(){let l=active();openModal('Export & Gurkerl',`<p class="notice">Für Gurkerl kopieren wir die offenen Artikel als Text mit einer Bitte um günstige passende Produkte. Anschließend in den Maia-Chat einfügen. Der Warenkorb wird nicht automatisch übertragen.</p><div class="modal-actions"><button class="primary wide" id="copyMaia">Für Gurkerl kopieren</button><button class="secondary" id="openGurkerl">Gurkerl öffnen ↗</button><button class="secondary" id="copyPlain">Nur Liste kopieren</button><button class="secondary" id="exportTxt">Textdatei exportieren</button><button class="secondary" id="exportCsv">CSV exportieren</button></div>`);$('#copyMaia').onclick=copyCurrent;$('#openGurkerl').onclick=()=>{if(window.AndroidEinkauf?.openURL)window.AndroidEinkauf.openURL('https://www.gurkerl.at/');else window.open('https://www.gurkerl.at/','_blank','noopener');};$('#copyPlain').onclick=async()=>{let t=textFor(l);if(!t){alertToast('Keine offenen Artikel');return;}try{await clipboardText(t);alertToast('Liste kopiert');}catch(e){alertToast('Kopieren nicht verfügbar');}};$('#exportTxt').onclick=()=>downloadFile('Einkauf-'+slug(l.name)+'.txt',textFor(l),'text/plain;charset=utf-8');$('#exportCsv').onclick=()=>{let rows=[['Artikel','Menge','Erledigt','Geschäft'],...listItems(l.id).map(x=>[x.text,x.amount,x.done?'ja':'nein',l.store])];downloadFile('Einkauf-'+slug(l.name)+'.csv','\ufeff'+rows.map(r=>r.map(s=>'"'+String(s).replace(/"/g,'""')+'"').join(';')).join('\r\n'),'text/csv;charset=utf-8');};}
async function clipboardText(t){if(window.AndroidEinkauf?.copyText){window.AndroidEinkauf.copyText(t);return;}if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(t);return;}const el=document.createElement('textarea');el.value=t;el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();const ok=document.execCommand('copy');el.remove();if(!ok)throw Error('Zwischenablage nicht verfügbar');}
function recipeImportModal(){const target=active();openModal('Zutaten übernehmen',`<div class="notice">Kopiere die Zutaten aus einem Rezept hierher – eine Zutat pro Zeile. Die App erkennt viele Mengen und vermeidet identische Doppeleinträge.</div><label class="field">Zutaten aus Rezept oder Textliste<textarea id="recipeLines" name="recipeLines" rows="8" placeholder="2 Zucchini\n500 g Pasta\n1 Zitrone\nOlivenöl"></textarea></label><div class="import-preview"><strong>Übernahme:</strong> Die Artikel landen in „${esc(target.name)}“. Mengen werden separat gespeichert. Du kannst jeden Artikel danach ändern oder einem anderen Geschäft zuordnen.</div><button class="primary wide" id="recipeCommit">Zutaten übernehmen</button>`);$('#recipeCommit').onclick=()=>{const n=addMultiple($('#recipeLines').value,target.id);if(n){closeModal();alertToast(`${n} Zutaten hinzugefügt`);}else alertToast('Keine neuen Artikel erkannt');};}
function slug(s){return s.toLowerCase().replace(/[^a-z0-9äöüß-]/gi,'-').replace(/-+/g,'-').slice(0,50);}
let scanTarget=null;
function scanModal(){scanTarget=active().id;openModal('Zettel scannen',`<p class="info">Zettel möglichst gerade, bei gutem Licht und mit großer Schrift im Bild fotografieren. ${SCAN_URL?'Das Foto wird nur zur Erkennung an einen KI-Dienst gesendet und nicht gespeichert.':'Ohne KI-Dienst klappt nur Gedrucktes zuverlässig, Handschrift kaum.'}</p><div class="modal-actions"><button class="primary" id="chooseCamera" type="button">Foto aufnehmen</button><button class="secondary" id="chooseImage" type="button">Aus Galerie</button></div><div id="scanPreview"></div><p id="ocrStatus" class="scan-status" style="margin:14px 0">${SCAN_URL?'Bereit – Foto aufnehmen oder auswählen.':'Bereit. Du kannst die Artikel auch direkt unten eintippen.'}</p><label class="field">Erkannte Artikel – ein Artikel pro Zeile<textarea name="scantext" id="scanText" placeholder="Milch\nBrot\nÄpfel" rows="7"></textarea></label><div class="modal-actions"><button class="primary wide" id="addScanned" type="button">Artikel zur aktiven Liste hinzufügen</button></div>`);$('#chooseCamera').onclick=()=>pickScanFile(true);$('#chooseImage').onclick=()=>pickScanFile(false);$('#addScanned').onclick=()=>{const n=addMultiple($('#scanText').value,scanTarget);if(n){closeModal();alertToast(`${n} Artikel hinzugefügt`);}else alertToast('Bitte zuerst Artikel eingeben');};}
function pickScanFile(camera){const f=$('#scanFile');if(camera)f.setAttribute('capture','environment');else f.removeAttribute('capture');f.click();}
function setOCRStatus(s){const el=$('#ocrStatus');if(el)el.textContent=s;}
function setScanBusy(b){['#chooseCamera','#chooseImage','#addScanned'].forEach(q=>{const el=$(q);if(el)el.disabled=b;});}
async function encodeScanImage(file,{max=1568,quality=.85,gray=false}={}){try{const bitmap=await createImageBitmap(file);const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);if(gray)ctx.filter='grayscale(1) contrast(1.35)';ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return canvas.toDataURL('image/jpeg',quality);}catch(e){return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});}}
// Handschrift: Foto an den eigenen Worker (Claude Vision). Klassische OCR (Tesseract) kann Handschrift praktisch nicht lesen.
async function recognizeCloud(dataURL){const m=/^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataURL);if(!m)throw new Error('Bildformat nicht unterstützt');const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),45000);
 try{const res=await fetch(SCAN_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:m[2],mediaType:m[1].toLowerCase(),store:(state.lists.find(x=>x.id===scanTarget)||active()).store}),signal:ctrl.signal});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||('Fehler '+res.status));
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  return (Array.isArray(data.items)?data.items:[]).map(it=>{const o=it&&typeof it==='object'?it:{text:it};const text=clean(o.text).slice(0,140);if(!text)return '';const amount=clean(o.amount).slice(0,40);return (o.unsure?'? ':'')+(amount?amount+' ':'')+text;}).filter(Boolean).slice(0,150);}
 catch(e){throw e.name==='AbortError'?new Error('Zeitüberschreitung'):e;}
 finally{clearTimeout(timer);}}
async function handleImage(file){if(!file)return;if(!$('#scanText'))scanModal();setScanBusy(true);
 try{
  setOCRStatus('Foto wird vorbereitet …');
  let photo;try{photo=await encodeScanImage(file,{max:1568,quality:.85});}catch(e){setOCRStatus('Das Foto konnte nicht gelesen werden. Bitte erneut versuchen.');return;}
  const pv=$('#scanPreview');if(pv)pv.innerHTML=`<img alt="Dein Zettel" src="${photo}" style="display:block;width:100%;max-height:220px;object-fit:contain;margin-top:14px;border-radius:14px;background:#fffefa;border:1px solid #e1e7d9">`;
  if(SCAN_URL&&navigator.onLine){
   try{
    setOCRStatus('Zettel wird gelesen … (meist 5–15 Sekunden)');
    const lines=await recognizeCloud(photo);const box=$('#scanText');if(!box)return;
    if(!lines.length){setOCRStatus('Keine Artikel erkannt. Bitte näher, gerader und heller fotografieren – oder unten eintippen.');return;}
    box.value=lines.join('\n');const unsure=lines.filter(l=>l.startsWith('?')).length;
    setOCRStatus(`${lines.length} Artikel erkannt.${unsure?` ${unsure} unsicher (mit „?“ markiert) – bitte prüfen.`:' Bitte kurz kontrollieren.'}`);return;
   }catch(e){console.warn('KI-Scan',e);setOCRStatus('KI-Erkennung nicht erreichbar ('+(e.message||'Fehler')+'). Versuche einfache Texterkennung …');}
  }
  if(window.AndroidEinkauf?.recognizeImage){window.AndroidEinkauf.recognizeImage(photo);return;}
  try{
   setOCRStatus('Texterkennung wird geladen (beim ersten Mal online) …');await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js');
   const gray=await encodeScanImage(file,{max:2000,quality:.92,gray:true});setOCRStatus('Schrift wird gelesen …');
   const worker=await Tesseract.createWorker('deu');
   try{await worker.setParameters({tessedit_pageseg_mode:'6'});const result=await worker.recognize(gray);const box=$('#scanText');if(box)box.value=cleanLines(result.data.text).join('\n');}finally{await worker.terminate();}
   setOCRStatus('Einfache Texterkennung: Gedrucktes klappt, Handschrift wird oft falsch gelesen. Bitte alles prüfen.');
  }catch(e){setOCRStatus('Automatische Erkennung derzeit nicht verfügbar. Bitte Artikel unten eintippen.');}
 }finally{setScanBusy(false);}}
window.onAndroidOCR=(text,error)=>{if(!$('#scanText'))return;if(error){setOCRStatus('Erkennung fehlgeschlagen: '+error);return;}$('#scanText').value=cleanLines(text||'').join('\n');setOCRStatus('Foto erkannt. Bitte die Wörter vor dem Übernehmen kontrollieren.');};
const loadedScripts=new Map();
function loadScript(src){if(loadedScripts.has(src))return loadedScripts.get(src);const p=new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>{loadedScripts.delete(src);reject(new Error('Laden fehlgeschlagen'));};document.head.append(el);});loadedScripts.set(src,p);return p;}
function backup(){let b={format:'einkauf-v1',date:new Date().toISOString(),data:{version:1,activeId:state.activeId,lists:state.lists.map(l=>({...l,sharedId:null})),items:state.items}};downloadFile('Einkauf-Backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(b,null,2),'application/json;charset=utf-8');}
function settingsModal(){openModal('Einstellungen & Backup',`<label class="field">Farbschema<select id="themeSelect">${THEMES.map(([id,label])=>`<option value="${id}" ${document.documentElement.dataset.theme===id?'selected':''}>${label}</option>`).join('')}</select></label><hr class="divider"><p class="modal-label">Deine Daten</p><p class="info">Alle Listen werden auf diesem Gerät gespeichert. Eine gemeinsame Liste wird zusätzlich mit Firebase synchronisiert, sobald Firebase eingerichtet wurde.</p><div class="modal-actions"><button class="primary" id="backupSave">JSON-Backup speichern</button><button class="secondary" id="backupLoad">Backup wiederherstellen</button></div><hr class="divider"><p class="modal-label">Partner-Synchronisierung</p><p class="info" id="syncInfo">${esc(firebaseReady?'Angemeldet: '+cloudUser.email:'Bitte mit Google anmelden. Lokale Listen funktionieren trotzdem.')} ${esc(cloudError)}</p><button id="googleLogin" class="primary">Mit Google anmelden</button><button id="googleLogout" class="secondary">Abmelden</button><button id="openPair" class="secondary">Gemeinsam verbinden</button><hr class="divider"><p class="modal-label">Hinweis</p><p class="info">Cloud-Zugriff erhalten nur freigeschaltete Google-Konten. Lokale Listen bitte weiterhin per JSON sichern.</p>`);
 $('#themeSelect').onchange = event => {
   const theme = event.target.value;
   applyTheme(theme);
   try { localStorage.setItem(THEME_KEY, theme); }
   catch { alertToast('Farbschema konnte nicht dauerhaft gespeichert werden'); }
 };
 $('#googleLogin').onclick=()=>{if(!window.firebase){alertToast('Verbindung wird geladen. Bitte kurz warten.');return;}googleLogin();};$('#googleLogout').onclick=async()=>{if(window.firebase)await firebase.auth().signOut();settingsModal();};$('#backupSave').onclick=backup;$('#backupLoad').onclick=()=>$('#backupFile').click();$('#openPair').onclick=pairModal;}
async function restore(file){if(!file)return;try{let j=JSON.parse(await file.text());if(j.format!=='einkauf-v1'||!Array.isArray(j.data?.lists)||!Array.isArray(j.data?.items)||j.data.lists.length>100||j.data.items.length>10000)throw Error('Unbekanntes Dateiformat');const ids=new Set(j.data.lists.map(x=>x.id));let lists=j.data.lists.filter(x=>typeof x.id==='string'&&typeof x.name==='string').map(x=>({id:x.id.slice(0,80),name:x.name.slice(0,70),store:String(x.store||'Alle Geschäfte').slice(0,60),sharedId:null,weekPlan:isDishes(x)&&Array.isArray(x.weekPlan)?WEEKDAYS.map((_,i)=>typeof x.weekPlan[i]==='string'?x.weekPlan[i].slice(0,140):''):undefined,color:LIST_COLORS.has(x.color)?x.color:undefined}));let items=j.data.items.filter(x=>ids.has(x.listId)&&typeof x.text==='string').map(x=>({id:String(x.id).slice(0,80),listId:String(x.listId).slice(0,80),text:x.text.slice(0,140),amount:String(x.amount||'').slice(0,100),done:!!x.done,department:departments.some(([label])=>label===x.department)?x.department:undefined,updatedAt:Number(x.updatedAt)||Date.now()}));if(!lists.length)throw Error('Keine Listen');if(!confirm('Aktuelle lokale Listen durch dieses Backup ersetzen?'))return;listeners.forEach(off=>off());listeners.clear();planDrafts.clear();state={...initial(),lists,items,activeId:lists[0].id};persist();closeModal();alertToast('Backup wiederhergestellt');}catch(e){alertToast('Backup ungültig: '+e.message);}}
// Firebase cloud. Auth is per-device, users are authenticated anonymously.
let authWatching=false;
async function applyUser(user){for(const off of listeners.values())off();listeners.clear();cloudUser=null;firebaseReady=false;cloudError='';
 if(user&&!user.isAnonymous){try{const approved=await cloud.collection('allowedUsers').doc(user.uid).get({source:'server'});if(!approved.exists||approved.data().enabled!==true){cloudError='Dieses Google-Konto ist noch nicht freigeschaltet. Nutzer-ID: '+user.uid;}else{cloudUser=user;firebaseReady=true;for(const l of state.lists)if(l.sharedId)watchList(l);alertToast('Google-Anmeldung und Cloud bereit');}}catch(e){cloudError='Freischaltung konnte nicht geprüft werden. Nutzer-ID: '+user.uid+' — '+(navigator.onLine?e.message:'kein Internet');}}
 render();if(!$('#overlay').hidden&&$('#syncInfo'))settingsModal();}
async function initFirebase(){const cfg=window.WOHIN_FIREBASE_CONFIG;if(!cfg?.apiKey||!cfg?.projectId)return;firebaseBusy=true;
try{await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js');await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js');
if(!firebase.apps.length)firebase.initializeApp(cfg);cloud=firebase.firestore();
if(!authWatching){authWatching=true;firebase.auth().onAuthStateChanged(applyUser);}
}catch(e){cloudError=e.message||String(e);render();}finally{firebaseBusy=false;}}
async function googleLogin(){try{await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());}catch(e){const m={'auth/unauthorized-domain':'Diese Adresse ist in Firebase nicht freigegeben: Authentication → Einstellungen → Autorisierte Domains → '+location.hostname+' hinzufügen.','auth/popup-blocked':'Das Anmeldefenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.','auth/popup-closed-by-user':'Anmeldung abgebrochen.','auth/network-request-failed':'Kein Internet.'};alertToast(m[e.code]||('Google-Anmeldung: '+e.message),e.code==='auth/unauthorized-domain'?9000:4000);}}
function needCloud(){if(!firebaseReady||!cloudUser||!cloud){settingsModal();return false;}return true;}
const sharedRef=id=>cloud.collection('sharedLists').doc(id);
function syncItem(l,item,op){if(!l?.sharedId)return;const payload={text:item.text,amount:item.amount,done:item.done,updatedAt:item.updatedAt};const id=l.sharedId;
 // Firestore persists pending writes offline. The local copy is the immediate UI state.
 if(cloudUser){let ref=sharedRef(id).collection('items').doc(item.id);const p=op==='delete'?ref.delete():ref.set(payload);p.catch(e=>{console.error(e);alertToast('Cloud: Änderung konnte nicht übertragen werden');});}
 else{state.pending.push({id,op,itemId:item.id,payload});save();}
}
function syncMeta(l){if(!l.sharedId)return;if(l.ownerUid&&l.ownerUid!==cloudUser?.uid){alertToast('Nur die Person, die diese Liste erstellt hat, kann sie umbenennen');return;}if(cloudUser){sharedRef(l.sharedId).update({name:l.name,store:l.store}).catch(e=>alertToast('Änderung nicht synchronisiert'));}}
async function flushPending(){if(!cloudUser||!state.pending.length)return;let tasks=state.pending.slice();state.pending=[];save();for(const task of tasks){try{let r=sharedRef(task.id).collection('items').doc(task.itemId);await(task.op==='delete'?r.delete():r.set(task.payload));}catch(e){state.pending.push(task);save();}}}
function stopListen(id){if(id&&listeners.has(id)){listeners.get(id)();listeners.delete(id);}}
function watchList(l){if(!cloud||!l.sharedId||listeners.has(l.sharedId))return;let sid=l.sharedId;
 const off1=sharedRef(sid).onSnapshot(s=>{if(!s.exists){return;}const cur=state.lists.find(z=>z.sharedId===sid);if(!cur)return;if(s.data().name&&cur.name!==s.data().name){cur.name=s.data().name;cur.store=s.data().store||'Alle Geschäfte';persist();}},err=>console.warn('Liste abonnieren',err.message));
 const off2=sharedRef(sid).collection('items').onSnapshot(s=>{const cur=state.lists.find(z=>z.sharedId===sid);if(!cur)return;for(const change of s.docChanges()){let idx=state.items.findIndex(i=>i.listId===cur.id&&i.id===change.doc.id);if(change.type==='removed'){if(idx!==-1)state.items.splice(idx,1);continue;}const d=change.doc.data(),item={id:change.doc.id,listId:cur.id,text:String(d.text||'').slice(0,140),amount:String(d.amount||''),done:!!d.done,updatedAt:d.updatedAt||Date.now()};if(idx===-1)state.items.push(item);else state.items[idx]={...item,department:state.items[idx].department};}persist();},err=>{console.error(err);alertToast('Cloud-Zugriff fehlgeschlagen');});
 listeners.set(sid,()=>{off1();off2();});flushPending();}
async function startShare(){if(!needCloud())return;const l=active();if(l.sharedId&&l.ownerUid&&l.ownerUid!==cloudUser.uid){alertToast('Nur die erstellende Person kann neue Einladungen versenden');return;}if(l.sharedId)return createInvite(l);
 try{let sid=uid();let ref=sharedRef(sid),batch=cloud.batch();await ref.set({name:l.name,store:l.store,ownerUid:cloudUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});for(const item of listItems(l.id))batch.set(ref.collection('items').doc(item.id),{text:item.text,amount:item.amount,done:item.done,updatedAt:item.updatedAt});await batch.commit();l.sharedId=sid;l.ownerUid=cloudUser.uid;persist();watchList(l);await createInvite(l);}catch(e){console.error(e);alertToast('Teilen nicht möglich: '+e.message);}}
async function createInvite(l){if(!needCloud())return;try{let code=uid().replace(/-/g,'')+uid().replace(/-/g,'');let expires=firebase.firestore.Timestamp.fromDate(new Date(Date.now()+15*60*1000));await cloud.collection('invites').doc(code).set({listId:l.sharedId,ownerUid:cloudUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp(),expiresAt:expires,usedBy:null});
 const qrValue='EINKAUF:'+code;openModal('Partner verbinden',`<div class="notice">Diese Einladung ist <strong>15 Minuten</strong> gültig und nur einmal nutzbar. Lass den QR-Code in der zweiten App scannen.</div><div class="qr-box" id="qrOutput"></div><p class="modal-label" style="text-align:center">Alternativ Code weitergeben</p><div class="codebox" id="pairCode">${esc(code)}</div><div class="modal-actions"><button class="primary wide" id="copyCode">Einladungscode kopieren</button><button class="secondary wide" id="shareCode">Per Messenger teilen</button></div>`);
 const q=new WohinQR(-1,0);q.addData(qrValue);q.make();const n=q.getModuleCount(),pad=4;let rects='';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(q.isDark(y,x))rects+=`<rect x="${x+pad}" y="${y+pad}" width="1" height="1"/>`;$('#qrOutput').innerHTML=`<svg aria-label="QR-Einladung" role="img" viewBox="0 0 ${n+2*pad} ${n+2*pad}" width="235" height="235" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="#172b21">${rects}</g></svg>`;$('#copyCode').onclick=async()=>{if(window.AndroidEinkauf?.copyText)window.AndroidEinkauf.copyText(code);else await navigator.clipboard.writeText(code);alertToast('Code kopiert');};$('#shareCode').onclick=async()=>{try{if(navigator.share)await navigator.share({text:'Einkauf-Einladungscode: '+code});else {if(window.AndroidEinkauf?.copyText)window.AndroidEinkauf.copyText(code);else await navigator.clipboard.writeText(code);alertToast('Code kopiert');}}catch(e){}};}
 catch(e){console.error(e);alertToast('Einladung fehlgeschlagen: '+e.message);}}
async function joinCode(raw){if(!needCloud())return;let code=String(raw||'').trim().replace(/^EINKAUF:/i,'').replace(/\s+/g,'');if(!/^[0-9a-f]{64}$/i.test(code)){alertToast('Ungültiger Einladungscode');return;}
 try{const ref=cloud.collection('invites').doc(code);const invite=await ref.get();if(!invite.exists)throw Error('Einladung existiert nicht');const d=invite.data();if(d.usedBy)throw Error('Code wurde bereits verwendet');if(d.expiresAt.toMillis()<Date.now())throw Error('Einladung abgelaufen');
 await cloud.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists||snap.data().usedBy||snap.data().expiresAt.toMillis()<Date.now())throw Error('Einladung abgelaufen oder verbraucht');tx.update(ref,{usedBy:cloudUser.uid});tx.set(sharedRef(d.listId).collection('members').doc(cloudUser.uid),{userId:cloudUser.uid,inviteId:code,joinedAt:firebase.firestore.FieldValue.serverTimestamp()});});
 const shared=await sharedRef(d.listId).get();if(!shared.exists)throw Error('Liste nicht gefunden');let l=state.lists.find(x=>x.sharedId===d.listId);if(!l){l={id:uid(),name:shared.data().name||'Gemeinsame Liste',store:shared.data().store||'Alle Geschäfte',sharedId:d.listId,ownerUid:shared.data().ownerUid};state.lists.push(l);}state.activeId=l.id;persist();watchList(l);closeModal();alertToast('Gemeinsame Liste verbunden!');
 }catch(e){console.error(e);alertToast('Verbinden fehlgeschlagen: '+e.message);}}
function pairModal(){if(!needCloud())return;const l=active();openModal('Gemeinsam einkaufen',`<p class="info">Teilt eure Listen über einen QR-Code. Jedes Geschäft kann separat geteilt werden. Änderungen erscheinen auf beiden Geräten.</p><div class="modal-actions"><button id="createPair" class="primary wide">${l.sharedId?'Neuen Einladungscode anzeigen':'Diese Liste teilen'}</button><button id="cameraPair" class="secondary wide">QR-Code scannen</button></div><label class="field">Oder Einladungscode eingeben<input id="joinCode" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="EINLADUNGSCODE"></label><button id="joinBtn" class="secondary wide" style="margin-top:9px">Mit Liste verbinden</button><p class="info">Du kannst mehrere Listen teilen. QR-Einladungen werden nach 15 Minuten ungültig.</p>`);$('#createPair').onclick=()=>startShare();$('#joinBtn').onclick=()=>joinCode($('#joinCode').value);$('#cameraPair').onclick=()=>startQRScan();}
function stopScan(){qrLoop++;if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null;}}
async function startQRScan(){if(!needCloud())return;if(window.AndroidEinkauf?.scanQRCode){window.AndroidEinkauf.scanQRCode();return;}
 if(!('BarcodeDetector' in window)){alertToast('QR-Kamera hier nicht verfügbar – Code eingeben');return;}
 try{const detector=new BarcodeDetector({formats:['qr_code']});scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});openModal('QR-Code scannen',`<p class="info">Halte die Kamera auf den QR-Code des anderen Handys.</p><video id="qrVideo" class="camera-preview" autoplay playsinline muted></video><button class="secondary wide" id="stopQR">Abbrechen</button>`);$('#qrVideo').srcObject=scanStream;$('#stopQR').onclick=()=>{closeModal();pairModal();};let token=++qrLoop;const loop=async()=>{if(token!==qrLoop)return;try{const found=await detector.detect($('#qrVideo'));if(found.length){const c=found[0].rawValue;stopScan();await joinCode(c);return;}}catch(e){}if(token===qrLoop)setTimeout(loop,320);};loop();}
 catch(e){stopScan();alertToast('Kamera nicht verfügbar: '+e.message);}}
window.onAndroidQRCode=code=>joinCode(code);
// UI listeners
const listCards = $('#listCards');
let itemPress = null;
let heldItemButton = null;

function cancelItemPress() {
  clearTimeout(itemPress?.timer);
  itemPress = null;
}

listCards.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  heldItemButton = null;
  cancelItemPress();
  const button = event.target.closest('.item-main');
  if (!button || !button.closest('[data-kind=shopping]')) return;
  const {pointerId, clientX, clientY} = event;
  const timer = setTimeout(() => {
    cancelItemPress();
    if (!button.isConnected || !$('#overlay').hidden) return;
    heldItemButton = button;
    categoryModal(button.dataset.id);
  }, 500);
  itemPress = {pointerId, clientX, clientY, timer};
});

window.addEventListener('pointermove', event => {
  if (itemPress?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - itemPress.clientX, event.clientY - itemPress.clientY) > 10) {
    cancelItemPress();
  }
}, {passive: true});
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(type, event => {
    if (itemPress?.pointerId === event.pointerId) cancelItemPress();
  });
}
window.addEventListener('blur', cancelItemPress);
listCards.addEventListener('contextmenu', event => {
  if (event.target.closest('.item-main') && (itemPress || heldItemButton)) event.preventDefault();
});
listCards.addEventListener('click', event => {
  if (heldItemButton && event.detail && heldItemButton.contains(event.target)) {
    heldItemButton = null;
    event.stopImmediatePropagation();
  }
}, true);
$('#closeModal').onclick=closeModal;$('#overlay').addEventListener('click',e=>{if(e.target===$('#overlay'))closeModal();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#overlay').hidden)closeModal();});
$('#listCards').addEventListener('click',e=>{const card=e.target.closest('.list-card');if(!card)return;state.activeId=card.dataset.list;const item=e.target.closest('[data-act]');if(item){if(item.dataset.act==='toggle')toggleItem(item.dataset.id);if(item.dataset.act==='edit')itemModal(item.dataset.id);return;}const action=e.target.closest('[data-card-action]')?.dataset.cardAction;if(['new-week','reroll-day','save-week','copy-week','share-week'].includes(action))return weekAction(active(),action,e.target.closest('[data-card-action]'));if(action==='menu')listModal();if(action==='scan')scanModal();if(action==='dictate')dictationModal(card.dataset.list);if(action==='share')pairModal();if(action==='recipe')recipeImportModal();if(action==='copy-gurkerl')copyCurrent();if(action==='export')exportModal();});
$('#listCards').addEventListener('submit',e=>{if(!e.target.matches('.card-add'))return;e.preventDefault();const id=e.target.closest('.list-card').dataset.list;state.activeId=id;const input=e.target.elements.article;const v=input.value;if(!v.trim())return;input.value='';addItem(v);const fresh=[...$('#listCards').querySelectorAll('.list-card')].find(c=>c.dataset.list===id);fresh.querySelector('input').focus();});
$('#newListBtn').onclick=newListModal;$('#settingsBtn').onclick=settingsModal;
$('#scanFile').onchange=e=>{handleImage(e.target.files?.[0]);e.target.value='';};$('#backupFile').onchange=e=>{restore(e.target.files?.[0]);e.target.value='';};
if(window.AndroidEinkauf && 'serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});}else if('serviceWorker' in navigator && location.protocol.startsWith('http')){navigator.serviceWorker.register('./sw.js').catch(console.warn);}
window.addEventListener('online',()=>{if(firebaseReady){flushPending();render();}else if(cloud&&window.firebase&&firebase.auth().currentUser)applyUser(firebase.auth().currentUser);else if(!firebaseBusy&&window.WOHIN_FIREBASE_CONFIG)initFirebase();});window.addEventListener('offline',render);
window.einkaufAndroidBack=()=>{if(!$('#overlay').hidden){closeModal();return true;}return false;};
render();initFirebase();
})();
