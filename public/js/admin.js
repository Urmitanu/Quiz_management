'use strict';
/* Admin Panel – admin.js */

const $ = id => document.getElementById(id);

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
window.closeModal = closeModal;

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const res = await fetch('/api' + path, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'API error');
  return json;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function notify(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:999;min-width:250px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Teams ─────────────────────────────────────────────────────────────────────
let teamsList = [];

async function loadTeams() {
  teamsList = await api('GET', '/teams');
  renderTeams();
}

function renderTeams() {
  const tbody = $('teams-tbody');
  if (!teamsList.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem">No teams yet.</td></tr>';
    return;
  }
  tbody.innerHTML = teamsList.map(t => `
    <tr class="${t.is_eliminated ? 'eliminated' : ''}">
      <td>${t.id}</td>
      <td>${escHtml(t.name)}</td>
      <td>${t.score}</td>
      <td>${t.is_eliminated ? '<span class="badge badge-danger">Eliminated</span>' : '<span class="badge badge-success">Active</span>'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editTeam(${t.id})">✏ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTeam(${t.id})">🗑 Delete</button>
      </td>
    </tr>`).join('');
}

$('btn-add-team').addEventListener('click', () => {
  $('team-modal-title').textContent = 'Add Team';
  $('edit-team-id').value           = '';
  $('team-name-input').value        = '';
  openModal('team-modal');
});

window.editTeam = function(id) {
  const t = teamsList.find(x => x.id === id);
  if (!t) return;
  $('team-modal-title').textContent = 'Edit Team';
  $('edit-team-id').value           = t.id;
  $('team-name-input').value        = t.name;
  openModal('team-modal');
};

window.deleteTeam = async function(id) {
  if (!confirm('Delete this team?')) return;
  try {
    await api('DELETE', `/teams/${id}`);
    notify('Team deleted.', 'danger');
    loadTeams();
  } catch (e) { notify(e.message, 'danger'); }
};

$('btn-save-team').addEventListener('click', async () => {
  const id   = $('edit-team-id').value;
  const name = $('team-name-input').value.trim();
  if (!name) return notify('Team name is required.', 'danger');
  try {
    if (id) {
      await api('PUT', `/teams/${id}`, { name });
      notify('Team updated!', 'success');
    } else {
      await api('POST', '/teams', { name });
      notify('Team added!', 'success');
    }
    closeModal('team-modal');
    loadTeams();
  } catch (e) { notify(e.message, 'danger'); }
});

// ── Questions ─────────────────────────────────────────────────────────────────
let questionsList = [];

async function loadQuestions() {
  const r = $('q-filter-round').value;
  const p = $('q-filter-phase').value;
  const params = new URLSearchParams();
  if (r) params.set('round', r);
  if (p) params.set('phase', p);
  questionsList = await api('GET', `/questions?${params}`);
  renderQuestions();
}

function diffTag(d) {
  const map = { easy:'tag-easy', medium:'tag-medium', hard:'tag-hard', expert:'tag-expert' };
  return `<span class="tag-diff ${map[d] || ''}">${d}</span>`;
}

function renderQuestions() {
  const list = $('questions-list');
  if (!questionsList.length) {
    list.innerHTML = '<p class="text-muted" style="padding:1rem;text-align:center">No questions found.</p>';
    return;
  }
  list.innerHTML = questionsList.map(q => `
    <div class="q-row">
      <span class="text-muted">${q.id}</span>
      <span class="tag-round">R${q.round}</span>
      <span class="tag-phase">P${q.phase}</span>
      ${diffTag(q.difficulty)}
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(q.question_text)}">${escHtml(q.question_text)}</span>
      <span>
        <button class="btn btn-ghost btn-sm" onclick="editQuestion(${q.id})">✏</button>
        <button class="btn btn-danger btn-sm" onclick="deleteQuestion(${q.id})">🗑</button>
      </span>
    </div>`).join('');
}

$('q-filter-round').addEventListener('change', loadQuestions);
$('q-filter-phase').addEventListener('change', loadQuestions);

$('btn-add-question').addEventListener('click', () => {
  $('q-modal-title').textContent = 'Add Question';
  $('edit-q-id').value           = '';
  ['q-round','q-phase','q-difficulty','q-text-input','q-opt-a','q-opt-b',
   'q-opt-c','q-opt-d','q-correct','q-media-url','q-media-type'].forEach(id => {
    const el = $(id);
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
  openModal('question-modal');
});

window.editQuestion = async function(id) {
  const q = await api('GET', `/questions/${id}`);
  $('q-modal-title').textContent = 'Edit Question';
  $('edit-q-id').value           = q.id;
  $('q-round').value             = q.round;
  $('q-phase').value             = q.phase;
  $('q-difficulty').value        = q.difficulty;
  $('q-text-input').value        = q.question_text;
  $('q-opt-a').value             = q.option_a || '';
  $('q-opt-b').value             = q.option_b || '';
  $('q-opt-c').value             = q.option_c || '';
  $('q-opt-d').value             = q.option_d || '';
  $('q-correct').value           = q.correct_answer || '';
  $('q-media-url').value         = q.media_url || '';
  $('q-media-type').value        = q.media_type || '';
  openModal('question-modal');
};

window.deleteQuestion = async function(id) {
  if (!confirm('Delete this question?')) return;
  try {
    await api('DELETE', `/questions/${id}`);
    notify('Question deleted.', 'danger');
    loadQuestions();
  } catch (e) { notify(e.message, 'danger'); }
};

$('btn-save-question').addEventListener('click', async () => {
  const id = $('edit-q-id').value;

  // Optional: upload media file first
  const mediaFile = $('q-media-file').files[0];
  let mediaUrl    = $('q-media-url').value.trim();
  let mediaType   = $('q-media-type').value;

  if (mediaFile) {
    try {
      const fd  = new FormData();
      fd.append('media', mediaFile);
      const res = await api('POST', '/upload', fd);
      mediaUrl  = res.url;
      // Auto-detect type from extension
      const ext = mediaFile.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) mediaType = 'image';
      else if (['mp3','wav','ogg','m4a','aac'].includes(ext))    mediaType = 'audio';
      else if (['mp4','webm','ogg','mov'].includes(ext))          mediaType = 'video';
    } catch (e) {
      return notify('Media upload failed: ' + e.message, 'danger');
    }
  }

  const payload = {
    round:          Number($('q-round').value),
    phase:          Number($('q-phase').value),
    difficulty:     $('q-difficulty').value,
    question_text:  $('q-text-input').value.trim(),
    option_a:       $('q-opt-a').value.trim() || null,
    option_b:       $('q-opt-b').value.trim() || null,
    option_c:       $('q-opt-c').value.trim() || null,
    option_d:       $('q-opt-d').value.trim() || null,
    correct_answer: $('q-correct').value || null,
    media_url:      mediaUrl || null,
    media_type:     mediaType || null,
  };

  if (!payload.question_text) return notify('Question text is required.', 'danger');

  try {
    if (id) {
      await api('PUT', `/questions/${id}`, payload);
      notify('Question updated!', 'success');
    } else {
      await api('POST', '/questions', payload);
      notify('Question added!', 'success');
    }
    closeModal('question-modal');
    $('q-media-file').value = '';
    loadQuestions();
  } catch (e) { notify(e.message, 'danger'); }
});

// ── Bulk import ───────────────────────────────────────────────────────────────
let selectedFile = null;

$('import-zone').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', (e) => {
  selectedFile = e.target.files[0];
  $('import-zone').innerHTML = selectedFile
    ? `<div style="font-size:1.5rem">📄</div><div class="fw-bold">${escHtml(selectedFile.name)}</div><div class="text-muted" style="font-size:.85rem">Ready to import</div>`
    : `<div style="font-size:2rem;margin-bottom:.5rem">📁</div><div class="fw-bold">Click to select CSV / JSON file</div><div class="text-muted" style="font-size:.85rem">or drag and drop</div>`;
});

// Drag & drop
const zone = $('import-zone');
zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
zone.addEventListener('drop', (e) => {
  e.preventDefault();
  zone.style.borderColor = '';
  selectedFile = e.dataTransfer.files[0];
  if (selectedFile) {
    zone.innerHTML = `<div style="font-size:1.5rem">📄</div><div class="fw-bold">${escHtml(selectedFile.name)}</div><div class="text-muted" style="font-size:.85rem">Ready to import</div>`;
  }
});

$('btn-upload').addEventListener('click', async () => {
  if (!selectedFile) return notify('Please select a file first.', 'danger');
  const fd = new FormData();
  fd.append('file', selectedFile);
  try {
    const res = await api('POST', '/questions/bulk', fd);
    const resEl = $('import-result');
    resEl.classList.remove('hidden');
    resEl.innerHTML = `
      <div class="alert alert-success">✓ Imported <strong>${res.imported}</strong> question(s).</div>
      ${res.skipped ? `<div class="alert alert-warning">⚠ Skipped ${res.skipped} row(s):
        <ul style="margin:.5rem 0 0 1.5rem">${res.errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul>
      </div>` : ''}`;
    selectedFile = null;
    $('import-file').value = '';
    zone.innerHTML = `<div style="font-size:2rem;margin-bottom:.5rem">📁</div><div class="fw-bold">Click to select CSV / JSON file</div><div class="text-muted" style="font-size:.85rem">or drag and drop</div>`;
    loadQuestions();
    notify(`Imported ${res.imported} questions!`, 'success');
  } catch (e) { notify('Import failed: ' + e.message, 'danger'); }
});

// ── Sample CSV template ───────────────────────────────────────────────────────
$('download-template').addEventListener('click', (e) => {
  e.preventDefault();
  const header = 'round,phase,difficulty,question_text,option_a,option_b,option_c,option_d,correct_answer,media_url,media_type';
  const rows = [
    '1,1,easy,"What has keys but no locks, space but no room, and you can enter but can\'t go inside?",Keyboard,Piano,Computer,Phone,A,,',
    '1,2,medium,"What is the capital of France?",Paris,London,Berlin,Madrid,A,,',
    '2,1,hard,"Which continent is Egypt in?",Africa,Asia,Europe,South America,A,/uploads/map.jpg,image',
    '3,1,medium,"Who painted the Mona Lisa?",Leonardo da Vinci,Michelangelo,Picasso,Raphael,A,,',
  ];
  const csv  = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'questions_template.csv';
  a.click(); URL.revokeObjectURL(url);
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadTeams();
loadQuestions();
