import { toDng, toJpeg, RAW_EXT } from './converter.js';

const $ = (id) => document.getElementById(id);
const list = $('list'), bar = $('bar'), zipBtn = $('zip');
const items = [];
let busy = false;

const fmt = () => document.querySelector('input[name=fmt]:checked').value;
const sizeStr = (b) => b > 1e6 ? (b / 1e6).toFixed(1) + ' Mo' : Math.round(b / 1e3) + ' Ko';

document.querySelectorAll('input[name=fmt]').forEach((r) => r.addEventListener('change', () => {
  $('quality').classList.toggle('on', fmt() === 'jpg');
}));
$('q').addEventListener('input', () => { $('qv').textContent = $('q').value + ' %'; });

$('file').accept = RAW_EXT.map((e) => '.' + e).join(',');
$('file').addEventListener('change', (e) => { add(e.target.files); e.target.value = ''; });

const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => add(e.dataTransfer.files));
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

function add(files) {
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    const it = { file, format: fmt(), quality: $('q').value / 100, state: 'wait', el: document.createElement('li') };
    it.el.className = 'item';
    items.push(it);
    list.append(it.el);
    if (!RAW_EXT.includes(ext)) { it.state = 'error'; it.error = 'Ce fichier n’est pas un RAW reconnu.'; }
    render(it);
  }
  refresh();
  run();
}

function render(it) {
  const ext = it.format.toUpperCase();
  const el = it.el;
  el.className = 'item ' + it.state;
  let right = '', meta = '';
  if (it.state === 'wait') { meta = `${sizeStr(it.file.size)} · en attente → ${ext}`; }
  if (it.state === 'work') { meta = it.step || 'Conversion…'; right = '<div class="spin" aria-label="En cours"></div>'; }
  if (it.state === 'done') {
    const cam = it.result.meta ? `${it.result.meta.camera_make || ''} ${it.result.meta.camera_model || ''}`.trim() : '';
    meta = `${it.result.name} · ${sizeStr(it.result.blob.size)}${cam ? ' · ' + cam : ''}`;
    right = `<a class="btn" href="${it.url}" download="${it.result.name}">Télécharger</a>`;
  }
  if (it.state === 'error') meta = it.error;
  el.innerHTML = `<div class="badge">${it.state === 'error' ? '!' : ext}</div>
    <div class="info"><div class="name"></div><div class="meta"></div></div>${right}`;
  el.querySelector('.name').textContent = it.file.name;
  el.querySelector('.meta').textContent = meta;
}

function refresh() {
  bar.classList.toggle('on', items.length > 0);
  const done = items.filter((i) => i.state === 'done').length;
  $('count').textContent = `${done}/${items.length} converti${done > 1 ? 's' : ''}`;
  zipBtn.disabled = done < 2 || busy;
  zipBtn.style.display = items.length > 1 ? '' : 'none';
}

async function run() {
  if (busy) return;
  busy = true;
  for (let it; (it = items.find((i) => i.state === 'wait'));) {
    it.state = 'work'; render(it);
    const onStep = (s) => { it.step = s; render(it); };
    try {
      it.result = it.format === 'dng' ? await toDng(it.file, onStep) : await toJpeg(it.file, { quality: it.quality }, onStep);
      it.url = URL.createObjectURL(it.result.blob);
      it.state = 'done';
    } catch (e) {
      console.error(e);
      it.state = 'error';
      const msg = String(e?.message || e);
      it.error = /X-Trans|Bayer|Motif/.test(msg)
        ? msg + ' — essayez le format JPG.'
        : 'Conversion impossible : ' + (/memory|Memory|alloc/.test(msg) ? 'mémoire insuffisante sur cet appareil.' : msg);
    }
    render(it); refresh();
  }
  busy = false;
  refresh();
}

$('clear').addEventListener('click', () => {
  if (busy) return;
  items.splice(0).forEach((i) => i.url && URL.revokeObjectURL(i.url));
  list.innerHTML = '';
  refresh();
});

zipBtn.addEventListener('click', async () => {
  zipBtn.disabled = true; const label = zipBtn.innerHTML; zipBtn.textContent = 'Préparation…';
  try {
    const { zip } = await import('./fflate.js');
    const files = {}, used = new Set();
    for (const it of items.filter((i) => i.state === 'done')) {
      let n = it.result.name, k = 1;
      while (used.has(n)) n = it.result.name.replace(/(\.\w+)$/, `-${k++}$1`);
      used.add(n);
      files[n] = [new Uint8Array(await it.result.blob.arrayBuffer()), { level: 0 }];
    }
    const data = await new Promise((res, rej) => zip(files, (err, d) => err ? rej(err) : res(d)));
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([data], { type: 'application/zip' })), download: 'alpha-converter.zip' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (e) { alert('Impossible de créer le zip : ' + e.message); }
  zipBtn.innerHTML = label; refresh();
});
