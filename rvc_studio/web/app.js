/* RVC Studio front-end — vanilla JS, no build step. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = (p) => p; // same-origin; works behind any proxy

const state = {
  convFiles: [],
  dsFiles: [],
  models: [],
  datasets: [],
  polling: false,
  recorder: null,
  recChunks: [],
  recTimer: null,
};

/* ------------------------------------------------------------------ utils */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4200);
}
const fmtSize = (b) => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' KB';
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function jget(url) {
  const r = await fetch(api(url));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}
async function jpost(url, body, method = 'POST') {
  const r = await fetch(api(url), { method, body });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

/* --------------------------------------------------------------- navigation */
$$('.nav-item').forEach(b => b.onclick = () => {
  $$('.nav-item').forEach(x => x.classList.remove('active'));
  $$('.view').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $('#view-' + b.dataset.view).classList.add('active');
  if (b.dataset.view === 'library') loadOutputs();
  if (b.dataset.view === 'models') loadModels();
  if (b.dataset.view === 'train') loadDatasets();
});

/* ------------------------------------------------------------------ health */
async function loadHealth() {
  try {
    const h = await jget('/api/health');
    const e = h.engine;
    $('#brandStatus').textContent = e.gpu ? 'GPU ready' : `${e.backend} · CPU`;
    $('#sysInfo').innerHTML = `
      <div><b>Engine</b> ${e.backend}${e.real_clone ? '' : ' (DSP)'}</div>
      <div><b>Device</b> ${e.device}</div>
      <div><b>Training</b> ${h.training_backend}</div>
      <div><b>Sample rate</b> ${(e.target_sr / 1000).toFixed(0)} kHz</div>
      <div><b>ffmpeg</b> ${h.ffmpeg ? 'yes' : 'no'}</div>`;
    if (!e.real_clone) {
      toast('No GPU RVC runtime detected — running the portable DSP engine.', '');
    }
  } catch (err) { $('#brandStatus').textContent = 'offline'; }
}

/* ------------------------------------------------------------------ models */
async function loadModels() {
  try {
    const { models } = await jget('/api/models');
    state.models = models;
    const sel = $('#modelSelect');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— no model (process only) —</option>' +
      models.map(m => `<option value="${m.name}">${m.name}${m.has_index ? ' ✓index' : ''}</option>`).join('');
    if (cur) sel.value = cur;

    $('#modelList').innerHTML = models.length ? models.map(m => `
      <div class="item">
        <div>
          <div class="name">${m.name}</div>
          <div class="meta">${m.size_mb} MB · ${m.source}
            ${m.profile?.f0_median_hz ? ` · F0 ${m.profile.f0_median_hz} Hz (${m.profile.voice_guess})` : ''}</div>
        </div>
        <div class="actions">
          ${m.has_weights ? '<span class="tag ok">weights</span>' : '<span class="tag warn">no weights</span>'}
          ${m.has_index ? '<span class="tag ok">index</span>' : ''}
          <a class="btn small ghost" href="/api/models/${encodeURIComponent(m.name)}/export">Export</a>
          <button class="btn small danger" data-del="${m.name}">Delete</button>
        </div>
      </div>`).join('') : '<div class="empty">No models yet — import one on the right.</div>';

    $$('[data-del]', $('#modelList')).forEach(b => b.onclick = async () => {
      if (!confirm(`Delete model "${b.dataset.del}"?`)) return;
      await jpost(`/api/models/${encodeURIComponent(b.dataset.del)}`, null, 'DELETE');
      toast('Model deleted', 'ok'); loadModels();
    });
  } catch (e) { toast(e.message, 'err'); }
}

$('#impFileBtn').onclick = async () => {
  const name = $('#impName').value.trim(), f = $('#impFile').files[0];
  if (!name || !f) return toast('Name and file are required', 'err');
  const fd = new FormData(); fd.append('name', name); fd.append('file', f);
  $('#impFileBtn').disabled = true;
  try { await jpost('/api/models/import-file', fd); toast('Model imported', 'ok'); loadModels(); }
  catch (e) { toast(e.message, 'err'); }
  finally { $('#impFileBtn').disabled = false; }
};

$('#impUrlBtn').onclick = async () => {
  const name = $('#urlName').value.trim(), url = $('#urlValue').value.trim();
  if (!name || !url) return toast('Name and URL are required', 'err');
  const fd = new FormData(); fd.append('name', name); fd.append('url', url);
  $('#impUrlBtn').disabled = true;
  try { await jpost('/api/models/import-url', fd); toast('Model downloaded', 'ok'); loadModels(); }
  catch (e) { toast(e.message, 'err'); }
  finally { $('#impUrlBtn').disabled = false; }
};

/* -------------------------------------------------------------- dropzones */
function wireDrop(zoneSel, inputSel, listSel, bucket, after) {
  const zone = $(zoneSel), input = $(inputSel);
  zone.onclick = () => input.click();
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
  zone.ondragleave = () => zone.classList.remove('over');
  zone.ondrop = (e) => {
    e.preventDefault(); zone.classList.remove('over');
    add([...e.dataTransfer.files]);
  };
  input.onchange = () => add([...input.files]);

  function add(files) {
    state[bucket].push(...files);
    render();
    after && after();
  }
  function render() {
    $(listSel).innerHTML = state[bucket].map((f, i) => `
      <div class="file-row"><span>♪</span><span>${f.name}</span>
        <span class="size">${fmtSize(f.size)}</span>
        <button data-i="${i}">×</button></div>`).join('');
    $$('button[data-i]', $(listSel)).forEach(b => b.onclick = () => {
      state[bucket].splice(+b.dataset.i, 1); render();
    });
  }
  return render;
}
const renderConvFiles = wireDrop('#convDrop', '#convFiles', '#fileList', 'convFiles', analyzeFirst);
wireDrop('#dsDrop', '#dsFiles', '#dsFileList', 'dsFiles');

/* -------------------------------------------------------------- recording */
$('#recBtn').onclick = async () => {
  if (state.recorder && state.recorder.state === 'recording') {
    state.recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    state.recorder = rec; state.recChunks = [];
    rec.ondataavailable = (e) => state.recChunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(state.recTimer); $('#recTime').textContent = '';
      $('#recBtn').textContent = '● Record from microphone';
      const blob = new Blob(state.recChunks, { type: 'audio/webm' });
      const file = new File([blob], `mic_${Date.now()}.webm`, { type: 'audio/webm' });
      state.convFiles.push(file); renderConvFiles(); analyzeFirst();
      toast('Recording added', 'ok');
    };
    rec.start();
    let t = 0;
    state.recTimer = setInterval(() => { t++; $('#recTime').textContent = fmtDur(t); }, 1000);
    $('#recBtn').textContent = '■ Stop recording';
  } catch (e) { toast('Microphone unavailable: ' + e.message, 'err'); }
};

/* --------------------------------------------------------------- analysis */
async function analyzeFirst() {
  const f = state.convFiles[0];
  if (!f) { $('#analysisCard').hidden = true; return; }
  const fd = new FormData();
  fd.append('file', f);
  if ($('#modelSelect').value) fd.append('model', $('#modelSelect').value);
  try {
    const { report, suggested_pitch } = await jpost('/api/analyze', fd);
    $('#analysisCard').hidden = false;
    $('#analysisStats').innerHTML = `
      <div class="stat"><div class="k">Duration</div><div class="v">${fmtDur(report.duration_s)}</div></div>
      <div class="stat"><div class="k">Pitch</div><div class="v">${report.f0_median_hz || '—'} Hz</div></div>
      <div class="stat"><div class="k">Voice</div><div class="v">${report.voice_guess}</div></div>
      <div class="stat"><div class="k">Level</div><div class="v">${report.rms_db} dB</div></div>
      <div class="stat"><div class="k">Silence</div><div class="v">${report.silence_pct}%</div></div>
      <div class="stat"><div class="k">Clipping</div><div class="v">${report.clipping_pct}%</div></div>`;
    $('#analysisWarn').innerHTML = report.warnings.length
      ? report.warnings.map(w => `<div class="notice warn">⚠ ${w}</div>`).join('')
      : '<div class="notice ok">✓ Input looks clean.</div>';
    if (suggested_pitch !== null && suggested_pitch !== undefined) {
      $('#autoPitchBtn').dataset.suggest = suggested_pitch;
      $('#autoPitchBtn').textContent = `auto ✦ ${suggested_pitch > 0 ? '+' : ''}${suggested_pitch}`;
    }
  } catch (e) { toast(e.message, 'err'); }
}
$('#modelSelect').onchange = () => { analyzeFirst(); };

/* ----------------------------------------------------------------- sliders */
[['pitch', '#pitchOut'], ['index_rate', '#indexOut'], ['protect', '#protectOut'],
 ['rms_mix_rate', '#rmsOut'], ['filter_radius', '#frOut'],
 ['epochs', '#epochsOut'], ['batch_size', '#bsOut']].forEach(([id, out]) => {
  const el = $('#' + id); if (!el) return;
  el.oninput = () => $(out).textContent = el.value;
});
$$('.chip[data-pitch]').forEach(c => c.onclick = () => {
  $('#pitch').value = c.dataset.pitch; $('#pitchOut').textContent = c.dataset.pitch;
});
$('#autoPitchBtn').onclick = () => {
  const s = $('#autoPitchBtn').dataset.suggest;
  if (s === undefined) return toast('Pick a model and upload audio first', 'err');
  $('#pitch').value = s; $('#pitchOut').textContent = s;
  toast(`Pitch set to ${s > 0 ? '+' : ''}${s} semitones from measurement`, 'ok');
};

/* ----------------------------------------------------------------- convert */
$('#convertBtn').onclick = async () => {
  if (!state.convFiles.length) return toast('Add at least one audio file', 'err');
  const fd = new FormData();
  state.convFiles.forEach(f => fd.append('files', f));
  fd.append('model', $('#modelSelect').value);
  ['pitch', 'index_rate', 'filter_radius', 'rms_mix_rate', 'protect', 'f0_method',
   'output_format'].forEach(k => fd.append(k, $('#' + k).value));
  fd.append('denoise', $('#denoise').checked);
  fd.append('trim_silence', $('#trim_silence').checked);

  $('#convertBtn').disabled = true;
  try {
    const { jobs } = await jpost('/api/convert', fd);
    toast(`${jobs.length} conversion job(s) queued`, 'ok');
    startPolling(jobs.map(j => j.id));
  } catch (e) { toast(e.message, 'err'); }
  finally { $('#convertBtn').disabled = false; }
};

/* ---------------------------------------------------------------- datasets */
async function loadDatasets() {
  try {
    const { datasets } = await jget('/api/datasets');
    state.datasets = datasets;
    const sel = $('#dsSelect');
    sel.innerHTML = datasets.map(d => `<option value="${d.name}">${d.name} (${d.clips} clips)</option>`).join('')
      || '<option value="">no datasets yet</option>';
    $('#dsList').innerHTML = datasets.length ? datasets.map(d => `
      <div class="item">
        <div>
          <div class="name">${d.name}</div>
          <div class="meta">${d.clips || 0} clips · ${fmtDur(d.total_seconds || 0)}
            ${d.grade ? ` · <span class="tag ${d.quality_score >= 70 ? 'ok' : 'warn'}">${d.grade} ${d.quality_score}</span>` : ''}</div>
        </div>
        <div class="actions"><button class="btn small danger" data-dsdel="${d.name}">Delete</button></div>
      </div>`).join('') : '<div class="empty">No datasets yet.</div>';
    $$('[data-dsdel]').forEach(b => b.onclick = async () => {
      await jpost(`/api/datasets/${encodeURIComponent(b.dataset.dsdel)}`, null, 'DELETE');
      toast('Dataset deleted', 'ok'); loadDatasets();
    });
    if (sel.value) loadReco(sel.value);
  } catch (e) { /* silent */ }
}
$('#dsSelect').onchange = (e) => loadReco(e.target.value);

async function loadReco(name) {
  if (!name) return;
  try {
    const { recommended } = await jget(`/api/datasets/${encodeURIComponent(name)}/recommend`);
    $('#recoBox').classList.remove('hidden');
    $('#recoBox').innerHTML = `<b>Recommended:</b> ${recommended.epochs} epochs · batch ${recommended.batch_size}
      · ~${recommended.estimated_minutes_gpu} min on GPU<br><span style="color:var(--tx3)">${recommended.rationale}</span>`;
    $('#epochs').value = recommended.epochs; $('#epochsOut').textContent = recommended.epochs;
    $('#batch_size').value = recommended.batch_size; $('#bsOut').textContent = recommended.batch_size;
  } catch (e) { $('#recoBox').classList.add('hidden'); }
}

$('#prepBtn').onclick = async () => {
  const name = $('#dsName').value.trim();
  if (!name) return toast('Dataset name required', 'err');
  if (!state.dsFiles.length) return toast('Add recordings first', 'err');
  const fd = new FormData();
  fd.append('name', name);
  state.dsFiles.forEach(f => fd.append('files', f));
  fd.append('denoise', $('#dsDenoise').checked);
  fd.append('trim', $('#dsTrim').checked);
  $('#prepBtn').disabled = true;
  try {
    const { job } = await jpost('/api/datasets/prepare', fd);
    toast('Dataset preparation queued', 'ok');
    startPolling([job.id], loadDatasets);
  } catch (e) { toast(e.message, 'err'); }
  finally { $('#prepBtn').disabled = false; }
};

$('#trainBtn').onclick = async () => {
  const ds = $('#dsSelect').value, name = $('#trainModelName').value.trim();
  if (!ds) return toast('Prepare a dataset first', 'err');
  if (!name) return toast('Give the new model a name', 'err');
  const fd = new FormData();
  fd.append('model_name', name); fd.append('dataset', ds);
  fd.append('epochs', $('#epochs').value);
  fd.append('batch_size', $('#batch_size').value);
  fd.append('save_every', Math.max(10, Math.floor($('#epochs').value / 10)));
  $('#trainBtn').disabled = true;
  try {
    const { job } = await jpost('/api/train', fd);
    toast('Training started — follow it in Jobs', 'ok');
    startPolling([job.id], loadModels);
  } catch (e) { toast(e.message, 'err'); }
  finally { $('#trainBtn').disabled = false; }
};

/* -------------------------------------------------------------------- jobs */
function jobCard(j) {
  const log = (j.log || []).slice(-14).join('\n');
  const out = j.result?.output ? j.result.output.split('/').pop() : null;
  return `<div class="job">
    <div class="job-head">
      <span class="name">${j.title}</span>
      <span class="status ${j.status}">${j.status}</span>
    </div>
    <div class="bar"><i style="width:${Math.round((j.progress || 0) * 100)}%"></i></div>
    <div class="job-msg">${j.message} · ${j.elapsed || 0}s
      ${j.error ? `<span style="color:var(--err)"> · ${j.error}</span>` : ''}</div>
    ${out ? `<audio controls src="/api/outputs/${encodeURIComponent(out)}"></audio>
      <div style="margin-top:6px"><a class="btn small" href="/api/outputs/${encodeURIComponent(out)}?download=true">Download ${out}</a></div>` : ''}
    ${j.result?.stats ? `<div class="reco">Dataset: ${j.result.stats.clips} clips · ${fmtDur(j.result.stats.total_seconds)}
      · quality <b>${j.result.stats.grade} (${j.result.stats.quality_score}/100)</b><br>${(j.result.stats.tips || []).join('<br>')}</div>` : ''}
    ${log ? `<div class="job-log">${log}</div>` : ''}
    ${['queued', 'running'].includes(j.status) ? `<button class="btn small ghost" data-cancel="${j.id}" style="margin-top:8px">Cancel</button>` : ''}
  </div>`;
}

async function refreshJobs() {
  try {
    const { jobs } = await jget('/api/jobs');
    const active = jobs.filter(j => ['queued', 'running'].includes(j.status)).length;
    $('#jobBadge').textContent = active;
    $('#jobBadge').classList.toggle('hidden', active === 0);
    $('#jobList').innerHTML = jobs.length ? jobs.map(jobCard).join('')
      : '<div class="empty">No jobs yet.</div>';
    $$('[data-cancel]').forEach(b => b.onclick = async () => {
      await jpost(`/api/jobs/${b.dataset.cancel}/cancel`, new FormData());
      toast('Cancel requested');
    });
    const conv = jobs.filter(j => j.kind === 'convert').slice(0, 6);
    if (conv.length) {
      $('#convResults').hidden = false;
      $('#convResultList').innerHTML = conv.map(jobCard).join('');
    }
    return jobs;
  } catch (e) { return []; }
}

function startPolling(ids = [], onDone) {
  if (state.polling) return;
  state.polling = true;
  const tick = async () => {
    const jobs = await refreshJobs();
    const watched = ids.length ? jobs.filter(j => ids.includes(j.id)) : jobs;
    const busy = watched.some(j => ['queued', 'running'].includes(j.status));
    if (busy) { setTimeout(tick, 900); }
    else {
      state.polling = false;
      onDone && onDone();
      loadOutputs();
      const failed = watched.filter(j => j.status === 'error');
      if (failed.length) toast(failed[0].error || 'A job failed', 'err');
      else if (watched.length) toast('All jobs finished', 'ok');
    }
  };
  tick();
}

$('#clearJobs').onclick = async () => {
  await jpost('/api/jobs/clear', new FormData());
  refreshJobs(); toast('Cleared', 'ok');
};

/* ----------------------------------------------------------------- outputs */
async function loadOutputs() {
  try {
    const { outputs } = await jget('/api/outputs');
    $('#outputList').innerHTML = outputs.length ? outputs.map(o => `
      <div class="item" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;gap:10px">
          <div><div class="name">${o.name}</div><div class="meta">${o.size_mb} MB</div></div>
          <div class="actions">
            <a class="btn small" href="${o.url}?download=true">Download</a>
            <button class="btn small danger" data-odel="${o.name}">Delete</button>
          </div>
        </div>
        <audio controls src="${o.url}"></audio>
      </div>`).join('') : '<div class="empty">Nothing converted yet.</div>';
    $$('[data-odel]').forEach(b => b.onclick = async () => {
      await jpost(`/api/outputs/${encodeURIComponent(b.dataset.odel)}`, null, 'DELETE');
      loadOutputs(); toast('Deleted', 'ok');
    });
  } catch (e) { /* silent */ }
}

/* -------------------------------------------------------------------- boot */
loadHealth(); loadModels(); loadDatasets(); refreshJobs(); loadOutputs();
setInterval(refreshJobs, 5000);
