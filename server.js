import express from 'express';
import rateLimit from 'express-rate-limit';
import { LowSync } from 'lowdb';
import { JSONFileSync } from 'lowdb/node';
import { customAlphabet } from 'nanoid';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';
const PORT = process.env.PORT || 8080;
const DB_FILE = path.join(__dirname, 'data.json');

// Initialize DB (JSON)
const adapter = new JSONFileSync(DB_FILE);
const db = new LowSync(adapter, {
  scores: [],
  prize_codes: [],
  leaderboard_snapshots: [],
  logs: []
});
db.read();
if (!db.data) db.data = { scores: [], prize_codes: [], leaderboard_snapshots: [], logs: [] };
function writeDB() { db.write(); }

// Helpers
const nowIso = () => new Date().toISOString();
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/I/1
const nanoCode = customAlphabet(CODE_ALPHABET, 4);
const generatePrizeCode = () => `DRM-${nanoCode()}`;
const isIso = (s) => /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(s);
const PUBLIC_SALT = process.env.PUBLIC_SALT || 'pub_salt_change_me';
function publicCodeFor(playerId) {
  const hash = crypto.createHash('sha256').update(PUBLIC_SALT + '|' + playerId).digest();
  // Map bytes to our alphabet, take 4 chars
  let code = '';
  for (let i = 0; i < hash.length && code.length < 4; i++) {
    const idx = hash[i] % CODE_ALPHABET.length;
    code += CODE_ALPHABET[idx];
  }
  return `PLY-${code}`; // e.g., PLY-3B2Q
}

function adminGuard(req, res, next) {
  const token = req.header('X-Admin-Token') || req.query.admin_token;
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

function log(action, { player_id = null, detail = null } = {}, req) {
  try {
    db.data.logs.push({
      id: db.data.logs.length + 1,
      ts: nowIso(),
      action,
      player_id,
      detail,
      ip: req?.ip || null,
      ua: req?.headers['user-agent'] || null
    });
    writeDB();
  } catch {}
}

// Build app
const app = express();
app.use(express.json());

// Static files (serve current directory)
app.use(express.static(__dirname));

// Score submit limiter
const scoreLimiter = rateLimit({ windowMs: 15 * 1000, max: 3 });

// API
app.post('/api/score', scoreLimiter, (req, res) => {
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';
  const player_id = String(req.body?.player_id || '').slice(0, 64);
  const score = Number(req.body?.score || 0) | 0;
  const tsClient = req.body?.ts && isIso(req.body.ts) ? req.body.ts : null;
  const ts = tsClient || nowIso();
  if (!player_id || !Number.isFinite(score) || score < 0 || score > 1000000) {
    log('score_reject', { player_id, detail: JSON.stringify(req.body) }, req);
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  try {
    db.data.scores.push({ id: db.data.scores.length + 1, player_id, score, ts, ua, ip });
    writeDB();
  } catch (e) {
    log('score_error', { player_id, detail: String(e) }, req);
    return res.status(500).json({ ok: false });
  }

  const best = db.data.scores
    .filter(s => s.player_id === player_id)
    .reduce((m, s) => Math.max(m, s.score), 0);
  const isBest = best === score;

  const pc = db.data.prize_codes
    .filter(p => p.player_id === player_id)
    .sort((a,b) => a.issued_at.localeCompare(b.issued_at))
    .slice(-1)[0];
  const prize_code = pc?.code || null;

  log('score_submit', { player_id, detail: JSON.stringify({ score }) }, req);
  // compute current rank (based on each player's best, tie: earlier ts -> fewer attempts)
  const all = db.data.scores;
  const attemptsByPlayer = new Map();
  all.forEach(s => attemptsByPlayer.set(s.player_id, (attemptsByPlayer.get(s.player_id) || 0) + 1));
  const bestMap = new Map();
  all.forEach(s => {
    const cur = bestMap.get(s.player_id);
    if (!cur || s.score > cur.score || (s.score === cur.score && s.ts < cur.ts)) {
      bestMap.set(s.player_id, { player_id: s.player_id, score: s.score, ts: s.ts, attempts: attemptsByPlayer.get(s.player_id) || 0 });
    }
  });
  const ranked = Array.from(bestMap.values()).sort((a,b) => b.score - a.score || a.ts.localeCompare(b.ts) || a.attempts - b.attempts);
  const idx = ranked.findIndex(r => r.player_id === player_id);
  const rank = idx >= 0 ? (idx + 1) : null;
  const total_players = ranked.length;
  const pub_code = publicCodeFor(player_id);
  return res.json({ ok: true, best: !!isBest, prize_code, rank, total_players, pub_code });
});

app.get('/api/leaderboard', (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 10)));
  const cutoff = req.query.cutoff && isIso(req.query.cutoff) ? req.query.cutoff : null;
  const mode = String(req.query.mode || 'best'); // 'best' | 'attempts'

  const scores = db.data.scores.filter(s => !cutoff || s.ts <= cutoff);
  let data;
  if (mode === 'attempts') {
    const rows = [...scores]
      .sort((a,b) => b.score - a.score || a.ts.localeCompare(b.ts))
      .slice(0, limit)
      .map((s, i) => ({
        rank: i + 1,
        player_id: s.player_id,
        score: s.score,
        ts: s.ts,
        code: (db.data.prize_codes.find(p => p.player_id === s.player_id)?.code) || null,
        pub_code: publicCodeFor(s.player_id)
      }));
    data = rows;
  } else {
    const attemptsByPlayer = new Map();
    scores.forEach(s => attemptsByPlayer.set(s.player_id, (attemptsByPlayer.get(s.player_id) || 0) + 1));
    const bestMap = new Map();
    scores.forEach(s => {
      const cur = bestMap.get(s.player_id);
      if (!cur || s.score > cur.score || (s.score === cur.score && s.ts < cur.ts)) {
        bestMap.set(s.player_id, { player_id: s.player_id, score: s.score, ts: s.ts, attempts: attemptsByPlayer.get(s.player_id) || 0 });
      }
    });
    const rows = Array.from(bestMap.values())
      .sort((a,b) => b.score - a.score || a.ts.localeCompare(b.ts) || a.attempts - b.attempts)
      .slice(0, limit)
      .map((r, i) => ({ rank: i+1, ...r }));
    data = rows.map(r => ({
      rank: r.rank,
      player_id: r.player_id,
      score: r.score,
      ts: r.ts,
      code: (db.data.prize_codes.find(p => p.player_id === r.player_id)?.code) || null,
      pub_code: publicCodeFor(r.player_id)
    }));
  }
  return res.json({ ok: true, leaderboard: data });
});

// Admin endpoints
app.post('/api/issue-code', adminGuard, (req, res) => {
  const { player_id, rank } = req.body || {};
  if (!player_id || !Number.isFinite(Number(rank))) return res.status(400).json({ ok: false, error: 'bad_request' });
  const existing = db.data.prize_codes.find(p => p.player_id === player_id);
  if (existing) return res.status(409).json({ ok: false, error: 'already_issued', code: existing.code });
  let code;
  for (let i = 0; i < 10; i++) {
    code = generatePrizeCode();
    const dup = db.prepare('SELECT 1 FROM prize_codes WHERE code = ?').get(code);
    if (!dup) break;
  }
  const issued_at = nowIso();
  const expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.data.prize_codes.push({ code, rank: Number(rank), player_id, issued_at, expires_at, used_at: null, used_by: null, notes: null });
  writeDB();
  log('issue_code', { player_id, detail: code }, req);
  return res.json({ ok: true, code, expires_at });
});

app.post('/api/verify-code', adminGuard, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ ok: false, error: 'bad_request' });
  const pc = db.data.prize_codes.find(p => p.code === code);
  if (!pc) return res.json({ ok: true, status: 'not_found' });
  const now = Date.now();
  const exp = Date.parse(pc.expires_at);
  if (pc.used_at) return res.json({ ok: true, status: 'used', used_at: pc.used_at, used_by: pc.used_by, rank: pc.rank, player_id: pc.player_id });
  if (now > exp) return res.json({ ok: true, status: 'expired', rank: pc.rank, player_id: pc.player_id });
  return res.json({ ok: true, status: 'valid', rank: pc.rank, player_id: pc.player_id, expires_at: pc.expires_at });
});

app.post('/api/use-code', adminGuard, (req, res) => {
  const { code, used_by } = req.body || {};
  if (!code) return res.status(400).json({ ok: false, error: 'bad_request' });
  const pc = db.prepare('SELECT * FROM prize_codes WHERE code = ?').get(code);
  if (!pc) return res.status(404).json({ ok: false, error: 'not_found' });
  const now = Date.now();
  const exp = Date.parse(pc.expires_at);
  if (pc.used_at) return res.status(409).json({ ok: false, error: 'already_used' });
  if (now > exp) return res.status(409).json({ ok: false, error: 'expired' });
  const usedAt = nowIso();
  pc.used_at = usedAt; pc.used_by = String(used_by || '').slice(0, 64) || null; writeDB();
  log('use_code', { player_id: pc.player_id, detail: code }, req);
  return res.json({ ok: true, used_at: usedAt });
});

app.post('/api/finalize', adminGuard, (req, res) => {
  const cutoff = req.query.cutoff;
  const top = Math.max(1, Math.min(100, Number(req.query.top || 10)));
  if (!cutoff || !isIso(cutoff)) return res.status(400).json({ ok: false, error: 'bad_cutoff' });

  // Top list at cutoff
  const sAll = db.data.scores.filter(s => s.ts <= cutoff);
  const attempts = new Map();
  sAll.forEach(s => attempts.set(s.player_id, (attempts.get(s.player_id) || 0) + 1));
  const best = new Map();
  sAll.forEach(s => {
    const cur = best.get(s.player_id);
    if (!cur || s.score > cur.score || (s.score === cur.score && s.ts < cur.ts)) {
      best.set(s.player_id, { player_id: s.player_id, score: s.score, ts: s.ts, attempts: attempts.get(s.player_id) || 0 });
    }
  });
  const rows = Array.from(best.values())
    .sort((a,b) => b.score - a.score || a.ts.localeCompare(b.ts) || a.attempts - b.attempts)
    .slice(0, top);

  // Save snapshot and issue codes for top 3 if not issued
  const existingSnap = db.data.leaderboard_snapshots.find(s => s.cutoff_at === cutoff);
  if (!existingSnap) {
    rows.forEach((r, idx) => {
      db.data.leaderboard_snapshots.push({ id: db.data.leaderboard_snapshots.length + 1, cutoff_at: cutoff, rank: idx + 1, player_id: r.player_id, score: r.score, code: null });
    });
    writeDB();
  }

  const winners = rows.slice(0, 3);
  const issued = [];
  winners.forEach((w, i) => {
    const prev = db.data.prize_codes.find(p => p.player_id === w.player_id);
    if (!prev) {
      const code = generatePrizeCode();
      const issued_at = nowIso();
      const expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      db.data.prize_codes.push({ code, rank: i + 1, player_id: w.player_id, issued_at, expires_at, used_at: null, used_by: null, notes: null });
      writeDB();
      issued.push({ player_id: w.player_id, rank: i + 1, code });
      log('issue_code_finalize', { player_id: w.player_id, detail: code });
    }
  });

  return res.json({ ok: true, cutoff, winners: rows.slice(0, 3), issued_count: issued.length });
});

app.get('/api/winners', adminGuard, (req, res) => {
  const cutoff = req.query.cutoff;
  if (!cutoff || !isIso(cutoff)) return res.status(400).json({ ok: false, error: 'bad_cutoff' });
  const rows = db.data.leaderboard_snapshots
    .filter(s => s.cutoff_at === cutoff)
    .sort((a,b) => a.rank - b.rank)
    .slice(0, 3);
  return res.json({ ok: true, cutoff, winners: rows });
});

app.listen(PORT, () => {
  if (ADMIN_TOKEN === 'changeme') {
    // eslint-disable-next-line no-console
    console.warn('[WARN] Using default ADMIN_TOKEN. Set env ADMIN_TOKEN for production.');
  }
  // eslint-disable-next-line no-console
  console.log(`Server started on http://localhost:${PORT}`);
});


