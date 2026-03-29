const DISTILLERIES_URL = './data/distilleries.json';
const CANDIDATES_URL = './data/candidates.json';
const map = L.map('map', { zoomControl:true, preferCanvas:true }).setView([36.2, 137.7], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18, attribution:'&copy; OpenStreetMap contributors' }).addTo(map);

function clusterColor(markers) {
  let w = 0, g = 0, b = 0, c = 0;
  markers.forEach(m => {
    const t = m.options.itemType;
    if (m.options.isCandidate) c++;
    else if (t === 'whisky') w++;
    else if (t === 'gin') g++;
    else b++;
  });
  if (c > w && c > g && c > b) return '#d97706';
  if (b >= w && b >= g) return '#7c3aed';
  if (w >= g) return '#2563eb';
  return '#059669';
}
const cluster = L.markerClusterGroup({
  showCoverageOnHover:false,
  spiderfyOnMaxZoom:true,
  disableClusteringAtZoom:8,
  iconCreateFunction: function(c) {
    const children = c.getAllChildMarkers();
    const color = clusterColor(children);
    return L.divIcon({
      html:`<div class="cluster-icon" style="background:${color};">${c.getChildCount()}</div>`,
      className:'',
      iconSize:[42,42]
    });
  }
});
map.addLayer(cluster);

const markerMap = new Map();
const state = { search:'', type:'all', visitableOnly:false, sort:'name', region:'all', candidateMode:false };
let distilleries = [];
let candidates = [];

function typeLabel(item) { return item.type_label || (item.type === 'both' ? 'ウイスキー＋クラフトジン' : item.type === 'whisky' ? 'ウイスキー' : 'クラフトジン'); }
function colorFor(item) {
  if (item.isCandidate) return '#d97706';
  if (item.type === 'both') return '#7c3aed';
  if (item.type === 'whisky') return '#2563eb';
  return '#059669';
}
function popupHtml(item) {
  const candidateInfo = item.isCandidate ? `<div><b>候補ステータス：</b>${item.candidate_status || '候補'}</div><div><b>監査状態：</b>${item.review_state || '未設定'}</div><div><b>操業状態：</b>${item.operation_status || '未設定'}</div><div><b>次の対応：</b>${item.next_action || '未設定'}</div>` : '';
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',Meiryo,sans-serif;line-height:1.6;min-width:270px;">
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${item.name}</div>
      ${item.isCandidate ? '<div style="margin-bottom:6px;color:#b45309;font-weight:700;">未収載候補</div>' : ''}
      <div><b>種別：</b>${typeLabel(item)}</div>
      <div><b>地域：</b>${item.region}</div>
      <div><b>所在地：</b>${item.location}</div>
      ${candidateInfo}
      <div><b>見学情報：</b>${item.visit_label}</div>
      <div><b>代表銘柄：</b>${(item.brands || []).join(' / ')}</div>
      <div><b>特徴：</b>${item.note || ''}</div>
      <div><b>情報ソース：</b>${item.source_label || '未設定'}</div>
      <div><b>最終確認日：</b>${item.last_checked || '未設定'}</div>
      <div style="margin-top:8px; display:flex; gap:12px; flex-wrap:wrap;">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer">参照ページを開く</a>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location)}" target="_blank" rel="noopener noreferrer">Googleマップで開く</a>
      </div>
    </div>`;
}
function buildMarkers(items) {
  cluster.clearLayers();
  markerMap.clear();
  items.forEach(item => {
    const marker = L.circleMarker([item.lat, item.lng], {
      radius:item.isCandidate ? 9 : 8, color:colorFor(item), weight:item.isCandidate ? 3 : 2, fillColor:colorFor(item),
      fillOpacity:item.isCandidate ? 0.08 : (item.visitable ? 0.82 : 0.28), opacity:item.visitable ? 1 : 0.75, dashArray:item.isCandidate ? '5 3' : null
    });
    marker.options.itemType = item.type;
    marker.options.isCandidate = !!item.isCandidate;
    marker.bindPopup(popupHtml(item), {maxWidth:390});
    marker.bindTooltip(item.name, {direction:'top'});
    cluster.addLayer(marker);
    markerMap.set(item.name, marker);
  });
}
function matchesType(item) {
  if (state.type === 'all') return true;
  if (state.type === 'both') return item.type === 'both';
  return item.type === state.type || item.type === 'both';
}
function sortWeightVisit(label) {
  if (label === '見学可') return 0;
  if (label === '予約制') return 1;
  if (label === 'イベント開催時のみ') return 2;
  if (label === '営業日限定') return 3;
  if (label === '現在見学受付なし') return 4;
  return 5;
}
function sortItems(items) {
  const arr = [...items];
  if (state.sort === 'pref') return arr.sort((a,b) => (a.region + a.location).localeCompare(b.region + b.location, 'ja'));
  if (state.sort === 'visit') return arr.sort((a,b) => {
    const diff = sortWeightVisit(a.visit_label) - sortWeightVisit(b.visit_label);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ja');
  });
  if (state.sort === 'type') return arr.sort((a,b) => {
    const diff = typeLabel(a).localeCompare(typeLabel(b), 'ja');
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ja');
  });
  return arr.sort((a,b) => a.name.localeCompare(b.name, 'ja'));
}
function allItems() {
  const confirmed = distilleries.map(x => ({...x, isCandidate:false}));
  const underReview = state.candidateMode ? candidates.map(x => ({...x, isCandidate:true})) : [];
  return confirmed.concat(underReview);
}
function filteredItems() {
  const q = state.search.trim().toLowerCase();
  const items = allItems().filter(item => {
    if (state.visitableOnly && !item.visitable) return false;
    if (!matchesType(item)) return false;
    if (state.region !== 'all' && item.region !== state.region) return false;
    if (!q) return true;
    const hay = [item.name, item.location, item.region, typeLabel(item), item.note || '', item.source_label || '', ...((item.brands) || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
  return sortItems(items);
}
function renderList(items) {
  const list = document.getElementById('list');
  if (!items.length) {
    list.innerHTML = '<div class="empty">条件に合う蒸溜所が見つかりませんでした。</div>';
    return;
  }
  list.innerHTML = items.map(item => `
    <article class="card" data-name="${item.name}">
      <h3>${item.name}</h3>
      <div class="meta">
        <span class="badge">${typeLabel(item)}</span>
        <span class="badge">${item.region}</span>
        <span class="badge ${item.visitable ? 'visit-yes' : 'visit-no'}">${item.visit_label}</span>
        ${item.isCandidate ? '<span class="badge candidate-badge">未収載候補</span>' : ''}
      </div>
      <div class="location"><b>所在地：</b>${item.location}</div>
      <div class="brands"><b>代表銘柄：</b>${(item.brands || []).join(' / ')}</div>
      <div class="note"><b>特徴：</b>${item.note || ''}</div>
      <div class="source-note"><b>情報ソース：</b>${item.source_label || '未設定'}</div>
      <div class="updated-note"><b>最終確認日：</b>${item.last_checked || '未設定'}</div>
      ${item.isCandidate ? `<div class="updated-note"><b>監査メモ：</b>${item.review_note || '未設定'}</div><div class="updated-note"><b>次の対応：</b>${item.next_action || '未設定'}</div>` : ''}
      <div class="tour"><b>参照ページ：</b> <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.url}</a><br><b>地図：</b> <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location)}" target="_blank" rel="noopener noreferrer">Googleマップで開く</a></div>
    </article>
  `).join('');

  list.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => {
      const name = card.getAttribute('data-name');
      const item = items.find(x => x.name === name);
      const marker = markerMap.get(name);
      if (item && marker) {
        map.setView([item.lat, item.lng], Math.max(map.getZoom(), 9), {animate:true});
        marker.openPopup();
        if (window.innerWidth < 960) window.scrollTo({top:0, behavior:'smooth'});
      }
    });
  });
}
function renderSummary(items) {
  const whiskyCount = items.filter(x => x.type === 'whisky' || x.type === 'both').length;
  const ginCount = items.filter(x => x.type === 'gin' || x.type === 'both').length;
  const visitableCount = items.filter(x => x.visitable).length;
  const candidateCount = items.filter(x => x.isCandidate).length;
  document.getElementById('summary').textContent = `表示中 ${items.length} 件 / ウイスキー ${whiskyCount} 件 / クラフトジン ${ginCount} 件 / 見学対象あり ${visitableCount} 件 / 未収載候補 ${candidateCount} 件`;
}
function rerender() {
  const items = filteredItems();
  buildMarkers(items);
  renderList(items);
  renderSummary(items);
}
function bindUI() {
  document.getElementById('searchInput').addEventListener('input', e => { state.search = e.target.value; rerender(); });
  document.getElementById('visitableOnly').addEventListener('change', e => { state.visitableOnly = e.target.checked; rerender(); });
  document.getElementById('candidateMode').addEventListener('change', e => { state.candidateMode = e.target.checked; rerender(); });
  document.getElementById('sortSelect').addEventListener('change', e => { state.sort = e.target.value; rerender(); });
  document.getElementById('regionSelect').addEventListener('change', e => { state.region = e.target.value; rerender(); });
  document.querySelectorAll('#typeFilters .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#typeFilters .pill').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      state.type = btn.dataset.type;
      rerender();
    });
  });
  const headerCard = document.getElementById('headerCard');
  const headerToggle = document.getElementById('headerToggle');
  headerToggle.addEventListener('click', () => {
    const expanded = headerCard.classList.toggle('expanded');
    headerToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    headerToggle.textContent = expanded ? '補足を閉じる' : '補足を表示';
  });
}
Promise.all([
  fetch(DISTILLERIES_URL).then(r => { if (!r.ok) throw new Error(`distilleries.json: ${r.status}`); return r.json(); }),
  fetch(CANDIDATES_URL).then(r => { if (!r.ok) throw new Error(`candidates.json: ${r.status}`); return r.json(); })
]).then(([confirmed, underReview]) => {
  distilleries = confirmed;
  candidates = underReview;
  bindUI();
  rerender();
}).catch(err => {
  document.getElementById('list').innerHTML = `<div class="empty">データの読み込みに失敗しました。<br>${err.message}</div>`;
  console.error(err);
});