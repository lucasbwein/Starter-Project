import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createDraftConflictFlow } from '../public/draft-conflict.js';

// The flow is exercised with fakes for every dependency, so each test pins
// the exact call sequence a resolution takes. The delivery fake settles each
// optimistic according to a script keyed by message text, which is how the
// "then mine" ordering and its failure hold are locked.

function harness({ outcomes = {}, persistFailsOnRequired = false } = {}) {
  const log = [];
  const list = [];
  const flow = createDraftConflictFlow({
    deliver: async (optimistic, options) => {
      log.push(['deliver', optimistic.text, options]);
      optimistic.delivery = outcomes[optimistic.text] || 'delivered';
    },
    makeOptimistic: (sessionId, text) => ({
      id: `optimistic:${text}`,
      sessionId,
      text,
      delivery: 'delivering',
    }),
    insertBefore: (entry, reference) => {
      const at = list.indexOf(reference);
      list.splice(at === -1 ? list.length : at, 0, entry);
      log.push(['insert', entry.text]);
    },
    remove: (entry) => {
      const at = list.indexOf(entry);
      if (at !== -1) list.splice(at, 1);
      log.push(['remove', entry.text]);
    },
    restoreComposer: (sessionId, text) => {
      log.push(['restore', sessionId, text]);
    },
    restoreAttachments: (entry) => {
      log.push(['restoreAttachments', entry.text]);
    },
    persist: async (options) => {
      log.push(['persist', options?.required === true]);
      if (persistFailsOnRequired && options?.required === true) {
        throw new Error('secure_delivery_storage_unavailable');
      }
    },
    render: () => log.push(['render']),
    announce: (text) => log.push(['announce', text]),
  });
  return { flow, log, list };
}

function conflicted() {
  return {
    id: 'optimistic:mine',
    sessionId: 'session-1',
    text: 'my phone message',
    macDraft: 'the draft on the mac',
    delivery: 'failed',
    retrySafe: true,
  };
}

test('replace and send delivers with the compare-and-swap fields', async () => {
  const { flow, log } = harness();
  const message = conflicted();
  await flow.replaceAndSend(message);
  const delivery = log.find(([kind]) => kind === 'deliver');
  assert.deepEqual(delivery, [
    'deliver',
    'my phone message',
    { replaceDraft: true, expectedMacDraft: 'the draft on the mac' },
  ]);
});

test('send the Mac draft delivers its exact text and returns mine to the composer', async () => {
  const { flow, log, list } = harness();
  const message = conflicted();
  list.push(message);
  await flow.sendMacDraft(message);
  assert.deepEqual(
    log.filter(([kind]) => kind !== 'render' && kind !== 'persist'),
    [
      ['insert', 'the draft on the mac'],
      ['remove', 'my phone message'],
      ['restore', 'session-1', 'my phone message'],
      ['restoreAttachments', 'my phone message'],
      [
        'deliver',
        'the draft on the mac',
        {
          deliveryIdentityPersisted: true,
          replaceDraft: true,
          expectedMacDraft: 'the draft on the mac',
        },
      ],
    ],
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].text, 'the draft on the mac');
});

test('send the Mac draft goes through the swap branch so edge whitespace cannot loop', async () => {
  // The server trims the outgoing message but never trims expectedMacDraft,
  // so the exact-match path re-conflicts forever on a draft with edge
  // whitespace. The swap path compares the untrimmed text just read.
  const { flow, log } = harness();
  const message = conflicted();
  message.macDraft = '  hello from the mac ';
  await flow.sendMacDraft(message);
  const delivery = log.find(([kind]) => kind === 'deliver');
  assert.equal(delivery[2].replaceDraft, true);
  assert.equal(delivery[2].expectedMacDraft, '  hello from the mac ');
});

test('the Mac draft optimistic is tagged with its origin', async () => {
  const { flow, list } = harness();
  const message = conflicted();
  list.push(message);
  await flow.sendMacDraft(message, { thenPhone: true });
  assert.equal(list[0].origin, 'macDraft');
  assert.equal(list[1].origin, undefined);
});

test('then mine keeps attachments on the queued phone message instead of restoring them', async () => {
  const { flow, log } = harness();
  const message = conflicted();
  await flow.sendMacDraft(message, { thenPhone: true });
  assert.equal(
    log.filter(([kind]) => kind === 'restoreAttachments').length,
    0,
  );
});

test('send the Mac draft then mine delivers both in order once the first confirms', async () => {
  const { flow, log, list } = harness();
  const message = conflicted();
  list.push(message);
  await flow.sendMacDraft(message, { thenPhone: true });
  const deliveries = log.filter(([kind]) => kind === 'deliver');
  assert.deepEqual(
    deliveries.map(([, text]) => text),
    ['the draft on the mac', 'my phone message'],
  );
  assert.equal(list[0].text, 'the draft on the mac');
  assert.equal(list[1].text, 'my phone message');
});

test('a Mac draft that does not confirm holds mine as a retryable failure', async () => {
  const { flow, log } = harness({
    outcomes: { 'the draft on the mac': 'failed' },
  });
  const message = conflicted();
  await flow.sendMacDraft(message, { thenPhone: true });
  const deliveries = log.filter(([kind]) => kind === 'deliver');
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0][1], 'the draft on the mac');
  assert.equal(message.delivery, 'failed');
  assert.equal(message.retrySafe, true);
  assert.ok(
    log.some(
      ([kind, text]) => kind === 'announce' && text.includes('your message is waiting'),
    ),
  );
});

test('a failed required persist rolls the Mac draft attempt back and sends nothing', async () => {
  const { flow, log, list } = harness({ persistFailsOnRequired: true });
  const message = conflicted();
  list.push(message);
  await flow.sendMacDraft(message, { thenPhone: true });
  assert.equal(log.filter(([kind]) => kind === 'deliver').length, 0);
  assert.deepEqual(list, [message]);
  assert.equal(message.delivery, 'failed');
  assert.equal(message.retrySafe, true);
  assert.ok(
    log.some(
      ([kind, text]) => kind === 'announce' && text.includes('secure delivery storage'),
    ),
  );
});

test('an empty Mac draft is treated as a stale sheet and keeps mine safe', async () => {
  const { flow, log } = harness();
  const message = conflicted();
  message.macDraft = '';
  const result = await flow.sendMacDraft(message);
  assert.equal(result, null);
  assert.equal(log.filter(([kind]) => kind === 'deliver').length, 0);
  assert.ok(
    log.some(([kind, , text]) => kind === 'restore' && text === 'my phone message'),
  );
});

test('a whitespace-only Mac draft cannot send and keeps mine safe', async () => {
  // Trimmed server-side it becomes an empty message the relay rejects, so
  // offering to send it would only manufacture a confusing failure.
  const { flow, log } = harness();
  const message = conflicted();
  message.macDraft = '   \n';
  const result = await flow.sendMacDraft(message);
  assert.equal(result, null);
  assert.equal(log.filter(([kind]) => kind === 'deliver').length, 0);
  assert.ok(
    log.some(([kind, , text]) => kind === 'restore' && text === 'my phone message'),
  );
});

test('the composer restore wiring merges with newer typing instead of overwriting it', async () => {
  // A conflict can come back tens of seconds after the send, and the user
  // may have typed something new in the phone composer meanwhile. The app
  // wiring must combine restored text with that typing, the same shape
  // restoreDefinitelyUnsentDraft uses, never blindly assign over it.
  const source = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  const wiringStart = source.indexOf('const draftConflictFlow = createDraftConflictFlow({');
  assert.ok(wiringStart >= 0);
  const wiring = source.slice(wiringStart, wiringStart + 2600);
  assert.match(
    wiring,
    /restoreComposer: \(sessionId, text\) => \{[\s\S]{0,600}current && current !== text[\s\S]{0,200}\$\{text\}\$\{text \? '\\n\\n' : ''\}\$\{current\}/,
  );
  assert.doesNotMatch(
    wiring,
    /restoreComposer: \(sessionId, text\) => \{\s*saveDraft\(sessionId, text\)/,
  );
});

test('keep the Mac draft restores the composer and removes the optimistic', () => {
  const { flow, log, list } = harness();
  const message = conflicted();
  list.push(message);
  flow.keepMacDraft(message);
  assert.equal(log.filter(([kind]) => kind === 'deliver').length, 0);
  assert.deepEqual(
    log.filter(
      ([kind]) =>
        kind === 'restore' || kind === 'remove' || kind === 'restoreAttachments',
    ),
    [
      ['restore', 'session-1', 'my phone message'],
      ['restoreAttachments', 'my phone message'],
      ['remove', 'my phone message'],
    ],
  );
  assert.equal(list.length, 0);
});
