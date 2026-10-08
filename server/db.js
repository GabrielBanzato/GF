import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      email          TEXT NOT NULL UNIQUE,
      password_hash  TEXT NOT NULL,
      name           TEXT NOT NULL DEFAULT '',
      voice          TEXT NOT NULL DEFAULT 'male',  -- legado: o Midas só tem voz masculina
      currency       TEXT NOT NULL DEFAULT 'BRL',
      language       TEXT NOT NULL DEFAULT 'auto',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    -- Uma sessão por aparelho logado (token guardado só como hash)
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL,
      last_seen   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
    -- Códigos de "esqueci minha senha"
    CREATE TABLE IF NOT EXISTS reset_codes (
      user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code_hash   TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0
    );
    -- seq = ordem de chegada no servidor (cursor de sincronização)
    -- ts  = quando a alteração foi feita de fato (ordem do histórico)
    CREATE TABLE IF NOT EXISTS ops (
      seq      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id       TEXT NOT NULL,
      ts       TEXT NOT NULL,
      type     TEXT NOT NULL,
      data     TEXT NOT NULL,
      source   TEXT NOT NULL,
      UNIQUE (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS ops_user_seq ON ops (user_id, seq);
  `);

  const q = {
    insertUser: db.prepare(`INSERT INTO users (id, email, password_hash, name, currency, language, created_at, updated_at)
                            VALUES (:id, :email, :password_hash, :name, :currency, :language, :now, :now)`),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    updateUser: db.prepare(`UPDATE users SET name = :name, email = :email, currency = :currency,
                            language = :language, updated_at = :now WHERE id = :id`),
    setPassword: db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare(`SELECT u.*, s.last_seen AS session_last_seen FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token_hash = ? AND s.last_seen > ?`),
    touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
    deleteAllSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),

    upsertReset: db.prepare(`INSERT INTO reset_codes (user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
                             ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`),
    getReset: db.prepare('SELECT * FROM reset_codes WHERE user_id = ?'),
    bumpReset: db.prepare('UPDATE reset_codes SET attempts = attempts + 1 WHERE user_id = ?'),
    deleteReset: db.prepare('DELETE FROM reset_codes WHERE user_id = ?'),

    insertOp: db.prepare('INSERT OR IGNORE INTO ops (user_id, id, ts, type, data, source) VALUES (?, ?, ?, ?, ?, ?)'),
    opsSince: db.prepare('SELECT seq, id, ts, type, data, source FROM ops WHERE user_id = ? AND seq > ? ORDER BY seq'),
    maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM ops WHERE user_id = ?'),
  };

  const now = () => new Date().toISOString();
  const rowToOp = (r) => ({ id: r.id, ts: r.ts, type: r.type, data: JSON.parse(r.data), source: r.source });

  return {
    createUser(u) {
      q.insertUser.run({ id: u.id, email: u.email, password_hash: u.password_hash, name: u.name, currency: u.currency, language: u.language, now: now() });
    },
    userById: (id) => q.userById.get(id) || null,
    userByEmail: (email) => q.userByEmail.get(email) || null,
    updateUser(u) {
      q.updateUser.run({ id: u.id, name: u.name, email: u.email, currency: u.currency, language: u.language, now: now() });
    },
    setPassword(userId, hash) {
      q.setPassword.run(hash, now(), userId);
    },
    deleteUser(id) {
      q.deleteUser.run(id);
    },

    createSession(tokenHash, userId) {
      const t = now();
      q.insertSession.run(tokenHash, userId, t, t);
    },
    /** Usuário da sessão, se ela não ficou parada mais que `maxIdleMs`. */
    userBySession(tokenHash, maxIdleMs) {
      const row = q.sessionUser.get(tokenHash, new Date(Date.now() - maxIdleMs).toISOString());
      if (!row) return null;
      // Atualiza o "visto por último" no máximo 1x por hora
      if (Date.now() - Date.parse(row.session_last_seen) > 3600_000) q.touchSession.run(now(), tokenHash);
      delete row.session_last_seen;
      return row;
    },
    deleteSession: (tokenHash) => q.deleteSession.run(tokenHash),
    deleteOtherSessions: (userId, keepTokenHash) => q.deleteOtherSessions.run(userId, keepTokenHash),
    deleteAllSessions: (userId) => q.deleteAllSessions.run(userId),

    saveResetCode(userId, codeHash, expiresAt) {
      q.upsertReset.run(userId, codeHash, expiresAt);
    },
    getResetCode: (userId) => q.getReset.get(userId) || null,
    bumpResetAttempts: (userId) => q.bumpReset.run(userId),
    deleteResetCode: (userId) => q.deleteReset.run(userId),

    /** Insere ops ignorando ids já existentes. Retorna quantos eram novos. */
    insertOps(userId, ops) {
      let added = 0;
      db.exec('BEGIN');
      try {
        for (const op of ops) added += Number(q.insertOp.run(userId, op.id, op.ts, op.type, JSON.stringify(op.data), op.source).changes);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return added;
    },
    opsSince(userId, since = 0) {
      return q.opsSince.all(userId, since).map(rowToOp);
    },
    allOps(userId) {
      return q.opsSince.all(userId, 0).map(rowToOp);
    },
    cursor(userId) {
      return Number(q.maxSeq.get(userId).seq);
    },
    close() {
      db.close();
    },
  };
}
