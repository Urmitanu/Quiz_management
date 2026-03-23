'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'quiz.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE,
    score        INTEGER DEFAULT 0,
    is_eliminated INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    round          INTEGER NOT NULL,
    phase          INTEGER NOT NULL,
    difficulty     TEXT    DEFAULT 'medium',
    question_text  TEXT    NOT NULL,
    option_a       TEXT,
    option_b       TEXT,
    option_c       TEXT,
    option_d       TEXT,
    correct_answer TEXT,
    media_url      TEXT,
    media_type     TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS question_usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    team_id     INTEGER NOT NULL,
    used_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(question_id, team_id)
  );
`);

// ── Teams ──────────────────────────────────────────────

function getTeams() {
  return db.prepare('SELECT * FROM teams ORDER BY score DESC').all();
}

function getTeamById(id) {
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
}

function addTeam(name) {
  const stmt = db.prepare('INSERT INTO teams (name) VALUES (?)');
  const result = stmt.run(name);
  return getTeamById(result.lastInsertRowid);
}

function updateTeamScore(teamId, score) {
  db.prepare('UPDATE teams SET score = ? WHERE id = ?').run(score, teamId);
}

function adjustTeamScore(teamId, delta) {
  db.prepare('UPDATE teams SET score = score + ? WHERE id = ?').run(delta, teamId);
  return db.prepare('SELECT score FROM teams WHERE id = ?').get(teamId).score;
}

function eliminateTeam(teamId) {
  db.prepare('UPDATE teams SET is_eliminated = 1 WHERE id = ?').run(teamId);
}

function restoreTeam(teamId) {
  db.prepare('UPDATE teams SET is_eliminated = 0 WHERE id = ?').run(teamId);
}

function unEliminateAllTeams() {
  db.prepare('UPDATE teams SET is_eliminated = 0').run();
}

function resetAllScores() {
  db.prepare('UPDATE teams SET score = 0').run();
}

function deleteTeam(teamId) {
  db.prepare('DELETE FROM question_usage WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
}

function updateTeamName(teamId, name) {
  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, teamId);
  return getTeamById(teamId);
}

// ── Questions ──────────────────────────────────────────

function getQuestions({ round, phase, difficulty } = {}) {
  let sql = 'SELECT * FROM questions WHERE 1=1';
  const params = [];
  if (round !== undefined) { sql += ' AND round = ?'; params.push(round); }
  if (phase !== undefined) { sql += ' AND phase = ?'; params.push(phase); }
  if (difficulty) { sql += ' AND difficulty = ?'; params.push(difficulty); }
  sql += ' ORDER BY id ASC';
  return db.prepare(sql).all(...params);
}

function getQuestionById(id) {
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
}

function addQuestion(q) {
  const stmt = db.prepare(`
    INSERT INTO questions
      (round, phase, difficulty, question_text, option_a, option_b, option_c, option_d,
       correct_answer, media_url, media_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    q.round, q.phase, q.difficulty || 'medium',
    q.question_text,
    q.option_a || null, q.option_b || null,
    q.option_c || null, q.option_d || null,
    q.correct_answer || null,
    q.media_url || null, q.media_type || null
  );
  return getQuestionById(result.lastInsertRowid);
}

function updateQuestion(id, q) {
  db.prepare(`
    UPDATE questions SET
      round = ?, phase = ?, difficulty = ?, question_text = ?,
      option_a = ?, option_b = ?, option_c = ?, option_d = ?,
      correct_answer = ?, media_url = ?, media_type = ?
    WHERE id = ?
  `).run(
    q.round, q.phase, q.difficulty || 'medium',
    q.question_text,
    q.option_a || null, q.option_b || null,
    q.option_c || null, q.option_d || null,
    q.correct_answer || null,
    q.media_url || null, q.media_type || null,
    id
  );
  return getQuestionById(id);
}

function deleteQuestion(id) {
  db.prepare('DELETE FROM question_usage WHERE question_id = ?').run(id);
  db.prepare('DELETE FROM questions WHERE id = ?').run(id);
}

/**
 * Get next question for a team that they haven't seen yet.
 * Optionally filter by difficulty.
 */
function getNextQuestion(round, phase, teamId, difficulty, usedIds) {
  const excludeIds = (usedIds && usedIds.length > 0) ? usedIds : [-1];
  const placeholders = excludeIds.map(() => '?').join(',');

  let sql = `
    SELECT * FROM questions
    WHERE round = ? AND phase = ?
      AND id NOT IN (${placeholders})
  `;
  const params = [round, phase, ...excludeIds];

  if (difficulty) {
    sql += ' AND difficulty = ?';
    params.push(difficulty);
  }

  sql += ' ORDER BY RANDOM() LIMIT 1';
  return db.prepare(sql).get(...params) || null;
}

function markQuestionUsed(questionId, teamId) {
  try {
    db.prepare('INSERT OR IGNORE INTO question_usage (question_id, team_id) VALUES (?, ?)').run(questionId, teamId);
  } catch (_) { /* ignore duplicates */ }
}

function resetQuestionUsage() {
  db.prepare('DELETE FROM question_usage').run();
}

// Bulk insert questions (array)
function bulkAddQuestions(questions) {
  const insert = db.prepare(`
    INSERT INTO questions
      (round, phase, difficulty, question_text, option_a, option_b, option_c, option_d,
       correct_answer, media_url, media_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((qs) => {
    for (const q of qs) {
      insert.run(
        q.round, q.phase, q.difficulty || 'medium',
        q.question_text,
        q.option_a || null, q.option_b || null,
        q.option_c || null, q.option_d || null,
        q.correct_answer || null,
        q.media_url || null, q.media_type || null
      );
    }
  });
  insertMany(questions);
}

module.exports = {
  getTeams, getTeamById, addTeam, updateTeamScore, adjustTeamScore,
  eliminateTeam, restoreTeam, unEliminateAllTeams, resetAllScores, deleteTeam, updateTeamName,
  getQuestions, getQuestionById, addQuestion, updateQuestion, deleteQuestion,
  getNextQuestion, markQuestionUsed, resetQuestionUsage, bulkAddQuestions,
};
