'use strict';

// Shared helpers for the agent-ping npm CLI. Zero runtime dependencies.
// Reads the SAME config.json / state/decisions.json format as the
// PowerShell scripts in ../scripts, so both implementations interoperate.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const PRIORITY_MAP = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };
const VALID_PRIORITIES = Object.keys(PRIORITY_MAP);
const VALID_TYPES = ['success', 'blocked', 'decision'];
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{8,}$/;
const DECISION_LINE_PATTERN = /^decision=([0-9a-f]{16})&option=(.+)$/;

function assertPriority(priority) {
  if (!VALID_PRIORITIES.includes(priority)) {
    throw new Error(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }
  return PRIORITY_MAP[priority];
}

class LockTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LockTimeoutError';
    this.code = 'LOCK_TIMEOUT';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findConfigPath() {
  if (process.env.AGENT_PING_CONFIG) return process.env.AGENT_PING_CONFIG;
  const candidate = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

/**
 * Resolves ntfy topics from (in order): AGENT_PING_OUTBOUND_TOPIC and
 * AGENT_PING_REPLY_TOPIC env vars (both must be set to use them), or a
 * config.json in the current directory (or AGENT_PING_CONFIG). Throws if
 * topics are missing, placeholder-looking, too short, or identical to
 * each other.
 */
function getConfig() {
  const envOut = process.env.AGENT_PING_OUTBOUND_TOPIC;
  const envReply = process.env.AGENT_PING_REPLY_TOPIC;
  let config;
  if (envOut && envReply) {
    config = { outboundTopic: envOut, replyTopic: envReply };
  } else {
    const configPath = findConfigPath();
    if (!configPath) {
      throw new Error(
        'No config found. Set both AGENT_PING_OUTBOUND_TOPIC and AGENT_PING_REPLY_TOPIC env vars, ' +
        'or create config.json in the current directory (copy config.example.json).'
      );
    }
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  if (
    !config.outboundTopic || !config.replyTopic ||
    String(config.outboundTopic).startsWith('REPLACE') || String(config.replyTopic).startsWith('REPLACE') ||
    !TOPIC_PATTERN.test(config.outboundTopic) || !TOPIC_PATTERN.test(config.replyTopic) ||
    config.outboundTopic === config.replyTopic
  ) {
    throw new Error(
      'Config must contain distinct, non-placeholder outboundTopic and replyTopic values ' +
      '(8+ chars, letters/numbers/underscore/hyphen only).'
    );
  }
  return config;
}

function statePath() {
  return process.env.AGENT_PING_STATE || path.join(process.cwd(), 'state', 'decisions.json');
}

function lockPath() {
  return path.join(path.dirname(statePath()), 'decisions.lock');
}

function readState() {
  const p = statePath();
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return { listener: { lastMessageId: '' }, decisions: [] };
}

/** Atomic write: write to a temp file in the same directory, then rename. */
function writeState(state) {
  const p = statePath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/**
 * Cross-process lock using an exclusive-create lock file (fs 'wx' flag).
 * Unlike the PowerShell FileShare.None lock, this does NOT auto-release if
 * the holding process crashes mid-lock. To self-heal from that rare case,
 * a lock file older than `staleMs` is treated as abandoned and removed.
 */
async function withLock(fn, { timeoutMs = 30000, staleMs = 60000 } = {}) {
  const lp = lockPath();
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  while (Date.now() < deadline) {
    try {
      fd = fs.openSync(lp, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const st = fs.statSync(lp);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.unlinkSync(lp);
          continue;
        }
      } catch (_) {
        // Lock disappeared between the failed open and this stat; loop retries.
      }
      await sleep(200);
    }
  }
  if (fd === null) {
    throw new LockTimeoutError('Could not acquire the decision lock (timed out).');
  }
  try {
    return await fn();
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* already closed */ }
    try { fs.unlinkSync(lp); } catch (_) { /* already removed */ }
  }
}

function postJson(payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request(
      'https://ntfy.sh',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        timeout: 20000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error(`ntfy returned HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('ntfy request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJsonLines(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`ntfy poll returned HTTP ${res.statusCode}`));
          return;
        }
        const events = body
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('{"id"'))
          .map((line) => {
            try { return JSON.parse(line); } catch (_) { return null; }
          })
          .filter(Boolean);
        resolve(events);
      });
    });
    req.on('timeout', () => req.destroy(new Error('ntfy poll timed out')));
    req.on('error', reject);
  });
}

/** One-way push notification. No state involved. */
async function notify({ title, message, priority = 'default', type = '' }) {
  if (typeof title !== 'string' || title.trim() === '') throw new Error('title must be a non-empty string.');
  if (typeof message !== 'string' || message.trim() === '') throw new Error('message must be a non-empty string.');
  if (type && !VALID_TYPES.includes(type)) throw new Error(`type must be one of: ${VALID_TYPES.join(', ')}`);
  const config = getConfig();
  let t = title;
  if (type === 'success') t = '\u2705 ' + t;
  else if (type === 'blocked') t = '\u26A0\uFE0F ' + t;
  else if (type === 'decision') t = '\u2753 ' + t;
  const priorityNum = assertPriority(priority);
  await postJson({ topic: config.outboundTopic, title: t, message, priority: priorityNum });
  return `OK: notification accepted '${t}'`;
}

/** Sends an A/B/C decision notification with reply-button actions. */
async function sendDecision({ decisionId, taskName, question, options, outboundTopic, replyTopic, priorityNum = 4 }) {
  const labels = ['A', 'B', 'C'];
  const actions = options.slice(0, 3).map((opt, i) => ({
    action: 'http',
    label: `${labels[i]} - ${opt}`,
    method: 'POST',
    url: `https://ntfy.sh/${replyTopic}`,
    body: `decision=${encodeURIComponent(decisionId)}&option=${encodeURIComponent(opt)}`,
  }));
  return postJson({
    topic: outboundTopic,
    title: `Needs a decision - ${taskName}`,
    message: question,
    priority: priorityNum,
    actions,
  });
}

/**
 * If nothing is pending and a decision is waiting, promotes the oldest
 * waiting decision to pending and sends its notification, preserving its
 * original priority. Returns the promoted decision, or null if nothing to
 * promote. Caller must persist `state` afterwards (this mutates it).
 */
async function promoteWaiting(state, outboundTopic, replyTopic, defaultPriority = 4, sender = sendDecision) {
  const pending = (state.decisions || []).filter((d) => d.status === 'pending');
  if (pending.length > 0) return null;
  const waiting = (state.decisions || [])
    .filter((d) => d.status === 'waiting')
    .sort((a, b) => (new Date(a.createdAt).getTime() || 0) - (new Date(b.createdAt).getTime() || 0));
  if (waiting.length === 0) return null;

  const old = waiting[0];
  const expiryMinutes = old.expiryMinutes || 720;
  const priority = old.priority || defaultPriority;
  const promoted = {
    decisionId: old.decisionId,
    task: old.task,
    question: old.question,
    options: [...old.options],
    createdAt: old.createdAt,
    expiresAt: new Date(Date.now() + expiryMinutes * 60000).toISOString(),
    status: 'pending',
    promotedAt: new Date().toISOString(),
    expiryMinutes,
    priority,
    response: null,
    replyMessageId: null,
  };
  await sender({
    decisionId: promoted.decisionId,
    taskName: promoted.task,
    question: promoted.question,
    options: promoted.options,
    outboundTopic,
    replyTopic,
    priorityNum: priority,
  });
  state.decisions = state.decisions.map((d) => (d.decisionId === old.decisionId ? promoted : d));
  return promoted;
}

/**
 * Ask a 2-3 option question on the phone. Queues behind an existing
 * pending decision instead of overwriting it. If the pending decision has
 * expired and older decisions are waiting, the oldest waiting decision is
 * promoted first and the new one queues behind it (FIFO). Returns
 * { decisionId, queued, waitsFor? } or { decisionId, queued: false, expiresAt }.
 */
async function askDecision({ taskName, question, options, priority = 'high', expiryMinutes = 720, sender = sendDecision }) {
  if (!Number.isFinite(expiryMinutes) || expiryMinutes < 1 || expiryMinutes > 43200) {
    throw new Error('expiryMinutes must be a number between 1 and 43200.');
  }
  if (/[\r\n]/.test(taskName) || /[\r\n]/.test(question)) {
    throw new Error('taskName and question cannot contain line breaks.');
  }
  const opts = options.split(',').map((o) => o.trim()).filter((o) => o !== '');
  if (opts.length < 2) throw new Error('Provide at least 2 comma-separated options.');
  if (opts.length > 3) throw new Error('Provide no more than 3 comma-separated options.');
  if (opts.some((o) => /[\r\n]/.test(o))) throw new Error('Options cannot contain line breaks.');

  const config = getConfig();
  const priorityNum = assertPriority(priority);
  const id = crypto.randomBytes(8).toString('hex');

  const result = await withLock(async () => {
    const state = readState();
    state.decisions = state.decisions || [];
    const now = Date.now();
    for (const existing of state.decisions) {
      if (existing.status === 'pending' && existing.expiresAt && new Date(existing.expiresAt).getTime() < now) {
        existing.status = 'expired';
      }
    }
    const pending = state.decisions.filter((d) => d.status === 'pending');
    if (pending.length > 0) {
      state.decisions.push({
        decisionId: id, task: taskName, question, options: opts,
        createdAt: new Date().toISOString(), status: 'waiting',
        waitsFor: pending[0].decisionId, expiryMinutes, priority: priorityNum, response: null,
      });
      writeState(state);
      return { queued: true, waitsFor: pending[0].decisionId };
    }
    // Nothing pending. If older decisions are waiting, promote the oldest
    // one first so the queue stays FIFO, then queue behind it.
    const waiting = state.decisions.filter((d) => d.status === 'waiting');
    if (waiting.length > 0) {
      try {
        const promoted = await promoteWaiting(state, config.outboundTopic, config.replyTopic, priorityNum, sender);
        if (promoted) {
          state.decisions.push({
            decisionId: id, task: taskName, question, options: opts,
            createdAt: new Date().toISOString(), status: 'waiting',
            waitsFor: promoted.decisionId, expiryMinutes, priority: priorityNum, response: null,
          });
          writeState(state);
          return { queued: true, waitsFor: promoted.decisionId };
        }
      } catch (_) {
        // Promotion send failed; fall through and become pending. The
        // waiting decision stays queued and is retried on the next call.
      }
    }
    const expiresAt = new Date(now + expiryMinutes * 60000).toISOString();
    state.decisions.push({
      decisionId: id, task: taskName, question, options: opts,
      createdAt: new Date().toISOString(), expiresAt, status: 'pending',
      priority: priorityNum, response: null,
    });
    writeState(state);
    return { queued: false, expiresAt };
  });

  if (result.queued) {
    return { decisionId: id, queued: true, waitsFor: result.waitsFor };
  }

  try {
    await sender({
      decisionId: id, taskName, question, options: opts,
      outboundTopic: config.outboundTopic, replyTopic: config.replyTopic, priorityNum,
    });
    return { decisionId: id, queued: false, expiresAt: result.expiresAt };
  } catch (err) {
    await withLock(async () => {
      const state = readState();
      state.decisions = (state.decisions || []).filter((d) => d.decisionId !== id);
      try {
        await promoteWaiting(state, config.outboundTopic, config.replyTopic, priorityNum, sender);
      } catch (_) {
        // Leave it queued; the next ask/watch call will retry the promotion.
      }
      writeState(state);
    });
    throw err;
  }
}

/**
 * Poll for a phone-tap reply. Resolves 0 once a valid answer is consumed
 * (after printing RESPONSE_RECEIVED / DECISION_ID / OPTION / MESSAGE_ID),
 * or 1 on timeout (TIMEOUT_NO_RESPONSE).
 */
async function watchReply({ durationSeconds = 600 } = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400) {
    throw new Error('durationSeconds must be a number between 1 and 86400.');
  }
  const config = getConfig();
  const deadline = Date.now() + durationSeconds * 1000;

  while (Date.now() < deadline) {
    let since = 'all';
    await withLock(async () => {
      const state = readState();
      state.listener = state.listener || { lastMessageId: '' };
      if (state.listener.lastMessageId) since = state.listener.lastMessageId;
      let changed = false;
      const now = Date.now();
      for (const d of state.decisions || []) {
        if (d.status === 'pending' && d.expiresAt && new Date(d.expiresAt).getTime() < now) {
          d.status = 'expired';
          changed = true;
        }
      }
      try {
        const promoted = await promoteWaiting(state, config.outboundTopic, config.replyTopic);
        if (promoted) {
          changed = true;
          console.log(`PROMOTED_WAITING: ${promoted.decisionId} -> pending (task: ${promoted.task})`);
        }
      } catch (err) {
        console.log(`LISTENER_ERR: queued decision promotion failed: ${err.message}`);
      }
      if (changed) writeState(state);
    });

    let events = [];
    try {
      events = await getJsonLines(`https://ntfy.sh/${config.replyTopic}/json?poll=1&since=${since}`);
    } catch (err) {
      console.log(`LISTENER_ERR: ${err.message}`);
    }

    const received = [];
    await withLock(async () => {
      const state = readState();
      state.listener = state.listener || { lastMessageId: '' };
      let changed = false;
      for (const evt of events) {
        if (!evt || !evt.id) continue;
        state.listener.lastMessageId = evt.id;
        changed = true;

        const match = DECISION_LINE_PATTERN.exec(evt.message || '');
        if (!match) continue;
        const did = match[1];
        let ans;
        try { ans = decodeURIComponent(match[2]); } catch (_) { continue; }

        const d = (state.decisions || []).find((x) => x.decisionId === did);
        if (!d || d.status !== 'pending') continue;

        if (d.expiresAt && new Date(d.expiresAt).getTime() < Date.now()) {
          d.status = 'expired';
          changed = true;
          try {
            const promoted = await promoteWaiting(state, config.outboundTopic, config.replyTopic);
            if (promoted) {
              changed = true;
              console.log(`PROMOTED_WAITING: ${promoted.decisionId} -> pending (task: ${promoted.task})`);
            }
          } catch (err) {
            console.log(`LISTENER_ERR: queued decision promotion failed: ${err.message}`);
          }
          continue;
        }

        if (!d.options.some((o) => String(o) === ans)) continue;

        d.status = 'answered';
        d.response = { option: ans, messageId: evt.id, time: evt.time };
        d.replyMessageId = evt.id;
        received.push({ decisionId: did, option: ans, messageId: evt.id, task: d.task });
        changed = true;

        try {
          const promoted = await promoteWaiting(state, config.outboundTopic, config.replyTopic);
          if (promoted) {
            changed = true;
            console.log(`PROMOTED_WAITING: ${promoted.decisionId} -> pending (task: ${promoted.task})`);
          }
        } catch (err) {
          console.log(`LISTENER_ERR: queued decision promotion failed: ${err.message}`);
        }
      }
      if (changed) writeState(state);
    });

    if (received.length > 0) {
      for (const r of received) {
        console.log(`RESPONSE_RECEIVED: decision=${r.decisionId}&option=${r.option} (task: ${r.task})`);
        console.log(`DECISION_ID=${r.decisionId}`);
        console.log(`OPTION=${r.option}`);
        console.log(`MESSAGE_ID=${r.messageId}`);
      }
      return 0;
    }
    if (Date.now() < deadline) await sleep(3000);
  }
  console.log('TIMEOUT_NO_RESPONSE');
  return 1;
}

module.exports = {
  PRIORITY_MAP,
  LockTimeoutError,
  getConfig,
  statePath,
  lockPath,
  readState,
  writeState,
  withLock,
  sendDecision,
  promoteWaiting,
  notify,
  askDecision,
  watchReply,
};
