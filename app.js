// CueScroll – offline teleprompter. Scripts and settings live in localStorage on this device only.
let stageEl = null; // the stage can move into the floating window's document
const $ = (id) => document.getElementById(id) || (stageEl && stageEl.ownerDocument.getElementById(id));

// ---------- Pro (Microsoft Store add-on via Digital Goods API) ----------
const FREE_SCRIPTS = 2;
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'cuescroll_pro';
const PRO_IDS = [PRO_SKU];
const STORE_URL = 'https://apps.microsoft.com/search?query=CueScroll';
let proAvailable = false; // Pro limits apply only when the Store actually sells the add-on
let proSku = PRO_SKU;
let isPro = false;
try { isPro = localStorage.getItem('cuescroll-pro') === '1'; } catch (_) {}
const unlocked = () => isPro || !proAvailable;

async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}

function setPro(v) {
  isPro = v;
  try { localStorage.setItem('cuescroll-pro', v ? '1' : '0'); } catch (_) {}
  const b = $('proBtn');
  b.textContent = v ? '★ Pro' : '★ Get Pro';
  b.classList.toggle('is-pro', v);
  b.hidden = !proAvailable && !v;
  const badge = unlocked() ? '' : '<span class="badge">PRO</span>';
  $('recBtn').innerHTML = (recorder ? '■ Stop' : '● Record') + (recorder ? '' : badge);
  $('floatBtn').innerHTML = '⧉ Float' + badge;
}

async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    proAvailable = details.length > 0;
    if (details[0]) { proSku = details[0].itemId; if (!PRO_IDS.includes(proSku)) PRO_IDS.push(proSku); }
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    setPro(owned);
    return owned;
  } catch (_) { return isPro; }
}

function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }

async function openPro(reason) {
  if (playing) pause();
  if (pipWin) pipWin.close(); // the dialog lives in the main window
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  proMessage(reason || '');
  const svc = await billing();
  if (!svc) {
    $('buyBtn').textContent = 'Get CueScroll on Microsoft Store';
    $('restoreBtn').hidden = true;
  } else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}

async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); }
    catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkPro()) {
    proMessage('Thank you! Pro is unlocked. ★');
    setTimeout(() => $('proDialog').close(), 1500);
  }
}

function needsPro(feature) {
  if (unlocked()) return false;
  openPro(`This needs Pro: ${feature}.`);
  return true;
}

// ---------- data ----------
const SAMPLE = `Welcome to CueScroll.

Paste your own script here, then press "Start prompter".

Press Space to play or pause. Use the up and down arrows to change the speed while you read, and the left and right arrows to jump back or ahead.

Look at the camera, not at the keyboard. Keep your sentences short. Breathe at every full stop.

When you are ready, delete this text and write your own. Good luck with your recording!`;

const DEFAULTS = { speed: 20, size: 64, width: 80, lh: 1.5, align: 'left', theme: 'white', mirrorH: false, mirrorV: false, guide: true, countdown: 3 };
let scripts = [];
let currentId = null;
let settings = { ...DEFAULTS };

function load() {
  try {
    const d = JSON.parse(localStorage.getItem('cuescroll-v1') || 'null');
    if (d && Array.isArray(d.scripts) && d.scripts.length) {
      scripts = d.scripts;
      currentId = d.currentId;
      settings = { ...DEFAULTS, ...(d.settings || {}) };
    }
  } catch (_) {}
  if (!scripts.length) scripts = [{ id: Date.now(), title: 'My first script', text: SAMPLE }];
  if (!scripts.some((s) => s.id === currentId)) currentId = scripts[0].id;
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('cuescroll-v1', JSON.stringify({ scripts, currentId, settings })); } catch (_) {}
  }, 250);
}

const current = () => scripts.find((s) => s.id === currentId);
const countWords = (t) => (t.trim().match(/\S+/g) || []).length;
const fmtTime = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

// ---------- editor ----------
function renderList() {
  const ul = $('scriptList');
  ul.textContent = '';
  scripts.forEach((s) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = s.title.trim() || 'Untitled';
    b.className = s.id === currentId ? 'on' : '';
    b.onclick = () => { currentId = s.id; showScript(); save(); };
    li.append(b);
    ul.append(li);
  });
}

function showStats() {
  const w = countWords($('text').value);
  $('stats').textContent = `${w} word${w === 1 ? '' : 's'}` + (w ? ` · about ${fmtTime(w / 150 * 60)} at a natural pace` : '');
  $('start').disabled = !w;
}

function showScript() {
  const s = current();
  $('title').value = s.title;
  $('text').value = s.text;
  renderList();
  showStats();
}

function addScript(title, text) {
  if (scripts.length >= FREE_SCRIPTS && needsPro(`more than ${FREE_SCRIPTS} scripts`)) return;
  const s = { id: Date.now(), title, text };
  scripts.unshift(s);
  currentId = s.id;
  showScript();
  save();
  $('text').focus();
}

function bindSetting(id, key, fmt, isNum) {
  const el = $(id);
  const apply = () => {
    if (el.type === 'checkbox') el.checked = settings[key]; else el.value = settings[key];
    if (fmt) $(id + 'Val').textContent = fmt(settings[key]);
  };
  apply();
  el.addEventListener('input', () => {
    settings[key] = el.type === 'checkbox' ? el.checked : (isNum ? Number(el.value) : el.value);
    if (fmt) $(id + 'Val').textContent = fmt(settings[key]);
    save();
    if (!$('stage').hidden) layout(true);
  });
  return apply;
}

// ---------- prompter ----------
const stage = $('stage');
stageEl = stage;
const scroller = $('scroller');
let y = 0; // current translateY of the text, px
let startY = 0;
let endY = 0;
let playing = false;
let lastT = 0;
let elapsed = 0;
let counting = 0;
let idleTimer = 0;
let pipWin = null;
let recorder = null;
let syncers = [];

const stageWin = () => stage.ownerDocument.defaultView || window;
const pxPerSec = () => settings.speed * settings.size * settings.lh * 0.02; // speed 50 = one line per second

function layout(keepProgress) {
  const h = stage.clientHeight;
  const w = stage.clientWidth;
  const progress = endY !== startY ? (y - startY) / (endY - startY) : 0;
  stage.className = `stage t-${settings.theme}` + (stage.classList.contains('idle') ? ' idle' : '') + (stage.classList.contains('has-cam') ? ' has-cam' : '');
  const size = Math.max(14, Math.round(settings.size * Math.min(1, w / 900))); // shrink in a small floating window
  scroller.style.fontSize = size + 'px';
  scroller.style.lineHeight = settings.lh;
  scroller.style.width = Math.round(w * settings.width / 100) + 'px';
  scroller.style.textAlign = settings.align;
  $('flip').className = 'flip' + (settings.mirrorH ? ' mh' : '') + (settings.mirrorV ? ' mv' : '');
  $('guideLine').hidden = !settings.guide;
  startY = Math.round(h * 0.38 - size * settings.lh / 2); // first line sits on the guide
  const pad = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
  endY = startY - (scroller.offsetHeight - pad);
  y = keepProgress ? startY + progress * (endY - startY) : startY;
  draw();
}

function draw() {
  scroller.style.transform = `translate(-50%, ${y.toFixed(1)}px)`;
  const remain = (y - endY) / pxPerSec();
  $('clock').textContent = `${fmtTime(elapsed)} · −${fmtTime(remain)}`;
  $('barSpeed').textContent = settings.speed;
}

function tick(t) {
  if (!playing) return;
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  elapsed += dt;
  y -= pxPerSec() * dt;
  if (y <= endY) { y = endY; draw(); pause(); toast('End of script'); return; }
  draw();
  stageWin().requestAnimationFrame(tick);
}

function reallyPlay() {
  playing = true;
  $('play').textContent = '❚❚';
  lastT = stageWin().performance.now();
  stageWin().requestAnimationFrame(tick);
  wake();
}

function play() {
  if (playing || counting) return;
  if (y <= endY) { y = startY; elapsed = 0; }
  if (y === startY && settings.countdown > 0) {
    let n = settings.countdown;
    const c = $('count');
    c.hidden = false;
    c.textContent = n;
    counting = setInterval(() => {
      n -= 1;
      if (n <= 0) { stopCount(); reallyPlay(); } else c.textContent = n;
    }, 1000);
    return;
  }
  reallyPlay();
}

function stopCount() { clearInterval(counting); counting = 0; $('count').hidden = true; }

function pause() {
  stopCount();
  playing = false;
  $('play').textContent = '▶';
  stage.classList.remove('idle');
}

function toggle() { if (playing || counting) pause(); else play(); }

function nudge(lines) {
  y = Math.max(endY, Math.min(startY, y - lines * parseFloat(scroller.style.fontSize) * settings.lh));
  draw();
}

function setSpeed(d) { settings.speed = Math.max(1, Math.min(100, settings.speed + d)); syncers.forEach((f) => f()); draw(); save(); }
function setSize(d) { settings.size = Math.max(24, Math.min(140, settings.size + d)); syncers.forEach((f) => f()); layout(true); save(); }
function setMirror() { settings.mirrorH = !settings.mirrorH; syncers.forEach((f) => f()); layout(true); save(); }

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function wake() {
  stage.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (playing) stage.classList.add('idle'); }, 2500);
}

function openStage() {
  const s = current();
  if (!countWords(s.text)) return;
  scroller.textContent = s.text.replace(/\r\n?/g, '\n').trim();
  stage.hidden = false;
  $('editor').hidden = true;
  elapsed = 0;
  layout(false);
  wake();
}

async function closeStage() {
  pause();
  await stopRecording();
  if (pipWin) pipWin.close();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  stage.hidden = true;
  $('editor').hidden = false;
}

function onKey(e) {
  if (stage.hidden || $('proDialog').open) return;
  const k = e.key;
  const map = {
    ' ': toggle, ArrowUp: () => setSpeed(1), ArrowDown: () => setSpeed(-1),
    ArrowLeft: () => nudge(-2), ArrowRight: () => nudge(2), PageUp: () => nudge(-8), PageDown: () => nudge(8),
    Home: () => { pause(); y = startY; elapsed = 0; draw(); },
    '+': () => setSize(4), '=': () => setSize(4), '-': () => setSize(-4),
    m: setMirror, M: setMirror, f: fullscreen, F: fullscreen,
    Escape: () => { if (!stage.ownerDocument.fullscreenElement) closeStage(); },
  };
  if (map[k]) { e.preventDefault(); map[k](); wake(); }
}

function fullscreen() {
  const d = stage.ownerDocument;
  if (d.fullscreenElement) d.exitFullscreen(); else stage.requestFullscreen().catch(() => toast('Fullscreen is not available here'));
}

// ---------- Pro: webcam recording ----------
async function startRecording() {
  if (needsPro('webcam recording')) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Recording is not supported on this device'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true }); }
  catch (e) { toast(e && e.name === 'NotFoundError' ? 'No camera or microphone found' : 'Camera access was blocked – allow it and try again'); return; }
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const chunks = [];
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const type = (rec.mimeType || 'video/webm').split(';')[0];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type }));
    a.download = `${(current().title.trim() || 'recording').replace(/[\\/:*?"<>|]+/g, ' ')}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`Saved ${a.download} to your Downloads folder`);
  };
  const cam = $('cam');
  cam.srcObject = stream;
  cam.hidden = false;
  cam.play().catch(() => {});
  stage.classList.add('has-cam');
  rec.start(1000);
  recorder = rec;
  $('recBtn').classList.add('rec-on');
  setPro(isPro);
  toast('Recording… press Space to start scrolling');
}

function stopRecording() {
  if (!recorder) return Promise.resolve();
  const rec = recorder;
  recorder = null;
  return new Promise((done) => {
    rec.addEventListener('stop', done, { once: true });
    rec.stop();
    const cam = $('cam');
    cam.hidden = true;
    cam.srcObject = null;
    stage.classList.remove('has-cam');
    $('recBtn').classList.remove('rec-on');
    setPro(isPro);
  });
}

// ---------- Pro: always-on-top floating window ----------
async function floatWindow() {
  if (pipWin) { pipWin.close(); return; }
  if (needsPro('the floating window')) return;
  if (!('documentPictureInPicture' in window)) { toast('Floating window needs a newer version of Microsoft Edge'); return; }
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  const wasPlaying = playing;
  pause();
  let w;
  try { w = await window.documentPictureInPicture.requestWindow({ width: 560, height: 360 }); }
  catch (_) { toast('Could not open the floating window'); return; }
  pipWin = w;
  const css = w.document.createElement('style'); // copy our rules synchronously so the first layout is correct
  css.textContent = [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].map((r) => r.cssText).join('\n'); } catch (_) { return ''; } }).join('\n');
  w.document.head.append(css);
  w.document.title = 'CueScroll';
  w.document.body.append(stage);
  w.document.addEventListener('keydown', onKey);
  w.addEventListener('resize', () => layout(true));
  w.addEventListener('pagehide', () => {
    pause();
    pipWin = null;
    document.body.insertBefore(stage, $('proDialog'));
    layout(true);
  }, { once: true });
  layout(true);
  if (wasPlaying) reallyPlay();
}

// ---------- wiring ----------
load();
syncers = [
  bindSetting('speed', 'speed', (v) => v, true),
  bindSetting('size', 'size', (v) => v + ' px', true),
  bindSetting('width', 'width', (v) => v + '%', true),
  bindSetting('lh', 'lh', (v) => Number(v).toFixed(1), true),
  bindSetting('align', 'align'),
  bindSetting('theme', 'theme'),
  bindSetting('countdown', 'countdown', null, true),
  bindSetting('mirrorH', 'mirrorH'),
  bindSetting('mirrorV', 'mirrorV'),
  bindSetting('guide', 'guide'),
];
showScript();
setPro(isPro);

$('title').addEventListener('input', () => { current().title = $('title').value; renderList(); save(); });
$('text').addEventListener('input', () => { current().text = $('text').value; showStats(); save(); });
$('newScript').onclick = () => addScript('New script', '');
$('delScript').onclick = () => {
  if (!confirm(`Delete "${current().title.trim() || 'Untitled'}"?`)) return;
  scripts = scripts.filter((s) => s.id !== currentId);
  if (!scripts.length) scripts = [{ id: Date.now(), title: 'New script', text: '' }];
  currentId = scripts[0].id;
  showScript();
  save();
};
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const text = await f.text();
  addScript(f.name.replace(/\.[^.]+$/, '').slice(0, 80), text);
});

$('start').onclick = openStage;
$('exit').onclick = closeStage;
$('play').onclick = toggle;
$('restart').onclick = () => { pause(); y = startY; elapsed = 0; draw(); };
$('slower').onclick = () => setSpeed(-1);
$('faster').onclick = () => setSpeed(1);
$('smaller').onclick = () => setSize(-4);
$('bigger').onclick = () => setSize(4);
$('mirrorBtn').onclick = setMirror;
$('fsBtn').onclick = fullscreen;
$('recBtn').onclick = () => (recorder ? stopRecording() : startRecording());
$('floatBtn').onclick = floatWindow;
stage.addEventListener('mousemove', wake);
stage.addEventListener('wheel', (e) => { e.preventDefault(); nudge(e.deltaY / 60); wake(); }, { passive: false });
$('flip').addEventListener('click', () => { toggle(); wake(); });
document.addEventListener('keydown', onKey);
window.addEventListener('resize', () => { if (!stage.hidden && !pipWin) layout(true); });
document.addEventListener('fullscreenchange', () => { if (!stage.hidden) layout(true); });

$('proBtn').onclick = () => { if (!isPro) openPro(); };
$('buyBtn').onclick = buyPro;
$('restoreBtn').onclick = async () => { proMessage((await checkPro()) ? 'Pro restored. ★' : 'No Pro purchase found on this Microsoft account.'); };
$('closePro').onclick = () => $('proDialog').close();

checkPro();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
