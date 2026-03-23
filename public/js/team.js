'use strict';
/* Team Panel – team.js */

const socket = io();

let myTeamId   = null;
let myTeamName = '';
let gs         = {};
let teams      = [];

const $ = id => document.getElementById(id);

// ── Team selection ────────────────────────────────────────────────────────────

async function loadTeamList() {
  try {
    const resp  = await fetch('/api/teams');
    const list  = await resp.json();
    const sel   = $('team-sel');
    sel.innerHTML = '<option value="">— Select Team —</option>';
    list.forEach(t => {
      const opt   = document.createElement('option');
      opt.value   = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load teams', e);
  }
}

$('btn-join').addEventListener('click', () => {
  const sel = $('team-sel');
  const id  = Number(sel.value);
  const nm  = sel.options[sel.selectedIndex]?.text || '';
  if (!id) return alert('Please select a team.');
  myTeamId   = id;
  myTeamName = nm;
  socket.emit('team:connect', { teamId: id, teamName: nm });
  $('team-select-screen').style.display = 'none';
  $('game-screen').style.display        = 'flex';
  $('gs-team-name').textContent         = nm;
  renderGameScreen();
});

// ── Socket events ─────────────────────────────────────────────────────────────

socket.on('game:state', (data) => {
  gs = data;
  if (myTeamId) renderGameScreen();
});

socket.on('scores:update', (data) => {
  teams = data;
  if (myTeamId) {
    const me = teams.find(t => t.id === myTeamId);
    if (me) $('gs-team-score').textContent = me.score;
  }
});

socket.on('timer:update', ({ value, running }) => {
  gs.timerValue   = value;
  gs.timerRunning = running;
  renderTimer();
});

socket.on('timer:expired', () => {
  const timerEl = $('team-timer');
  timerEl.classList.add('danger');
  timerEl.textContent = '0';
});

socket.on('buzz:registered', ({ teamId, teamName }) => {
  const res = $('buzz-result');
  if (teamId === myTeamId) {
    res.textContent = '🎉 You buzzed first! Answer the question.';
    res.style.color = 'var(--success)';
    $('buzzer-btn').classList.add('buzzed');
    $('buzzer-btn').disabled = true;
  } else {
    res.textContent = `${escHtml(teamName)} buzzed first.`;
    res.style.color = 'var(--text-muted)';
    $('buzzer-btn').disabled = true;
  }
});

socket.on('answer:result', ({ correct, teamId, points }) => {
  if (teamId !== myTeamId) return;
  const banner = $('result-banner');
  banner.style.display = 'block';
  if (correct) {
    banner.style.background = 'rgba(0,230,118,.15)';
    banner.style.border     = '2px solid var(--success)';
    banner.style.color      = 'var(--success)';
    banner.textContent      = `✓ Correct! +${points} points`;
  } else {
    banner.style.background = 'rgba(255,68,68,.15)';
    banner.style.border     = '2px solid var(--danger)';
    banner.style.color      = 'var(--danger)';
    banner.textContent      = `✗ Wrong! ${points} points`;
  }
  setTimeout(() => { banner.style.display = 'none'; }, 4000);
});

socket.on('audio:speed_change', ({ speed }) => {
  const audio = document.getElementById('q-audio');
  if (audio) {
    audio.playbackRate = speed;
    audio.play();
  }
});

socket.on('round3:ready_for_next', () => {
  const res = $('buzz-result');
  res.textContent = 'Get ready for the next question!';
  res.style.color = 'var(--accent)';
});

// ── Render ────────────────────────────────────────────────────────────────────

function renderGameScreen() {
  if (!myTeamId) return;

  renderRoundInfo();
  renderWaitMsg();
  renderQuestion();
  renderBuzzer();
}

function renderRoundInfo() {
  const badge = $('rp-badge');
  if (!gs.currentRound) {
    $('round-phase-info').classList.add('hidden');
    return;
  }
  $('round-phase-info').classList.remove('hidden');

  const phaseNames = {
    1: { 1: 'Riddles', 2: 'Puzzle', 3: 'Spell Bee' },
    2: { 1: 'Map', 2: 'Audio', 3: 'Video' },
    3: { 1: 'Buzzer Round' },
  };
  const pn = (phaseNames[gs.currentRound] || {})[gs.currentPhase] || `Phase ${gs.currentPhase}`;
  badge.textContent = `Round ${gs.currentRound} – ${pn}`;
}

function renderWaitMsg() {
  const waitEl  = $('wait-msg');
  const showWait = !gs.currentRound ||
    (gs.currentRound === 1 && !gs.currentQuestion) ||
    (gs.currentRound === 2 && !gs.questionRevealed) ||
    (gs.currentRound === 3 && !gs.currentQuestion);

  waitEl.style.display = showWait ? 'block' : 'none';

  if (gs.currentRound === 2 && gs.currentQuestion && !gs.questionRevealed) {
    waitEl.textContent = '⏳ Media is being shown. Wait for the host to reveal the question…';
  } else if (!gs.currentRound) {
    waitEl.textContent = '⏳ Waiting for the host to start the game…';
  } else {
    waitEl.textContent = '⏳ Waiting for the host…';
  }
}

function renderQuestion() {
  const area = $('question-area');

  // Determine if question should be visible to this team
  const isMyTurn = isCurrentTeam();
  const shouldShow = gs.currentQuestion && (
    (gs.currentRound === 1 && isMyTurn) ||
    (gs.currentRound === 2 && gs.questionRevealed && isMyTurn) ||
    gs.currentRound === 3
  );

  if (!shouldShow) { area.classList.add('hidden'); return; }
  area.classList.remove('hidden');

  const q = gs.currentQuestion;
  $('q-text').textContent = q.question_text;

  // Media
  const mediaArea = $('q-media-area');
  mediaArea.innerHTML = '';
  if (q.media_url && (gs.currentRound === 2)) {
    const wrap = document.createElement('div');
    wrap.className = 'media-container mb-2';
    if (q.media_type === 'image') {
      wrap.innerHTML = `<img src="${q.media_url}" alt="Question media">`;
    } else if (q.media_type === 'audio') {
      wrap.innerHTML = `<audio id="q-audio" controls src="${q.media_url}"></audio>`;
    } else if (q.media_type === 'video') {
      wrap.innerHTML = `<video id="q-video" controls src="${q.media_url}" style="max-width:100%;max-height:300px"></video>`;
    }
    mediaArea.appendChild(wrap);
  }

  // Options (only show if question is revealed in R2, or always in R1/R3)
  const showOptions = gs.currentRound !== 2 || gs.questionRevealed;
  const optArea = $('q-options');
  if (showOptions) {
    const opts = [
      { lbl: 'A', val: q.option_a },
      { lbl: 'B', val: q.option_b },
      { lbl: 'C', val: q.option_c },
      { lbl: 'D', val: q.option_d },
    ].filter(o => o.val);

    optArea.innerHTML = opts.map(o => `
      <div class="option-btn">
        <span class="option-label">${o.lbl}</span>
        <span>${escHtml(o.val)}</span>
      </div>`).join('');
  } else {
    optArea.innerHTML = '';
  }
}

function renderTimer() {
  const el = $('team-timer');
  const v  = gs.timerValue || 0;

  if (!gs.currentRound || (!gs.timerRunning && v === 0)) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.textContent   = v;
  el.className     = 'timer-display ';
  if (v > 30)      el.className += 'normal';
  else if (v > 10) el.className += 'warning';
  else             el.className += 'danger';
}

function renderBuzzer() {
  const area = $('buzzer-area');
  const btn  = $('buzzer-btn');
  const res  = $('buzz-result');

  if (gs.currentRound !== 3) { area.classList.add('hidden'); return; }
  area.classList.remove('hidden');

  const canBuzz = gs.buzzerActive && !gs.buzzedTeam;
  btn.disabled  = !canBuzz;
  btn.classList.toggle('buzzed', !!gs.buzzedTeam);

  if (!gs.buzzerActive && !gs.buzzedTeam) {
    res.textContent = gs.currentQuestion ? 'Waiting for buzzer to be enabled…' : 'Waiting for next question…';
    res.style.color = 'var(--text-muted)';
  } else if (canBuzz) {
    res.textContent = '';
  }
}

function isCurrentTeam() {
  if (gs.currentRound === 3) return true; // Both teams play in R3
  const activeTeams = teams.filter(t => !t.is_eliminated);
  const ct = activeTeams[gs.currentTeamIndex];
  return ct && ct.id === myTeamId;
}

// Buzz button
$('buzzer-btn').addEventListener('click', () => {
  if (!gs.buzzerActive || gs.buzzedTeam) return;
  socket.emit('team:buzz', { teamId: myTeamId, teamName: myTeamName });
});

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Init
loadTeamList();
