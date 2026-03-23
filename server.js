'use strict';

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const db       = require('./db/database');
const apiInit  = require('./routes/api');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api', apiInit(io));

// ── In-memory game state ─────────────────────────────────────────────────────

const state = {
  status: 'idle',          // idle | round1 | round2 | round3 | finished
  currentRound: 0,
  currentPhase: 0,
  currentTeamIndex: 0,
  currentQuestion: null,
  timerValue: 0,
  timerRunning: false,
  questionRevealed: false, // Round 2: host manually reveals question
  buzzerActive: false,     // Round 3 buzzer
  buzzedTeam: null,        // { id, name }
  round1ChosenPoints: 0,
  questionIndex: 0,        // Round 3 question counter
  pendingAnswer: false,    // waiting for host to mark correct/wrong
  scores: {},              // teamId -> score (mirrors DB)
  usedQuestionIds: {},     // teamId -> [questionIds]
  audioSpeed: 1,           // Round 2 phase 2 audio speed state
};

let timerInterval = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function syncScoresFromDB() {
  db.getTeams().forEach(t => {
    state.scores[t.id] = t.score;
  });
}

function teamsWithScores() {
  return db.getTeams().map(t => ({ ...t, score: state.scores[t.id] ?? 0 }));
}

function activeTeams() {
  return db.getTeams().filter(t => !t.is_eliminated);
}

function currentTeam() {
  const teams = activeTeams();
  return teams[state.currentTeamIndex] || null;
}

function emitState() {
  io.emit('game:state', publicState());
}

function publicState() {
  return {
    status:              state.status,
    currentRound:        state.currentRound,
    currentPhase:        state.currentPhase,
    currentTeamIndex:    state.currentTeamIndex,
    currentQuestion:     state.currentQuestion,
    timerValue:          state.timerValue,
    timerRunning:        state.timerRunning,
    questionRevealed:    state.questionRevealed,
    buzzerActive:        state.buzzerActive,
    buzzedTeam:          state.buzzedTeam,
    round1ChosenPoints:  state.round1ChosenPoints,
    questionIndex:       state.questionIndex,
    pendingAnswer:       state.pendingAnswer,
    audioSpeed:          state.audioSpeed,
    teamsCount:          activeTeams().length,
  };
}

function startTimer(seconds, onExpire) {
  clearInterval(timerInterval);
  state.timerValue   = seconds;
  state.timerRunning = true;
  io.emit('timer:update', { value: state.timerValue, running: true });

  timerInterval = setInterval(() => {
    state.timerValue -= 1;
    io.emit('timer:update', { value: state.timerValue, running: state.timerRunning });
    if (state.timerValue <= 0) {
      clearInterval(timerInterval);
      state.timerRunning = false;
      io.emit('timer:update', { value: 0, running: false });
      io.emit('timer:expired', {});
      if (onExpire) onExpire();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  state.timerRunning = false;
  io.emit('timer:update', { value: state.timerValue, running: false });
}

function applyScore(teamId, delta) {
  if (state.scores[teamId] === undefined) state.scores[teamId] = 0;
  state.scores[teamId] += delta;
  db.updateTeamScore(teamId, state.scores[teamId]);
  io.emit('scores:update', teamsWithScores());
}

function pickQuestion(round, phase, teamId, difficulty) {
  const usedIds = state.usedQuestionIds[teamId] || [];
  const q = db.getNextQuestion(round, phase, teamId, difficulty || null, usedIds);
  if (q) {
    if (!state.usedQuestionIds[teamId]) state.usedQuestionIds[teamId] = [];
    state.usedQuestionIds[teamId].push(q.id);
    db.markQuestionUsed(q.id, teamId);
  }
  return q;
}

// ── Socket.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  // Send current state immediately
  socket.emit('game:state', publicState());
  socket.emit('scores:update', teamsWithScores());

  // ── Registration ────────────────────────────────────────────────────────

  socket.on('host:connect', () => {
    socket.join('host');
    socket.emit('game:state', publicState());
    socket.emit('scores:update', teamsWithScores());
  });

  socket.on('team:connect', ({ teamId }) => {
    socket.join(`team:${teamId}`);
    socket.data.teamId = teamId;
    socket.emit('game:state', publicState());
  });

  socket.on('audience:connect', () => {
    socket.join('audience');
  });

  // ── Round management ─────────────────────────────────────────────────────

  socket.on('host:start_round', ({ round }) => {
    stopTimer();
    state.status             = ['', 'round1', 'round2', 'round3'][round] || 'idle';
    state.currentRound       = round;
    state.currentPhase       = 1;
    state.currentTeamIndex   = 0;
    state.questionIndex      = 0;
    state.currentQuestion    = null;
    state.questionRevealed   = false;
    state.buzzerActive       = false;
    state.buzzedTeam         = null;
    state.pendingAnswer      = false;
    state.round1ChosenPoints = 0;
    state.audioSpeed         = 1;
    emitState();
  });

  socket.on('host:set_phase', ({ phase }) => {
    stopTimer();
    state.currentPhase     = phase;
    state.currentTeamIndex = 0;
    state.questionIndex    = 0;
    state.currentQuestion  = null;
    state.questionRevealed = false;
    state.pendingAnswer    = false;
    state.audioSpeed       = 1;
    emitState();
  });

  // ── Round 1 ──────────────────────────────────────────────────────────────

  /**
   * Host chooses point value for the current team (10/20/30/40).
   * Difficulty: 10→easy, 20→medium, 30→hard, 40→expert
   */
  socket.on('host:choose_points', ({ points }) => {
    if (state.currentRound !== 1) return;
    const diffMap = { 10: 'easy', 20: 'medium', 30: 'hard', 40: 'expert' };
    const difficulty = diffMap[points] || 'medium';
    const team = currentTeam();
    if (!team) return socket.emit('error', { message: 'No active team found.' });

    const q = pickQuestion(1, state.currentPhase, team.id, difficulty);
    if (!q) return socket.emit('error', { message: `No ${difficulty} questions left for this phase.` });

    state.round1ChosenPoints = points;
    state.currentQuestion    = q;
    state.pendingAnswer      = true;
    emitState();

    startTimer(90, () => {
      // Timer expired – notify but do not auto-score
      io.emit('timer:expired', { teamId: team.id, teamName: team.name });
    });
  });

  // ── Round 2 ──────────────────────────────────────────────────────────────

  /** Host loads question for current team (media shown, question text hidden). */
  socket.on('host:load_question', () => {
    if (state.currentRound !== 2) return;
    const team = currentTeam();
    if (!team) return socket.emit('error', { message: 'No active team found.' });

    const q = pickQuestion(2, state.currentPhase, team.id, null);
    if (!q) return socket.emit('error', { message: 'No more questions for this phase.' });

    stopTimer();
    state.currentQuestion  = q;
    state.questionRevealed = false;
    state.pendingAnswer    = false;
    state.audioSpeed       = 1;
    emitState();
  });

  /** Host presses "Reveal Question" – starts 30s timer. */
  socket.on('host:reveal_question', () => {
    if (state.currentRound !== 2) return;
    state.questionRevealed = true;
    state.pendingAnswer    = true;
    emitState();
    const team = currentTeam();
    startTimer(30, () => {
      io.emit('timer:expired', { teamId: team ? team.id : null });
    });
  });

  /** For phase 2 audio – host controls speed (1x → 1.5x). */
  socket.on('host:set_audio_speed', ({ speed }) => {
    state.audioSpeed = speed;
    io.emit('audio:speed_change', { speed });
  });

  // ── Round 3 ──────────────────────────────────────────────────────────────

  /** Host loads next Round 3 question; buzzer is automatically enabled. */
  socket.on('host:load_round3_question', () => {
    if (state.currentRound !== 3) return;
    const teams = activeTeams();
    if (teams.length < 1) return socket.emit('error', { message: 'No active teams.' });

    // Use first active team's ID for uniqueness tracking (both R3 teams see same questions)
    const q = pickQuestion(3, 1, teams[0].id, null);
    if (!q) return socket.emit('error', { message: 'No more Round 3 questions.' });

    // Mark for second team too so we don't accidentally reuse
    if (teams[1]) {
      if (!state.usedQuestionIds[teams[1].id]) state.usedQuestionIds[teams[1].id] = [];
      state.usedQuestionIds[teams[1].id].push(q.id);
      db.markQuestionUsed(q.id, teams[1].id);
    }

    stopTimer();
    state.currentQuestion = q;
    state.buzzerActive    = true;
    state.buzzedTeam      = null;
    state.pendingAnswer   = false;
    emitState();
  });

  socket.on('host:enable_buzzer', () => {
    state.buzzerActive = true;
    state.buzzedTeam   = null;
    emitState();
  });

  socket.on('host:reset_buzzer', () => {
    state.buzzerActive = true;
    state.buzzedTeam   = null;
    state.pendingAnswer = false;
    emitState();
  });

  // ── Scoring ──────────────────────────────────────────────────────────────

  socket.on('host:answer_correct', () => {
    let teamId, points;
    if (state.currentRound === 1) {
      const team = currentTeam();
      teamId = team ? team.id : null;
      points = state.round1ChosenPoints;
    } else if (state.currentRound === 2) {
      const team = currentTeam();
      teamId = team ? team.id : null;
      points = 50;
    } else if (state.currentRound === 3) {
      teamId = state.buzzedTeam ? state.buzzedTeam.id : null;
      points = 30;
    }
    if (teamId) applyScore(teamId, points);
    state.pendingAnswer = false;
    stopTimer();
    io.emit('answer:result', { correct: true, teamId, points });
    emitState();
  });

  socket.on('host:answer_wrong', () => {
    let teamId, points;
    if (state.currentRound === 1) {
      const team = currentTeam();
      teamId = team ? team.id : null;
      points = -state.round1ChosenPoints;
    } else if (state.currentRound === 2) {
      const team = currentTeam();
      teamId = team ? team.id : null;
      points = -20;
    } else if (state.currentRound === 3) {
      teamId = state.buzzedTeam ? state.buzzedTeam.id : null;
      points = -10;
    }
    if (teamId) applyScore(teamId, points);
    state.pendingAnswer = false;
    stopTimer();
    io.emit('answer:result', { correct: false, teamId, points });
    emitState();
  });

  // ── Navigation ───────────────────────────────────────────────────────────

  /** Move to next team (R1/R2) or trigger 20s gap (R3). */
  socket.on('host:next', () => {
    stopTimer();
    if (state.currentRound === 3) {
      state.questionIndex   += 1;
      state.buzzerActive     = false;
      state.buzzedTeam       = null;
      state.currentQuestion  = null;
      state.pendingAnswer    = false;
      emitState();
      // 20-second inter-question gap
      startTimer(20, () => {
        io.emit('round3:ready_for_next', { questionIndex: state.questionIndex });
      });
    } else {
      const teams = activeTeams();
      state.currentTeamIndex   = (state.currentTeamIndex + 1) % (teams.length || 1);
      state.currentQuestion    = null;
      state.questionRevealed   = false;
      state.pendingAnswer      = false;
      state.round1ChosenPoints = 0;
      state.audioSpeed         = 1;
      emitState();
    }
  });

  // ── Manual score change ──────────────────────────────────────────────────

  socket.on('host:manual_score', ({ teamId, score }) => {
    state.scores[Number(teamId)] = Number(score);
    db.updateTeamScore(Number(teamId), Number(score));
    io.emit('scores:update', teamsWithScores());
  });

  socket.on('host:manual_score_delta', ({ teamId, delta }) => {
    applyScore(Number(teamId), Number(delta));
  });

  // ── Team elimination ─────────────────────────────────────────────────────

  socket.on('host:eliminate_team', ({ teamId }) => {
    db.eliminateTeam(Number(teamId));
    io.emit('scores:update', teamsWithScores());
    emitState();
  });

  socket.on('host:restore_team', ({ teamId }) => {
    db.restoreTeam(Number(teamId));
    io.emit('scores:update', teamsWithScores());
    emitState();
  });

  // ── Game reset ───────────────────────────────────────────────────────────

  socket.on('host:reset_game', () => {
    stopTimer();
    Object.assign(state, {
      status: 'idle', currentRound: 0, currentPhase: 0,
      currentTeamIndex: 0, questionIndex: 0, currentQuestion: null,
      timerValue: 0, timerRunning: false, questionRevealed: false,
      buzzerActive: false, buzzedTeam: null, round1ChosenPoints: 0,
      pendingAnswer: false, scores: {}, usedQuestionIds: {}, audioSpeed: 1,
    });
    db.resetAllScores();
    db.unEliminateAllTeams();
    db.resetQuestionUsage();
    emitState();
    io.emit('scores:update', teamsWithScores());
  });

  // ── Team buzz (Round 3) ──────────────────────────────────────────────────

  socket.on('team:buzz', ({ teamId, teamName }) => {
    if (!state.buzzerActive || state.buzzedTeam) return;
    state.buzzedTeam   = { id: teamId, name: teamName };
    state.buzzerActive = false;
    state.pendingAnswer = true;
    stopTimer();
    io.emit('buzz:registered', { teamId, teamName });
    emitState();
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

syncScoresFromDB();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎯 Quiz Management System running at http://localhost:${PORT}`);
  console.log(`   Host Panel    : http://localhost:${PORT}/host.html`);
  console.log(`   Team Panel    : http://localhost:${PORT}/team.html`);
  console.log(`   Audience View : http://localhost:${PORT}/audience.html`);
  console.log(`   Admin Panel   : http://localhost:${PORT}/admin.html\n`);
});
