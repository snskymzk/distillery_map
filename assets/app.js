const APP_VERSION = 'v192';
const DISTILLERIES_URL = './data/distilleries.public.json';
const TYPE_META = {
  whisky:{label:'ウイスキー',color:'#2563eb'},
  gin:{label:'ジン',color:'#059669'},
  brandy:{label:'ブランデー',color:'#9333ea'},
  rum:{label:'ラム',color:'#dc2626'},
  vodka:{label:'ウォッカ',color:'#0891b2'}
};
const REGION_ORDER = {'北海道':0,'東北':1,'関東':2,'東海':3,'北陸':4,'近畿':5,'中国':6,'四国':7,'九州':8,'沖縄':9,'所在地未設定':10};
const PREF_TO_REGION = {
  '北海道':'北海道',
  '青森県':'東北','岩手県':'東北','秋田県':'東北','宮城県':'東北','山形県':'東北','福島県':'東北','新潟県':'東北',
  '茨城県':'関東','栃木県':'関東','群馬県':'関東','山梨県':'関東','長野県':'関東','埼玉県':'関東','千葉県':'関東','東京都':'関東','神奈川県':'関東',
  '静岡県':'東海','岐阜県':'東海','愛知県':'東海','三重県':'東海',
  '富山県':'北陸','石川県':'北陸','福井県':'北陸',
  '滋賀県':'近畿','京都府':'近畿','奈良県':'近畿','和歌山県':'近畿','大阪府':'近畿','兵庫県':'近畿',
  '鳥取県':'中国','島根県':'中国','岡山県':'中国','広島県':'中国','山口県':'中国',
  '徳島県':'四国','香川県':'四国','愛媛県':'四国','高知県':'四国',
  '福岡県':'九州','佐賀県':'九州','長崎県':'九州','大分県':'九州','熊本県':'九州','宮崎県':'九州','鹿児島県':'九州',
  '沖縄県':'沖縄'
};

const PREF_ORDER = {
  '北海道':0,
  '青森県':1,'岩手県':2,'秋田県':3,'宮城県':4,'山形県':5,'福島県':6,'新潟県':7,
  '茨城県':8,'栃木県':9,'群馬県':10,'山梨県':11,'長野県':12,'埼玉県':13,'千葉県':14,'東京都':15,'神奈川県':16,
  '静岡県':17,'岐阜県':18,'愛知県':19,'三重県':20,
  '富山県':21,'石川県':22,'福井県':23,
  '滋賀県':24,'京都府':25,'奈良県':26,'和歌山県':27,'大阪府':28,'兵庫県':29,
  '鳥取県':30,'島根県':31,'岡山県':32,'広島県':33,'山口県':34,
  '徳島県':35,'香川県':36,'愛媛県':37,'高知県':38,
  '福岡県':39,'佐賀県':40,'長崎県':41,'大分県':42,'熊本県':43,'宮崎県':44,'鹿児島県':45,
  '沖縄県':46
};

const QUICK_PRESETS = {
  all: {label:'すべて', types:['whisky','gin','brandy','rum','vodka']},
  whisky: {label:'ウイスキー', types:['whisky']},
  gin: {label:'ジン', types:['gin']},
  other_spirits: {label:'その他スピリッツ', types:['brandy','rum','vodka']}
};

const DEFAULT_VIEW = { center:[36.2, 137.7], zoom:5 };
const map = L.map('map', { zoomControl:true, preferCanvas:true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
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
function normalizedRegion(item){
  const precomputed = String(item._sort_region || '').trim();
  if (precomputed && Object.prototype.hasOwnProperty.call(REGION_ORDER, precomputed)) {
    return precomputed;
  }
  const pref = extractPrefecture(item);
  if (pref !== '所在地未設定' && Object.prototype.hasOwnProperty.call(PREF_TO_REGION, pref)) {
    return PREF_TO_REGION[pref];
  }
  const reg = String(item.region || '').trim();
  if (Object.prototype.hasOwnProperty.call(REGION_ORDER, reg)) return reg;
  return '所在地未設定';
}

function extractPrefecture(item){
  const precomputed = String(item._sort_prefecture || '').trim();
  if (precomputed) return precomputed;
  const loc = String(item.location || '').trim();
  if(!loc) return '所在地未設定';
  if(loc.startsWith('北海道')) return '北海道';
  const m = loc.match(/^(東京都|京都府|大阪府|北海道|[^都道府県]+県)/);
  return m ? m[1] : '所在地未設定';
}
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
function visitableBadgeHtml(item){
  if(!item.visitable) return '';
  const label = normalizeVisitLabel(item.visit_label);
  const text = label && label !== '見学未確認' ? `見学可 / ${label}` : '見学可';
  return `<span class="visit-badge-strong">${text}</span>`;
}
function popupVisitableBadgeHtml(item){
  if(!item.visitable) return '';
  const label = normalizeVisitLabel(item.visit_label);
  const text = label && label !== '見学未確認' ? `見学可 / ${label}` : '見学可';
  return `<span class="popup-visit-badge">${text}</span>`;
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

function representativeProducts(item){
  const reps = Array.isArray(item.representative_products) ? item.representative_products.filter(x => String(x||'').trim()) : [];
  if (reps.length) return reps;
  const legacy = Array.isArray(item.brands) ? item.brands.filter(x => String(x||'').trim()) : [];
  return legacy;
}

function popupHtml(item){
  const reps = representativeProducts(item);
  const repLine = reps.length ? `<div><b>代表銘柄：</b>${reps.join(' / ')}</div>` : '';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',Meiryo,sans-serif;line-height:1.6;min-width:250px;">
    <div class="popup-topline">
      <div class="popup-title">${item.name}</div>
      ${popupVisitableBadgeHtml(item)}
    </div>
    <div class="multi-type-row" style="margin-bottom:6px;">${renderTypeChips(item.types||[])}</div>
    <div><b>所在地：</b>${item.location||'未設定'}</div>
    ${repLine}
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
    marker.on('click',()=>{ setActiveName(item.name); pulseMarkerName(item.name); });
    marker.bindPopup(popupHtml(item), {maxWidth:320, autoPan:true, autoPanPaddingTopLeft:[16,68], autoPanPaddingBottomRight:[16,48], keepInView:true, closeButton:true});
    marker.bindTooltip(item.name,{direction:'top'});
    cluster.addLayer(marker);
    markerMap.set(item.name, marker);
  });
}
function matchesTypes(item){ const types=item.types||[]; return types.length>0 && types.some(t=>state.types[t]); }
function matchesPreparing(item){ return state.preparingMode==='show' || item.record_status!=='preparing_or_unclear'; }
function matchesJwic(item){ return true; }
function sortItems(items){
  const arr = [...items];
  if ((state.sort || 'name') === 'region') {
    return arr.sort((a,b)=>{
      const ar = normalizedRegion(a);
      const br = normalizedRegion(b);
      const ai = Object.prototype.hasOwnProperty.call(REGION_ORDER, ar) ? REGION_ORDER[ar] : 99;
      const bi = Object.prototype.hasOwnProperty.call(REGION_ORDER, br) ? REGION_ORDER[br] : 99;
      if (ai !== bi) return ai - bi;

      const ap = extractPrefecture(a);
      const bp = extractPrefecture(b);
      const api = Object.prototype.hasOwnProperty.call(PREF_ORDER, ap) ? PREF_ORDER[ap] : 999;
      const bpi = Object.prototype.hasOwnProperty.call(PREF_ORDER, bp) ? PREF_ORDER[bp] : 999;
      if (api !== bpi) return api - bpi;

      return (a.name||'').localeCompare((b.name||''), 'ja');
    });
  }
  return arr.sort((a,b)=>(a.name||'').localeCompare((b.name||''), 'ja'));
}
function filteredItems(){
  const q=state.search.trim().toLowerCase();
  const filtered = distilleries.filter(item=>{
    if(!matchesTypes(item)) return false;
    if(!matchesPreparing(item)) return false;
    if(!matchesJwic(item)) return false;
    if(state.visitableOnly && !item.visitable) return false;
    if(state.region!=='all' && item.region!==state.region) return false;
    if(!q) return true;
    const hay=[item.name,item.location||'',item.region||'',typesLabel(item),item.note||'',item.source_label||'',...representativeProducts(item)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  return sortItems(filtered);
}
function suggestionItems(query){
  const q=query.trim().toLowerCase();
  if(!q) return [];
  const scored = filteredCache.map(item=>{
    let score=0;
    const name=(item.name||'').toLowerCase();
    const brands=representativeProducts(item).join(' ').toLowerCase();
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
  if(!(item && marker)) return;

  const lat = Number(item.lat);
  const lng = Number(item.lng);
  const targetZoom = Math.max(map.getZoom(), 9);

  if(window.innerWidth <= 960){
    const offsetLat = lat - 0.03;
    map.setView([offsetLat, lng], targetZoom, {animate:true});
    setTimeout(()=>{
      marker.openPopup();
      setActiveName(name);
      pulseMarkerName(name);
    }, 220);
  }else{
    map.setView([lat, lng], targetZoom, {animate:true});
    marker.openPopup();
    setActiveName(name);
    pulseMarkerName(name);
    const card=cardMap.get(name);
    if(card){
      card.scrollIntoView({behavior:smoothScroll?'smooth':'auto', block:'nearest'});
    }
  }
}
function renderList(items){
  const list=document.getElementById('list');
  cardMap.clear();
  if(!items.length){ list.innerHTML='<div class="empty">条件に合う蒸溜所が見つかりませんでした。</div>'; return; }
  list.innerHTML=items.map(item=>{
    const reps = representativeProducts(item);
    const repText = reps.length ? `${reps[0]}${reps.length>1?` ほか${reps.length-1}件`:''}` : '';
    return `<article class="card" data-name="${item.name}">
      <div class="card-head">
        <div class="card-title-wrap">
          <h3>${item.name}</h3>
        </div>
        ${visitableBadgeHtml(item)}
      </div>
      <div class="multi-type-row">${renderTypeChips(item.types||[])}</div>
      <div class="location">${item.location||'所在地未設定'}</div>
      ${repText?`<div class="brands"><b>代表銘柄：</b>${repText}</div>`:''}
      <div class="action-row">${actionLinks(item)}</div>
    </article>`;
  }).join('');
  list.querySelectorAll('.card').forEach(card=>{
    const name=card.getAttribute('data-name');
    cardMap.set(name, card);
    card.addEventListener('click',(e)=>{
      if(e.target && e.target.closest('.action-row')) return;
      focusItemByName(name, true);
    });
    card.addEventListener('mouseenter',()=>setHoveredName(name,true));
    card.addEventListener('mouseleave',()=>setHoveredName(name,false));
  });
  if(currentActiveName) setActiveName(currentActiveName);
}







function renderSummary(items){
  const summaryEl = document.getElementById('summary');
  if(summaryEl) summaryEl.textContent = '';
  const versionEl = document.getElementById('versionInfo');
  if(versionEl){
    versionEl.textContent = `表示バージョン: ${APP_VERSION} / ${DISTILLERIES_URL}`;
  }
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
function pulseMarkerName(name){
  const marker = markerMap.get(name);
  if(marker && marker._icon){
    const shell = marker._icon.querySelector('.marker-shell');
    if(shell){
      shell.classList.remove('flash');
      void shell.offsetWidth;
      shell.classList.add('flash');
      setTimeout(()=>shell.classList.remove('flash'), 900);
    }
  }
  const card = cardMap.get(name);
  if(card){
    card.classList.remove('flash-card');
    void card.offsetWidth;
    card.classList.add('flash-card');
    setTimeout(()=>card.classList.remove('flash-card'), 700);
  }
}

function setHoveredName(name, hovered){
  const marker=markerMap.get(name);
  if(marker && marker._icon){
    const shell = marker._icon.querySelector('.marker-shell');
    if(shell){ shell.classList.toggle('hovered', hovered); }
  }
  const card=cardMap.get(name);
  if(card){ card.classList.toggle('hover-card', hovered); }
}
function setActiveName(name){
  if(currentActiveName && currentActiveName!==name){
    const oldMarker=markerMap.get(currentActiveName);
    if(oldMarker && oldMarker._icon){
      const oldShell = oldMarker._icon.querySelector('.marker-shell');
      if(oldShell){ oldShell.classList.remove('active'); }
    }
    const oldCard = cardMap.get(currentActiveName);
    if(oldCard){ oldCard.classList.remove('active-card'); }
  }
  currentActiveName=name;
  const newMarker = markerMap.get(name);
  if(newMarker && newMarker._icon){
    const newShell = newMarker._icon.querySelector('.marker-shell');
    if(newShell){ newShell.classList.add('active'); }
  }
  const newCard = cardMap.get(name);
  if(newCard){
    newCard.classList.add('active-card');
    if(window.innerWidth > 960){
      newCard.scrollIntoView({behavior:'smooth', block:'nearest'});
    }
  }
}
function bindUI(){
  const input=document.getElementById('searchInput');
  const searchWrap=document.getElementById('searchWrap');
  if(input){
    input.addEventListener('input',e=>{ state.search=e.target.value; rerender(); });
    input.addEventListener('focus',()=>renderSuggestions(suggestionItems(state.search)));
    input.addEventListener('keydown',e=>{
      if(!suggestionCache.length) return;
      if(e.key==='ArrowDown'){ e.preventDefault(); activeSuggestionIndex=Math.min(activeSuggestionIndex+1, suggestionCache.length-1); updateSuggestionActive(); }
      else if(e.key==='ArrowUp'){ e.preventDefault(); activeSuggestionIndex=Math.max(activeSuggestionIndex-1, 0); updateSuggestionActive(); }
      else if(e.key==='Enter' && activeSuggestionIndex>=0){ e.preventDefault(); chooseSuggestion(suggestionCache[activeSuggestionIndex].name); }
      else if(e.key==='Escape'){ renderSuggestions([]); }
    });
  }
  document.addEventListener('click',e=>{ if(searchWrap && !searchWrap.contains(e.target)) renderSuggestions([]); });

  const visitable = document.getElementById('visitableOnly');
  if(visitable){
    visitable.checked = !!state.visitableOnly;
    visitable.addEventListener('change',e=>{ state.visitableOnly=e.target.checked; rerender(); });
  }
  const sortSelect = document.getElementById('sortSelect');
  if(sortSelect){
    sortSelect.value = state.sort || 'name';
    sortSelect.addEventListener('change', e => {
      state.sort = e.target.value;
      rerender();
    });
  }
  document.querySelectorAll('.quick-pill').forEach(btn=>btn.addEventListener('click',()=>applyQuickPreset(btn.dataset.preset)));
  const resetViewBtn = document.getElementById('resetViewBtn');
  if(resetViewBtn){
    resetViewBtn.addEventListener('click',()=>{
      map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, {animate:true});
    });
  }
}
fetch(DISTILLERIES_URL)
  .then(r=>{ if(!r.ok) throw new Error(`distilleries.json: ${r.status}`); return r.json(); })
  .then(items=>{ distilleries=items; bindUI(); enableMobileDoubleTapZoom(); applyQuickPreset('all'); })
  .catch(err=>{ document.getElementById('list').innerHTML=`<div class="empty">データの読み込みに失敗しました。<br>${err.message}</div>`; console.error(err); });







function enableMobileDoubleTapZoom(){
  const mapEl = document.getElementById('map');
  if(!mapEl) return;
  let lastTapAt = 0;
  let lastX = 0;
  let lastY = 0;

  mapEl.addEventListener('touchend', (e) => {
    if(window.innerWidth > 960) return;
    if(!e.changedTouches || e.changedTouches.length !== 1) return;

    const t = e.changedTouches[0];
    const now = Date.now();
    const dt = now - lastTapAt;
    const dx = Math.abs(t.clientX - lastX);
    const dy = Math.abs(t.clientY - lastY);

    if(dt > 0 && dt < 320 && dx < 24 && dy < 24){
      e.preventDefault();
      const point = map.mouseEventToContainerPoint({ clientX:t.clientX, clientY:t.clientY });
      const latlng = map.containerPointToLatLng(point);
      map.setZoomAround(latlng, map.getZoom() + 1, { animate:true });
      lastTapAt = 0;
      return;
    }

    lastTapAt = now;
    lastX = t.clientX;
    lastY = t.clientY;
  }, { passive: false });
}
