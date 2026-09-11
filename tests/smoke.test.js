'use strict';

// Node smoke tests for the npm CLI's shared library (lib/common.js).
// Run with: node --test tests/
// Mirrors the invariants also checked by tests/smoke.ps1 for the
// PowerShell implementation, since both share the same state format.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function freshStatePath() {
  return path.join(os.tmpdir(), `agent-ping-smoke-${crypto.randomBytes(8).toString('hex')}.json`);
}

function loadFreshCommon() {
  delete require.cache[require.resolve('../lib/common.js')];
  return require('../lib/common.js');
}

test('new state starts empty', () => {
  const statePath = freshStatePath();
  process.env.AGENT_PING_STATE = statePath;
  const common = loadFreshCommon();
  try {
    const state = common.readState();
    assert.equal(state.decisions.length, 0);
  } finally {
    delete process.env.AGENT_PING_STATE;
  }
});

test('promotion preserves the original priority and creates exactly one pending decision', async () => {
  const statePath = freshStatePath();
  process.env.AGENT_PING_STATE = statePath;
  const common = loadFreshCommon();
  try {
    const state = common.readState();
    state.decisions.push({
      decisionId: '1111111111111111', task: 'first', question: 'q', options: ['A', 'B'],
      createdAt: new Date(Date.now() - 120000).toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      status: 'answered', response: null,
    });
    state.decisions.push({
      decisionId: '2222222222222222', task: 'second', question: 'q', options: ['A', 'B'],
      createdAt: new Date(Date.now() - 60000).toISOString(),
      status: 'waiting', expiryMinutes: 5, priority: 5, response: null,
    });

    let sentPriority = null;
    const stubSender = async (args) => { sentPriority = args.priorityNum; return ''; };

    const promoted = await common.promoteWaiting(state, 'outbound-test-topic', 'reply-test-topic', 4, stubSender);
    assert.ok(promoted, 'expected a promoted decision');
    assert.equal(promoted.status, 'pending');
    assert.equal(state.decisions.filter((d) => d.status === 'pending').length, 1);
    assert.equal(promoted.priority, 5, 'promoted decision lost its original priority');
    assert.equal(sentPriority, 5, 'promotion sent the wrong priority to the notifier');
  } finally {
    delete process.env.AGENT_PING_STATE;
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    const lockPath = path.join(path.dirname(statePath), 'decisions.lock');
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
});

test('promotion is a no-op when a decision is already pending', async () => {
  const statePath = freshStatePath();
  process.env.AGENT_PING_STATE = statePath;
  const common = loadFreshCommon();
  try {
    const state = common.readState();
    state.decisions.push({
      decisionId: '3333333333333333', task: 'active', options: ['A', 'B'],
      status: 'pending', expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
    state.decisions.push({
      decisionId: '4444444444444444', task: 'queued', options: ['A', 'B'],
      createdAt: new Date().toISOString(), status: 'waiting', priority: 4,
    });
    let called = false;
    const stubSender = async () => { called = true; return ''; };
    const promoted = await common.promoteWaiting(state, 'outbound-test-topic', 'reply-test-topic', 4, stubSender);
    assert.equal(promoted, null, 'should not promote while a decision is already pending');
    assert.equal(called, false, 'should not send a notification when nothing was promoted');
  } finally {
    delete process.env.AGENT_PING_STATE;
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
});

test('getConfig rejects identical outbound/reply topics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ping-cfg-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ outboundTopic: 'same-test-topic', replyTopic: 'same-test-topic' }));
  process.env.AGENT_PING_CONFIG = configPath;
  const common = loadFreshCommon();
  try {
    assert.throws(() => common.getConfig(), /distinct/);
  } finally {
    delete process.env.AGENT_PING_CONFIG;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getConfig rejects placeholder and too-short topics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ping-cfg-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ outboundTopic: 'REPLACE_ME', replyTopic: 'short' }));
  process.env.AGENT_PING_CONFIG = configPath;
  const common = loadFreshCommon();
  try {
    assert.throws(() => common.getConfig());
  } finally {
    delete process.env.AGENT_PING_CONFIG;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('notify and askDecision reject unknown priorities instead of silently defaulting', async () => {
  process.env.AGENT_PING_OUTBOUND_TOPIC = 'outbound-test-topic';
  process.env.AGENT_PING_REPLY_TOPIC = 'reply-test-topic-2';
  const common = loadFreshCommon();
  try {
    await assert.rejects(
      common.notify({ title: 't', message: 'm', priority: 'whenever' }),
      /priority must be one of/
    );
    await assert.rejects(
      common.askDecision({ taskName: 't', question: 'q?', options: 'A,B', priority: 'whenever' }),
      /priority must be one of/
    );
  } finally {
    delete process.env.AGENT_PING_OUTBOUND_TOPIC;
    delete process.env.AGENT_PING_REPLY_TOPIC;
  }
});

test('watchReply rejects non-numeric durations instead of silently timing out', async () => {
  process.env.AGENT_PING_OUTBOUND_TOPIC = 'outbound-test-topic';
  process.env.AGENT_PING_REPLY_TOPIC = 'reply-test-topic-2';
  const common = loadFreshCommon();
  try {
    await assert.rejects(common.watchReply({ durationSeconds: Number('abc') }), /durationSeconds/);
  } finally {
    delete process.env.AGENT_PING_OUTBOUND_TOPIC;
    delete process.env.AGENT_PING_REPLY_TOPIC;
  }
});

test('notify rejects empty titles and messages', async () => {
  process.env.AGENT_PING_OUTBOUND_TOPIC = 'outbound-test-topic';
  process.env.AGENT_PING_REPLY_TOPIC = 'reply-test-topic-2';
  const common = loadFreshCommon();
  try {
    await assert.rejects(common.notify({ title: '  ', message: 'm' }), /title/);
    await assert.rejects(common.notify({ title: 't', message: '' }), /message/);
  } finally {
    delete process.env.AGENT_PING_OUTBOUND_TOPIC;
    delete process.env.AGENT_PING_REPLY_TOPIC;
  }
});

test('askDecision rejects fewer than 2 or more than 3 options', async () => {
  process.env.AGENT_PING_OUTBOUND_TOPIC = 'outbound-test-topic';
  process.env.AGENT_PING_REPLY_TOPIC = 'reply-test-topic-2';
  const common = loadFreshCommon();
  try {
    await assert.rejects(
      common.askDecision({ taskName: 't', question: 'q?', options: 'OnlyOne' }),
      /at least 2/
    );
    await assert.rejects(
      common.askDecision({ taskName: 't', question: 'q?', options: 'A,B,C,D' }),
      /no more than 3/
    );
  } finally {
    delete process.env.AGENT_PING_OUTBOUND_TOPIC;
    delete process.env.AGENT_PING_REPLY_TOPIC;
  }
});
