import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { config, PROJECT_ROOT } from '../../../../config/loader.mjs';
import logger from '../utils/logger.mjs';

const DB_PATH = join(PROJECT_ROOT, config.database.path);
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma(`journal_mode = ${config.database.journal_mode}`);
db.pragma(`foreign_keys = ${config.database.foreign_keys ? 'ON' : 'OFF'}`);

function sqlQuote(str) {
  return String(str).replace(/'/g, "''");
}

export function initDB() {
  logger.info('Initializing database...', { context: 'DB' });
  logger.info(`Path: ${DB_PATH}`, { context: 'DB' });

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      label TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS diagnostic_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      owner_user_id TEXT,
      client_token_id TEXT,
      name TEXT NOT NULL,
      scene_name TEXT NOT NULL,
      data_path TEXT NOT NULL,
      data_folder TEXT,
      user_question TEXT,
      status TEXT DEFAULT 'pending',
      session_id TEXT,
      workspace_path TEXT,
      report_path TEXT,
      score INTEGER,
      judge_verdict TEXT,
      error_message TEXT,
      model TEXT DEFAULT '${sqlQuote(config.claude.model)}',
      max_turns INTEGER DEFAULT ${Number(config.claude.max_turns)},
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (client_token_id) REFERENCES auth_tokens(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS diagnosis_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      message_type TEXT DEFAULT 'text',
      tool_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES diagnostic_runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS diagnosis_event_stream (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_subtype TEXT,
      payload_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES diagnostic_runs(run_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_runs_status ON diagnostic_runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON diagnostic_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_run_id ON diagnosis_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_event_stream_run_seq ON diagnosis_event_stream(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS data_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      owner_user_id TEXT,
      client_token_id TEXT,
      path TEXT NOT NULL,
      description TEXT,
      file_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (client_token_id) REFERENCES auth_tokens(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL UNIQUE,
      owner_user_id TEXT,
      client_token_id TEXT,
      title TEXT,
      session_id TEXT,
      origin_session_id TEXT,
      status TEXT DEFAULT 'active',
      model TEXT DEFAULT '${sqlQuote(config.claude.model)}',
      permission_mode TEXT DEFAULT 'bypassPermissions',
      cwd TEXT DEFAULT '${sqlQuote(PROJECT_ROOT)}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (client_token_id) REFERENCES auth_tokens(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      event_type TEXT DEFAULT 'message',
      event_subtype TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chat_id) REFERENCES chat_sessions(chat_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_created ON chat_sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);
  `);

  // Migration: add report_language column if missing
  const cols = db.prepare('PRAGMA table_info(diagnostic_runs)').all();
  const hasRunOwnerUserId = cols.some(c => c.name === 'owner_user_id');
  if (!hasRunOwnerUserId) {
    db.exec('ALTER TABLE diagnostic_runs ADD COLUMN owner_user_id TEXT');
  }
  const hasRunClientTokenId = cols.some(c => c.name === 'client_token_id');
  if (!hasRunClientTokenId) {
    db.exec('ALTER TABLE diagnostic_runs ADD COLUMN client_token_id TEXT');
  }
  const hasReportLang = cols.some(c => c.name === 'report_language');
  if (!hasReportLang) {
    db.exec(`ALTER TABLE diagnostic_runs ADD COLUMN report_language TEXT DEFAULT '${sqlQuote(config.diagnosis.default_language)}'`);
  }

  const chatCols = db.prepare('PRAGMA table_info(chat_sessions)').all();
  const hasChatOwnerUserId = chatCols.some(c => c.name === 'owner_user_id');
  if (!hasChatOwnerUserId) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN owner_user_id TEXT');
  }
  const hasChatClientTokenId = chatCols.some(c => c.name === 'client_token_id');
  if (!hasChatClientTokenId) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN client_token_id TEXT');
  }
  const hasOriginSessionId = chatCols.some(c => c.name === 'origin_session_id');
  if (!hasOriginSessionId) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN origin_session_id TEXT');
    db.exec(`
      UPDATE chat_sessions
      SET origin_session_id = session_id
      WHERE origin_session_id IS NULL AND session_id IS NOT NULL
    `);
  }

  const hasPermissionMode = chatCols.some(c => c.name === 'permission_mode');
  if (!hasPermissionMode) {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN permission_mode TEXT DEFAULT 'bypassPermissions'`);
    db.exec(`
      UPDATE chat_sessions
      SET permission_mode = 'bypassPermissions'
      WHERE permission_mode IS NULL OR permission_mode = ''
    `);
  }

  const hasCwd = chatCols.some(c => c.name === 'cwd');
  if (!hasCwd) {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN cwd TEXT DEFAULT '${sqlQuote(PROJECT_ROOT)}'`);
    db.exec(`
      UPDATE chat_sessions
      SET cwd = '${sqlQuote(PROJECT_ROOT)}'
      WHERE cwd IS NULL OR cwd = ''
    `);
  }

  const folderCols = db.prepare('PRAGMA table_info(data_folders)').all();
  const hasFolderOwnerUserId = folderCols.some(c => c.name === 'owner_user_id');
  if (!hasFolderOwnerUserId) {
    db.exec('ALTER TABLE data_folders ADD COLUMN owner_user_id TEXT');
  }
  const hasFolderClientTokenId = folderCols.some(c => c.name === 'client_token_id');
  if (!hasFolderClientTokenId) {
    db.exec('ALTER TABLE data_folders ADD COLUMN client_token_id TEXT');
  }

  // Migration: rebuild diagnosis_logs with ON DELETE CASCADE if missing
  const fkCols = db.prepare('PRAGMA foreign_key_list(diagnosis_logs)').all();
  const hasCascade = fkCols.some(fk => fk.on_delete === 'CASCADE');
  if (fkCols.length > 0 && !hasCascade) {
    db.exec(`
      ALTER TABLE diagnosis_logs RENAME TO diagnosis_logs_old;
      CREATE TABLE diagnosis_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        message_type TEXT DEFAULT 'text',
        tool_name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (run_id) REFERENCES diagnostic_runs(run_id) ON DELETE CASCADE
      );
      INSERT INTO diagnosis_logs SELECT * FROM diagnosis_logs_old;
      DROP TABLE diagnosis_logs_old;
      CREATE INDEX IF NOT EXISTS idx_logs_run_id ON diagnosis_logs(run_id);
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_runs_owner_user ON diagnostic_runs(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_runs_client_token ON diagnostic_runs(client_token_id);
    CREATE INDEX IF NOT EXISTS idx_data_folders_owner_user ON data_folders(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_data_folders_client_token ON data_folders(client_token_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_user ON chat_sessions(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_client_token ON chat_sessions(client_token_id);
  `);

  logger.info('Database initialized successfully.', { context: 'DB' });
}

initDB();

// Prepared statements
const stmts = {
  insertUser: db.prepare(`
    INSERT INTO users (id, username, password_hash, password_salt, display_name)
    VALUES (@id, @username, @passwordHash, @passwordSalt, @displayName)
  `),
  getUserByUsername: db.prepare(`
    SELECT * FROM users WHERE username = ?
  `),
  getUserById: db.prepare(`
    SELECT * FROM users WHERE id = ?
  `),
  countUsers: db.prepare(`
    SELECT COUNT(*) AS count FROM users
  `),
  insertAuthToken: db.prepare(`
    INSERT INTO auth_tokens (id, user_id, token_hash, token_prefix, label, last_used_at)
    VALUES (@id, @userId, @tokenHash, @tokenPrefix, @label, datetime('now'))
  `),
  getAuthTokenWithUserByHash: db.prepare(`
    SELECT
      t.id AS token_id,
      t.user_id,
      t.token_prefix,
      t.label,
      t.created_at AS token_created_at,
      t.updated_at AS token_updated_at,
      t.last_used_at,
      t.revoked_at,
      u.id AS resolved_user_id,
      u.username,
      u.display_name,
      u.created_at AS user_created_at,
      u.updated_at AS user_updated_at
    FROM auth_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
      AND t.revoked_at IS NULL
    LIMIT 1
  `),
  touchAuthToken: db.prepare(`
    UPDATE auth_tokens
    SET last_used_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `),
  revokeAuthToken: db.prepare(`
    UPDATE auth_tokens
    SET revoked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `),
  assignUnownedRunsToUser: db.prepare(`
    UPDATE diagnostic_runs
    SET owner_user_id = @userId
    WHERE owner_user_id IS NULL
  `),
  assignUnownedRunsToToken: db.prepare(`
    UPDATE diagnostic_runs
    SET client_token_id = @clientTokenId
    WHERE client_token_id IS NULL
  `),
  assignUnownedFoldersToUser: db.prepare(`
    UPDATE data_folders
    SET owner_user_id = @userId
    WHERE owner_user_id IS NULL
  `),
  assignUnownedFoldersToToken: db.prepare(`
    UPDATE data_folders
    SET client_token_id = @clientTokenId
    WHERE client_token_id IS NULL
  `),
  assignUnownedChatsToUser: db.prepare(`
    UPDATE chat_sessions
    SET owner_user_id = @userId
    WHERE owner_user_id IS NULL
  `),
  assignUnownedChatsToToken: db.prepare(`
    UPDATE chat_sessions
    SET client_token_id = @clientTokenId
    WHERE client_token_id IS NULL
  `),
  insertRun: db.prepare(`
    INSERT INTO diagnostic_runs (run_id, owner_user_id, client_token_id, name, scene_name, data_path, data_folder, user_question, model, max_turns, report_language)
    VALUES (@runId, @ownerUserId, @clientTokenId, @name, @sceneName, @dataPath, @dataFolder, @userQuestion, @model, @maxTurns, @reportLanguage)
  `),
  updateRunClientToken: db.prepare(`
    UPDATE diagnostic_runs SET client_token_id = @clientTokenId, updated_at = datetime('now') WHERE run_id = @runId
  `),
  updateRunStatus: db.prepare(`
    UPDATE diagnostic_runs SET status = @status, updated_at = datetime('now') WHERE run_id = @runId
  `),
  completeRun: db.prepare(`
    UPDATE diagnostic_runs
    SET status = 'completed', workspace_path = @workspacePath, report_path = @reportPath,
        score = @score, judge_verdict = @judgeVerdict, completed_at = datetime('now'), updated_at = datetime('now')
    WHERE run_id = @runId
  `),
  failRun: db.prepare(`
    UPDATE diagnostic_runs SET status = 'failed', error_message = @error, updated_at = datetime('now') WHERE run_id = @runId
  `),
  insertLog: db.prepare(`
    INSERT INTO diagnosis_logs (run_id, role, content, message_type, tool_name)
    VALUES (@runId, @role, @content, @messageType, @toolName)
  `),
  insertEventStream: db.prepare(`
    INSERT INTO diagnosis_event_stream (run_id, seq, event_type, event_subtype, payload_json)
    VALUES (@runId, @seq, @eventType, @eventSubtype, @payloadJson)
  `),
  getAllRuns: db.prepare(`
    SELECT id, run_id, name, scene_name, data_path, data_folder, user_question, status,
           session_id, workspace_path, report_path, score, judge_verdict,
           created_at, updated_at, completed_at, error_message, owner_user_id, client_token_id
    FROM diagnostic_runs ORDER BY created_at DESC
  `),
  getAllRunsByUser: db.prepare(`
    SELECT id, run_id, name, scene_name, data_path, data_folder, user_question, status,
           session_id, workspace_path, report_path, score, judge_verdict,
           created_at, updated_at, completed_at, error_message, owner_user_id, client_token_id
    FROM diagnostic_runs
    WHERE owner_user_id = ?
    ORDER BY created_at DESC
  `),
  getAllRunsByToken: db.prepare(`
    SELECT id, run_id, name, scene_name, data_path, data_folder, user_question, status,
           session_id, workspace_path, report_path, score, judge_verdict,
           created_at, updated_at, completed_at, error_message, owner_user_id, client_token_id
    FROM diagnostic_runs
    WHERE client_token_id = ?
    ORDER BY created_at DESC
  `),
  getRunById: db.prepare('SELECT * FROM diagnostic_runs WHERE run_id = ?'),
  getRunByIdAndUser: db.prepare('SELECT * FROM diagnostic_runs WHERE run_id = ? AND owner_user_id = ?'),
  getRunByIdAndToken: db.prepare('SELECT * FROM diagnostic_runs WHERE run_id = ? AND client_token_id = ?'),
  getRunByWorkspacePathAndToken: db.prepare('SELECT * FROM diagnostic_runs WHERE workspace_path = ? AND client_token_id = ? LIMIT 1'),
  getLogsByRunId: db.prepare('SELECT * FROM diagnosis_logs WHERE run_id = ? ORDER BY created_at ASC'),
  getEventStreamByRunId: db.prepare(`
    SELECT run_id, seq, event_type, event_subtype, payload_json, created_at
    FROM diagnosis_event_stream
    WHERE run_id = ?
    ORDER BY id ASC
  `),
  getActiveRuns: db.prepare("SELECT run_id FROM diagnostic_runs WHERE status = 'running'"),
  insertFolder: db.prepare(`
    INSERT INTO data_folders (name, owner_user_id, client_token_id, path, description, file_count)
    VALUES (@name, @ownerUserId, @clientTokenId, @path, @description, @fileCount)
  `),
  getAllFolders: db.prepare('SELECT * FROM data_folders ORDER BY created_at DESC'),
  getAllFoldersByUser: db.prepare('SELECT * FROM data_folders WHERE owner_user_id = ? ORDER BY created_at DESC'),
  getAllFoldersByToken: db.prepare('SELECT * FROM data_folders WHERE client_token_id = ? ORDER BY created_at DESC'),
  getFolderByName: db.prepare('SELECT * FROM data_folders WHERE name = ?'),
  getFolderByNameAndUser: db.prepare('SELECT * FROM data_folders WHERE name = ? AND owner_user_id = ?'),
  getFolderByNameAndToken: db.prepare('SELECT * FROM data_folders WHERE name = ? AND client_token_id = ?'),
  deleteFolder: db.prepare('DELETE FROM data_folders WHERE name = ?'),
  deleteFolderByNameAndUser: db.prepare('DELETE FROM data_folders WHERE name = ? AND owner_user_id = ?'),
  deleteFolderByNameAndToken: db.prepare('DELETE FROM data_folders WHERE name = ? AND client_token_id = ?'),
  getClaimedWorkspacePaths: db.prepare('SELECT workspace_path FROM diagnostic_runs WHERE workspace_path IS NOT NULL'),
  getClaimedWorkspacePathsByUser: db.prepare('SELECT workspace_path FROM diagnostic_runs WHERE workspace_path IS NOT NULL AND owner_user_id = ?'),
  updateRunSession: db.prepare('UPDATE diagnostic_runs SET session_id = @sessionId, updated_at = datetime(\'now\') WHERE run_id = @runId'),
  insertChatSession: db.prepare(`
    INSERT INTO chat_sessions (chat_id, owner_user_id, client_token_id, title, session_id, origin_session_id, status, model, permission_mode, cwd)
    VALUES (@chatId, @ownerUserId, @clientTokenId, @title, @sessionId, @originSessionId, @status, @model, @permissionMode, @cwd)
  `),
  updateChatSession: db.prepare(`
    UPDATE chat_sessions
    SET title = COALESCE(@title, title),
        session_id = COALESCE(@sessionId, session_id),
        origin_session_id = COALESCE(origin_session_id, @originSessionId, session_id),
        client_token_id = COALESCE(@clientTokenId, client_token_id),
        permission_mode = COALESCE(@permissionMode, permission_mode),
        cwd = COALESCE(@cwd, cwd),
        status = COALESCE(@status, status),
        updated_at = datetime('now'),
        completed_at = CASE
          WHEN @status = 'active' THEN NULL
          WHEN @status IN ('completed', 'failed', 'stopped') THEN datetime('now')
          ELSE completed_at
        END
    WHERE chat_id = @chatId
  `),
  patchChatSessionConfig: db.prepare(`
    UPDATE chat_sessions
    SET title = COALESCE(@title, title),
        permission_mode = COALESCE(@permissionMode, permission_mode),
        cwd = COALESCE(@cwd, cwd),
        updated_at = datetime('now')
    WHERE chat_id = @chatId
  `),
  getChatSessionByChatId: db.prepare('SELECT * FROM chat_sessions WHERE chat_id = ?'),
  getChatSessionByChatIdAndUser: db.prepare('SELECT * FROM chat_sessions WHERE chat_id = ? AND owner_user_id = ?'),
  getChatSessionByChatIdAndToken: db.prepare('SELECT * FROM chat_sessions WHERE chat_id = ? AND client_token_id = ?'),
  getChatSessionBySessionId: db.prepare('SELECT * FROM chat_sessions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'),
  getAllChatSessions: db.prepare(`
    SELECT * FROM chat_sessions ORDER BY updated_at DESC, created_at DESC
  `),
  getAllChatSessionsByUser: db.prepare(`
    SELECT * FROM chat_sessions WHERE owner_user_id = ? ORDER BY updated_at DESC, created_at DESC
  `),
  getAllChatSessionsByToken: db.prepare(`
    SELECT * FROM chat_sessions WHERE client_token_id = ? ORDER BY updated_at DESC, created_at DESC
  `),
  renameChatSession: db.prepare(`
    UPDATE chat_sessions
    SET title = @title, updated_at = datetime('now')
    WHERE chat_id = @chatId
  `),
  deleteChatSession: db.prepare(`
    DELETE FROM chat_sessions WHERE chat_id = ?
  `),
  deleteChatSessionByUser: db.prepare(`
    DELETE FROM chat_sessions WHERE chat_id = ? AND owner_user_id = ?
  `),
  insertChatMessage: db.prepare(`
    INSERT INTO chat_messages (chat_id, role, content, event_type, event_subtype)
    VALUES (@chatId, @role, @content, @eventType, @eventSubtype)
  `),
  getChatMessagesByChatId: db.prepare(`
    SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id ASC
  `),
  deleteEventStreamByRunId: db.prepare('DELETE FROM diagnosis_event_stream WHERE run_id = ?'),
};

export { db, stmts };
