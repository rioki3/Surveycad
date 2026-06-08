// v59: CIRCLE center-side radius choice panel added
// v59.1.1: CIRCLE radius confirms on pointer release; circle radius grips and numeric radius input fixed
// v53: Grip hit/drag fixed; SELECT mode grip drag edits only the touched grip; active grip turns red
// v53: SELECT mode is grip-only editing; MOVE command is whole-object move; grip OSNAP excludes the dragged object
// v51: pen-only cursor mode, wider OSNAP/grip hit tolerance, updated icons
// v45: rectangle selection + PWA app shell + default layer 0 + current layer display
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const fileInput = document.getElementById('fileInput');
const notesLayer = document.getElementById('notesLayer');
const openFileBtn = document.getElementById('openFileBtn');
const openFileBtn2 = document.getElementById('openFileBtn2');
const fileName = document.getElementById('fileName');
const info = document.getElementById('info');
const layersDiv = document.getElementById('layers');
const layerCount = document.getElementById('layerCount');
const propsDiv = document.getElementById('props');
const newLayerName = document.getElementById('newLayerName');
const addLayerBtn = document.getElementById('addLayerBtn');
const currentLayerSelect = document.getElementById('currentLayerSelect');
const buttons = { pan: modePan, coord: modeCoord, dist: modeDist, select: modeSelect, line: modeLine, poly: modePoly, circle: modeCircle, text: modeText };
let currentDrawLayer = '0';
let currentFileBaseName = 'drawing.dxf';
let drawState = null;
let mode = 'pan';
let entities = [];
let segments = [];
let intersections = [];
let circleItems = []; // CIRCLE/ARC for snap and viewport culling
let layerVisible = new Map();
let layerLocked = new Map();
let view = { scale: 1, ox: 0, oy: 0 };
let last = null;
let pointers = new Map();
let measureStart = null;
let measureEnd = null;
let notes = [];
let noteSeq = 1;
let draggingNote = null;
let selectedIndex = -1;
let selectedIndices = []; // v45: 矩形選択用の複数選択
let rectSelectState = null; // v45: SELECTドラッグ矩形
let moveState = null; // MOVE: selected object + base point state
let copyState = null; // COPY: source object + base point state
let lineReleaseState = null; // v59.1: LINE 2点目は指/ペンを離した位置で確定
let polyReleaseState = null; // v59.1: PLINE 2点目以降は指/ペンを離した位置で確定
let circleReleaseState = null; // v59.1: CIRCLE 半径指定は指/ペンを離した位置で確定
let circleChoicePanel = null; // v59: 円中心指定後に半径入力/直接指定を選ぶ小パネル
let gripDrag = null; // selected object grip edit: endpoint / vertex / center / insertion point
let undoStack = [];
let redoStack = [];
const HISTORY_LIMIT = 10; // Undo/Redoは最大10操作分まで保持
let restoringHistory = false;
let gridEnabled = localStorage.getItem('surveyDxf.gridEnabled') === '1';

function ensureBaseLayer0(){
  if(!layerVisible.has('0')) layerVisible.set('0', true);
  if(!layerLocked.has('0')) layerLocked.set('0', false);
  if(!currentDrawLayer) currentDrawLayer = '0';
}

function resize(){
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(r.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(r.height * devicePixelRatio));
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  draw();
  renderNotes();
}
addEventListener('resize', resize);

function setMode(m){
  mode=m; Object.entries(buttons).forEach(([k,b])=>b.classList.toggle('active', k===m));
  measureStart=null; measureEnd=null;
  drawState=null;
  moveState=null;
  copyState=null;
  lineReleaseState=null;
  polyReleaseState=null;
  circleReleaseState=null;
  hideCircleChoicePanel();
  gripDrag=null;
  hideObjectMenu();
  // MOVE と SELECT は選択状態を維持する。
  // 他の作図/測定モードへ移る時だけ選択を解除する。
  if(m !== 'select' && m !== 'pan') clearSelection();
  updateProperties();
  updateDrawHint();
  draw();
}
modePan.onclick=()=>setMode('pan'); modeCoord.onclick=()=>setMode('coord'); modeDist.onclick=()=>setMode('dist'); modeSelect.onclick=()=>setMode('select');
modeLine.onclick=()=>setMode('line'); modePoly.onclick=()=>setMode('poly'); modeCircle.onclick=()=>setMode('circle'); modeText.onclick=()=>setMode('text');
finishDrawBtn.onclick=finishDrawing; cancelDrawBtn.onclick=cancelDrawing; saveBtn.onclick=saveDXF; saveAsBtn.onclick=saveDXFAs; fitBtn.onclick=fit; if(typeof undoBtn !== 'undefined') undoBtn.onclick=undoAction; if(typeof redoBtn !== 'undefined') redoBtn.onclick=redoAction;
if(typeof gridToggle !== 'undefined'){ gridToggle.classList.toggle('active', gridEnabled); gridToggle.onclick=()=>{ gridEnabled=!gridEnabled; localStorage.setItem('surveyDxf.gridEnabled', gridEnabled?'1':'0'); gridToggle.classList.toggle('active', gridEnabled); command(gridEnabled ? 'GRID：ドットグリッド ON' : 'GRID：ドットグリッド OFF'); draw(); }; }
openFileBtn.onclick=()=>fileInput.click(); openFileBtn2.onclick=()=>fileInput.click();
if(typeof alignPanelsBtn !== 'undefined') alignPanelsBtn.onclick = alignFloatingPanels;
[snapEnd, snapMid, snapIntersect, snapCircle, snapPoint, snapPerp, snapTangent, snapNear, snapText]
  .filter(Boolean)
  .forEach(cb => cb.addEventListener('change', ()=>{ syncSnapDock(); draw(); }));
initSnapDock();
initCircleChoicePanel();


// v39: SNAP is operated from the bottom dock. The old SNAP details panel is kept only
// as hidden checkbox storage, so existing snap logic can stay unchanged.
function initSnapDock(){
  const dock = document.getElementById('snapDock');
  if(!dock) return;
  dock.querySelectorAll('.snapToggle').forEach(btn=>{
    const id = btn.getAttribute('data-snap');
    const cb = document.getElementById(id);
    if(!cb) return;
    btn.onclick = ()=>{
      cb.checked = !cb.checked;
      syncSnapDock();
      command('SNAP：' + snapDockSummary());
      draw();
    };
  });
  syncSnapDock();
}
function syncSnapDock(){
  const dock = document.getElementById('snapDock');
  if(!dock) return;
  dock.querySelectorAll('.snapToggle').forEach(btn=>{
    const cb = document.getElementById(btn.getAttribute('data-snap'));
    btn.classList.toggle('on', !!(cb && cb.checked));
  });
}
function snapDockSummary(){
  const pairs = [
    ['snapEnd','端点'],['snapMid','中点'],['snapPoint','点'],['snapIntersect','交点'],
    ['snapCircle','中心'],['snapPerp','垂線'],['snapTangent','接線'],['snapNear','近接'],['snapText','文字']
  ];
  const on = pairs.filter(([id])=>{ const cb=document.getElementById(id); return cb && cb.checked; }).map(([,label])=>label);
  return on.length ? on.join(' / ') : '全OFF';
}


// v18: floating panels can be dragged and their positions are stored locally.
initCommandLine();
restorePanelAlignmentState();
initMovablePanels();

function initCommandLine(){
  const bar = document.querySelector('.commandLine');
  if(!bar || !info) return;
  // Move to body so it is never clipped by canvasWrap or browser viewport quirks.
  if(bar.parentElement !== document.body) document.body.appendChild(bar);
  command('MOVE：オブジェクトを選択。基準点→移動先を指定。画面移動はドラッグ。');
}

function initMovablePanels(){
  const panels = [
    {key:'layerPanelV23', el:document.querySelector('.layerPanel')},
    {key:'propPanelV23', el:document.querySelector('.propPanel')},
  ].filter(x=>x.el);

  for(const item of panels){
    const panel = item.el;
    const summary = panel.querySelector('summary') || panel;
    restorePanelPosition(item.key, panel);

    let handle = summary.querySelector('.panelDragHandle');
    if(!handle){
      handle = document.createElement('span');
      handle.className = 'panelDragHandle';
      handle.textContent = '⋮⋮';
      handle.title = 'ドラッグして移動 / 長押しで整列';
      handle.setAttribute('aria-label','パネル移動');
      summary.prepend(handle);
    }

    let start = null;
    let panelLongPressTimer = null;

    const cleanupDoc = ()=>{
      document.removeEventListener('pointermove', onDocMove, true);
      document.removeEventListener('pointerup', onDocEnd, true);
      document.removeEventListener('pointercancel', onDocEnd, true);
    };

    handle.addEventListener('click', ev=>{
      ev.preventDefault();
      ev.stopPropagation();
    });

    handle.addEventListener('pointerdown', ev=>{
      if(ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const rect = panel.getBoundingClientRect();
      start = {
        pointerId: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
        menu: false
      };
      // detailsのCSS配置やright指定を一度、現在位置の絶対座標に固定する。
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.classList.add('panelDragging');
      handle.classList.add('handleDragging');

      document.addEventListener('pointermove', onDocMove, true);
      document.addEventListener('pointerup', onDocEnd, true);
      document.addEventListener('pointercancel', onDocEnd, true);

      clearTimeout(panelLongPressTimer);
      panelLongPressTimer = setTimeout(()=>{
        if(!start || start.moved) return;
        start.menu = true;
        panel.classList.remove('panelDragging');
        handle.classList.remove('handleDragging');
        cleanupDoc();
        showPanelMenu(ev.clientX, ev.clientY);
      }, 650);
    }, {passive:false});

    function onDocMove(ev){
      if(!start || ev.pointerId !== start.pointerId || start.menu) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if(Math.hypot(dx,dy) > 3){
        clearTimeout(panelLongPressTimer);
        start.moved = true;
      }
      if(!start.moved) return;
      ev.preventDefault();
      ev.stopPropagation();
      document.body.classList.remove('panelsAligned');
      localStorage.setItem('surveyDxf.panelsAligned','0');
      const w = panel.offsetWidth || 160;
      const h = panel.offsetHeight || 40;
      const maxLeft = Math.max(0, innerWidth - w - 2);
      const maxTop = Math.max(0, innerHeight - h - 58);
      const left = Math.min(maxLeft, Math.max(0, start.left + dx));
      const top = Math.min(maxTop, Math.max(0, start.top + dy));
      panel.style.setProperty('left', left + 'px', 'important');
      panel.style.setProperty('top', top + 'px', 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('bottom', 'auto', 'important');
    }

    function onDocEnd(ev){
      if(!start || ev.pointerId !== start.pointerId) return;
      clearTimeout(panelLongPressTimer);
      ev.preventDefault();
      ev.stopPropagation();
      panel.classList.remove('panelDragging');
      handle.classList.remove('handleDragging');
      if(start.moved) savePanelPosition(item.key, panel);
      start = null;
      cleanupDoc();
    }
  }
}
function restorePanelPosition(key, panel){
  try{
    const raw = localStorage.getItem('surveyDxf.' + key + '.pos');
    if(!raw) return;
    const pos = JSON.parse(raw);
    if(!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return;
    panel.style.left = Math.max(4, Math.min(innerWidth-40, pos.left)) + 'px';
    panel.style.top = Math.max(4, Math.min(innerHeight-80, pos.top)) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }catch(_e){}
}
function savePanelPosition(key, panel){
  try{
    const r = panel.getBoundingClientRect();
    localStorage.setItem('surveyDxf.' + key + '.pos', JSON.stringify({left:r.left, top:r.top}));
  }catch(_e){}
}


// v40: LAYER / PROPERTIES の左端ハンドル長押しメニュー。
function showPanelMenu(clientX, clientY){
  showMenu(clientX, clientY, [
    {label:'整列', action:alignFloatingPanels},
    {label:'キャンセル', action:()=>{}}
  ]);
  command('PANEL：整列する場合は「整列」を選択してください。');
}

// v39: SNAP / LAYER / PROPERTIES を横一列に戻す整列ボタン。
// ドラッグ移動で保存された位置をクリアし、CSSの標準位置を適用する。
function alignFloatingPanels(){
  const panels = [
    {key:'layerPanelV23', el:document.querySelector('.layerPanel')},
    {key:'propPanelV23', el:document.querySelector('.propPanel')},
  ].filter(x=>x.el);
  for(const p of panels){
    localStorage.removeItem('surveyDxf.' + p.key);
    p.el.style.left = '';
    p.el.style.top = '';
    p.el.style.right = '';
    p.el.style.bottom = '';
  }
  document.body.classList.add('panelsAligned');
  localStorage.setItem('surveyDxf.panelsAligned', '1');
  command('PANEL：LAYER / PROPERTIES を上部に整列しました。SNAPは下部トグルで操作します。');
}

function restorePanelAlignmentState(){
  if(localStorage.getItem('surveyDxf.panelsAligned') === '1'){
    document.body.classList.add('panelsAligned');
  }
}


function serializeState(){
  return JSON.stringify({
    entities,
    layerVisible:[...layerVisible.entries()],
    layerLocked:[...layerLocked.entries()],
    currentDrawLayer
  });
}
function restoreState(json){
  try{
    const st = JSON.parse(json);
    entities = Array.isArray(st.entities) ? st.entities : [];
    layerVisible = new Map(Array.isArray(st.layerVisible) ? st.layerVisible : []);
    layerLocked = new Map(Array.isArray(st.layerLocked) ? st.layerLocked : []);
    currentDrawLayer = st.currentDrawLayer || currentDrawLayer || '0';
    clearSelection();
    rectSelectState = null;
    drawState = null;
    measureStart = null;
    measureEnd = null;
    refreshGeometry();
    renderLayers();
    updateProperties();
    draw();
  }catch(err){ console.error(err); command('UNDO/REDO復元エラー: ' + (err.message || err)); }
}
function resetHistory(){
  undoStack = [serializeState()];
  redoStack = [];
  updateUndoRedoButtons();
}
function commitHistory(){
  if(restoringHistory) return;
  const now = serializeState();
  if(undoStack.length && undoStack[undoStack.length-1] === now) return;
  undoStack.push(now);
  if(undoStack.length > HISTORY_LIMIT + 1) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}
function undoAction(){
  if(undoStack.length <= 1){ command('UNDO：これ以上戻せません。'); return; }
  const current = undoStack.pop();
  redoStack.push(current);
  if(redoStack.length > HISTORY_LIMIT) redoStack.shift();
  restoringHistory = true;
  restoreState(undoStack[undoStack.length-1]);
  restoringHistory = false;
  updateUndoRedoButtons();
  command('UNDO：1操作戻しました。');
}
function redoAction(){
  if(redoStack.length === 0){ command('REDO：やり直す操作がありません。'); return; }
  const next = redoStack.pop();
  undoStack.push(next);
  if(undoStack.length > HISTORY_LIMIT + 1) undoStack.shift();
  restoringHistory = true;
  restoreState(next);
  restoringHistory = false;
  updateUndoRedoButtons();
  command('REDO：1操作やり直しました。');
}
function updateUndoRedoButtons(){
  if(typeof undoBtn !== 'undefined' && undoBtn) undoBtn.disabled = undoStack.length <= 1;
  if(typeof redoBtn !== 'undefined' && redoBtn) redoBtn.disabled = redoStack.length === 0;
}
ensureBaseLayer0();
renderLayers();
updateCurrentLayerUI();
resetHistory();
command('新規図面：レイヤ 0 を作成しました。\n現在レイヤ：0');

fileInput.addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if(!file){ info.textContent='ファイルが選択されませんでした。もう一度DXFを選択してください。'; return; }
  await loadDXFFile(file); fileInput.value = '';
});

async function loadDXFFile(file){
  try{
    fileName.textContent = file.name; currentFileBaseName = file.name || 'drawing.dxf'; info.textContent = `読み込み中: ${file.name}`;
    const text = await file.text();
    entities = parseDXF(text);
    notes = []; noteSeq = 1; selectedIndex = -1; renderNotes(); updateProperties();
    segments = buildSegments(entities);
    circleItems = buildCircleItems(entities);
    intersections = buildIntersections(segments, 5000);
    const layers = [...new Set(['0', ...entities.map(x=>x.layer || '0')])].sort();
    layerVisible = new Map(layers.map(l=>[l,true]));
    layerLocked = new Map(layers.map(l=>[l,false]));
    if(!layerVisible.has(currentDrawLayer) || isLayerLocked(currentDrawLayer)) currentDrawLayer = '0';
    renderLayers(); fit();
    resetHistory();
    const counts = countTypes(entities);
    info.textContent = `${file.name}\n要素数: ${entities.length}\nLINE系: ${counts.line}\n円/円弧: ${counts.circle}\n線×線交点候補: ${intersections.length}\nレイヤ数: ${layers.length}`;
  }catch(err){ console.error(err); info.textContent = `読み込みエラー: ${err.message || err}`; }
}
function countTypes(es){return {line:es.filter(e=>e.type==='LINE'||e.type==='LWPOLYLINE').length, circle:es.filter(e=>e.type==='CIRCLE'||e.type==='ARC').length};}
function refreshGeometry(){
  segments = buildSegments(entities);
  circleItems = buildCircleItems(entities);
  intersections = buildIntersections(segments, 5000);
  ensureDrawLayer();
  updateProperties();
}
function ensureDrawLayer(){
  ensureBaseLayer0();
  for(const l of [...new Set(entities.map(x=>x.layer || '0'))].sort()){
    if(!layerVisible.has(l)) layerVisible.set(l, true);
    if(!layerLocked.has(l)) layerLocked.set(l, false);
  }
  if(!layerVisible.has(currentDrawLayer)) layerVisible.set(currentDrawLayer, true);
  if(!layerLocked.has(currentDrawLayer)) layerLocked.set(currentDrawLayer, false);
  renderLayers();
}
function addEntity(e){
  if(e && !e.layer) e.layer = currentDrawLayer;
  if(e && isLayerLocked(e.layer || currentDrawLayer)){ command(`作図不可：レイヤ「${e.layer || currentDrawLayer}」はロック中です。`); return; }
  entities.push(e);
  refreshGeometry();
  commitHistory();
  draw();
}

function updateCurrentLayerUI(){
  ensureBaseLayer0();
  if(!layerVisible.has(currentDrawLayer)) layerVisible.set(currentDrawLayer, true);
  if(currentLayerSelect){
    const layers = allLayers();
    currentLayerSelect.innerHTML = '';
    for(const l of layers){
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = isLayerLocked(l) ? `${l} 🔒` : l;
      opt.selected = (l === currentDrawLayer);
      opt.disabled = isLayerLocked(l);
      currentLayerSelect.appendChild(opt);
    }
    currentLayerSelect.value = currentDrawLayer;
    currentLayerSelect.title = `現在の編集レイヤー: ${currentDrawLayer}`;
  }
}

function setCurrentDrawLayer(layer, silent=false){
  const name = String(layer || '').trim() || '0';
  if(!layerVisible.has(name)) layerVisible.set(name, true);
  if(!layerLocked.has(name)) layerLocked.set(name, false);
  if(isLayerLocked(name)){
    command(`現在レイヤ変更不可：${name} はロック中です。`);
    updateCurrentLayerUI();
    renderLayers();
    return;
  }
  currentDrawLayer = name;
  updateCurrentLayerUI();
  renderLayers();
  if(!silent) command(`現在レイヤ：${currentDrawLayer}`);
}

function renderLayers(){
  ensureBaseLayer0();
  layersDiv.innerHTML='';
  if(!layerVisible.has(currentDrawLayer)) layerVisible.set(currentDrawLayer, true);
  if(!layerLocked.has(currentDrawLayer)) layerLocked.set(currentDrawLayer, false);
  if(layerCount) layerCount.textContent = String(layerVisible.size);
  for(const l of allLayers()){
    if(!layerLocked.has(l)) layerLocked.set(l, false);
    const row=document.createElement('div');
    row.className='layerItem' + (l===currentDrawLayer ? ' currentDrawLayerItem' : '') + (isLayerLocked(l) ? ' lockedLayerItem' : '');

    const visBtn=document.createElement('button');
    visBtn.type='button';
    visBtn.className='layerIconBtn layerVisBtn';
    visBtn.textContent = isLayerVisible(l) ? '👁' : '🚫';
    visBtn.title = isLayerVisible(l) ? '表示中。押すと非表示' : '非表示。押すと表示';
    visBtn.onclick=()=>{
      layerVisible.set(l, !isLayerVisible(l));
      commitHistory();
      renderLayers();
      draw();
      command(`${l}：${isLayerVisible(l) ? '表示' : '非表示'}`);
    };

    const lockBtn=document.createElement('button');
    lockBtn.type='button';
    lockBtn.className='layerIconBtn layerLockBtn';
    lockBtn.textContent = isLayerLocked(l) ? '🔒' : '🔓';
    lockBtn.title = isLayerLocked(l) ? 'ロック中。押すとアンロック' : '編集可。押すとロック';
    lockBtn.onclick=()=>{
      const next = !isLayerLocked(l);
      layerLocked.set(l, next);
      if(next && currentDrawLayer === l){
        const fallback = allLayers().find(x => x !== l && !isLayerLocked(x));
        if(fallback) currentDrawLayer = fallback;
      }
      commitHistory();
      renderLayers();
      updateProperties();
      draw();
      command(`${l}：${next ? 'ロック' : 'アンロック'}`);
    };

    const current=document.createElement('input');
    current.type='radio';
    current.name='currentDrawLayer';
    current.checked = (l===currentDrawLayer);
    current.disabled = isLayerLocked(l);
    current.title = isLayerLocked(l) ? 'ロック中のため作図レイヤにできません' : 'このレイヤーに作図';
    current.onchange=()=>{ if(current.checked) setCurrentDrawLayer(l); };

    const name=document.createElement('span');
    name.className='layerName';
    name.textContent=l;
    name.title=l;

    const mark=document.createElement('span');
    mark.className='currentLayerMark';
    mark.textContent = (l===currentDrawLayer) ? '作図中' : (isLayerLocked(l) ? 'LOCK' : '');

    row.append(visBtn, lockBtn, current, name, mark);
    layersDiv.append(row);
  }
  updateCurrentLayerUI();
}

function addLayer(name){
  const layer = String(name || '').trim();
  if(!layer){ command('レイヤ追加：名前を入力してください。'); return; }
  if(!layerVisible.has(layer)) layerVisible.set(layer, true);
  if(!layerLocked.has(layer)) layerLocked.set(layer, false);
  currentDrawLayer = layer;
  renderLayers();
  updateProperties();
  commitHistory();
  command(`レイヤを追加/選択しました：${layer}`);
}
function allLayers(){ return [...layerVisible.keys()].sort((a,b)=>a.localeCompare(b,'ja')); }
if(addLayerBtn){ addLayerBtn.addEventListener('click', ()=>{ addLayer(newLayerName.value); newLayerName.value=''; }); }
if(newLayerName){ newLayerName.addEventListener('keydown', e=>{ if(e.key==='Enter'){ addLayer(newLayerName.value); newLayerName.value=''; }}); }
if(currentLayerSelect){ currentLayerSelect.addEventListener('change', ()=>setCurrentDrawLayer(currentLayerSelect.value)); }

function setSelection(indices){
  const uniq=[];
  for(const i of indices || []){
    if(Number.isInteger(i) && i>=0 && i<entities.length && !uniq.includes(i)) uniq.push(i);
  }
  selectedIndices = uniq;
  selectedIndex = (uniq.length === 1) ? uniq[0] : -1;
}
function clearSelection(){
  selectedIndex = -1;
  selectedIndices = [];
}
function getSelectedIndices(){
  if(selectedIndices && selectedIndices.length) return selectedIndices.filter(i=>entities[i]);
  return (selectedIndex>=0 && entities[selectedIndex]) ? [selectedIndex] : [];
}
function ensureEditableSelection(action='編集'){
  const selected = getSelectedIndices();
  for(const i of selected){
    if(isEntityLocked(entities[i])){
      command(`${action}不可：選択内にロック中レイヤ「${entities[i].layer || '0'}」があります。`);
      return false;
    }
  }
  return true;
}

function updateProperties(){
  if(!propsDiv) return;
  const selected = getSelectedIndices();
  if(selected.length > 1){
    propsDiv.innerHTML = '';
    addProp('選択数', String(selected.length));
    const counts = {};
    for(const idx of selected){ const t = entities[idx]?.type || 'UNKNOWN'; counts[t] = (counts[t]||0)+1; }
    addProp('種類', Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(' / '));
    addProp('操作', '移動コマンドでまとめて移動できます。長押しメニューからまとめて削除できます。');
    return;
  }
  if(selectedIndex < 0 || !entities[selectedIndex]){ propsDiv.textContent = '未選択'; return; }
  const e = entities[selectedIndex];
  propsDiv.innerHTML = '';
  const layerSelect = document.createElement('select');
  for(const l of allLayers()){
    const opt = document.createElement('option'); opt.value=l; opt.textContent=l; opt.selected=(l===(e.layer||'0')); layerSelect.appendChild(opt);
  }
  layerSelect.onchange = () => { if(!ensureEditableEntity(e, 'レイヤ変更')){ updateProperties(); return; } if(isLayerLocked(layerSelect.value)){ command(`移動先レイヤ「${layerSelect.value}」はロック中です。`); updateProperties(); return; } e.layer = layerSelect.value; refreshGeometry(); commitHistory(); command(`選択オブジェクトのレイヤを変更：${e.layer}`); draw(); updateProperties(); };
  addPropNode('レイヤ', layerSelect);
  addProp('種類', e.type);
  if(e.type==='LINE'){
    const a=e.pts[0], b=e.pts[1];
    addProp('開始点', fmtPt(a)); addProp('終点', fmtPt(b)); addProp('長さ', distPt(a,b).toFixed(3));
  } else if(e.type==='LWPOLYLINE'){
    addProp('点数', String(e.pts.length));
    addProp('全長', polyLength(e).toFixed(3));
    const closedChk=document.createElement('input');
    closedChk.type='checkbox';
    closedChk.checked=!!e.closed;
    closedChk.onchange=()=>{ if(!ensureEditableEntity(e, '閉合変更')){ updateProperties(); return; } e.closed=closedChk.checked; refreshGeometry(); commitHistory(); draw(); updateProperties(); };
    addPropNode('閉合', closedChk);
    if(e.closed) addProp('面積', polyArea(e).toFixed(3)+'㎡');
    addPolylineCoordTools(e);
  } else if(e.type==='CIRCLE' || e.type==='ARC'){
    addProp('中心', fmtPt(e.center)); addProp('半径', e.r.toFixed(3)); addProp('直径', (e.r*2).toFixed(3));
    if(e.type==='ARC'){ addProp('開始角', e.a1.toFixed(3)); addProp('終了角', e.a2.toFixed(3)); }
  } else if(e.type==='POINT'){
    addProp('座標', fmtPt(e.pts[0]));
  } else if(e.type==='TEXT'){
    addProp('挿入基点', fmtPt(e.pts[0])); addProp('文字', e.text || ''); addProp('高さ', String(e.height || 2.5));
  }
}
function addProp(k,v){ const row=document.createElement('div'); row.className='propRow'; const kk=document.createElement('div'); kk.className='propKey'; kk.textContent=k; const vv=document.createElement('div'); vv.className='propVal'; vv.textContent=v; row.append(kk,vv); propsDiv.appendChild(row); }
function addPropNode(k,node){ const row=document.createElement('div'); row.className='propRow'; const kk=document.createElement('div'); kk.className='propKey'; kk.textContent=k; const vv=document.createElement('div'); vv.className='propVal'; vv.appendChild(node); row.append(kk,vv); propsDiv.appendChild(row); }

function addPolylineCoordTools(e){
  const wrap=document.createElement('div');
  wrap.className='polyCoordTools';
  const listBtn=document.createElement('button');
  listBtn.type='button';
  listBtn.textContent='座標一覧';
  const simaBtn=document.createElement('button');
  simaBtn.type='button';
  simaBtn.textContent='SIMA出力';
  listBtn.onclick=()=>showPolylineCoordList(e);
  simaBtn.onclick=()=>exportSelectedPolylineSIMA();
  wrap.append(listBtn,simaBtn);
  addPropNode('構成点', wrap);
}

function showPolylineCoordList(e){
  if(!propsDiv || !e || e.type!=='LWPOLYLINE') return;
  const old=propsDiv.querySelector('.polyCoordList');
  if(old){ old.remove(); return; }
  const box=document.createElement('div');
  box.className='polyCoordList';
  const title=document.createElement('div');
  title.className='polyCoordTitle';
  title.textContent=`構成点座標一覧（${e.pts.length}点 / ${e.closed?'閉合':'開放'}）`;
  const table=document.createElement('table');
  table.innerHTML='<thead><tr><th>No</th><th>点名</th><th>X</th><th>Y</th></tr></thead>';
  const tb=document.createElement('tbody');
  e.pts.forEach((p,i)=>{
    const tr=document.createElement('tr');
    const name=polyPointName(i);
    tr.innerHTML=`<td>${i+1}</td><td>${escapeHtml(name)}</td><td>${surveyX(p).toFixed(3)}</td><td>${surveyY(p).toFixed(3)}</td>`;
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  box.append(title,table);
  propsDiv.appendChild(box);
  command(`PLINE\n構成点座標一覧を表示しました。\nSIMA出力はPROPERTIES内の「SIMA出力」を押してください。`);
}

function polyPointName(i){
  return 'P' + String(i+1).padStart(3,'0');
}

function escapeHtml(v){
  return String(v).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function exportSelectedPolylineSIMA(){
  if(selectedIndex < 0 || !entities[selectedIndex] || entities[selectedIndex].type!=='LWPOLYLINE'){
    command('SIMA出力\nポリラインを選択してください。');
    return;
  }
  const e=entities[selectedIndex];
  if(!e.pts || e.pts.length===0){ command('SIMA出力\n構成点がありません。'); return; }
  const base=(currentFileBaseName || 'polyline').replace(/\.dxf$/i,'');
  const filename=`${base}_polyline_${selectedIndex+1}.sim`;
  const text=exportPolylineSIMA(e, `POLYLINE_${selectedIndex+1}`);
  downloadTextFile(filename, text, 'text/plain;charset=utf-8');
  command(`SIMA出力\n${filename} を保存しました。\n出力点数：${e.pts.length}点\n形式：旧SIMA カンマ区切り座標データ Z00/A00/A01/A99（ASCIIヘッダ）`);
}

function exportPolylineSIMA(e, title){
  const lines=[];
  const add=(...xs)=>lines.push(xs.join(','));
  add('G00','00',title,'');
  // SIMAをShift_JIS前提のソフトで読むとUTF-8日本語が文字化けするため、出力データ部はASCIIだけにする。
  add('Z00','COORDINATE_DATA','');
  add('Z01','2','');
  add('A00','');
  e.pts.forEach((p,i)=>{
    // 測量座標として X=CAD-Y, Y=CAD-X で出力する。
    add('A01', String(i+1), polyPointName(i), surveyX(p).toFixed(3), surveyY(p).toFixed(3), '0.000', '');
  });
  add('A99','');
  return lines.join('\r\n') + '\r\n';
}
// 測量座標表示：CAD内部座標は x/y のまま保持し、表示だけ X=CAD-Y / Y=CAD-X に入れ替える。
function surveyX(p){ return p && Number.isFinite(p.y) ? p.y : 0; }
function surveyY(p){ return p && Number.isFinite(p.x) ? p.x : 0; }
function fmtPt(p){ return `X=${surveyX(p).toFixed(3)}, Y=${surveyY(p).toFixed(3)}`; }
function fmtPtLines(p){ return `X = ${surveyX(p).toFixed(3)}\nY = ${surveyY(p).toFixed(3)}`; }
function fmtPtInline(p){ return `X=${surveyX(p).toFixed(3)} Y=${surveyY(p).toFixed(3)}`; }
function distPt(a,b){ return Math.hypot(b.x-a.x,b.y-a.y); }

function polyArea(e){
  if(!e.closed || !e.pts || e.pts.length < 3) return 0;
  let a=0;
  for(let i=0;i<e.pts.length;i++){
    const p1=e.pts[i], p2=e.pts[(i+1)%e.pts.length];
    a += p1.x*p2.y - p2.x*p1.y;
  }
  return Math.abs(a)/2;
}

function polyLength(e){ let d=0; for(let i=0;i<e.pts.length-1;i++) d+=distPt(e.pts[i],e.pts[i+1]); if(e.closed && e.pts.length>1) d+=distPt(e.pts[e.pts.length-1],e.pts[0]); return d; }

function parsePairs(text){
  const lines = text.replace(/\r/g,'').split('\n'); const pairs=[];
  for(let i=0;i<lines.length-1;i+=2) pairs.push({code:lines[i].trim(), val:lines[i+1].trim()});
  return pairs;
}
function parseDXF(text){
  const p=parsePairs(text), out=[]; let inEnt=false;
  for(let i=0;i<p.length;i++){
    if(p[i].code==='0' && p[i].val==='SECTION' && p[i+1]?.code==='2' && p[i+1]?.val==='ENTITIES') { inEnt=true; i++; continue; }
    if(inEnt && p[i].code==='0' && p[i].val==='ENDSEC') break;
    if(!inEnt || p[i].code!=='0') continue;
    const type=p[i].val; const rec=[]; i++;
    while(i<p.length && p[i].code!=='0'){ rec.push(p[i]); i++; } i--;
    const layer = rec.find(x=>x.code==='8')?.val || '0';
    if(type==='LINE'){
      const x1=num(rec,'10'), y1=num(rec,'20'), x2=num(rec,'11'), y2=num(rec,'21');
      if(valid(x1,y1,x2,y2)) out.push({type, layer, pts:[{x:x1,y:y1},{x:x2,y:y2}]});
    } else if(type==='LWPOLYLINE'){
      const pts=[]; let x=null;
      for(const a of rec){ if(a.code==='10') x=parseFloat(a.val); if(a.code==='20' && x!==null){ pts.push({x,y:parseFloat(a.val)}); x=null; } }
      if(pts.length>1) out.push({type, layer, pts, closed: (num(rec,'70') & 1)===1});
    } else if(type==='POINT'){
      const x=num(rec,'10'), y=num(rec,'20'); if(valid(x,y)) out.push({type, layer, pts:[{x,y}]});
    } else if(type==='CIRCLE'){
      const x=num(rec,'10'), y=num(rec,'20'), r=num(rec,'40'); if(valid(x,y,r)) out.push({type, layer, center:{x,y}, r, pts:[{x,y}]});
    } else if(type==='ARC'){
      const x=num(rec,'10'), y=num(rec,'20'), r=num(rec,'40'), a1=num(rec,'50'), a2=num(rec,'51'); if(valid(x,y,r,a1,a2)) out.push({type, layer, center:{x,y}, r, a1, a2, pts:[{x,y}]});
    } else if(type==='TEXT' || type==='MTEXT'){
      const x=num(rec,'10'), y=num(rec,'20'); const textVal=rec.find(a=>a.code==='1')?.val || '';
      const h=num(rec,'40'); if(valid(x,y)) out.push({type:'TEXT', layer, pts:[{x,y}], text:textVal, height:Number.isFinite(h)?h:2.5});
    }
  }
  return out;
}
function num(rec, code){ const v=rec.find(x=>x.code===code)?.val; return v==null ? NaN : parseFloat(v); }
function valid(...xs){ return xs.every(Number.isFinite); }

function buildSegments(es){
  const seg=[];
  for(const e of es){
    if(e.type==='LINE') seg.push({a:e.pts[0], b:e.pts[1], layer:e.layer});
    if(e.type==='LWPOLYLINE'){
      for(let i=0;i<e.pts.length-1;i++) seg.push({a:e.pts[i], b:e.pts[i+1], layer:e.layer});
      if(e.closed) seg.push({a:e.pts[e.pts.length-1], b:e.pts[0], layer:e.layer});
    }
  }
  return seg;
}
function buildCircleItems(es){
  return es.filter(e => e.type==='CIRCLE' || e.type==='ARC').map(e => ({...e, bbox: circleBBox(e)}));
}
function entityBBox(e){
  if(e.type==='CIRCLE'||e.type==='ARC') return circleBBox(e);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of (e.pts||[])){ minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }
  if(!Number.isFinite(minX)) return {minX:0,minY:0,maxX:0,maxY:0};
  return {minX,minY,maxX,maxY};
}
function circleBBox(e){ return {minX:e.center.x-e.r, minY:e.center.y-e.r, maxX:e.center.x+e.r, maxY:e.center.y+e.r}; }
function bboxIntersects(a,b,pad=0){ return !(a.maxX < b.minX-pad || a.minX > b.maxX+pad || a.maxY < b.minY-pad || a.minY > b.maxY+pad); }
function visibleWorldRect(padPx=30){
  const r=canvas.getBoundingClientRect();
  const p1=screenToWorld(-padPx, r.height+padPx);
  const p2=screenToWorld(r.width+padPx, -padPx);
  return {minX:Math.min(p1.x,p2.x), minY:Math.min(p1.y,p2.y), maxX:Math.max(p1.x,p2.x), maxY:Math.max(p1.y,p2.y)};
}
function isLayerVisible(layer){ return layerVisible.get(layer) !== false; }
function isLayerLocked(layer){ return layerLocked.get(layer) === true; }
function isEntityLocked(e){ return !!(e && isLayerLocked(e.layer || '0')); }
function ensureEditableEntity(e, action='編集'){
  if(isEntityLocked(e)){ command(`${action}不可：レイヤ「${e.layer || '0'}」はロック中です。`); return false; }
  return true;
}
function ensureCurrentLayerEditable(action='作図'){
  if(isLayerLocked(currentDrawLayer)){ command(`${action}不可：現在レイヤ「${currentDrawLayer}」はロック中です。アンロックするか現在レイヤを変更してください。`); return false; }
  return true;
}
function buildIntersections(seg, maxSeg){
  if(seg.length > maxSeg) return [];
  const out=[];
  for(let i=0;i<seg.length;i++) for(let j=i+1;j<seg.length;j++){
    const p=lineIntersection(seg[i].a,seg[i].b,seg[j].a,seg[j].b);
    if(p) out.push({...p, layers:[seg[i].layer,seg[j].layer]});
  }
  return out;
}
function lineIntersection(a,b,c,d){
  const r={x:b.x-a.x,y:b.y-a.y}, s={x:d.x-c.x,y:d.y-c.y};
  const den=cross(r,s); if(Math.abs(den)<1e-12) return null;
  const q={x:c.x-a.x,y:c.y-a.y}; const t=cross(q,s)/den, u=cross(q,r)/den;
  if(t<-1e-9||t>1+1e-9||u<-1e-9||u>1+1e-9) return null;
  return {x:a.x+t*r.x, y:a.y+t*r.y};
}
function cross(a,b){ return a.x*b.y-a.y*b.x; }

function bounds(){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const e of entities){
    if(e.type==='CIRCLE'||e.type==='ARC') { minX=Math.min(minX,e.center.x-e.r); minY=Math.min(minY,e.center.y-e.r); maxX=Math.max(maxX,e.center.x+e.r); maxY=Math.max(maxY,e.center.y+e.r); }
    else for(const p of e.pts){ minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }
  }
  return {minX,minY,maxX,maxY};
}
function fit(){
  const b=bounds(); const r=canvas.getBoundingClientRect(); if(!Number.isFinite(b.minX)) return draw();
  const w=b.maxX-b.minX || 1, h=b.maxY-b.minY || 1;
  view.scale = Math.min(r.width/(w*1.1), r.height/(h*1.1));
  view.ox = r.width/2 - ((b.minX+b.maxX)/2)*view.scale;
  view.oy = r.height/2 + ((b.minY+b.maxY)/2)*view.scale;
  draw();
}
function worldToScreen(p){ return {x:p.x*view.scale+view.ox, y:-p.y*view.scale+view.oy}; }
function screenToWorld(x,y){ return {x:(x-view.ox)/view.scale, y:-(y-view.oy)/view.scale}; }

function draw(renderNoteLayer=true){
  if(circleChoicePanel && !circleChoicePanel.classList.contains('hidden') && drawState && drawState.type==='CIRCLE' && drawState.center) updateCircleChoicePanelPosition(drawState.center);
  const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height);
  if(gridEnabled) drawDotGrid(r);
  const vw = visibleWorldRect(80);
  ctx.lineWidth=1; ctx.strokeStyle='#d1d5db'; ctx.fillStyle='#e5e7eb'; ctx.font='12px sans-serif';
  for(const e of entities){
    if(!isLayerVisible(e.layer)) continue;
    if(!bboxIntersects(entityBBox(e), vw)) continue;
    if(e.type==='LINE' || e.type==='LWPOLYLINE'){
      ctx.beginPath(); e.pts.forEach((p,i)=>{ const s=worldToScreen(p); i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y); }); if(e.closed) ctx.closePath(); ctx.stroke();
    } else if(e.type==='CIRCLE'){
      const s=worldToScreen(e.center); ctx.beginPath(); ctx.arc(s.x,s.y,Math.abs(e.r*view.scale),0,Math.PI*2); ctx.stroke();
    } else if(e.type==='ARC'){
      const s=worldToScreen(e.center); ctx.beginPath(); ctx.arc(s.x,s.y,Math.abs(e.r*view.scale),degToRad(-e.a1),degToRad(-e.a2), e.a2<e.a1); ctx.stroke();
    } else if(e.type==='POINT'){
      const s=worldToScreen(e.pts[0]); ctx.beginPath(); ctx.arc(s.x,s.y,3,0,Math.PI*2); ctx.fill();
    } else if(e.type==='TEXT'){
      const s=worldToScreen(e.pts[0]); ctx.fillText(e.text, s.x, s.y);
    }
  }
  drawSelectedEntity();
  drawSelectionRectangle();
  if(moveState && moveState.base){ ctx.save(); ctx.strokeStyle='#60a5fa'; ctx.fillStyle='#60a5fa'; ctx.lineWidth=1.2; drawCross(moveState.base); ctx.restore(); }
  if(copyState && copyState.base){ ctx.save(); ctx.strokeStyle='#34d399'; ctx.fillStyle='#34d399'; ctx.lineWidth=1.2; drawCross(copyState.base); ctx.restore(); }
  if(measureStart){ drawCross(measureStart); }
  if(measureEnd){ drawCross(measureEnd); const a=worldToScreen(measureStart), b=worldToScreen(measureEnd); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
  drawDrawingPreview();
  drawSnapMarker();
  drawFingerCursor();
  drawNotes();
  if(renderNoteLayer) renderNotes();
}

function drawDotGrid(r){
  const step = chooseGridStep();
  if(!Number.isFinite(step) || step <= 0) return;
  const vw = visibleWorldRect(0);
  const startX = Math.ceil(vw.minX / step) * step;
  const endX = Math.floor(vw.maxX / step) * step;
  const startY = Math.ceil(vw.minY / step) * step;
  const endY = Math.floor(vw.maxY / step) * step;
  const screenStep = step * Math.abs(view.scale);
  if(screenStep < 18) return;
  const maxDots = 12000;
  const nx = Math.max(0, Math.floor((endX - startX) / step) + 1);
  const ny = Math.max(0, Math.floor((endY - startY) / step) + 1);
  if(nx * ny > maxDots) return;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  const dot = screenStep >= 80 ? 2.0 : 2.0;
  for(let x = startX; x <= endX + step * 0.001; x += step){
    for(let y = startY; y <= endY + step * 0.001; y += step){
      const s = worldToScreen({x,y});
      if(s.x < -2 || s.y < -2 || s.x > r.width + 2 || s.y > r.height + 2) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function chooseGridStep(){
  const targetPx = 48;
  const targetWorld = targetPx / Math.max(Math.abs(view.scale), 0.000001);
  const pow = Math.pow(10, Math.floor(Math.log10(targetWorld)));
  const candidates = [1, 2, 5, 10].map(v => v * pow);
  for(const c of candidates){
    if(c * Math.abs(view.scale) >= 34) return c;
  }
  return candidates[candidates.length - 1];
}

function degToRad(d){return d*Math.PI/180;}
function drawCross(p){ const s=worldToScreen(p); ctx.beginPath(); ctx.moveTo(s.x-7,s.y); ctx.lineTo(s.x+7,s.y); ctx.moveTo(s.x,s.y-7); ctx.lineTo(s.x,s.y+7); ctx.stroke(); }
function snapMarkerKind(type){
  const t=String(type||'');
  if(t.includes('端点')) return 'endpoint';
  if(t.includes('中点')) return 'midpoint';
  if(t.includes('中心')) return 'center';
  if(t.includes('交点')) return 'intersection';
  if(t.includes('垂線')) return 'perpendicular';
  if(t.includes('接線')) return 'tangent';
  if(t.includes('近接')) return 'nearest';
  if(t.includes('文字')) return 'text';
  if(t==='点') return 'point';
  return 'default';
}
function updateSnapMarkerAtCanvas(sx, sy){
  const raw=screenToWorld(sx, sy);
  const q=nearestSnap(raw, SNAP_TOLERANCE_PX/view.scale);
  currentSnapMarker = q ? {x:q.x, y:q.y, snapType:q.snapType, kind:snapMarkerKind(q.snapType)} : null;
}
function snappedPointAtCanvas(sx, sy){
  const raw = screenToWorld(sx, sy);
  const q = nearestSnap(raw, SNAP_TOLERANCE_PX/view.scale);
  if(q){
    currentSnapMarker = {x:q.x, y:q.y, snapType:q.snapType, kind:snapMarkerKind(q.snapType)};
    return q;
  }
  currentSnapMarker = null;
  return {...raw, snapType:'なし'};
}
function snappedPointFromEvent(ev){
  const c = cursorCanvasFromClient(ev.clientX, ev.clientY);
  currentCursorScreen = c;
  return snappedPointAtCanvas(c.x, c.y);
}
function clearSnapMarker(){ currentSnapMarker = null; }
function drawSnapMarker(){
  if(!currentSnapMarker) return;
  const ss=worldToScreen(currentSnapMarker);
  const x=ss.x, y=ss.y;
  const size=13;
  ctx.save();
  ctx.strokeStyle='#00e5ff';
  ctx.fillStyle='#00e5ff';
  ctx.lineWidth=1.8;
  ctx.setLineDash([]);
  ctx.shadowColor='rgba(0,229,255,0.55)';
  ctx.shadowBlur=5;
  const k=currentSnapMarker.kind;
  if(k==='endpoint') {
    ctx.strokeRect(x-size/2, y-size/2, size, size);
  } else if(k==='midpoint') {
    ctx.beginPath();
    ctx.moveTo(x, y-size*0.58);
    ctx.lineTo(x-size*0.58, y+size*0.45);
    ctx.lineTo(x+size*0.58, y+size*0.45);
    ctx.closePath();
    ctx.stroke();
  } else if(k==='center') {
    ctx.beginPath(); ctx.arc(x,y,size*0.52,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-size*0.35,y); ctx.lineTo(x+size*0.35,y); ctx.moveTo(x,y-size*0.35); ctx.lineTo(x,y+size*0.35); ctx.stroke();
  } else if(k==='intersection') {
    ctx.beginPath();
    ctx.moveTo(x-size*0.55,y-size*0.55); ctx.lineTo(x+size*0.55,y+size*0.55);
    ctx.moveTo(x+size*0.55,y-size*0.55); ctx.lineTo(x-size*0.55,y+size*0.55);
    ctx.stroke();
  } else if(k==='perpendicular') {
    ctx.beginPath();
    ctx.moveTo(x-size*0.45,y-size*0.45);
    ctx.lineTo(x-size*0.45,y+size*0.45);
    ctx.lineTo(x+size*0.45,y+size*0.45);
    ctx.moveTo(x-size*0.15,y+size*0.45);
    ctx.lineTo(x-size*0.15,y+size*0.15);
    ctx.lineTo(x-size*0.45,y+size*0.15);
    ctx.stroke();
  } else if(k==='tangent') {
    ctx.beginPath(); ctx.arc(x-size*0.12,y,size*0.42,-Math.PI*0.8,Math.PI*0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-size*0.05,y-size*0.48); ctx.lineTo(x+size*0.55,y-size*0.48); ctx.stroke();
  } else if(k==='nearest') {
    ctx.beginPath();
    ctx.moveTo(x, y-size*0.62); ctx.lineTo(x+size*0.62, y); ctx.lineTo(x, y+size*0.62); ctx.lineTo(x-size*0.62,y); ctx.closePath();
    ctx.stroke();
  } else if(k==='text') {
    ctx.font='bold 15px system-ui, sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('A', x, y+0.5);
  } else if(k==='point') {
    ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,size*0.45,0,Math.PI*2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x,y,size*0.45,0,Math.PI*2); ctx.stroke();
  }
  ctx.shadowBlur=0;
  ctx.font='11px system-ui, sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillStyle='#a5f3fc';
  ctx.fillText(currentSnapMarker.snapType || '', x+10, y-12);
  ctx.restore();
}


function drawFingerCursor(){
  // v51: ペン/タップ位置へ常時クロスヘアを表示する。
  if(!currentCursorScreen) return;
  const x=currentCursorScreen.x, y=currentCursorScreen.y;
  ctx.save();
  ctx.strokeStyle='#22d3ee';
  ctx.fillStyle='#22d3ee';
  ctx.lineWidth=1.15;
  ctx.setLineDash([]);
  ctx.shadowColor='rgba(34,211,238,.42)';
  ctx.shadowBlur=4;

  // AutoCAD風クロスヘア。中心を少し空けて、OSNAPマーカーと重なりすぎないようにする。
  ctx.beginPath();
  ctx.moveTo(x-26,y); ctx.lineTo(x-5,y);
  ctx.moveTo(x+5,y); ctx.lineTo(x+26,y);
  ctx.moveTo(x,y-26); ctx.lineTo(x,y-5);
  ctx.moveTo(x,y+5); ctx.lineTo(x,y+26);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x,y,3.2,0,Math.PI*2);
  ctx.stroke();

  ctx.restore();
}


function drawUcsIcon(){ /* v24.2: UCS is HTML overlay only. */ }
function drawAxisArrow(x1,y1,x2,y2){
  ctx.beginPath();
  ctx.moveTo(x1,y1);
  ctx.lineTo(x2,y2);
  ctx.stroke();
  const ang = Math.atan2(y2-y1, x2-x1);
  const ah = 6;
  ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2 - ah*Math.cos(ang-Math.PI/6), y2 - ah*Math.sin(ang-Math.PI/6));
  ctx.lineTo(x2 - ah*Math.cos(ang+Math.PI/6), y2 - ah*Math.sin(ang+Math.PI/6));
  ctx.closePath();
  ctx.fill();
}


// Googleマップ風操作
// 1本指: そのままドラッグで図面移動。短いタップだけ座標/距離入力。
// 2本指: ピンチで拡大縮小しながら、2本指中心の移動量で図面移動。
let activePointers = new Map();
let dragStart = null;
let lastCentroid = null;
let lastPinchDist = null;
let suppressTap = false;
const TAP_TOLERANCE_PX = 8;
// v50: スマホ操作では指ブレがあるため、OSNAP検出範囲を少し広めにする。
const SNAP_TOLERANCE_PX = 42;
const GRIP_LONGPRESS_MOVE_TOLERANCE_PX = 22;
const GRIP_HIT_TOLERANCE_PX = 46; // v53: スマホでも端点グリップを掴みやすくする
const GRIP_VISIBLE_SIZE_PX = 9;
let pendingGripPress = null;
let currentSnapMarker = null; // v47: AutoCAD-like OSNAP marker near cursor
// v47: Finger/Pen input mode. Finger mode uses an offset cursor so the target is not hidden by the finger.
// v51: 指モードは一旦廃止。ペン/タップ位置をそのまま有効カーソル位置にする。
// これにより、選択グリップの位置判定が指モードのオフセットでズレる不具合を解消する。
try { localStorage.removeItem('surveyDxf.inputMode'); } catch(_e) {}
let currentCursorScreen = null;

function cursorClientFromEvent(ev){
  return {clientX: ev.clientX, clientY: ev.clientY};
}
function cursorCanvasFromClient(clientX, clientY){
  const r=canvas.getBoundingClientRect();
  return {x: clientX - r.left, y: clientY - r.top};
}
function updateCursorFromEvent(ev){
  const r=canvas.getBoundingClientRect();
  const c=cursorCanvasFromClient(ev.clientX, ev.clientY);
  if(c.x>=-40 && c.y>=-40 && c.x<=r.width+40 && c.y<=r.height+40) currentCursorScreen = c;
  else currentCursorScreen = null;
}
function clearFingerCursor(){ currentCursorScreen = null; }

canvas.addEventListener('pointerdown', e=>{
  e.preventDefault();
  hideObjectMenu();
  updateCursorFromEvent(e);
  // v59.1: LINEの2点目指定中は、押した瞬間ではなく、指/ペンを離した位置で確定する。
  // これにより、押したままOSNAPマーカーを探してから終点を決められる。
  if(mode==='line' && drawState && drawState.type==='LINE' && drawState.pts && drawState.pts.length===1){
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const p2 = snappedPointFromEvent(e);
    lineReleaseState = {pointerId:e.pointerId, p2};
    suppressTap = true;
    updateDrawHint(`線分 2点目を探索中\n1点目 ${fmtPtInline(drawState.pts[0])}\n2点目 ${fmtPtInline(p2)}\nスナップ = ${snapLabel(p2)}\n指/ペンを離すと確定`);
    draw();
    return;
  }
  // v59.1: PLINEの2点目以降も、押した瞬間ではなく、指/ペンを離した位置で確定する。
  // 押したままOSNAPを探し、ラバーバンド仮線を見ながら点を追加できる。
  if(mode==='poly' && drawState && drawState.type==='LWPOLYLINE' && drawState.pts && drawState.pts.length>=1){
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const pNext = snappedPointFromEvent(e);
    polyReleaseState = {pointerId:e.pointerId, p:pNext};
    suppressTap = true;
    const last = drawState.pts[drawState.pts.length-1];
    updateDrawHint(`ポリライン 次点を探索中\n点数: ${drawState.pts.length}\n前点 ${fmtPtInline(last)}\n次点 ${fmtPtInline(pNext)}\nスナップ = ${snapLabel(pNext)}\n指/ペンを離すと追加`);
    draw();
    return;
  }
  // v59.1: CIRCLEの半径指定も、押した瞬間ではなく、指/ペンを離した位置で確定する。
  // 押したままOSNAPを探し、仮円＋半径ラバーバンドを見ながら指定できる。
  if(mode==='circle' && drawState && drawState.type==='CIRCLE' && drawState.center){
    hideCircleChoicePanel();
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const pR = snappedPointFromEvent(e);
    circleReleaseState = {pointerId:e.pointerId, p:pR};
    suppressTap = true;
    const c = drawState.center;
    const rr = Math.hypot(pR.x-c.x, pR.y-c.y);
    updateDrawHint(`円 半径点を探索中\n中心 ${fmtPtInline(c)}\n半径点 ${fmtPtInline(pR)}\n半径 ${rr.toFixed(3)}\nスナップ = ${snapLabel(pR)}\n指/ペンを離すと確定。数値指定は「確定」`);
    draw();
    return;
  }
  // v53: SELECTモードでは、矩形選択やオブジェクト選択より先にグリップ判定を行う。
  // これにより、表示されている四角グリップを押したとき必ずグリップ編集へ入る。
  const gripClient = cursorClientFromEvent(e);
  const grip = (mode==='select' && selectedIndex>=0) ? hitSelectedGripScreen(gripClient.clientX, gripClient.clientY) : null;
  if(grip){
    rectSelectState = null;
    clearTimeout(longPressTimer);
    pendingGripPress = null;
    suppressTap = true;
    activePointers.delete(e.pointerId);
    canvas.setPointerCapture?.(e.pointerId);
    startGripDrag(e, grip);
    draw();
    return;
  }
  if(mode==='select'){
    const cpt = cursorCanvasFromClient(e.clientX, e.clientY);
    rectSelectState = {pointerId:e.pointerId, startX:cpt.x, startY:cpt.y, x:cpt.x, y:cpt.y, active:false};
  }
  canvas.setPointerCapture(e.pointerId);
  const pt = {x:e.clientX, y:e.clientY, startX:e.clientX, startY:e.clientY};
  activePointers.set(e.pointerId, pt);
  dragStart = {x:e.clientX, y:e.clientY};
  suppressTap = activePointers.size > 1;
  if(activePointers.size === 2){
    const ps=[...activePointers.values()];
    lastCentroid = centroid(ps);
    lastPinchDist = distance(ps[0], ps[1]);
  }
}, {passive:false});

canvas.addEventListener('pointermove', e=>{
  updateCursorFromEvent(e);
  if(lineReleaseState && lineReleaseState.pointerId === e.pointerId){
    e.preventDefault();
    const p2 = snappedPointFromEvent(e);
    lineReleaseState.p2 = p2;
    suppressTap = true;
    updateDrawHint(`線分 2点目を探索中\n1点目 ${fmtPtInline(drawState.pts[0])}\n2点目 ${fmtPtInline(p2)}\nスナップ = ${snapLabel(p2)}\n指/ペンを離すと確定`);
    draw();
    return;
  }
  if(polyReleaseState && polyReleaseState.pointerId === e.pointerId){
    e.preventDefault();
    const pNext = snappedPointFromEvent(e);
    polyReleaseState.p = pNext;
    suppressTap = true;
    const last = drawState && drawState.pts ? drawState.pts[drawState.pts.length-1] : null;
    updateDrawHint(`ポリライン 次点を探索中\n点数: ${drawState && drawState.pts ? drawState.pts.length : 0}\n前点 ${last ? fmtPtInline(last) : '-'}\n次点 ${fmtPtInline(pNext)}\nスナップ = ${snapLabel(pNext)}\n指/ペンを離すと追加`);
    draw();
    return;
  }
  if(circleReleaseState && circleReleaseState.pointerId === e.pointerId){
    e.preventDefault();
    const pR = snappedPointFromEvent(e);
    circleReleaseState.p = pR;
    suppressTap = true;
    const c = drawState && drawState.center ? drawState.center : null;
    const rr = c ? Math.hypot(pR.x-c.x, pR.y-c.y) : 0;
    updateDrawHint(`円 半径点を探索中\n中心 ${c ? fmtPtInline(c) : '-'}\n半径点 ${fmtPtInline(pR)}\n半径 ${rr.toFixed(3)}\nスナップ = ${snapLabel(pR)}\n指/ペンを離すと確定。数値指定は「確定」`);
    draw();
    return;
  }
  if(pendingGripPress && pendingGripPress.pointerId === e.pointerId){
    const moved = Math.hypot(e.clientX-pendingGripPress.startX, e.clientY-pendingGripPress.startY);
    if(moved > GRIP_LONGPRESS_MOVE_TOLERANCE_PX){
      clearTimeout(longPressTimer);
      const pg = pendingGripPress;
      pendingGripPress = null;
      startGripDrag(pg.event, pg.grip);
      moveGripDrag({...e, clientX: cursorClientFromEvent(e).clientX, clientY: cursorClientFromEvent(e).clientY});
      return;
    }
  }
  if(gripDrag && gripDrag.pointerId === e.pointerId){
    e.preventDefault();
    rectSelectState = null;
    suppressTap = true;
    moveGripDrag(e);
    return;
  }
  // v47: hover/move中もOSNAP候補を表示。2本指操作・矩形選択中は消す。
  if(!activePointers.has(e.pointerId)){
    const cpt = cursorCanvasFromClient(e.clientX, e.clientY);
    updateSnapMarkerAtCanvas(cpt.x, cpt.y);
    draw();
    return;
  }
  e.preventDefault();
  const prev = activePointers.get(e.pointerId);
  activePointers.set(e.pointerId, {...prev, x:e.clientX, y:e.clientY});
  const cmarker = cursorCanvasFromClient(e.clientX, e.clientY);
  updateSnapMarkerAtCanvas(cmarker.x, cmarker.y);

  const ps=[...activePointers.values()];
  if(ps.length === 1){
    const p=ps[0];
    const dx=e.clientX-prev.x;
    const dy=e.clientY-prev.y;
    const movedFromStart = Math.hypot(p.x-p.startX, p.y-p.startY);
    if(mode==='select' && rectSelectState && rectSelectState.pointerId===e.pointerId){
      const cpt = cursorCanvasFromClient(e.clientX, e.clientY);
      rectSelectState.x = cpt.x;
      rectSelectState.y = cpt.y;
      if(movedFromStart > TAP_TOLERANCE_PX) rectSelectState.active = true;
      if(rectSelectState.active){
        suppressTap = true;
        clearSnapMarker();
        draw();
        return;
      }
    }
    if(movedFromStart > TAP_TOLERANCE_PX){
      suppressTap = true;
      // v48.1: 1本指ではパンしない（カーソル操作専用）
      draw();
    }
    return;
  }

  if(ps.length >= 2){
    clearSnapMarker();
    suppressTap = true;
    const c = centroid(ps.slice(0,2));
    const d = distance(ps[0], ps[1]);
    if(lastCentroid){
      view.ox += (c.x - lastCentroid.x);
      view.oy += (c.y - lastCentroid.y);
    }
    if(lastPinchDist){
      const factor = Math.max(0.2, Math.min(5, d / lastPinchDist));
      zoomAtClient(c.x, c.y, factor, false);
    }
    draw();
    lastCentroid = c;
    lastPinchDist = d;
  }
}, {passive:false});

canvas.addEventListener('pointerup', e=>{
  if(lineReleaseState && lineReleaseState.pointerId === e.pointerId){
    e.preventDefault();
    const p2 = snappedPointFromEvent(e);
    const p1 = drawState && drawState.pts ? drawState.pts[0] : null;
    if(p1 && p2){
      addEntity({type:'LINE', layer:currentDrawLayer, pts:[{x:p1.x,y:p1.y},{x:p2.x,y:p2.y}], created:true});
      updateDrawHint(`線分を追加しました\nレイヤ：${currentDrawLayer}\n1点目 ${fmtPt(p1)}\n2点目 ${fmtPt(p2)}\nスナップ = ${snapLabel(p2)}`);
    }
    drawState = null;
    lineReleaseState = null;
    suppressTap = true;
    clearSnapMarker();
    draw();
    return;
  }
  if(polyReleaseState && polyReleaseState.pointerId === e.pointerId){
    e.preventDefault();
    const pNext = snappedPointFromEvent(e);
    if(drawState && drawState.type==='LWPOLYLINE' && drawState.pts){
      drawState.pts.push(pNext);
      updateDrawHint(`ポリライン点を追加しました\n点数: ${drawState.pts.length}\n追加点 ${fmtPtInline(pNext)}\nスナップ = ${snapLabel(pNext)}\n続けて押したまま探す、または「確定」`);
    }
    polyReleaseState = null;
    suppressTap = true;
    clearSnapMarker();
    draw();
    return;
  }
  if(circleReleaseState && circleReleaseState.pointerId === e.pointerId){
    e.preventDefault();
    const pR = snappedPointFromEvent(e);
    const c = drawState && drawState.center ? drawState.center : null;
    if(c && pR){
      const rr = Math.hypot(pR.x-c.x, pR.y-c.y);
      if(rr>0){
        addEntity({type:'CIRCLE', layer:currentDrawLayer, center:{x:c.x,y:c.y}, r:rr, pts:[{x:c.x,y:c.y}], created:true});
        updateDrawHint(`円を追加しました\nレイヤ：${currentDrawLayer}\n中心 ${fmtPt(c)}\n半径 ${rr.toFixed(3)}\nスナップ = ${snapLabel(pR)}`);
      }
    }
    drawState = null;
    hideCircleChoicePanel();
    circleReleaseState = null;
    suppressTap = true;
    clearSnapMarker();
    draw();
    return;
  }
  if(rectSelectState && rectSelectState.pointerId===e.pointerId && rectSelectState.active){
    e.preventDefault();
    finishRectangleSelection();
    if(activePointers.has(e.pointerId)) activePointers.delete(e.pointerId);
    suppressTap = false;
    return;
  }
  if(pendingGripPress && pendingGripPress.pointerId===e.pointerId){ clearTimeout(longPressTimer); pendingGripPress=null; suppressTap=true; rectSelectState=null; return; }
  if(gripDrag && gripDrag.pointerId===e.pointerId){ e.preventDefault(); endGripDrag(e,false); rectSelectState=null; return; }
  finishPointer(e);
  rectSelectState=null;
}, {passive:false});
canvas.addEventListener('pointercancel', e=>{ if(lineReleaseState && lineReleaseState.pointerId===e.pointerId){ lineReleaseState=null; suppressTap=false; draw(); return; } if(polyReleaseState && polyReleaseState.pointerId===e.pointerId){ polyReleaseState=null; suppressTap=false; draw(); return; } if(circleReleaseState && circleReleaseState.pointerId===e.pointerId){ circleReleaseState=null; suppressTap=false; draw(); return; } rectSelectState=null; if(pendingGripPress && pendingGripPress.pointerId===e.pointerId){ clearTimeout(longPressTimer); pendingGripPress=null; suppressTap=false; return; } if(gripDrag && gripDrag.pointerId===e.pointerId){ endGripDrag(e,true); return; } finishPointer(e, true); }, {passive:false});
canvas.addEventListener('pointerleave', e=>{ if(gripDrag && gripDrag.pointerId===e.pointerId){ return; } clearFingerCursor(); clearSnapMarker(); if(activePointers.has(e.pointerId)) finishPointer(e, true); draw(); }, {passive:false});

function finishPointer(e, cancelled=false){
  if(activePointers.has(e.pointerId)){
    const p = activePointers.get(e.pointerId);
    activePointers.delete(e.pointerId);
    if(!cancelled && !suppressTap && Math.hypot(e.clientX-p.startX, e.clientY-p.startY) <= TAP_TOLERANCE_PX){
      handleTapAt(e.clientX, e.clientY);
    }
  }
  if(activePointers.size < 2){
    lastCentroid = null;
    lastPinchDist = null;
  }
  if(activePointers.size === 0){
    suppressTap = false;
    dragStart = null;
  }
}

canvas.addEventListener('wheel', e=>{
  e.preventDefault();
  zoomAtClient(e.clientX,e.clientY, e.deltaY<0?1.12:0.88, true);
}, {passive:false});

function centroid(ps){ return {x:(ps[0].x+ps[1].x)/2, y:(ps[0].y+ps[1].y)/2}; }
function distance(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }

function zoomAtClient(cx,cy,f, redraw=true){
  const r=canvas.getBoundingClientRect();
  zoomAtCanvasPoint(cx-r.left, cy-r.top, f, redraw);
}
function zoomAtCanvasPoint(x,y,f, redraw=true){
  const before=screenToWorld(x,y);
  view.scale*=f;
  view.scale=Math.max(1e-9, Math.min(1e9, view.scale));
  view.ox = x - before.x * view.scale;
  view.oy = y + before.y * view.scale;
  if(redraw) draw();
}

function handleTapAt(clientX, clientY){
  const cpt = cursorCanvasFromClient(clientX, clientY);
  const sx = cpt.x;
  const sy = cpt.y;
  currentCursorScreen = {x:sx, y:sy};
  const raw=screenToWorld(sx, sy);
  const p=nearestSnap(raw, SNAP_TOLERANCE_PX/view.scale) || {...raw, snapType:'なし'};
  currentSnapMarker = p.snapType && p.snapType !== 'なし' ? {x:p.x, y:p.y, snapType:p.snapType, kind:snapMarkerKind(p.snapType)} : null;
  if(copyState){ handleCopyTap(raw, p); return; }
  if(mode==='select'){ handleSelectTap(raw); return; }
  if(mode==='pan'){ handleMoveTap(raw, p); return; }
  if(handleDrawingTap(p)) return;
  if(mode==='coord') {
    addNote('座標', `${fmtPtLines(p)}\nスナップ = ${p.snapType}`, sx, sy, [p]);
    info.textContent = `COORD\n${fmtPtInline(p)}\nSNAP = ${p.snapType}`;
    draw();
  }
  if(mode==='dist'){
    if(!measureStart){
      measureStart=p; measureEnd=null;
      addNote('距離 1点目', `${fmtPtLines(p)}\nスナップ = ${p.snapType}`, sx, sy, [p], true, 'measureStart');
      info.textContent=`DIST\n1点目 ${fmtPtInline(p)} SNAP=${p.snapType}\n2点目を指定`;
    }
    else {
      measureEnd=p;
      // 重要: removeTempMeasureNotes() は measureStart をクリアするため、
      // 先にローカル変数へ退避してから1点目の仮付箋だけを消す。
      const p1 = {...measureStart};
      const p2 = {...measureEnd};
      const d=Math.hypot(p2.x-p1.x, p2.y-p1.y);
      const midScreen = worldToScreen({x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2});
      removeTempMeasureNotes({resetState:false});
      addNote('点間距離', formatDistanceNote(p1, p2, d), midScreen.x, midScreen.y, [p1, p2], false, 'distance');
      info.textContent=formatDistanceNote(p1, p2, d);
      measureStart=null;
      measureEnd=null;
    }
    draw();
  }
}


function initCircleChoicePanel(){
  const wrap = document.getElementById('canvasWrap');
  if(!wrap || circleChoicePanel) return;
  const panel = document.createElement('div');
  panel.id = 'circleChoicePanel';
  panel.className = 'circleChoicePanel hidden';
  panel.innerHTML = `
    <div class="circleChoiceTitle">円の半径指定</div>
    <div class="circleChoiceActions">
      <button type="button" id="circleRadiusInputBtn">半径入力</button>
      <button type="button" id="circleDirectPickBtn">直接クリック</button>
    </div>
  `;
  wrap.appendChild(panel);
  circleChoicePanel = panel;
  const radiusBtn = panel.querySelector('#circleRadiusInputBtn');
  const directBtn = panel.querySelector('#circleDirectPickBtn');
  if(radiusBtn) radiusBtn.onclick = (ev)=>{ ev.stopPropagation(); promptCircleRadiusAtCenter(); };
  if(directBtn) directBtn.onclick = (ev)=>{
    ev.stopPropagation();
    hideCircleChoicePanel();
    if(drawState && drawState.type==='CIRCLE' && drawState.center){
      updateDrawHint(`円 半径点を直接指定\n中心 ${fmtPtInline(drawState.center)}\n押したままOSNAPを探して、離すと確定`);
    }
  };
}
function showCircleChoicePanel(center){
  initCircleChoicePanel();
  if(!circleChoicePanel || !center) return;
  updateCircleChoicePanelPosition(center);
  circleChoicePanel.classList.remove('hidden');
}
function hideCircleChoicePanel(){
  if(circleChoicePanel) circleChoicePanel.classList.add('hidden');
}
function updateCircleChoicePanelPosition(center){
  if(!circleChoicePanel || !center) return;
  const wrap = document.getElementById('canvasWrap');
  if(!wrap) return;
  const s = worldToScreen(center);
  const w = wrap.clientWidth || 320;
  const h = wrap.clientHeight || 480;
  // 中心点の少し右上へ出す。下のコマンドラインには被りにくくする。
  const panelW = 188;
  const panelH = 74;
  const x = Math.max(8, Math.min(w - panelW - 8, s.x + 22));
  const y = Math.max(58, Math.min(h - panelH - 112, s.y - 18));
  circleChoicePanel.style.left = x + 'px';
  circleChoicePanel.style.top = y + 'px';
}
function promptCircleRadiusAtCenter(){
  if(!(mode==='circle' && drawState && drawState.type==='CIRCLE' && drawState.center)) return;
  if(!ensureCurrentLayerEditable('円確定')) return;
  const v = prompt('半径を入力してください', '');
  if(v===null) return;
  const rr = Number(String(v).trim());
  if(Number.isFinite(rr) && rr>0){
    const c=drawState.center;
    addEntity({type:'CIRCLE', layer:currentDrawLayer, center:{x:c.x,y:c.y}, r:rr, pts:[{x:c.x,y:c.y}], created:true});
    updateDrawHint(`円を追加しました\nレイヤ：${currentDrawLayer}\n中心 ${fmtPt(c)}\n半径 ${rr.toFixed(3)}（数値入力）`);
    drawState=null; circleReleaseState=null; hideCircleChoicePanel(); draw();
  } else {
    updateDrawHint('半径は0より大きい数値を入力してください。');
  }
}


function command(msg){
  if(!info) return;
  const text = String(msg ?? '');
  info.textContent = text.includes('現在レイヤ') ? text : `${text}\n現在レイヤ：${currentDrawLayer}`;
}
function updateDrawHint(extra=''){
  if(!info) return;
  if(mode==='select') info.textContent = extra || `SELECT\n現在レイヤ：${currentDrawLayer}\nオブジェクトを選択`;
  else if(mode==='line') info.textContent = extra || `LINE\n現在レイヤ：${currentDrawLayer}${isLayerLocked(currentDrawLayer)?'（ロック中）':''}\n1点目を指定`;
  else if(mode==='poly') info.textContent = extra || `PLINE\n現在レイヤ：${currentDrawLayer}${isLayerLocked(currentDrawLayer)?'（ロック中）':''}\n次の点を指定。確定で終了`;
  else if(mode==='circle') info.textContent = extra || `CIRCLE\n現在レイヤ：${currentDrawLayer}${isLayerLocked(currentDrawLayer)?'（ロック中）':''}\n中心点を指定`;
  else if(mode==='text') info.textContent = extra || `TEXT\n現在レイヤ：${currentDrawLayer}${isLayerLocked(currentDrawLayer)?'（ロック中）':''}\n文字の挿入位置を指定`;
  else if(mode==='pan') info.textContent = extra || `MOVE\n現在レイヤ：${currentDrawLayer}\nオブジェクトを選択。選択後、基準点→移動先を指定。画面移動は2本指ドラッグ`;
  else if(mode==='coord') info.textContent = extra || `COORD\n現在レイヤ：${currentDrawLayer}\n座標を取得する点を指定`;
  else if(mode==='dist') info.textContent = extra || `DIST\n現在レイヤ：${currentDrawLayer}\n1点目を指定`;
}
function handleDrawingTap(p){
  if(['line','poly','circle','text'].includes(mode) && !ensureCurrentLayerEditable('作図')) return true;
  if(mode==='line'){
    if(!drawState) {
      drawState={type:'LINE', pts:[p]};
      updateDrawHint(`線分 1点目\n${fmtPtLines(p)}\nスナップ = ${snapLabel(p)}\n2点目は押したまま探して、離すと確定`);
      draw();
      return true;
    }
    // v59.1では2点目はpointerdown→move→pointerupで確定する。
    // ここに来るのはキーボード/特殊環境のフォールバック。
    const p1=drawState.pts[0], p2=p;
    addEntity({type:'LINE', layer:currentDrawLayer, pts:[{x:p1.x,y:p1.y},{x:p2.x,y:p2.y}], created:true});
    drawState=null;
    updateDrawHint(`線分を追加しました\nレイヤ：${currentDrawLayer}\n1点目 ${fmtPt(p1)}\n2点目 ${fmtPt(p2)}`);
    return true;
  }
  if(mode==='poly'){
    if(!drawState) {
      drawState={type:'LWPOLYLINE', pts:[p]};
      updateDrawHint(`ポリライン 1点目
レイヤ：${currentDrawLayer}
${fmtPtInline(p)}
2点目以降は押したまま探して、離すと追加`);
    } else {
      // v59.1では2点目以降はpointerdown→move→pointerupで追加する。
      // ここに来るのはキーボード/特殊環境のフォールバック。
      drawState.pts.push(p);
      updateDrawHint(`ポリライン点を追加しました
点数: ${drawState.pts.length}
追加点 ${fmtPtInline(p)}
続けて押したまま探す、または「確定」`);
    }
    draw();
    return true;
  }
  if(mode==='circle'){
    if(!drawState) { drawState={type:'CIRCLE', center:p}; updateDrawHint(`円 中心点\n${fmtPtLines(p)}\n中心横のメニューで「半径入力」または「直接クリック」を選択`); showCircleChoicePanel(p); draw(); return true; }
    const c=drawState.center;
    const rr=Math.hypot(p.x-c.x, p.y-c.y);
    if(rr>0){ addEntity({type:'CIRCLE', layer:currentDrawLayer, center:{x:c.x,y:c.y}, r:rr, pts:[{x:c.x,y:c.y}], created:true}); }
    drawState=null; hideCircleChoicePanel();
    updateDrawHint(`円を追加しました\nレイヤ：${currentDrawLayer}\n中心 ${fmtPt(c)}\n半径 ${rr.toFixed(3)}`);
    return true;
  }
  if(mode==='text'){
    const t=prompt('配置する文字を入力してください', '');
    if(t!==null && t.trim()!==''){
      addEntity({type:'TEXT', layer:currentDrawLayer, pts:[{x:p.x,y:p.y}], text:t.trim(), height:2.5, created:true});
      updateDrawHint(`文字を追加しました\nレイヤ：${currentDrawLayer}\n${t.trim()}\n${fmtPtInline(p)}`);
    }
    return true;
  }
  return false;
}
function finishDrawing(){
  if(mode==='poly'){
    if(!ensureCurrentLayerEditable('ポリライン確定')) return;
    if(drawState && drawState.type==='LWPOLYLINE' && drawState.pts.length>=2){
      const pts=drawState.pts.map(q=>({x:q.x,y:q.y}));
      addEntity({type:'LWPOLYLINE', layer:currentDrawLayer, pts, closed:false, created:true});
      updateDrawHint(`ポリラインを追加しました\nレイヤ：${currentDrawLayer}\n点数: ${pts.length}`);
    } else updateDrawHint('ポリラインは2点以上必要です。');
    drawState=null; draw(); return;
  }
  if(mode==='circle' && drawState && drawState.type==='CIRCLE' && drawState.center){
    promptCircleRadiusAtCenter();
    return;
  }
  if(drawState){ updateDrawHint('この作図はまだ確定できません。必要な点を続けてタップしてください。'); }
}
function cancelDrawing(){
  hideCircleChoicePanel();
  drawState=null; lineReleaseState=null; polyReleaseState=null; circleReleaseState=null; measureStart=null; measureEnd=null; moveState=null; copyState=null; hideObjectMenu();
  updateDrawHint('作図/測定/コピーの途中状態を取り消しました。');
  draw();
}
function drawDrawingPreview(){
  if(!drawState) return;
  ctx.save();
  ctx.strokeStyle='#fbbf24'; ctx.fillStyle='#fbbf24'; ctx.lineWidth=1.2; ctx.setLineDash([5,4]);
  if(drawState.type==='LINE' && drawState.pts.length){
    drawCross(drawState.pts[0]);
    const p2 = lineReleaseState && lineReleaseState.p2 ? lineReleaseState.p2 : null;
    if(p2){
      const a=worldToScreen(drawState.pts[0]), b=worldToScreen(p2);
      ctx.beginPath();
      ctx.moveTo(a.x,a.y);
      ctx.lineTo(b.x,b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      drawCross(p2);
      ctx.setLineDash([5,4]);
    }
  }
  if(drawState.type==='LWPOLYLINE' && drawState.pts.length){
    ctx.beginPath();
    drawState.pts.forEach((p,i)=>{ const s=worldToScreen(p); i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y); });
    const pNext = polyReleaseState && polyReleaseState.p ? polyReleaseState.p : null;
    if(pNext){ const s=worldToScreen(pNext); ctx.lineTo(s.x,s.y); }
    ctx.stroke();
    ctx.setLineDash([]); for(const p of drawState.pts) drawCross(p);
    if(pNext) drawCross(pNext);
  }
  if(drawState.type==='CIRCLE' && drawState.center){
    drawCross(drawState.center);
    const pR = circleReleaseState && circleReleaseState.p ? circleReleaseState.p : null;
    if(pR){
      const c=drawState.center;
      const rr=Math.hypot(pR.x-c.x, pR.y-c.y);
      const cs=worldToScreen(c), rs=worldToScreen(pR);
      ctx.beginPath();
      ctx.moveTo(cs.x, cs.y);
      ctx.lineTo(rs.x, rs.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cs.x, cs.y, Math.abs(rr*view.scale), 0, Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
      drawCross(pR);
      ctx.setLineDash([5,4]);
    }
  }
  ctx.restore();
}
function saveDXF(){
  const name = currentFileBaseName || 'drawing.dxf';
  downloadTextFile(name, exportDXF(entities));
  info.textContent = `保存しました：${name}\n※ブラウザ仕様上、同名DXFのダウンロードとして保存します。`;
}
function saveDXFAs(){
  const def = (currentFileBaseName || 'drawing.dxf').replace(/\.dxf$/i,'') + '_edited.dxf';
  const name = prompt('保存ファイル名', def);
  if(!name) return;
  const safe = name.toLowerCase().endsWith('.dxf') ? name : name + '.dxf';
  downloadTextFile(safe, exportDXF(entities));
  currentFileBaseName = safe;
  fileName.textContent = safe;
  info.textContent = `名前を付けて保存しました：${safe}`;
}
function downloadTextFile(filename, text, mimeType='application/dxf;charset=utf-8'){
  const blob = new Blob([text], {type:mimeType});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();}, 500);
}
function exportDXF(es){
  const lines=[];
  const add=(c,v)=>{lines.push(String(c)); lines.push(String(v));};
  add(0,'SECTION'); add(2,'HEADER'); add(9,'$ACADVER'); add(1,'AC1009'); add(0,'ENDSEC');
  add(0,'SECTION'); add(2,'ENTITIES');
  for(const e of es){
    const layer=e.layer || '0';
    if(e.type==='LINE'){
      add(0,'LINE'); add(8,layer); add(10,fmt(e.pts[0].x)); add(20,fmt(e.pts[0].y)); add(30,0); add(11,fmt(e.pts[1].x)); add(21,fmt(e.pts[1].y)); add(31,0);
    } else if(e.type==='LWPOLYLINE'){
      add(0,'LWPOLYLINE'); add(8,layer); add(90,e.pts.length); add(70,e.closed?1:0);
      for(const p of e.pts){ add(10,fmt(p.x)); add(20,fmt(p.y)); }
    } else if(e.type==='POINT'){
      add(0,'POINT'); add(8,layer); add(10,fmt(e.pts[0].x)); add(20,fmt(e.pts[0].y)); add(30,0);
    } else if(e.type==='CIRCLE'){
      add(0,'CIRCLE'); add(8,layer); add(10,fmt(e.center.x)); add(20,fmt(e.center.y)); add(30,0); add(40,fmt(e.r));
    } else if(e.type==='ARC'){
      add(0,'ARC'); add(8,layer); add(10,fmt(e.center.x)); add(20,fmt(e.center.y)); add(30,0); add(40,fmt(e.r)); add(50,fmt(e.a1)); add(51,fmt(e.a2));
    } else if(e.type==='TEXT'){
      add(0,'TEXT'); add(8,layer); add(10,fmt(e.pts[0].x)); add(20,fmt(e.pts[0].y)); add(30,0); add(40,fmt(e.height || 2.5)); add(1,escapeDXFText(e.text || ''));
    }
  }
  add(0,'ENDSEC'); add(0,'EOF');
  return lines.join('\n')+'\n';
}
function fmt(n){ return Number.isFinite(n) ? String(Math.round(n*1000000)/1000000) : '0'; }
function escapeDXFText(t){ return String(t).replace(/[\r\n]/g,' '); }

function snapLabel(p){ return p && p.snapType ? p.snapType : 'なし'; }
function formatDistanceNote(p1, p2, d){
  return `1点目
${fmtPtLines(p1)}
スナップ = ${snapLabel(p1)}

2点目
${fmtPtLines(p2)}
スナップ = ${snapLabel(p2)}

点間距離 = ${d.toFixed(3)} m`;
}

function addNote(title, body, screenX, screenY, anchors=[], temp=false, kind='note'){
  if(temp) removeTempMeasureNotes();
  const id = noteSeq++;
  const r = canvas.getBoundingClientRect();
  const x = Math.max(8, Math.min(r.width - 190, screenX + 46));
  const y = Math.max(8, Math.min(r.height - 100, screenY - 72));
  const base = noteBaseScreen(anchors);
  const offsetX = base ? x - base.x : 0;
  const offsetY = base ? y - base.y : 0;
  notes.push({id, title, body, x, y, anchors, offsetX, offsetY, temp, kind});
  renderNotes();
}
function noteBaseScreen(anchors){
  if(!anchors || anchors.length===0) return null;
  if(anchors.length >= 2){
    return worldToScreen({x:(anchors[0].x+anchors[1].x)/2, y:(anchors[0].y+anchors[1].y)/2});
  }
  return worldToScreen(anchors[0]);
}
function removeTempMeasureNotes(options={resetState:true}){
  const hadStart = notes.some(n => n.kind === 'measureStart');
  notes = notes.filter(n => !n.temp);
  // 1点目を×で削除した場合は未選択に戻す。
  // 2点目確定時は、寸法線作成のため状態を勝手に消さない。
  if(options.resetState && hadStart){ measureStart = null; measureEnd = null; }
  renderNotes();
}
function removeNote(id){
  const removed = notes.find(n => n.id === id);
  notes = notes.filter(n => n.id !== id);
  if(removed && removed.kind === 'measureStart'){
    measureStart = null;
    measureEnd = null;
    info.textContent = '距離モード：1点目を削除しました。次のタップが1点目になります。';
  }
  renderNotes();
  draw();
}
function notePosition(n){
  const r = canvas.getBoundingClientRect();
  const base = noteBaseScreen(n.anchors);
  const leftRaw = base ? base.x + (n.offsetX || 0) : n.x;
  const topRaw = base ? base.y + (n.offsetY || 0) : n.y;
  return {
    left: Math.max(8, Math.min(r.width - 190, leftRaw)),
    top: Math.max(8, Math.min(r.height - 92, topRaw)),
    base
  };
}
function renderNotes(){
  if(!notesLayer) return;
  notesLayer.innerHTML = '';
  for(const n of notes){
    const div = document.createElement('div');
    div.className = 'note';
    div.dataset.noteId = String(n.id);
    const pos = notePosition(n);
    div.style.left = `${pos.left}px`;
    div.style.top = `${pos.top}px`;

    const title = document.createElement('div');
    title.className='noteTitle';
    title.textContent=n.title;

    const body = document.createElement('div');
    body.className='noteBody';
    body.textContent=n.body;

    const close = document.createElement('button');
    close.className='noteClose';
    close.type='button';
    close.textContent='×';
    close.onclick=(ev)=>{ ev.stopPropagation(); removeNote(n.id); };

    div.addEventListener('pointerdown', ev => startNoteDrag(ev, n.id));
    div.append(title, body, close);
    notesLayer.appendChild(div);
  }
}

function startNoteDrag(ev, id){
  if(ev.target && ev.target.classList && ev.target.classList.contains('noteClose')) return;
  ev.preventDefault();
  ev.stopPropagation();
  const n = notes.find(x => x.id === id);
  if(!n) return;
  const pos = notePosition(n);
  const el = ev.currentTarget;
  el.setPointerCapture(ev.pointerId);
  draggingNote = {
    id,
    pointerId: ev.pointerId,
    startClientX: ev.clientX,
    startClientY: ev.clientY,
    startLeft: pos.left,
    startTop: pos.top,
    el
  };
  el.classList.add('dragging');
  el.addEventListener('pointermove', moveNoteDrag);
  el.addEventListener('pointerup', endNoteDrag);
  el.addEventListener('pointercancel', endNoteDrag);
}

function moveNoteDrag(ev){
  if(!draggingNote || ev.pointerId !== draggingNote.pointerId) return;
  ev.preventDefault();
  ev.stopPropagation();

  const n = notes.find(x => x.id === draggingNote.id);
  if(!n) return;
  const r = canvas.getBoundingClientRect();
  const newLeft = Math.max(8, Math.min(r.width - 190, draggingNote.startLeft + (ev.clientX - draggingNote.startClientX)));
  const newTop = Math.max(8, Math.min(r.height - 92, draggingNote.startTop + (ev.clientY - draggingNote.startClientY)));

  const base = noteBaseScreen(n.anchors);
  if(base){
    n.offsetX = newLeft - base.x;
    n.offsetY = newTop - base.y;
  } else {
    n.x = newLeft;
    n.y = newTop;
  }

  if(draggingNote.el){
    draggingNote.el.style.left = `${newLeft}px`;
    draggingNote.el.style.top = `${newTop}px`;
  }
  draw(false);
}

function endNoteDrag(ev){
  if(!draggingNote || ev.pointerId !== draggingNote.pointerId) return;
  ev.preventDefault();
  ev.stopPropagation();
  if(draggingNote.el){
    draggingNote.el.classList.remove('dragging');
    draggingNote.el.removeEventListener('pointermove', moveNoteDrag);
    draggingNote.el.removeEventListener('pointerup', endNoteDrag);
    draggingNote.el.removeEventListener('pointercancel', endNoteDrag);
  }
  draggingNote = null;
  draw();
}
function drawArrowHead(tip, from, size=10){
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(ang - Math.PI/6), tip.y - size * Math.sin(ang - Math.PI/6));
  ctx.lineTo(tip.x - size * Math.cos(ang + Math.PI/6), tip.y - size * Math.sin(ang + Math.PI/6));
  ctx.closePath();
  ctx.fill();
}
function drawLeader(anchorScreen, notePos){
  const target = {x: notePos.left + 10, y: notePos.top + 10};
  ctx.beginPath();
  ctx.moveTo(anchorScreen.x, anchorScreen.y);
  ctx.lineTo(target.x, target.y);
  ctx.stroke();
  // 矢印の先端は取得座標に向ける。旗揚げの起点が明確になる。
  drawArrowHead(anchorScreen, target, 7);
}
function drawDimensionLine(a, b){
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if(len < 1) return;

  ctx.save();
  ctx.strokeStyle = '#f9fafb';
  ctx.fillStyle = '#f9fafb';
  ctx.lineWidth = 1.0;

  // 1点目と2点目を直接結ぶ寸法線。
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // 両端矢印。取得した2点が寸法線の端点として明確になる。
  drawArrowHead(a, b, 8);
  drawArrowHead(b, a, 8);

  // 端点の丸は描かない。矢印の先端だけで測点を示す。
  ctx.restore();
}
function drawNotes(){
  for(const n of notes){
    if(!n.anchors || n.anchors.length===0) continue;
    ctx.save();
    ctx.strokeStyle = '#f9fafb';
    ctx.fillStyle = '#f9fafb';
    ctx.lineWidth = 0.9;
    const pos = notePosition(n);
    if(n.anchors.length >= 2){
      const a=worldToScreen(n.anchors[0]), b=worldToScreen(n.anchors[1]);
      drawDimensionLine(a, b);
      drawLeader({x:(a.x+b.x)/2, y:(a.y+b.y)/2}, pos);
    } else {
      const a = worldToScreen(n.anchors[0]);
      drawCross(n.anchors[0]);
      drawLeader(a, pos);
    }
    ctx.restore();
  }
}


function deepCloneEntity(e){
  return JSON.parse(JSON.stringify(e));
}
function startCopySelected(){
  if(getSelectedIndices().length > 1){ command('COPY\n複数選択のコピーは未対応です。1個だけ選択してください。'); return; }
  if(selectedIndex < 0 || !entities[selectedIndex]){
    command('COPY\nコピーするオブジェクトが選択されていません。');
    return;
  }
  if(!ensureEditableEntity(entities[selectedIndex], 'コピー')) return;
  copyState = {index:selectedIndex, source:deepCloneEntity(entities[selectedIndex]), base:null};
  moveState = null;
  command('COPY\n基準点を指定してください。\n端点・円中心・交点などのスナップを使用できます。');
  draw();
}
function handleCopyTap(raw, snappedPoint){
  if(!copyState || !copyState.source){ copyState=null; return; }
  const p = snappedPoint || raw;
  if(!copyState.base){
    copyState.base = {x:p.x, y:p.y, snapType:p.snapType || 'なし'};
    command(`COPY\n基準点 ${fmtPtInline(p)} SNAP=${snapLabel(p)}\nコピー先を指定してください。`);
    draw();
    return;
  }
  const base = copyState.base;
  const dx = p.x - base.x;
  const dy = p.y - base.y;
  const copied = deepCloneEntity(copyState.source);
  if(isLayerLocked(copied.layer || '0')){ command(`COPY不可：コピー先レイヤ「${copied.layer || '0'}」はロック中です。`); copyState=null; return; }
  copied.created = true;
  translateEntity(copied, dx, dy);
  entities.push(copied);
  selectedIndex = entities.length - 1;
  copyState = null;
  refreshGeometry();
  commitHistory();
  updateProperties();
  command(`COPY\nコピーしました。\nΔX=${dy.toFixed(3)} ΔY=${dx.toFixed(3)} ※測量表示`);
  draw();
}
function deleteSelectedEntity(){
  const selected = getSelectedIndices();
  if(selected.length === 0){
    command('DELETE\n削除するオブジェクトが選択されていません。');
    return;
  }
  if(!ensureEditableSelection('DELETE')) return;
  const sorted=[...selected].sort((a,b)=>b-a);
  for(const idx of sorted){ if(entities[idx]) entities.splice(idx,1); }
  clearSelection();
  moveState = null;
  copyState = null;
  refreshGeometry();
  commitHistory();
  updateProperties();
  command(`DELETE\n${selected.length}個のオブジェクトを削除しました。`);
  draw();
}

function handleMoveTap(raw, snappedPoint){
  // MOVEコマンド：単体選択または矩形選択した複数オブジェクトを平行移動
  let selected = getSelectedIndices();
  if(selected.length === 0){
    const hit = hitTestEntity(raw, 12/view.scale);
    setSelection(hit ? [hit.index] : []);
    selected = getSelectedIndices();
    updateProperties();
    if(hit){
      const e = entities[hit.index];
      command(`MOVE\n${e.type} を選択しました。基準点を指定してください。\nスナップ：端点・円中心・交点などを使用できます。`);
    } else {
      command('MOVE\n移動するオブジェクトを選択してください。\n※画面移動はタップではなくドラッグで行います。');
    }
    draw();
    return;
  }

  if(!ensureEditableSelection('MOVE')) return;
  const p = snappedPoint || raw;
  const key = selected.join(',');
  if(!moveState || moveState.key !== key){
    moveState = {indices:[...selected], key, base:{x:p.x, y:p.y, snapType:p.snapType || 'なし'}};
    command(`MOVE\n${selected.length}個選択中。基準点 ${fmtPtInline(p)} SNAP=${snapLabel(p)}\n移動先を指定してください。`);
    draw();
    return;
  }

  const base = moveState.base;
  const dx = p.x - base.x;
  const dy = p.y - base.y;
  for(const idx of moveState.indices){ if(entities[idx]) translateEntity(entities[idx], dx, dy); }
  moveState = null;
  refreshGeometry();
  commitHistory();
  updateProperties();
  command(`MOVE\n${selected.length}個を移動しました。\nΔX=${dy.toFixed(3)} ΔY=${dx.toFixed(3)} ※測量表示`);
  draw();
}

function translateEntity(e, dx, dy){
  if(!e) return;
  if(e.pts && Array.isArray(e.pts)){
    for(const p of e.pts){ p.x += dx; p.y += dy; }
  }
  if(e.center){ e.center.x += dx; e.center.y += dy; }
}

function handleSelectTap(raw){
  const hit = hitTestEntity(raw, 12/view.scale);
  setSelection(hit ? [hit.index] : []);
  updateProperties();
  if(hit){
    const e=entities[selectedIndex];
    command(`SELECT：${e.type} を選択しました。\n四角グリップだけドラッグ編集できます。\n全体移動はMOVEコマンドです。`);
  } else {
    command('SELECT：オブジェクトが見つかりません。線や円の近くをタップしてください。');
  }
  draw();
}
function hitTestEntity(p, tol){
  let best=null, bd=Infinity;
  entities.forEach((e, index)=>{
    if(!isLayerVisible(e.layer)) return;
    if(!bboxIntersects(entityBBox(e), {minX:p.x-tol, minY:p.y-tol, maxX:p.x+tol, maxY:p.y+tol}, tol)) return;
    let d=Infinity;
    if(e.type==='LINE') d=distPt(p, closestPointOnSegment(p,e.pts[0],e.pts[1]));
    else if(e.type==='LWPOLYLINE'){
      for(let i=0;i<e.pts.length-1;i++) d=Math.min(d, distPt(p, closestPointOnSegment(p,e.pts[i],e.pts[i+1])));
      if(e.closed && e.pts.length>1) d=Math.min(d, distPt(p, closestPointOnSegment(p,e.pts[e.pts.length-1],e.pts[0])));
    } else if(e.type==='CIRCLE') d=Math.abs(distPt(p,e.center)-e.r);
    else if(e.type==='ARC'){
      const q=closestPointOnCircleOrArc(p,e); d=q ? distPt(p,q) : Infinity;
    } else if(e.type==='POINT' || e.type==='TEXT') d=distPt(p,e.pts[0]);
    if(d < bd && d <= tol){ bd=d; best={index,d}; }
  });
  return best;
}
function drawSelectedEntity(){
  const selected = getSelectedIndices();
  if(!selected.length) return;
  const single = selected.length === 1;
  for(const idx of selected){
    const e=entities[idx];
    if(!e) continue;
    ctx.save();
    ctx.strokeStyle='#fbbf24';
    ctx.fillStyle='#fbbf24';
    ctx.lineWidth=2.2;
    ctx.setLineDash([6,3]);
    if(e.type==='LINE' || e.type==='LWPOLYLINE'){
      ctx.beginPath();
      e.pts.forEach((p,i)=>{ const s=worldToScreen(p); i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y); });
      if(e.closed) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      if(single) drawEntityGrips(e);
    } else if(e.type==='CIRCLE'){
      const ss=worldToScreen(e.center);
      ctx.beginPath();
      ctx.arc(ss.x,ss.y,Math.abs(e.r*view.scale),0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
      if(single) drawEntityGrips(e);
    } else if(e.type==='ARC'){
      const ss=worldToScreen(e.center);
      ctx.beginPath();
      ctx.arc(ss.x,ss.y,Math.abs(e.r*view.scale),degToRad(-e.a1),degToRad(-e.a2), e.a2<e.a1);
      ctx.stroke();
      ctx.setLineDash([]);
      if(single) drawEntityGrips(e);
    } else if(e.type==='POINT' || e.type==='TEXT'){
      ctx.setLineDash([]);
      if(single) drawEntityGrips(e);
      else drawGripSquare(e.pts[0]);
    }
    ctx.restore();
  }
}

function drawSelectionRectangle(){
  if(!rectSelectState || !rectSelectState.active) return;
  const x1=rectSelectState.startX, y1=rectSelectState.startY, x2=rectSelectState.x, y2=rectSelectState.y;
  const left=Math.min(x1,x2), top=Math.min(y1,y2), w=Math.abs(x2-x1), h=Math.abs(y2-y1);
  const crossing = x2 < x1; // AutoCAD風：右→左は交差選択
  ctx.save();
  ctx.setLineDash(crossing ? [4,3] : []);
  ctx.strokeStyle = crossing ? '#22c55e' : '#60a5fa';
  ctx.fillStyle = crossing ? 'rgba(34,197,94,0.10)' : 'rgba(96,165,250,0.10)';
  ctx.lineWidth = 1;
  ctx.fillRect(left, top, w, h);
  ctx.strokeRect(left, top, w, h);
  ctx.restore();
}

function finishRectangleSelection(){
  if(!rectSelectState) return;
  const s=rectSelectState;
  rectSelectState=null;
  const minSx=Math.min(s.startX,s.x), maxSx=Math.max(s.startX,s.x);
  const minSy=Math.min(s.startY,s.y), maxSy=Math.max(s.startY,s.y);
  if(Math.abs(maxSx-minSx)<4 || Math.abs(maxSy-minSy)<4) return;
  const pA=screenToWorld(minSx, maxSy);
  const pB=screenToWorld(maxSx, minSy);
  const rect={minX:Math.min(pA.x,pB.x), minY:Math.min(pA.y,pB.y), maxX:Math.max(pA.x,pB.x), maxY:Math.max(pA.y,pB.y)};
  const crossing = s.x < s.startX;
  const hits=[];
  entities.forEach((e, index)=>{
    if(!isLayerVisible(e.layer)) return;
    const bb=entityBBox(e);
    const ok = crossing ? entityCrossesRect(e, rect) : bboxInside(bb, rect);
    if(ok) hits.push(index);
  });
  setSelection(hits);
  updateProperties();
  command(`${crossing?'交差選択':'窓選択'}：${hits.length}個選択しました。`);
  draw();
}


function pointInRect(pt, rect){
  return pt.x>=rect.minX && pt.x<=rect.maxX && pt.y>=rect.minY && pt.y<=rect.maxY;
}
function lineIntersectsRect(a,b,rect){
  if(pointInRect(a,rect)||pointInRect(b,rect)) return true;
  const edges=[
    [{x:rect.minX,y:rect.minY},{x:rect.maxX,y:rect.minY}],
    [{x:rect.maxX,y:rect.minY},{x:rect.maxX,y:rect.maxY}],
    [{x:rect.maxX,y:rect.maxY},{x:rect.minX,y:rect.maxY}],
    [{x:rect.minX,y:rect.maxY},{x:rect.minX,y:rect.minY}]
  ];
  return edges.some(e=>segmentsIntersect(a,b,e[0],e[1]));
}
function segmentsIntersect(p1,p2,q1,q2){
  const orient=(a,b,c)=>{
    const v=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    if(Math.abs(v)<1e-10) return 0;
    return v>0 ? 1 : -1;
  };
  const onSeg=(a,b,c)=> Math.min(a.x,b.x)-1e-10<=c.x && c.x<=Math.max(a.x,b.x)+1e-10 && Math.min(a.y,b.y)-1e-10<=c.y && c.y<=Math.max(a.y,b.y)+1e-10;
  const o1=orient(p1,p2,q1), o2=orient(p1,p2,q2), o3=orient(q1,q2,p1), o4=orient(q1,q2,p2);
  if(o1!==o2 && o3!==o4) return true;
  if(o1===0 && onSeg(p1,p2,q1)) return true;
  if(o2===0 && onSeg(p1,p2,q2)) return true;
  if(o3===0 && onSeg(q1,q2,p1)) return true;
  if(o4===0 && onSeg(q1,q2,p2)) return true;
  return false;
}
function rectEdges(rect){
  return [
    [{x:rect.minX,y:rect.minY},{x:rect.maxX,y:rect.minY}],
    [{x:rect.maxX,y:rect.minY},{x:rect.maxX,y:rect.maxY}],
    [{x:rect.maxX,y:rect.maxY},{x:rect.minX,y:rect.maxY}],
    [{x:rect.minX,y:rect.maxY},{x:rect.minX,y:rect.minY}]
  ];
}
function segmentCircleIntersects(a,b,c,r){
  // true only when the segment touches/crosses the circumference.
  // If the whole segment is inside the circle, it is NOT a crossing of the circle object.
  const dx=b.x-a.x, dy=b.y-a.y;
  const fx=a.x-c.x, fy=a.y-c.y;
  const A=dx*dx+dy*dy;
  if(A<1e-12) return Math.abs(Math.hypot(a.x-c.x,a.y-c.y)-r)<1e-9;
  const B=2*(fx*dx+fy*dy);
  const C=fx*fx+fy*fy-r*r;
  const disc=B*B-4*A*C;
  if(disc < -1e-10) return false;
  const sd=Math.sqrt(Math.max(0,disc));
  const t1=(-B-sd)/(2*A);
  const t2=(-B+sd)/(2*A);
  return (t1>=-1e-10 && t1<=1+1e-10) || (t2>=-1e-10 && t2<=1+1e-10);
}
function circleCrossesRectStroke(center,r,rect){
  const bb={minX:center.x-r,minY:center.y-r,maxX:center.x+r,maxY:center.y+r};
  // Entire circle object is inside crossing rectangle -> selected.
  if(bboxInside(bb, rect)) return true;
  // Rectangle inside circle should NOT select unless rectangle edge touches circumference.
  return rectEdges(rect).some(edge=>segmentCircleIntersects(edge[0], edge[1], center, r));
}
function arcPoint(e, angDeg){
  const a=degToRad(angDeg);
  return {x:e.center.x + e.r*Math.cos(a), y:e.center.y + e.r*Math.sin(a)};
}
function normDeg(d){ d%=360; return d<0?d+360:d; }
function arcSpan(a1,a2){
  a1=normDeg(a1); a2=normDeg(a2);
  let span=a2-a1;
  if(span<0) span+=360;
  return {a1,a2,span};
}
function arcCrossesRectStroke(e, rect){
  const {a1,span}=arcSpan(e.a1||0,e.a2||0);
  const steps=Math.max(12, Math.ceil(span/10));
  let prev=arcPoint(e,a1);
  let anyInside=pointInRect(prev,rect);
  let allInside=anyInside;
  for(let i=1;i<=steps;i++){
    const p=arcPoint(e,a1 + span*i/steps);
    if(lineIntersectsRect(prev,p,rect)) return true;
    const inside=pointInRect(p,rect);
    anyInside = anyInside || inside;
    allInside = allInside && inside;
    prev=p;
  }
  // If the sampled arc is completely inside the rectangle, select it.
  return allInside && anyInside;
}
function entityCrossesRect(e, rect){
  if(e.type==='LINE'){
    return lineIntersectsRect(e.pts[0],e.pts[1],rect);
  }
  if(e.type==='LWPOLYLINE'){
    for(let i=0;i<e.pts.length-1;i++){
      if(lineIntersectsRect(e.pts[i],e.pts[i+1],rect)) return true;
    }
    if(e.closed && e.pts.length>2){
      if(lineIntersectsRect(e.pts[e.pts.length-1],e.pts[0],rect)) return true;
    }
    return false;
  }
  if(e.type==='CIRCLE'){
    return circleCrossesRectStroke(e.center, e.r, rect);
  }
  if(e.type==='ARC'){
    return arcCrossesRectStroke(e, rect);
  }
  return bboxIntersects(entityBBox(e),rect);
}

function bboxInside(a,b){
  return a.minX >= b.minX && a.maxX <= b.maxX && a.minY >= b.minY && a.maxY <= b.maxY;
}

function getEntityGrips(e){
  const grips=[];
  if(!e) return grips;
  if((e.type==='LINE' || e.type==='LWPOLYLINE') && Array.isArray(e.pts)){
    e.pts.forEach((p,i)=>grips.push({kind:'pt', index:i, label:e.type==='LINE' ? (i===0?'始点':'終点') : `頂点${i+1}`, point:p}));
  } else if(e.type==='CIRCLE'){
    grips.push({kind:'center', index:-1, label:'中心', point:e.center});
    // v59.1.1: 円選択時は中心＋0/90/180/270度の円周グリップを表示する。
    // 中心は全体移動、円周グリップは半径変更に使う。
    const c=e.center, r=e.r;
    if(c && Number.isFinite(r) && r>0){
      [0,90,180,270].forEach(deg=>{
        const rad=deg*Math.PI/180;
        grips.push({kind:'radius', index:deg, label:`半径${deg}°`, point:{x:c.x+r*Math.cos(rad), y:c.y+r*Math.sin(rad)}});
      });
    }
  } else if(e.type==='ARC'){
    grips.push({kind:'center', index:-1, label:'中心', point:e.center});
  } else if((e.type==='POINT' || e.type==='TEXT') && e.pts && e.pts[0]){
    grips.push({kind:'pt', index:0, label:e.type==='TEXT' ? '文字挿入基点' : '点', point:e.pts[0]});
  }
  return grips;
}

function drawEntityGrips(e){
  const grips = getEntityGrips(e);
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth=1.3;
  for(const g of grips){
    const active = gripDrag && gripDrag.entityIndex===selectedIndex && gripDrag.grip && gripDrag.grip.kind===g.kind && gripDrag.grip.index===g.index;
    drawGripSquare(g.point, active);
  }
  ctx.restore();
}

function drawGripSquare(p, active=false){
  const ss=worldToScreen(p);
  const size=GRIP_VISIBLE_SIZE_PX;
  ctx.fillStyle=active ? '#7f1d1d' : '#111827';
  ctx.strokeStyle=active ? '#ef4444' : '#fbbf24';
  ctx.lineWidth=active ? 2.2 : 1.4;
  ctx.beginPath();
  ctx.rect(ss.x-size/2, ss.y-size/2, size, size);
  ctx.fill();
  ctx.stroke();
}

function hitSelectedGripScreen(clientX, clientY){
  if(getSelectedIndices().length !== 1 || selectedIndex < 0 || !entities[selectedIndex]) return null;
  const r=canvas.getBoundingClientRect();
  const sx=clientX-r.left, sy=clientY-r.top;
  const grips=getEntityGrips(entities[selectedIndex]);
  let best=null, bd=Infinity;
  for(const g of grips){
    if(!g.point) continue;
    const ss=worldToScreen(g.point);
    const d=Math.hypot(ss.x-sx, ss.y-sy);
    if(d<bd && d<=GRIP_HIT_TOLERANCE_PX){ bd=d; best=g; }
  }
  return best;
}


// v53: During grip editing, do not OSNAP to the same selected object.
// Without this, an endpoint grip keeps snapping to its own old endpoint and feels "stuck".
function nearestSnapForGrip(raw, tol){
  if(!gripDrag || !Number.isInteger(gripDrag.entityIndex)) return nearestSnap(raw, tol);
  const skipIndex = gripDrag.entityIndex;
  const oldEntities = entities;
  const oldSegments = segments;
  const oldCircleItems = circleItems;
  const oldIntersections = intersections;
  try{
    const filtered = oldEntities.filter((_, i) => i !== skipIndex);
    entities = filtered;
    segments = buildSegments(filtered);
    circleItems = buildCircleItems(filtered);
    intersections = buildIntersections(segments, 5000);
    return nearestSnap(raw, tol);
  } finally {
    entities = oldEntities;
    segments = oldSegments;
    circleItems = oldCircleItems;
    intersections = oldIntersections;
  }
}

function startGripDrag(ev, grip){
  const e=entities[selectedIndex];
  if(!ensureEditableEntity(e, 'GRIP編集')) return;
  gripDrag={
    pointerId:ev.pointerId,
    entityIndex:selectedIndex,
    grip:{kind:grip.kind, index:grip.index, label:grip.label},
    before:serializeState(),
    originalPoint:{...grip.point},
    lastPoint:{...grip.point}
  };
  canvas.setPointerCapture?.(ev.pointerId);
  command(`GRIP編集\n${e.type} の ${grip.label} を掴みました。\nそのままドラッグして離すと確定します。\n全体移動はMOVEコマンドです。`);
  draw();
}

function moveGripDrag(ev){
  if(!gripDrag || gripDrag.pointerId !== ev.pointerId) return;
  const r=canvas.getBoundingClientRect();
  const raw=screenToWorld(ev.clientX-r.left, ev.clientY-r.top);
  const p=nearestSnapForGrip(raw, (SNAP_TOLERANCE_PX*1.15)/view.scale) || {...raw, snapType:'なし'};
  applyGripPoint(gripDrag.entityIndex, gripDrag.grip, p);
  gripDrag.lastPoint={x:p.x,y:p.y,snapType:p.snapType||'なし'};
  refreshGeometry();
  updateProperties();
  command(`GRIP編集\n${gripDrag.grip.label} 移動中\n${fmtPtLines(p)}\nスナップ = ${snapLabel(p)}`);
  draw();
}

function endGripDrag(ev, cancelled=false){
  if(!gripDrag || gripDrag.pointerId !== ev.pointerId) return;
  const g=gripDrag;
  gripDrag=null;
  if(cancelled){
    restoreState(g.before);
    command('GRIP編集：キャンセルしました。');
    return;
  }
  refreshGeometry();
  commitHistory();
  updateProperties();
  command(`GRIP編集\n${g.grip.label} を移動しました。\n${fmtPtLines(g.lastPoint || g.originalPoint)}`);
  draw();
}

function applyGripPoint(entityIndex, grip, p){
  const e=entities[entityIndex];
  if(!e || !p) return;
  if(grip.kind==='pt' && e.pts && e.pts[grip.index]){
    e.pts[grip.index].x=p.x;
    e.pts[grip.index].y=p.y;
    // TEXT/POINTは挿入基点、LINE/POLYLINEは端点/頂点を直接移動。
  } else if(grip.kind==='center' && e.center){
    e.center.x=p.x;
    e.center.y=p.y;
    if(e.pts && e.pts[0]){ e.pts[0].x=p.x; e.pts[0].y=p.y; }
  } else if(grip.kind==='radius' && e.center){
    // v59.1.1: 円周グリップを動かしたら、中心は固定して半径だけ変更する。
    const rr = Math.hypot(p.x - e.center.x, p.y - e.center.y);
    if(Number.isFinite(rr) && rr > 0){ e.r = rr; }
  }
}


function currentSnapReference(){
  // 垂線・接線スナップは「直前に指定した点」からの補助スナップとして使う。
  if(copyState && copyState.base) return copyState.base;
  if(moveState && moveState.base) return moveState.base;
  if(gripDrag && gripDrag.originalPoint) return gripDrag.originalPoint;
  if(mode==='line' && drawState && drawState.type==='LINE' && drawState.pts && drawState.pts[0]) return drawState.pts[0];
  if(mode==='poly' && drawState && drawState.type==='LWPOLYLINE' && drawState.pts && drawState.pts.length) return drawState.pts[drawState.pts.length-1];
  if(mode==='dist' && measureStart) return measureStart;
  return null;
}
function tangentPointsFromPointToCircle(base, c){
  const out=[];
  if(!base || !c || !c.center || !Number.isFinite(c.r) || c.r<=0) return out;
  const vx = base.x - c.center.x, vy = base.y - c.center.y;
  const d = Math.hypot(vx, vy);
  if(d <= c.r + 1e-9) return out;
  const baseAng = Math.atan2(vy, vx);
  const alpha = Math.acos(c.r / d);
  for(const a of [baseAng + alpha, baseAng - alpha]){
    const q = {x:c.center.x + c.r*Math.cos(a), y:c.center.y + c.r*Math.sin(a)};
    if(c.type==='ARC'){
      const deg = a*180/Math.PI;
      if(!angleOnArc(deg, c.a1, c.a2)) continue;
    }
    out.push(q);
  }
  return out;
}

function nearestSnap(p, tol){
  let best=null, bd=Infinity;
  const searchBox = {minX:p.x-tol, minY:p.y-tol, maxX:p.x+tol, maxY:p.y+tol};
  function checked(el){ return !!(el && el.checked); }
  function consider(q,type){
    if(!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return;
    const d=Math.hypot(q.x-p.x,q.y-p.y);
    if(d<bd && d<=tol){ bd=d; best={x:q.x,y:q.y,snapType:type}; }
  }

  // 点スナップ：DXFのPOINT要素
  if(checked(snapPoint)){
    for(const e of entities){
      if(!isLayerVisible(e.layer) || e.type!=='POINT') continue;
      if(!bboxIntersects(entityBBox(e), searchBox)) continue;
      consider(e.pts[0], '点');
    }
  }

  // 端点スナップ：線分・ポリライン端点、円弧端点
  if(checked(snapEnd)){
    for(const e of entities){
      if(!isLayerVisible(e.layer)) continue;
      if(!bboxIntersects(entityBBox(e), searchBox, tol)) continue;
      if(e.type==='LINE'||e.type==='LWPOLYLINE') for(const q of e.pts) consider(q,'端点');
      if(e.type==='ARC'){
        consider(arcPoint(e,e.a1),'円弧端点');
        consider(arcPoint(e,e.a2),'円弧端点');
      }
    }
  }

  // 中点スナップ：線分・ポリライン構成線分、円弧の角度中点
  if(checked(snapMid)){
    for(const s of segments){
      if(!isLayerVisible(s.layer)) continue;
      const bb={minX:Math.min(s.a.x,s.b.x), minY:Math.min(s.a.y,s.b.y), maxX:Math.max(s.a.x,s.b.x), maxY:Math.max(s.a.y,s.b.y)};
      if(!bboxIntersects(bb, searchBox, tol)) continue;
      consider({x:(s.a.x+s.b.x)/2, y:(s.a.y+s.b.y)/2}, '中点');
    }
    for(const e of circleItems){
      if(!isLayerVisible(e.layer) || e.type!=='ARC' || !bboxIntersects(e.bbox, searchBox, tol)) continue;
      let a1=((e.a1%360)+360)%360, a2=((e.a2%360)+360)%360;
      let span = a2>=a1 ? a2-a1 : a2+360-a1;
      consider(arcPoint(e, a1 + span/2), '円弧中点');
    }
  }

  // 文字の挿入基点
  if(checked(snapText)){
    for(const e of entities){
      if(!isLayerVisible(e.layer) || e.type!=='TEXT') continue;
      if(!bboxIntersects(entityBBox(e), searchBox, tol)) continue;
      consider(e.pts[0], '文字基点');
    }
  }

  // 円中心
  if(checked(snapCircle)){
    for(const e of circleItems){
      if(!isLayerVisible(e.layer)) continue;
      // 中心だけなので、中心近傍のみチェック
      if(Math.abs(e.center.x-p.x) > tol || Math.abs(e.center.y-p.y) > tol) continue;
      consider(e.center,'円中心');
    }
  }

  // 垂線スナップ：直前点から線分へ下ろした垂線の足
  const snapRef = currentSnapReference();
  if(checked(snapPerp) && snapRef){
    for(const s of segments){
      if(!isLayerVisible(s.layer)) continue;
      const bb={minX:Math.min(s.a.x,s.b.x), minY:Math.min(s.a.y,s.b.y), maxX:Math.max(s.a.x,s.b.x), maxY:Math.max(s.a.y,s.b.y)};
      if(!bboxIntersects(bb, searchBox, tol)) continue;
      const foot = closestPointOnSegment(snapRef, s.a, s.b);
      // 端点に張り付くケースは垂線らしくないので、線分内部だけを垂線候補にする。
      const len=Math.hypot(s.b.x-s.a.x, s.b.y-s.a.y);
      const d1=Math.hypot(foot.x-s.a.x, foot.y-s.a.y), d2=Math.hypot(foot.x-s.b.x, foot.y-s.b.y);
      if(len>1e-12 && d1>len*1e-6 && d2>len*1e-6) consider(foot, '垂線');
    }
  }

  // 接線スナップ：直前点から円/円弧への接点
  if(checked(snapTangent) && snapRef){
    for(const c of circleItems){
      if(!isLayerVisible(c.layer) || !bboxIntersects(c.bbox, searchBox, tol)) continue;
      for(const q of tangentPointsFromPointToCircle(snapRef, c)) consider(q, '接線');
    }
  }

  // 近接点：線分上・円/円弧上の最近点
  if(checked(snapNear)){
    for(const s of segments){
      if(!isLayerVisible(s.layer)) continue;
      const bb={minX:Math.min(s.a.x,s.b.x), minY:Math.min(s.a.y,s.b.y), maxX:Math.max(s.a.x,s.b.x), maxY:Math.max(s.a.y,s.b.y)};
      if(!bboxIntersects(bb, searchBox, tol)) continue;
      consider(closestPointOnSegment(p, s.a, s.b), '近接点');
    }
    for(const c of circleItems){
      if(!isLayerVisible(c.layer) || !bboxIntersects(c.bbox, searchBox, tol)) continue;
      const q = closestPointOnCircleOrArc(p, c);
      if(q) consider(q, c.type==='ARC' ? '円弧近接点' : '円近接点');
    }
  }

  // 交点：線×線はキャッシュ、線×円・円×円はタップ近傍だけ動的計算
  if(checked(snapIntersect)){
    for(const q of intersections){
      if(q.layers.every(l=>isLayerVisible(l))) consider(q,'交点 線×線');
    }
    // 線×円/円弧
    for(const s of segments){
      if(!isLayerVisible(s.layer)) continue;
      const sbb={minX:Math.min(s.a.x,s.b.x), minY:Math.min(s.a.y,s.b.y), maxX:Math.max(s.a.x,s.b.x), maxY:Math.max(s.a.y,s.b.y)};
      if(!bboxIntersects(sbb, searchBox, tol)) continue;
      for(const c of circleItems){
        if(!isLayerVisible(c.layer) || !bboxIntersects(c.bbox, searchBox, tol)) continue;
        for(const q of lineCircleIntersections(s.a, s.b, c)) consider(q, '交点 線×円');
      }
    }
    // 円×円
    const nearbyCircles = circleItems.filter(c => isLayerVisible(c.layer) && bboxIntersects(c.bbox, searchBox, tol));
    for(let i=0;i<nearbyCircles.length;i++){
      for(let j=i+1;j<nearbyCircles.length;j++){
        for(const q of circleCircleIntersections(nearbyCircles[i], nearbyCircles[j])) consider(q, '交点 円×円');
      }
    }
  }
  return best;
}
function closestPointOnSegment(p,a,b){
  const vx=b.x-a.x, vy=b.y-a.y;
  const len2=vx*vx+vy*vy;
  if(len2<=1e-18) return {x:a.x,y:a.y};
  const t=Math.max(0, Math.min(1, ((p.x-a.x)*vx+(p.y-a.y)*vy)/len2));
  return {x:a.x+t*vx, y:a.y+t*vy};
}
function closestPointOnCircleOrArc(p,c){
  const vx=p.x-c.center.x, vy=p.y-c.center.y;
  const len=Math.hypot(vx,vy);
  if(len<=1e-18) return null;
  let deg = Math.atan2(vy,vx)*180/Math.PI;
  if(c.type==='ARC' && !angleOnArc(deg, c.a1, c.a2)){
    const q1=arcPoint(c,c.a1), q2=arcPoint(c,c.a2);
    return Math.hypot(q1.x-p.x,q1.y-p.y) <= Math.hypot(q2.x-p.x,q2.y-p.y) ? q1 : q2;
  }
  return {x:c.center.x + vx/len*c.r, y:c.center.y + vy/len*c.r};
}
function lineCircleIntersections(a,b,c){
  const out=[];
  const dx=b.x-a.x, dy=b.y-a.y;
  const fx=a.x-c.center.x, fy=a.y-c.center.y;
  const A=dx*dx+dy*dy;
  const B=2*(fx*dx+fy*dy);
  const C=fx*fx+fy*fy-c.r*c.r;
  const disc=B*B-4*A*C;
  if(A<=1e-18 || disc < -1e-9) return out;
  const root=Math.sqrt(Math.max(0,disc));
  for(const t of [(-B-root)/(2*A), (-B+root)/(2*A)]){
    if(t < -1e-9 || t > 1+1e-9) continue;
    const q={x:a.x+t*dx, y:a.y+t*dy};
    if(c.type==='ARC'){
      const deg=Math.atan2(q.y-c.center.y, q.x-c.center.x)*180/Math.PI;
      if(!angleOnArc(deg,c.a1,c.a2)) continue;
    }
    if(!out.some(o=>Math.hypot(o.x-q.x,o.y-q.y)<1e-8)) out.push(q);
  }
  return out;
}
function circleCircleIntersections(c1,c2){
  const out=[];
  const dx=c2.center.x-c1.center.x, dy=c2.center.y-c1.center.y;
  const d=Math.hypot(dx,dy);
  if(d<=1e-12 || d>c1.r+c2.r+1e-9 || d<Math.abs(c1.r-c2.r)-1e-9) return out;
  const a=(c1.r*c1.r-c2.r*c2.r+d*d)/(2*d);
  const h2=c1.r*c1.r-a*a;
  if(h2 < -1e-9) return out;
  const h=Math.sqrt(Math.max(0,h2));
  const xm=c1.center.x+a*dx/d, ym=c1.center.y+a*dy/d;
  const rx=-dy*(h/d), ry=dx*(h/d);
  for(const q of [{x:xm+rx,y:ym+ry},{x:xm-rx,y:ym-ry}]){
    let ok=true;
    for(const c of [c1,c2]){
      if(c.type==='ARC'){
        const deg=Math.atan2(q.y-c.center.y, q.x-c.center.x)*180/Math.PI;
        if(!angleOnArc(deg,c.a1,c.a2)) ok=false;
      }
    }
    if(ok && !out.some(o=>Math.hypot(o.x-q.x,o.y-q.y)<1e-8)) out.push(q);
  }
  return out;
}
function arcPoint(e,deg){ const a=degToRad(deg); return {x:e.center.x+Math.cos(a)*e.r, y:e.center.y+Math.sin(a)*e.r}; }
function angleOnArc(deg,a1,a2){ deg=((deg%360)+360)%360; a1=((a1%360)+360)%360; a2=((a2%360)+360)%360; return a1<=a2 ? deg>=a1&&deg<=a2 : deg>=a1||deg<=a2; }
resize();
(function setupPWA(){
  const badge = document.getElementById('pwaStatus');
  const setBadge = (text, cls='') => {
    if(!badge) return;
    badge.textContent = text;
    badge.className = 'pwaChip' + (cls ? ' ' + cls : '');
  };
  function updateOnline(){
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
    const secure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if(!navigator.onLine) setBadge('オフライン起動中', 'offline');
    else if(standalone) setBadge('アプリモード', 'ready');
    else if(secure) setBadge('PWA対応：ホーム画面追加可', 'ready');
    else setBadge('PWA確認用：HTTPS/localhost推奨');
  }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(() => updateOnline())
        .catch(() => setBadge('PWAはHTTPS/localhost推奨'));
    });
  }else{
    setBadge('PWA非対応');
  }
})();

// v33.2 long press object menu + polyline vertex add/delete
let longPressTimer=null;
let longPressStart=null;
function hideObjectMenu(){
  const m=document.getElementById('objectMenu');
  if(m) m.style.display='none';
}
function showMenu(clientX, clientY, items){
  const m=document.getElementById('objectMenu');
  if(!m) return;
  m.innerHTML='';
  for(const it of items){
    const b=document.createElement('button');
    b.type='button';
    b.textContent=it.label;
    b.addEventListener('click', ev=>{ ev.stopPropagation(); hideObjectMenu(); it.action(); });
    m.appendChild(b);
  }
  m.style.display='block';
  const w=m.offsetWidth || 160;
  const h=m.offsetHeight || 48;
  m.style.left=Math.min(window.innerWidth-w-6, Math.max(6, clientX))+'px';
  m.style.top=Math.min(window.innerHeight-h-6, Math.max(6, clientY))+'px';
}
function showObjectMenu(clientX, clientY){
  showMenu(clientX, clientY, [
    {label:'コピー', action:startCopySelected},
    {label:'削除', action:deleteSelectedEntity},
    {label:'キャンセル', action:()=>{}}
  ]);
  command('SELECT\n長押しメニュー：削除 または コピーを選択してください。');
}
function showPolylineSegmentMenu(clientX, clientY, segHit){
  showMenu(clientX, clientY, [
    {label:'頂点を追加', action:()=>addPolylineVertex(segHit)},
    {label:'キャンセル', action:()=>{}}
  ]);
  command('PLINE\n長押しメニュー：頂点を追加できます。');
}
function showGripMenu(clientX, clientY, grip){
  const e = entities[selectedIndex];
  if(e && e.type==='LWPOLYLINE' && grip && grip.kind==='pt'){
    showMenu(clientX, clientY, [
      {label:'頂点を削除', action:()=>deletePolylineVertex(grip.index)},
      {label:'キャンセル', action:()=>{}}
    ]);
    command('PLINE\n長押しメニュー：頂点を削除できます。');
  } else {
    showObjectMenu(clientX, clientY);
  }
}
function hitSelectedPolylineSegmentScreen(clientX, clientY){
  if(selectedIndex < 0) return null;
  const e=entities[selectedIndex];
  if(!e || e.type!=='LWPOLYLINE' || !Array.isArray(e.pts) || e.pts.length<2) return null;
  const r=canvas.getBoundingClientRect();
  const p=screenToWorld(clientX-r.left, clientY-r.top);
  const tol=14/Math.max(Math.abs(view.scale), 1e-9);
  let best=null, bd=Infinity;
  const maxSeg = e.closed ? e.pts.length : e.pts.length-1;
  for(let i=0;i<maxSeg;i++){
    const a=e.pts[i], b=e.pts[(i+1)%e.pts.length];
    const q=closestPointOnSegment(p,a,b);
    const d=distPt(p,q);
    if(d<bd && d<=tol){ bd=d; best={entityIndex:selectedIndex, segmentIndex:i, point:{x:q.x,y:q.y}}; }
  }
  return best;
}
function addPolylineVertex(segHit){
  const e=entities[segHit?.entityIndex ?? selectedIndex];
  if(!e || e.type!=='LWPOLYLINE' || !segHit) return;
  if(!ensureEditableEntity(e, '頂点追加')) return;
  e.pts.splice(segHit.segmentIndex+1, 0, {x:segHit.point.x, y:segHit.point.y});
  refreshGeometry();
  commitHistory();
  updateProperties();
  command(`PLINE\n頂点を追加しました。\n頂点数: ${e.pts.length}`);
  draw();
}
function deletePolylineVertex(index){
  const e=entities[selectedIndex];
  if(!e || e.type!=='LWPOLYLINE' || !Array.isArray(e.pts)) return;
  if(!ensureEditableEntity(e, '頂点削除')) return;
  if(index < 0 || index >= e.pts.length) return;
  if(e.pts.length <= 2){ command('PLINE\n頂点は2点未満にできません。'); return; }
  e.pts.splice(index,1);
  if(e.closed && e.pts.length < 3) e.closed=false;
  refreshGeometry();
  commitHistory();
  updateProperties();
  command(`PLINE\n頂点を削除しました。\n頂点数: ${e.pts.length}`);
  draw();
}
canvas.addEventListener('pointerdown',e=>{
  // v33.3 fallback: first pointer handler manages grip dragging. This handler only manages
  // long-press menus for selected polyline segments or selected objects, avoiding grips.
  if(mode==='select' && getSelectedIndices().length>0 && !hitSelectedGripScreen(e.clientX, e.clientY)){
    clearTimeout(longPressTimer);
    longPressStart={x:e.clientX,y:e.clientY};
    const segHit = hitSelectedPolylineSegmentScreen(e.clientX, e.clientY);
    longPressTimer=setTimeout(()=>{
      if(segHit) showPolylineSegmentMenu(e.clientX,e.clientY,segHit);
      else showObjectMenu(e.clientX,e.clientY);
    },650);
  }
}, {passive:true});
canvas.addEventListener('pointermove',e=>{
  if(!longPressStart) return;
  if(Math.hypot(e.clientX-longPressStart.x, e.clientY-longPressStart.y)>8){
    clearTimeout(longPressTimer);
    longPressStart=null;
  }
}, {passive:true});
canvas.addEventListener('pointerup',()=>{clearTimeout(longPressTimer); longPressStart=null;});
canvas.addEventListener('pointercancel',()=>{clearTimeout(longPressTimer); longPressStart=null;});
document.addEventListener('pointerdown',e=>{
  const m=document.getElementById('objectMenu');
  if(m && m.style.display==='block' && !m.contains(e.target) && e.target!==canvas) hideObjectMenu();
});
