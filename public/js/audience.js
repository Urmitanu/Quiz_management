'use strict';
/* Audience display – audience.js */

const socket = io();
socket.emit('audience:connect');

let gs    = {};
let teams = [];

const $ = id => document.getElementById(id);

// ── Socket events ─────────────────────────────────────────────────────────────

socket.on('connect', () => {
  $('aud-connection').textContent = 'Connected';
  $('aud-connection').className   = 'badge badge-success';
});

socket.on('disconnect', () => {
  $('aud-connection').textContent = 'Disconnected';
  $('aud-connection').className   = 'badge badge-danger';
});

socket.on('game:state', (data) => {
  gs = data;
  renderContent();
});

socket.on('scores:update', (data) => {
  teams = data;
  renderScoreboard();
  renderContent();
});

socket.on('timer:update', ({ value, running }) => {
  gs.timerValue   = value;
  gs.timerRunning = running;
  renderTimer();
});

socket.on('timer:expired', () => {
  const el = $('aud-timer-el');
  if (el) { el.textContent = '0'; el.style.color = 'var(--danger)'; }
});

socket.on('answer:result', ({ correct }) => {
  const content = $('aud-content');
  content.classList.add(correct ? 'answer-flash-correct' : 'answer-flash-wrong');
  setTimeout(() => content.classList.remove('answer-flash-correct', 'answer-flash-wrong'), 800);
});

socket.on('buzz:registered', ({ teamName }) => {
  // Show buzz banner briefly
  showBuzzBanner(teamName);
});

socket.on('audio:speed_change', ({ speed }) => {
  const audio = document.getElementById('aud-audio');
  if (audio) { audio.playbackRate = speed; audio.play(); }
});

// ── Render ────────────────────────────────────────────────────────────────────

function renderContent() {
  renderRoundBadge();
  renderMainArea();
}

function renderRoundBadge() {
  const badge = $('aud-round-badge');
  if (!gs.currentRound) { badge.style.display = 'none'; return; }

  const phaseNames = {
    1: { 1: 'Riddles', 2: 'Puzzle', 3: 'Spell Bee' },
    2: { 1: 'Map', 2: 'Audio', 3: 'Video' },
    3: { 1: 'Buzzer Finale' },
  };
  const pn = (phaseNames[gs.currentRound] || {})[gs.currentPhase] || `Phase ${gs.currentPhase}`;
  badge.textContent  = `Round ${gs.currentRound} – ${pn}`;
  badge.style.display = 'inline-block';
}

function renderMainArea() {
  const content = $('aud-content');

  if (!gs.currentRound || gs.status === 'idle') {
    content.innerHTML = '<div class="idle-msg">⏳ Waiting for host to start the game…</div>';
    return;
  }

  let html = '';

  // Timer
  html += buildTimerHtml();

  // Question (show if appropriate)
  const shouldShowQ = gs.currentQuestion && (
    gs.currentRound === 1 ||
    (gs.currentRound === 2 && gs.questionRevealed) ||
    gs.currentRound === 3
  );

  if (shouldShowQ) {
    html += buildQuestionHtml(gs.currentQuestion);
  } else if (gs.currentRound === 2 && gs.currentQuestion && !gs.questionRevealed) {
    html += buildMediaOnlyHtml(gs.currentQuestion);
  } else {
    html += '<div class="idle-msg" style="font-size:1.2rem">⏳ Waiting for next question…</div>';
  }

  // R3 buzz state
  if (gs.currentRound === 3 && gs.buzzedTeam) {
    html += `<div class="buzz-banner">🔔 ${escHtml(gs.buzzedTeam.name)} BUZZED!</div>`;
  }

  content.innerHTML = html;

  // Re-attach audio/video elements if needed
  attachMediaListeners();
}

function buildTimerHtml() {
  const v = gs.timerValue || 0;
  if (!gs.timerRunning && v === 0) return '';
  let color = 'var(--accent)';
  if (v <= 10) color = 'var(--danger)';
  else if (v <= 30) color = 'var(--warning)';
  return `<div class="aud-timer" id="aud-timer-el" style="color:${color}">${v}</div>`;
}

function buildQuestionHtml(q) {
  let html = '';

  // Media (for R2 after reveal, show media above question)
  if (q.media_url) {
    html += buildMediaHtml(q);
  }

  html += `<div class="aud-question-text">${escHtml(q.question_text)}</div>`;

  // Options
  const opts = [
    { lbl: 'A', val: q.option_a },
    { lbl: 'B', val: q.option_b },
    { lbl: 'C', val: q.option_c },
    { lbl: 'D', val: q.option_d },
  ].filter(o => o.val);

  if (opts.length) {
    html += '<div class="aud-options">';
    opts.forEach(o => {
      html += `<div class="aud-option">
        <span class="lbl">${o.lbl}</span>
        <span>${escHtml(o.val)}</span>
      </div>`;
    });
    html += '</div>';
  }

  return html;
}

function buildMediaOnlyHtml(q) {
  if (!q.media_url) return '<div class="idle-msg">⏳ Media is being shown…</div>';
  return buildMediaHtml(q) + '<div class="idle-msg" style="font-size:1rem;margin-top:1rem">⏳ Waiting for host to reveal the question…</div>';
}

function buildMediaHtml(q) {
  if (!q.media_url) return '';
  if (q.media_type === 'image') {
    return `<div class="media-aud"><img src="${escHtml(q.media_url)}" alt="Question media"></div>`;
  } else if (q.media_type === 'audio') {
    return `<div class="media-aud"><audio id="aud-audio" controls src="${escHtml(q.media_url)}" style="width:100%;padding:1rem"></audio></div>`;
  } else if (q.media_type === 'video') {
    return `<div class="media-aud"><video id="aud-video" controls src="${escHtml(q.media_url)}" style="max-width:100%;max-height:350px"></video></div>`;
  }
  return '';
}

function renderTimer() {
  const el = $('aud-timer-el');
  if (!el) return;
  const v = gs.timerValue || 0;
  el.textContent = v;
  if (v <= 10)      el.style.color = 'var(--danger)';
  else if (v <= 30) el.style.color = 'var(--warning)';
  else              el.style.color = 'var(--accent)';
}

function renderScoreboard() {
  const el = $('scoreboard');
  if (!teams.length) {
    el.innerHTML = '<p class="text-muted" style="font-size:.85rem;padding:.5rem">No teams yet.</p>';
    return;
  }

  const sorted = [...teams].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map((t, i) => {
    const rankColors = ['gold', 'silver', 'bronze'];
    const rankClass  = rankColors[i] || '';
    const elimClass  = t.is_eliminated ? 'sb-eliminated' : '';
    return `<div class="sb-row ${elimClass}">
      <span class="sb-rank ${rankClass}">${i + 1}</span>
      <span class="sb-name">${escHtml(t.name)}</span>
      <span class="sb-score">${t.score}</span>
    </div>`;
  }).join('');
}

function showBuzzBanner(teamName) {
  const content = $('aud-content');
  const existing = content.querySelector('.buzz-banner');
  if (!existing) {
    const banner = document.createElement('div');
    banner.className = 'buzz-banner';
    banner.textContent = `🔔 ${teamName} BUZZED!`;
    content.appendChild(banner);
    setTimeout(() => banner.remove(), 3000);
  }
}

function attachMediaListeners() {
  // Audio speed handled via socket event
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
