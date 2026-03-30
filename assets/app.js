const APP_VERSION = 'v124';
const DISTILLERIES_URL = './data/distilleries.json';
const TYPE_META = {
  whisky:{label:'ウイスキー',color:'#2563eb'},
  gin:{label:'ジン',color:'#059669'},
  brandy:{label:'ブランデー',color:'#9333ea'},
  rum:{label:'ラム',color:'#dc2626'},
  vodka:{label:'ウォッカ',color:'#0891b2'}
};
const QUICK_PRESETS = {
  all: {label:'すべて', types:['whisky','gin','brandy','rum','vodka']},
  whisky: {label:'ウイスキー', types:['whisky']},
  gin: {label:'ジン', types:['gin']},
  other_spirits: {label:'その他スピリッツ', types:['brandy','rum','vodka']}
};

const map = L.map('map', { zoomControl:true, preferCanvas:true }).setView([36.2, 137.7], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:18,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);

function clusterColor(markers){
  const counts={whisky:0,gin:0,brandy:0,rum:0,vodka:0,prep:0};
  markers.forEach(m=>{ if(m.options.preparing) counts.prep++; (m.options.types||[]).forEach(t=>{ if(counts[t]!==undefined) counts[t]++; }); });
  if(counts.prep > Math.max(counts.whisky,counts.gin,counts.brandy,counts.rum,counts.vodka)) return '#98a2b3';
  let w='whisky'; ['gin','brandy','rum','vodka'].forEach(t=>{ if(counts[t]>counts[w]) w=t; });
  return TYPE_META[w].color;
}
const cluster=L.markerClusterGroup({
  showCoverageOnHover:false, spiderfyOnMaxZoom:true, disableClusteringAtZoom:8,
  iconCreateFunction:function(c){
    const color=clusterColor(c.getAllChildMarkers());
    return L.divIcon({html:`<div class="cluster-icon" style="background:${color};">${c.getChildCount()}</div>`,className:'',iconSize:[42,42]});
  }
});
map.addLayer(cluster);

let distilleries=[];
let filteredCache=[];
let suggestionCache=[];
let activeSuggestionIndex=-1;
let currentActiveName=null;

const markerMap=new Map();
const cardMap=new Map();

const state={search:'',region:'all',visitableOnly:false,preparingMode:'hide',jwicMode:'all',sort:'name',quickPreset:'all',types:{whisky:true,gin:true,brandy:true,rum:true,vodka:true}};

function typesLabel(item){ return item.types_label || (item.types||[]).map(t=> (TYPE_META[t] ? TYPE_META[t].label : t)).join(' / '); }
function itemColor(item){ if(item.record_status==='preparing_or_unclear') return '#98a2b3'; const first=(item.types||[])[0]||'whisky'; return (TYPE_META[first] ? TYPE_META[first].color : '#2563eb'); }
function markerBackground(types, preparing){
  if (preparing) return '#98a2b3';
  const arr=(types||[]).filter(t=>TYPE_META[t]);
  if(!arr.length) return '#2563eb';
  if(arr.length===1) return TYPE_META[arr[0]].color;
  const step=100/arr.length;
  const parts=arr.map((t,i)=>`${TYPE_META[t].color} ${Math.round(i*step)}% ${Math.round((i+1)*step)}%`);
  return `conic-gradient(${parts.join(', ')})`;
}
function renderTypeChips(types){
  return (types||[]).map(t=>`<span class="type-chip"><span class="type-swatch" style="background:${TYPE_META[t] ? TYPE_META[t].color : '#2563eb'}"></span>${TYPE_META[t] ? TYPE_META[t].label : t}</span>`).join('');
}
function hasUsableCoords(item){
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < 20 || lat > 50 || lng < 120 || lng > 155) return false;
  return true;
}
function normalizeVisitLabel(label){
  const raw = (label || '').trim();
  if (!raw) return '見学未確認';
  if (raw === '見学情報未確認' || raw === '未確認') return '見学未確認';
  return raw;
}
function statusBadge(item){
  return item.data_status === '保留' ? '<span class="badge hold-badge">要確認</span>' : '';
}
function actionLinks(item){
  const mapUrl = item.google_maps_address_url || '';
  return `${item.official_url?`<a class="action-link" href="${item.official_url}" target="_blank" rel="noopener noreferrer">公式サイト</a>`:''}${mapUrl?`<a class="action-link" href="${mapUrl}" target="_blank" rel="noopener noreferrer">Googleマップ</a>`:''}`;
}
function coordinateBadge(item){
  if(item.coordinate_status === 'approx') return '<span class="badge approx-badge">位置は暫定</span>';
  if(item.coordinate_status === 'area') return '<span class="badge area-badge">エリア位置</span>';
  return '';
}
function popupHtml(item){
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',Meiryo,sans-serif;line-height:1.6;min-width:278px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;">
      <div style="font-size:16px;font-weight:700;">${item.name}</div>
      ${item.data_status === '保留' ? '<span class="popup-status">要確認</span>' : ''}
    </div>
    <div><b>種類</b></div><div class="multi-type-row">${renderTypeChips(item.types||[])}</div>
    <div><b>所在地：</b>${item.location||'未設定'}</div>
    ${item.coordinate_status && item.coordinate_status !== 'exact' ? `<div><b>位置情報：</b>${item.coordinate_status === 'approx' ? '暫定' : 'エリア位置'}</div>` : ''}
    <div><b>見学：</b>${normalizeVisitLabel(item.visit_label)}</div>
    ${(item.brands && item.brands.length)?`<div><b>代表銘柄：</b>${item.brands.join(' / ')}</div>`:''}
    ${item.note?`<div><b>特徴：</b>${item.note}</div>`:''}
    <div class="popup-subline"><b>最終確認日：</b>${item.last_checked||'未設定'}</div>
    <div class="action-row">${actionLinks(item)}</div>
  </div>`;
}

function buildMarkers(items){
  cluster.clearLayers();
  markerMap.clear();
  items.filter(item => hasUsableCoords(item)).forEach(item => {
    const preparing = item.record_status==='preparing_or_unclear';
    const icon = L.divIcon({
      className:'',
      html:`<div class="marker-shell ${preparing ? 'preparing' : ''} ${item.coordinate_status==='approx' ? 'approx' : ''}" style="background:${markerBackground(item.types || [], preparing)}"></div>`,
      iconSize:[18,18],
      iconAnchor:[9,9],
      popupAnchor:[0,-10]
    });
    const marker = L.marker([Number(item.lat), Number(item.lng)], {icon});
    marker.options.types = item.types || [];
    marker.options.preparing = preparing;
    marker.on('mouseover',()=>setHoveredName(item.name,true));
    marker.on('mouseout',()=>setHoveredName(item.name,false));
    marker.on('click',()=>setActiveName(item.name));
    marker.bindPopup(popupHtml(item), {maxWidth:390});
    marker.bindTooltip(item.name,{direction:'top'});
    cluster.addLayer(marker);
    markerMap.set(item.name, marker);
  });
}
function matchesTypes(item){ const types=item.types||[]; return types.length>0 && types.some(t=>state.types[t]); }
function matchesPreparing(item){ return state.preparingMode==='show' || item.record_status!=='preparing_or_unclear'; }
function matchesJwic(item){ return true; }
function sortItems(items){
  const arr=[...items];
  if(state.sort==='region') return arr.sort((a,b)=>((a.region||'')+(a.location||'')).localeCompare((b.region||'')+(b.location||''),'ja'));
  if(state.sort==='status') return arr.sort((a,b)=>(a.record_status||'').localeCompare(b.record_status||'','ja'));
  if(state.sort==='visit') return arr.sort((a,b)=>(a.visit_label||'').localeCompare(b.visit_label||'','ja'));
  return arr.sort((a,b)=>a.name.localeCompare(b.name,'ja'));
}
function filteredItems(){
  const q=state.search.trim().toLowerCase();
  return sortItems(distilleries.filter(item=>{
    if(!matchesTypes(item)) return false;
    if(!matchesPreparing(item)) return false;
    if(!matchesJwic(item)) return false;
    if(state.visitableOnly && !item.visitable) return false;
    if(state.region!=='all' && item.region!==state.region) return false;
    if(!q) return true;
    const hay=[item.name,item.location||'',item.region||'',typesLabel(item),item.note||'',item.source_label||'',...(item.brands||[])].join(' ').toLowerCase();
    return hay.includes(q);
  }));
}
function suggestionItems(query){
  const q=query.trim().toLowerCase();
  if(!q) return [];
  const scored = filteredCache.map(item=>{
    let score=0;
    const name=(item.name||'').toLowerCase();
    const brands=(item.brands||[]).join(' ').toLowerCase();
    const loc=(item.location||'').toLowerCase();
    if(name.startsWith(q)) score+=50;
    if(name.includes(q)) score+=25;
    if(brands.includes(q)) score+=15;
    if(loc.includes(q)) score+=10;
    if(score===0) return null;
    return {item, score};
  }).filter(Boolean).sort((a,b)=>b.score-a.score || a.item.name.localeCompare(b.item.name,'ja')).slice(0,8);
  return scored.map(x=>x.item);
}
function renderSuggestions(items){
  const box=document.getElementById('suggestions');
  suggestionCache=items;
  activeSuggestionIndex=-1;
  if(!items.length){ box.classList.remove('open'); box.innerHTML=''; return; }
  box.innerHTML=items.map((item,i)=>`<div class="suggestion-item" data-index="${i}" data-name="${item.name}"><div class="suggestion-title">${item.name}</div><div class="suggestion-sub">${typesLabel(item)} / ${item.location||'所在地未設定'}</div></div>`).join('');
  box.classList.add('open');
  box.querySelectorAll('.suggestion-item').forEach(el=>{
    el.addEventListener('mousedown',e=>{ e.preventDefault(); chooseSuggestion(el.dataset.name); });
  });
}
function updateSuggestionActive(){
  const items=document.querySelectorAll('.suggestion-item');
  items.forEach((el,i)=>el.classList.toggle('active', i===activeSuggestionIndex));
}
function chooseSuggestion(name){
  const input=document.getElementById('searchInput');
  input.value=name; state.search=name;
  renderSuggestions([]);
  rerender();
  focusItemByName(name, true);
}
function focusItemByName(name, smoothScroll){
  const item=filteredCache.find(x=>x.name===name) || distilleries.find(x=>x.name===name);
  const marker=markerMap.get(name);
  if(item && marker){
    map.setView([Number(item.lat), Number(item.lng)], Math.max(map.getZoom(),9), {animate:true});
    marker.openPopup();
    setActiveName(name);
  }
  const card=cardMap.get(name);
  if(card){ card.scrollIntoView({behavior:smoothScroll?'smooth':'auto', block:'nearest'}); }
}
function renderList(items){
  const list=document.getElementById('list');
  cardMap.clear();
  if(!items.length){ list.innerHTML='<div class="empty">条件に合う蒸溜所が見つかりませんでした。</div>'; return; }
  list.innerHTML=items.map(item=>`<article class="card" data-name="${item.name}">
    <div class="card-head">
      <h3>${item.name}</h3>
      <div class="card-head-badges">${statusBadge(item)}${coordinateBadge(item)}</div>
    </div>
    <div class="meta">
      <span class="badge ${item.visitable?'visit-yes':'visit-no'}">${normalizeVisitLabel(item.visit_label)}</span>
      ${item.record_status==='preparing_or_unclear' ? `<span class="badge prep-badge">準備中・詳細不明</span>` : ''}
    </div>
    <div class="multi-type-row">${renderTypeChips(item.types||[])}</div>
    <div class="location"><b>所在地：</b>${item.location||'未設定'}</div>
    ${(item.brands && item.brands.length)?`<div class="brands"><b>代表銘柄：</b>${item.brands.join(' / ')}</div>`:''}
    ${item.note?`<div class="note"><b>特徴：</b>${item.note}</div>`:''}
    <div class="updated-note"><b>最終確認日：</b>${item.last_checked||'未設定'}</div>
    <div class="action-row">${actionLinks(item)}</div>
  </article>`).join('');
  list.querySelectorAll('.card').forEach(card=>{
    const name=card.getAttribute('data-name');
    cardMap.set(name, card);
    card.addEventListener('click',()=>focusItemByName(name, true));
    card.addEventListener('mouseenter',()=>setHoveredName(name,true));
    card.addEventListener('mouseleave',()=>setHoveredName(name,false));
  });
  if(currentActiveName) setActiveName(currentActiveName);
}

function renderSummary(items){
  const counts={whisky:0,gin:0,brandy:0,rum:0,vodka:0};
  items.forEach(item=>(item.types||[]).forEach(t=>{ if(counts[t]!==undefined) counts[t]++; }));
  const prep=items.filter(x=>x.record_status==='preparing_or_unclear').length;
  const hold=items.filter(x=>x.data_status==='保留').length;
  const approx=items.filter(x=>x.coordinate_status==='approx').length;
  document.getElementById('summary').textContent=`表示中 ${items.length} 件 / ウイスキー ${counts.whisky} / ジン ${counts.gin} / ブランデー ${counts.brandy} / ラム ${counts.rum} / ウォッカ ${counts.vodka} / 要確認 ${hold} / 準備中・詳細不明 ${prep} / 暫定位置 ${approx}`;
  const versionEl = document.getElementById('versionInfo');
  if(versionEl){ versionEl.textContent = `表示バージョン: ${APP_VERSION} / data/distilleries.json`; }
}
function rerender(){
  filteredCache=filteredItems();
  buildMarkers(filteredCache);
  renderList(filteredCache);
  renderSummary(filteredCache);
  renderSuggestions(suggestionItems(state.search));
}
function applyQuickPreset(key){
  state.quickPreset=key;
  const preset=QUICK_PRESETS[key];
  Object.keys(state.types).forEach(t=>{ state.types[t]=preset.types.includes(t); });
  document.querySelectorAll('.quick-pill').forEach(btn=>btn.classList.toggle('active', btn.dataset.preset===key));
  rerender();
}
function setHoveredName(name, hovered){
  const marker=markerMap.get(name);
  if(marker && marker._icon){ const shell = marker._icon.querySelector('.marker-shell'); if(shell){ shell.classList.toggle('hovered', hovered); } }
  const card=cardMap.get(name);
  if(card){ card.classList.toggle('hover-card', hovered); }
}
function setActiveName(name){
  if(currentActiveName && currentActiveName!==name){
    const oldMarker=markerMap.get(currentActiveName);
    if(oldMarker && oldMarker._icon){ const oldShell = oldMarker._icon.querySelector('.marker-shell'); if(oldShell){ oldShell.classList.remove('active'); } }
    const oldCard = cardMap.get(currentActiveName); if(oldCard){ oldCard.classList.remove('active-card'); }
  }
  currentActiveName=name;
  const newMarker = markerMap.get(name); if(newMarker && newMarker._icon){ const newShell = newMarker._icon.querySelector('.marker-shell'); if(newShell){ newShell.classList.add('active'); } }
  const newCard = cardMap.get(name); if(newCard){ newCard.classList.add('active-card'); }
}
function bindUI(){
  const input=document.getElementById('searchInput');
  const suggestionBox=document.getElementById('suggestions');
  input.addEventListener('input',e=>{ state.search=e.target.value; rerender(); });
  input.addEventListener('focus',()=>renderSuggestions(suggestionItems(state.search)));
  input.addEventListener('keydown',e=>{
    if(!suggestionCache.length) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); activeSuggestionIndex=Math.min(activeSuggestionIndex+1, suggestionCache.length-1); updateSuggestionActive(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); activeSuggestionIndex=Math.max(activeSuggestionIndex-1, 0); updateSuggestionActive(); }
    else if(e.key==='Enter' && activeSuggestionIndex>=0){ e.preventDefault(); chooseSuggestion(suggestionCache[activeSuggestionIndex].name); }
    else if(e.key==='Escape'){ renderSuggestions([]); }
  });
  document.addEventListener('click',e=>{ if(!document.getElementById('searchWrap').contains(e.target)) renderSuggestions([]); });

  document.getElementById('visitableOnly').addEventListener('change',e=>{ state.visitableOnly=e.target.checked; rerender(); });
  document.getElementById('preparingMode').addEventListener('change',e=>{ state.preparingMode=e.target.checked?'show':'hide'; rerender(); });
  document.getElementById('sortSelect').addEventListener('change',e=>{ state.sort=e.target.value; rerender(); });
  document.getElementById('regionSelect').addEventListener('change',e=>{ state.region=e.target.value; rerender(); });
  document.querySelectorAll('.quick-pill').forEach(btn=>btn.addEventListener('click',()=>applyQuickPreset(btn.dataset.preset)));

  const headerCard=document.getElementById('headerCard');
  const headerToggle=document.getElementById('headerToggle');
  headerToggle.addEventListener('click',()=>{
    const expanded=headerCard.classList.toggle('expanded');
    headerToggle.setAttribute('aria-expanded',expanded?'true':'false');
    headerToggle.textContent=expanded?'補足を閉じる':'補足を表示';
  });

  const panel=document.getElementById('sidePanel');
  const mobileFilterToggle=document.getElementById('mobileFilterToggle');
  const filterBox=document.getElementById('filterBox');
  mobileFilterToggle.addEventListener('click',()=>{
    panel.classList.toggle('filter-open');
    const isOpen = panel.classList.contains('filter-open');
    if(window.innerWidth < 960){
      filterBox.open = isOpen;
    }
    mobileFilterToggle.textContent=isOpen?'絞り込みを閉じる':'絞り込みを開く';
  });

  map.on('click',()=>{ if(window.innerWidth < 960){ panel.scrollIntoView({behavior:'smooth', block:'start'}); }});
}
fetch(DISTILLERIES_URL)
  .then(r=>{ if(!r.ok) throw new Error(`distilleries.json: ${r.status}`); return r.json(); })
  .then(items=>{ distilleries=items; bindUI(); applyQuickPreset('all'); })
  .catch(err=>{ document.getElementById('list').innerHTML=`<div class="empty">データの読み込みに失敗しました。<br>${err.message}</div>`; console.error(err); });

window.addEventListener('resize', ()=>{
  const panel=document.getElementById('sidePanel');
  const mobileFilterToggle=document.getElementById('mobileFilterToggle');
  const filterBox=document.getElementById('filterBox');
  if(window.innerWidth >= 960){
    panel.classList.remove('filter-open');
    filterBox.open = false;
    mobileFilterToggle.textContent='絞り込みを開く';
  }
});
