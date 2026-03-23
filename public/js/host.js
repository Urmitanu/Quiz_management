'use strict';
/* Host Panel – host.js */

const socket = io();
socket.emit('host:connect');

// ── State ─────────────────────────────────────────────────────────────────────
let gs        = {};   // game state from server
let teams     = [];   // teams array with scores

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Socket events ─────────────────────────────────────────────────────────────

socket.on('game:state', (data) => {
  gs = data;
  renderState();
});

socket.on('scores:update', (data) => {
  teams = data;
  renderTeamList();
  renderManualSelects();
  renderCurrentTeamInfo();
});

socket.on('timer:update', ({ value, running }) => {
  gs.timerValue   = value;
  gs.timerRunning = running;
  renderTimer();
});

socket.on('timer:expired', () => {
  showFeedback('⏰ Time expired!', 'var(--warning)');
});

socket.on('answer:result', ({ correct, teamId, points }) => {
  const team = teams.find(t => t.id === teamId);
  const name = team ? team.name : 'Team';
  if (correct) {
    showFeedback(`✓ Correct! +${points} for ${name}`, 'var(--success)');
  } else {
    showFeedback(`✗ Wrong! ${points} for ${name}`, 'var(--danger)');
  }
});

socket.on('buzz:registered', ({ teamId, teamName }) => {
  $('buzz-status').textContent = `🔔 ${teamName} buzzed!`;
  $('buzz-status').style.color = 'var(--warning)';
  $('btn-reset-buzzer').disabled = false;
});

socket.on('round3:ready_for_next', () => {
  $('btn-load-r3-q').disabled = false;
});

socket.on('error', ({ message }) => {
  showFeedback('⚠ ' + message, 'var(--danger)');
});

// ── Render ────────────────────────────────────────────────────────────────────

function renderState() {
  renderStatusBadge();
  renderRoundButtons();
  renderPhasePanel();
  renderRoundControls();
  renderCurrentTeamInfo();
  renderQuestion();
  renderAnswerPanel();
  renderTimer();
  renderR3BuzzStatus();
}

function renderStatusBadge() {
  const badge = $('status-badge');
  const labels = { idle: 'Idle', round1: 'Round 1', round2: 'Round 2', round3: 'Round 3', finished: 'Finished' };
  badge.textContent = labels[gs.status] || gs.status;
}

function renderRoundButtons() {
  ['r1-btn', 'r2-btn', 'r3-btn'].forEach((id, i) => {
    const btn = $(id);
    btn.classList.toggle('active', gs.currentRound === i + 1);
  });
}

function renderPhasePanel() {
  const panel = $('phase-panel');
  if (!gs.currentRound) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const phaseLabels = {
    1: { 1: 'Phase 1: Riddles', 2: 'Phase 2: Puzzle', 3: 'Phase 3: Spell Bee' },
    2: { 1: 'Phase 1: Map', 2: 'Phase 2: Audio', 3: 'Phase 3: Video' },
    3: { 1: 'Round 3 Questions' },
  };
  const labels = phaseLabels[gs.currentRound] || {};
  $('phase-title').textContent = `Round ${gs.currentRound} – Phase`;

  const container = $('phase-btns');
  container.innerHTML = '';
  const phases = gs.currentRound === 3 ? [1] : [1, 2, 3];
  phases.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'round-btn' + (gs.currentPhase === p ? ' active' : '');
    btn.textContent = labels[p] || `Phase ${p}`;
    btn.onclick = () => setPhase(p);
    container.appendChild(btn);
  });
}

function renderRoundControls() {
  $('r1-controls').classList.toggle('hidden', gs.currentRound !== 1);
  $('r2-controls').classList.toggle('hidden', gs.currentRound !== 2);
  $('r3-controls').classList.toggle('hidden', gs.currentRound !== 3);
  $('r3-question-counter').classList.toggle('hidden', gs.currentRound !== 3);

  if (gs.currentRound === 2) {
    const isPhase2 = gs.currentPhase === 2;
    $('btn-audio-1x').style.display   = isPhase2 ? 'inline-flex' : 'none';
    $('btn-audio-15x').style.display  = isPhase2 ? 'inline-flex' : 'none';

    $('btn-load-q').disabled   = !!gs.pendingAnswer;
    $('btn-reveal-q').disabled = !(gs.currentQuestion && !gs.questionRevealed);
  }

  if (gs.currentRound === 3) {
    $('q-counter-val').textContent = `${gs.questionIndex}/20`;
    $('btn-load-r3-q').disabled    = gs.pendingAnswer || gs.timerRunning;
    $('btn-enable-buzzer').disabled = !(gs.currentQuestion && !gs.buzzerActive && !gs.buzzedTeam);
    $('btn-reset-buzzer').disabled  = !gs.buzzedTeam;
  }
}

function renderCurrentTeamInfo() {
  if (!gs.currentRound || !teams.length) {
    $('current-team-name').textContent  = '—';
    $('current-team-score').textContent = '0';
    return;
  }

  if (gs.currentRound === 3) {
    // Show both teams
    const activeteams = teams.filter(t => !t.is_eliminated).slice(0, 2);
    $('current-team-name').textContent = activeteams.map(t => t.name).join(' vs ');
    $('current-team-score').textContent = '';
    return;
  }

  const activeTeams = teams.filter(t => !t.is_eliminated);
  const team = activeTeams[gs.currentTeamIndex];
  if (team) {
    $('current-team-name').textContent  = team.name;
    $('current-team-score').textContent = team.score;
  }
}

function renderTeamList() {
  const container = $('team-list');
  if (!teams.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem">No teams yet. <a href="/admin.html">Add teams</a></p>';
    return;
  }

  const activeTeams = teams.filter(t => !t.is_eliminated);
  const currentIndex = gs.currentTeamIndex || 0;

  container.innerHTML = teams.map((t, _i) => {
    const isActive = !t.is_eliminated && activeTeams.indexOf(t) === currentIndex && gs.currentRound > 0;
    return `<div class="team-card ${isActive ? 'active' : ''} ${t.is_eliminated ? 'eliminated' : ''}">
      <div class="flex justify-between items-center">
        <span class="t-name">${escHtml(t.name)}</span>
        <span class="t-score">${t.score}</span>
      </div>
      ${t.is_eliminated ? '<small style="color:var(--danger)">Eliminated</small>' : ''}
    </div>`;
  }).join('');
}

function renderManualSelects() {
  ['manual-team-sel', 'elim-team-sel'].forEach(id => {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = teams.map(t => `<option value="${t.id}">${escHtml(t.name)} (${t.score})</option>`).join('');
    if (prev) sel.value = prev;
  });
}

function renderQuestion() {
  const panel = $('question-panel');
  if (!gs.currentQuestion) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const q = gs.currentQuestion;
  $('q-meta').textContent = `R${q.round}/P${q.phase} – ${q.difficulty}`;
  $('question-text').textContent = q.question_text;

  // Media
  const mediaArea = $('media-area');
  mediaArea.innerHTML = '';
  if (q.media_url) {
    const wrap = document.createElement('div');
    wrap.className = 'media-container mb-2';
    if (q.media_type === 'image') {
      wrap.innerHTML = `<img src="${q.media_url}" alt="Question media">`;
    } else if (q.media_type === 'audio') {
      wrap.innerHTML = `<audio id="host-audio" controls src="${q.media_url}"></audio>`;
    } else if (q.media_type === 'video') {
      wrap.innerHTML = `<video id="host-video" controls src="${q.media_url}" style="max-width:100%;max-height:300px"></video>`;
    }
    mediaArea.appendChild(wrap);
  }

  // Options
  const optArea = $('options-area');
  const opts = [
    { lbl: 'A', val: q.option_a },
    { lbl: 'B', val: q.option_b },
    { lbl: 'C', val: q.option_c },
    { lbl: 'D', val: q.option_d },
  ].filter(o => o.val);

  if (opts.length) {
    optArea.innerHTML = opts.map(o => `
      <div class="option-btn${o.lbl === q.correct_answer ? ' correct' : ''}">
        <span class="option-label">${o.lbl}</span>
        <span>${escHtml(o.val)}</span>
      </div>`).join('');
  } else {
    optArea.innerHTML = '';
  }
}

function renderAnswerPanel() {
  const hasPending = gs.pendingAnswer;
  $('btn-correct').disabled = !hasPending;
  $('btn-wrong').disabled   = !hasPending;
  $('btn-next').disabled    = gs.timerRunning && gs.currentRound === 3; // only disable during R3 gap
}

function renderTimer() {
  const el = $('timer');
  const v  = gs.timerValue || 0;
  el.textContent = v;
  el.className = 'timer-display ';
  if (v > 30)     el.className += 'normal';
  else if (v > 10) el.className += 'warning';
  else             el.className += 'danger';
  $('timer-panel').classList.toggle('hidden', !gs.currentRound);
}

function renderR3BuzzStatus() {
  if (gs.currentRound !== 3) return;
  const el = $('buzz-status');
  if (gs.buzzedTeam) {
    el.textContent = `🔔 ${gs.buzzedTeam.name} buzzed!`;
    el.style.color = 'var(--warning)';
  } else if (gs.buzzerActive) {
    el.textContent = '⏳ Buzzer active – waiting for buzz…';
    el.style.color = 'var(--text-muted)';
  } else {
    el.textContent = '';
  }
}

function showFeedback(msg, color) {
  const el = $('answer-feedback');
  el.classList.remove('hidden');
  el.style.color      = color;
  el.style.background = 'rgba(0,0,0,.2)';
  el.style.border     = `1px solid ${color}`;
  el.textContent      = msg;
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ── Actions ───────────────────────────────────────────────────────────────────

function startRound(r) {
  if (!confirm(`Start Round ${r}?`)) return;
  socket.emit('host:start_round', { round: r });
}

function setPhase(p) {
  socket.emit('host:set_phase', { phase: p });
}

function choosePoints(pts) {
  socket.emit('host:choose_points', { points: pts });
}

// Round 2
$('btn-load-q').addEventListener('click', () => {
  socket.emit('host:load_question');
});

$('btn-reveal-q').addEventListener('click', () => {
  socket.emit('host:reveal_question');
});

$('btn-audio-1x').addEventListener('click', () => {
  socket.emit('host:set_audio_speed', { speed: 1 });
  playAudioAtSpeed(1);
});

$('btn-audio-15x').addEventListener('click', () => {
  socket.emit('host:set_audio_speed', { speed: 1.5 });
  playAudioAtSpeed(1.5);
});

function playAudioAtSpeed(speed) {
  const audio = document.getElementById('host-audio');
  if (audio) { audio.playbackRate = speed; audio.play(); }
}

// Round 3
$('btn-load-r3-q').addEventListener('click', () => {
  socket.emit('host:load_round3_question');
  $('buzz-status').textContent = '';
  $('btn-load-r3-q').disabled = true;
  $('btn-enable-buzzer').disabled = false;
});

$('btn-enable-buzzer').addEventListener('click', () => {
  socket.emit('host:enable_buzzer');
  $('btn-enable-buzzer').disabled = true;
  $('buzz-status').textContent = '⏳ Buzzer active – waiting for buzz…';
  $('buzz-status').style.color = 'var(--text-muted)';
});

$('btn-reset-buzzer').addEventListener('click', () => {
  socket.emit('host:reset_buzzer');
  $('buzz-status').textContent = '⏳ Buzzer re-enabled…';
  $('btn-reset-buzzer').disabled = true;
});

// Answer buttons
$('btn-correct').addEventListener('click', () => {
  socket.emit('host:answer_correct');
});

$('btn-wrong').addEventListener('click', () => {
  socket.emit('host:answer_wrong');
});

$('btn-next').addEventListener('click', () => {
  socket.emit('host:next');
});

// Manual score
$('btn-set-score').addEventListener('click', () => {
  const teamId = $('manual-team-sel').value;
  const score  = $('manual-score-val').value;
  if (!teamId || score === '') return;
  socket.emit('host:manual_score', { teamId: Number(teamId), score: Number(score) });
  $('manual-score-val').value = '';
});

$('btn-delta-score').addEventListener('click', () => {
  const teamId = $('manual-team-sel').value;
  const delta  = $('manual-delta-val').value;
  if (!teamId || delta === '') return;
  socket.emit('host:manual_score_delta', { teamId: Number(teamId), delta: Number(delta) });
  $('manual-delta-val').value = '';
});

// Eliminate
$('btn-eliminate').addEventListener('click', () => {
  const teamId = $('elim-team-sel').value;
  if (!teamId) return;
  socket.emit('host:eliminate_team', { teamId: Number(teamId) });
});

$('btn-restore-all').addEventListener('click', () => {
  // Restore all eliminated teams via the server
  teams.filter(t => t.is_eliminated).forEach(t => {
    socket.emit('host:restore_team', { teamId: t.id });
  });
});

// Reset game
$('btn-reset').addEventListener('click', () => {
  if (!confirm('Reset the entire game? All scores and progress will be cleared.')) return;
  socket.emit('host:reset_game');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
