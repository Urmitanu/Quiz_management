'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { parse } = require('csv-parse/sync');
const db      = require('../db/database');

const router  = express.Router();

// ── Simple in-memory rate limiter ────────────────────────────────────────────
// Limits upload endpoints to 20 requests per minute per IP
const RATE_WINDOW_MS  = 60 * 1000; // 1 minute
const RATE_MAX_HITS   = 20;
const rateCounts = new Map(); // ip -> { count, windowStart }

function rateLimit(req, res, next) {
  const ip  = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateCounts.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count       = 1;
    entry.windowStart = now;
  } else {
    entry.count += 1;
  }
  rateCounts.set(ip, entry);

  if (entry.count > RATE_MAX_HITS) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  next();
}

// ── File upload storage ──────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ── Teams ────────────────────────────────────────────────────────────────────

router.get('/teams', (_req, res) => {
  res.json(db.getTeams());
});

router.post('/teams', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const team = db.addTeam(name.trim());
    res.status(201).json(team);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Team name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/teams/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, score } = req.body;
  if (name !== undefined) {
    try { db.updateTeamName(id, name.trim()); } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  if (score !== undefined) db.updateTeamScore(id, Number(score));
  res.json(db.getTeamById(id));
});

router.delete('/teams/:id', (req, res) => {
  db.deleteTeam(Number(req.params.id));
  res.json({ success: true });
});

// ── Questions ────────────────────────────────────────────────────────────────

router.get('/questions', (req, res) => {
  const { round, phase, difficulty } = req.query;
  res.json(db.getQuestions({
    round: round !== undefined ? Number(round) : undefined,
    phase: phase !== undefined ? Number(phase) : undefined,
    difficulty,
  }));
});

router.get('/questions/:id', (req, res) => {
  const q = db.getQuestionById(Number(req.params.id));
  if (!q) return res.status(404).json({ error: 'Not found' });
  res.json(q);
});

router.post('/questions', (req, res) => {
  const q = req.body;
  if (!q.round || !q.phase || !q.question_text) {
    return res.status(400).json({ error: 'round, phase, question_text are required' });
  }
  res.status(201).json(db.addQuestion(q));
});

router.put('/questions/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.getQuestionById(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  res.json(db.updateQuestion(id, req.body));
});

router.delete('/questions/:id', (req, res) => {
  db.deleteQuestion(Number(req.params.id));
  res.json({ success: true });
});

// ── Bulk import (CSV or JSON) ────────────────────────────────────────────────

router.post('/questions/bulk', rateLimit, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  let questions = [];

  try {
    const raw = fs.readFileSync(req.file.path, 'utf8');

    if (ext === '.json') {
      const parsed = JSON.parse(raw);
      questions = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      // CSV expected columns (case-insensitive):
      // round, phase, difficulty, question_text, option_a, option_b, option_c, option_d,
      // correct_answer, media_url, media_type
      const records = parse(raw, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      questions = records;
    }
  } catch (err) {
    return res.status(400).json({ error: `Parse error: ${err.message}` });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch (_) { /* ignore */ }
  }

  // Validate & normalise
  const valid = [];
  const errors = [];
  questions.forEach((q, i) => {
    if (!q.round || !q.phase || !q.question_text) {
      errors.push(`Row ${i + 1}: missing round, phase, or question_text`);
    } else {
      valid.push({
        round: Number(q.round),
        phase: Number(q.phase),
        difficulty: q.difficulty || 'medium',
        question_text: q.question_text,
        option_a: q.option_a || null,
        option_b: q.option_b || null,
        option_c: q.option_c || null,
        option_d: q.option_d || null,
        correct_answer: q.correct_answer || null,
        media_url: q.media_url || null,
        media_type: q.media_type || null,
      });
    }
  });

  if (valid.length > 0) db.bulkAddQuestions(valid);
  res.json({ imported: valid.length, skipped: errors.length, errors });
});

// ── Media upload ─────────────────────────────────────────────────────────────

router.post('/upload', rateLimit, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── Game state snapshot ──────────────────────────────────────────────────────

// io instance injected by server.js
let _io = null;
router.use((req, _res, next) => { req.io = _io; next(); });

// POST /api/game/reset – exposed for convenience (host panel also resets via socket)
router.post('/game/reset', (_req, res) => {
  db.resetAllScores();
  db.unEliminateAllTeams();
  db.resetQuestionUsage();
  res.json({ success: true });
});

function init(io) {
  _io = io;
  return router;
}

module.exports = init;
