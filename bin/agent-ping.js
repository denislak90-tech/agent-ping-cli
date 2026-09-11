#!/usr/bin/env node
'use strict';

const { notify, askDecision, watchReply } = require('../lib/common.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function printUsage() {
  console.error('Usage: agent-ping <notify|ask|watch> [--flags]');
  console.error('');
  console.error('  notify --title <t> --message <m> [--priority min|low|default|high|urgent] [--type success|blocked|decision]');
  console.error('  ask    --task <t> --question <q> --options "A,B,C" [--priority min|low|default|high|urgent] [--expiry-minutes 720]');
  console.error('  watch  [--duration 600]');
  console.error('');
  console.error('Config: set AGENT_PING_OUTBOUND_TOPIC and AGENT_PING_REPLY_TOPIC env vars,');
  console.error('or create config.json in the current directory (see config.example.json).');
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }

  try {
    if (cmd === 'notify') {
      if (typeof args.title !== 'string' || args.title.trim() === '') {
        throw new Error('notify requires --title <text> and --message <text>');
      }
      if (typeof args.message !== 'string' || args.message.trim() === '') {
        throw new Error('notify requires --title <text> and --message <text>');
      }
      const result = await notify({
        title: args.title,
        message: args.message,
        priority: args.priority || 'default',
        type: args.type || '',
      });
      console.log(result);
      process.exit(0);
    } else if (cmd === 'ask') {
      for (const flag of ['task', 'question', 'options']) {
        if (typeof args[flag] !== 'string' || args[flag].trim() === '') {
          throw new Error('ask requires --task <text>, --question <text>, and --options "A,B,C"');
        }
      }
      const result = await askDecision({
        taskName: args.task,
        question: args.question,
        options: args.options,
        priority: args.priority || 'high',
        expiryMinutes: args['expiry-minutes'] ? Number(args['expiry-minutes']) : 720,
      });
      if (result.queued) {
        console.log(`WAITING: queued behind ${result.waitsFor}`);
        console.log(`DECISION_ID=${result.decisionId}`);
        process.exit(2);
      }
      console.log('OK: decision sent');
      console.log(`DECISION_ID=${result.decisionId}`);
      console.log(`EXPIRES=${result.expiresAt}`);
      process.exit(0);
    } else if (cmd === 'watch') {
      const code = await watchReply({
        durationSeconds: args.duration ? Number(args.duration) : 600,
      });
      process.exit(code);
    } else {
      printUsage();
      process.exit(1);
    }
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    if (cmd === 'ask' && err.code === 'LOCK_TIMEOUT') process.exit(3);
    process.exit(1);
  }
}

main();
