import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import * as deliveryReceipts from '../public/delivery-receipts.js';
import {
  createDeliveryActionCoordinator,
  deliveryNeedsAutomaticRecovery,
  deliveredReceiptCanDismiss,
  deliveredReceiptVerificationDelay,
  deliveryReceiptObservationDisposition,
  deliveryRecoveryDecision,
  deliveryStatusIsTerminal,
  extendDeliveryRecoveryDeadline,
  missingDeliveredReceiptDisposition,
  readDeliveryStatusResponse,
  rearmDeliveryRecovery,
  receiptReachedTranscript,
  reconcileDeliveryReceipts,
  runDefinitelyUnsentRetry,
  sameDeliveredReceiptIdentity,
  terminalDeliveryActionDisposition,
} from '../public/delivery-receipts.js';

function persistedMessage(overrides = {}) {
  return {
    id: 'optimistic:message-123456789',
    idempotencyKey: 'idempotency-key-123456789',
    activeDeliveryKey: 'idempotency-key-123456789',
    kind: 'optimistic',
    sessionId: 'session-1',
    text: 'Keep this text safe',
    attachments: [],
    delivery: 'failed',
    retrySafe: true,
    definitelyUnsent: true,
    deliveryAttempt: 1,
    createdAt: '2026-08-23T12:00:00.000Z',
    ...overrides,
  };
}

const acceptPersistedMessage = (value) =>
  value?.kind === 'optimistic' ? structuredClone(value) : null;

test('a terminal tombstone stops a stale Pocket window from resurrecting a deleted delivery', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const staleWindowMessage = persistedMessage();
  const initial = [structuredClone(staleWindowMessage)];

  const deleted = transition?.(
    initial,
    {
      type: 'claim-terminal',
      action: 'delete',
      message: staleWindowMessage,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const staleRecovery = transition?.(
    deleted?.snapshot,
    { type: 'mutate', upserts: [staleWindowMessage] },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );

  assert.equal(deleted?.value?.id, staleWindowMessage.id);
  assert.deepEqual(staleRecovery?.snapshot?.messages, []);
  assert.equal(staleRecovery?.snapshot?.version, 2);
  assert.equal(staleRecovery?.snapshot?.tombstones?.length, 1);
});

test('a certified unsent retry claims locally and posts the same delivery without a status preflight', async () => {
  const message = persistedMessage({
    errorCode: 'automation_budget_exhausted',
  });
  const calls = [];
  const claimed = {
    ...message,
    delivery: 'delivering',
    deliveryAttempt: 2,
    retrySafe: false,
    definitelyUnsent: false,
  };

  const result = await runDefinitelyUnsentRetry({
    message,
    canRetry(candidate) {
      calls.push(['can-retry', candidate.activeDeliveryKey]);
      return candidate.retrySafe === true && candidate.definitelyUnsent === true;
    },
    async claim(candidate) {
      calls.push(['claim', candidate.activeDeliveryKey]);
      return claimed;
    },
    apply(candidate) {
      calls.push(['apply', candidate.activeDeliveryKey]);
    },
    deliver(candidate) {
      calls.push(['post', candidate.activeDeliveryKey]);
    },
  });

  assert.deepEqual(result, { status: 'started', message: claimed });
  assert.deepEqual(calls, [
    ['can-retry', message.activeDeliveryKey],
    ['claim', message.activeDeliveryKey],
    ['apply', message.activeDeliveryKey],
    ['post', message.activeDeliveryKey],
  ]);
});

test('stopping a delivery check leaves one actionable notice without rearming recovery', () => {
  const checking = persistedMessage({
    delivery: 'confirming',
    deliveryPhase: 'confirming',
    retrySafe: false,
    definitelyUnsent: false,
    deliveryRecoveryExhausted: false,
    errorCode: null,
  });
  const stopped = deliveryReceipts.pendingDeliverySnapshotTransition(
    [checking],
    { type: 'stop-check', message: checking },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );

  assert.equal(stopped.value?.delivery, 'failed');
  assert.equal(stopped.value?.deliveryPhase, null);
  assert.equal(stopped.value?.errorCode, 'delivery_check_stopped');
  assert.equal(stopped.value?.deliveryRecoveryExhausted, true);
  assert.equal(stopped.value?.definitelyUnsent, false);
  assert.equal(
    deliveryNeedsAutomaticRecovery(stopped.value),
    false,
    'a user-stopped check must stay stopped until Check is tapped',
  );

  const staleIdentity = {
    ...checking,
    activeDeliveryKey: 'different-idempotency-key-123456789',
  };
  const rejected = deliveryReceipts.pendingDeliverySnapshotTransition(
    stopped.snapshot,
    { type: 'stop-check', message: staleIdentity },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  assert.equal(rejected.value, null);
  assert.equal(rejected.snapshot.messages[0].errorCode, 'delivery_check_stopped');
});

test('a retry clears the collapsed project name from the prior failure', () => {
  const message = persistedMessage({
    errorCode: 'workspace_project_collapsed',
    errorProjectName: 'Quickstart',
  });
  const retried = deliveryReceipts.pendingDeliverySnapshotTransition(
    [message],
    {
      type: 'claim-terminal',
      action: 'retry',
      message,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );

  assert.equal(retried.value?.delivery, 'delivering');
  assert.equal(retried.value?.errorCode, null);
  assert.equal(retried.value?.errorProjectName, null);
});

test('a failed draft write releases an edit claim and leaves the delivery recoverable', async () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const recover = deliveryReceipts.persistRecoveredDraftBeforeFinalizing;
  const message = persistedMessage();
  let sharedSnapshot = [structuredClone(message)];
  const claimed = transition?.(
    sharedSnapshot,
    {
      type: 'claim-terminal',
      action: 'edit',
      claimToken: 'edit-claim-token-123456789',
      message,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  sharedSnapshot = claimed?.snapshot;

  const result = await recover?.({
    persistDraft: () => false,
    finalize: () => {
      assert.fail('the pending delivery must not finalize before the draft is durable');
    },
    release: () => {
      const released = transition(
        sharedSnapshot,
        {
          type: 'release-edit',
          claimToken: 'edit-claim-token-123456789',
          message,
        },
        { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
      );
      sharedSnapshot = released.snapshot;
      return released.value;
    },
  });

  assert.deepEqual(result, { status: 'draft-failed', value: null });
  assert.equal(sharedSnapshot?.messages?.length, 1);
  assert.equal(sharedSnapshot?.messages?.[0]?.text, message.text);
  assert.equal(sharedSnapshot?.messages?.[0]?.terminalActionClaim, undefined);
  assert.deepEqual(sharedSnapshot?.tombstones, []);
});

test('two Pocket windows get one atomic winner for the same visible draft revision', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const firstMessage = persistedMessage({
    id: 'optimistic:first-message-123456789',
    delivery: 'delivering',
  });
  const secondMessage = persistedMessage({
    id: 'optimistic:second-message-123456789',
    idempotencyKey: 'idempotency-key-987654321',
    activeDeliveryKey: 'idempotency-key-987654321',
    delivery: 'delivering',
  });
  const command = (message) => ({
    type: 'claim-draft-send',
    sessionId: 'session-1',
    draftRevision: 'draft-revision-123456789',
    message,
  });

  const firstWindow = transition?.(
    [],
    command(firstMessage),
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const secondWindow = transition?.(
    firstWindow?.snapshot,
    command(secondMessage),
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );

  assert.equal(firstWindow?.value?.id, firstMessage.id);
  assert.equal(secondWindow?.value?.kind, 'draft-claim-conflict');
  assert.equal(secondWindow?.value?.message?.id, firstMessage.id);
  assert.deepEqual(
    secondWindow?.snapshot?.messages?.map((item) => item.id),
    [firstMessage.id],
  );
  assert.equal(secondWindow?.snapshot?.draftClaims?.length, 1);
});

test('a duplicate draft claim identifies the exact delivery that owns it', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const firstMessage = persistedMessage({
    id: 'optimistic:owned-draft-first-123456789',
    delivery: 'delivered',
    retrySafe: false,
    definitelyUnsent: false,
  });
  const duplicateMessage = persistedMessage({
    id: 'optimistic:owned-draft-duplicate-123456789',
    idempotencyKey: 'idempotency-owned-draft-duplicate-123456789',
    activeDeliveryKey: 'idempotency-owned-draft-duplicate-123456789',
    delivery: 'delivering',
  });
  const claim = (message, draftRevision) => ({
    type: 'claim-draft-send',
    sessionId: 'session-1',
    draftRevision,
    payloadFingerprint: 'payload-owned-draft-123456789',
    message,
  });

  const first = transition(
    [],
    claim(firstMessage, 'draft-owned-first-123456789'),
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const duplicate = transition(
    first.snapshot,
    claim(duplicateMessage, 'draft-owned-duplicate-123456789'),
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );

  assert.equal(first.snapshot.draftClaims[0].messageId, firstMessage.id);
  assert.equal(duplicate.value?.kind, 'draft-claim-conflict');
  assert.equal(duplicate.value?.message?.id, firstMessage.id);
  assert.equal(duplicate.value?.message?.delivery, 'delivered');
  assert.deepEqual(
    duplicate.snapshot.messages.map((message) => message.id),
    [firstMessage.id],
  );
});

test('editing a definitely unsent delivery releases only its exact draft claim', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const message = persistedMessage({
    id: 'optimistic:safe-edit-claim-123456789',
    definitelyUnsent: true,
  });
  const first = transition(
    [],
    {
      type: 'claim-draft-send',
      sessionId: message.sessionId,
      draftRevision: 'draft-safe-edit-123456789',
      payloadFingerprint: 'payload-safe-edit-123456789',
      message,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const claimedEdit = transition(
    first.snapshot,
    {
      type: 'claim-terminal',
      action: 'edit',
      claimToken: 'edit-safe-claim-token-123456789',
      message,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  const finalized = transition(
    claimedEdit.snapshot,
    {
      type: 'finalize-edit',
      claimToken: 'edit-safe-claim-token-123456789',
      payloadFingerprint: 'payload-safe-edit-123456789',
      message: claimedEdit.value,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_779_000 },
  );

  assert.equal(finalized.value?.id, message.id);
  assert.deepEqual(finalized.snapshot.messages, []);
  assert.deepEqual(finalized.snapshot.draftClaims, []);
});

test('editing an unconfirmed delivery keeps its duplicate protection', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const message = persistedMessage({
    id: 'optimistic:ambiguous-edit-claim-123456789',
    retrySafe: false,
    definitelyUnsent: false,
  });
  const first = transition(
    [],
    {
      type: 'claim-draft-send',
      sessionId: message.sessionId,
      draftRevision: 'draft-ambiguous-edit-123456789',
      payloadFingerprint: 'payload-ambiguous-edit-123456789',
      message,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const claimedEdit = transition(
    first.snapshot,
    {
      type: 'claim-terminal',
      action: 'edit',
      claimToken: 'edit-ambiguous-claim-token-123456789',
      message,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  const finalized = transition(
    claimedEdit.snapshot,
    {
      type: 'finalize-edit',
      claimToken: 'edit-ambiguous-claim-token-123456789',
      payloadFingerprint: 'payload-ambiguous-edit-123456789',
      message: claimedEdit.value,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_779_000 },
  );

  assert.equal(finalized.snapshot.draftClaims.length, 1);
  assert.equal(
    finalized.snapshot.draftClaims[0].messageId,
    message.id,
  );
});

test('a retried delivery remains the owner of its original draft claim', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const message = persistedMessage({
    id: 'optimistic:retried-owner-123456789',
    definitelyUnsent: true,
  });
  const duplicate = persistedMessage({
    id: 'optimistic:retried-owner-duplicate-123456789',
    idempotencyKey: 'idempotency-retried-owner-duplicate-123456789',
    activeDeliveryKey: 'idempotency-retried-owner-duplicate-123456789',
    delivery: 'delivering',
  });
  const first = transition(
    [],
    {
      type: 'claim-draft-send',
      sessionId: message.sessionId,
      draftRevision: 'draft-retried-owner-first-123456789',
      payloadFingerprint: 'payload-retried-owner-123456789',
      message,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const retried = transition(
    first.snapshot,
    { type: 'claim-terminal', action: 'retry', message },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  const blocked = transition(
    retried.snapshot,
    {
      type: 'claim-draft-send',
      sessionId: duplicate.sessionId,
      draftRevision: 'draft-retried-owner-second-123456789',
      payloadFingerprint: 'payload-retried-owner-123456789',
      message: duplicate,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_779_000 },
  );

  assert.equal(retried.value?.deliveryAttempt, 2);
  assert.equal(blocked.value?.kind, 'draft-claim-conflict');
  assert.equal(blocked.value?.message?.id, message.id);
  assert.equal(blocked.value?.message?.deliveryAttempt, 2);
});

test('a reconciled delivery releases its draft claim before an intentional identical send', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const firstMessage = persistedMessage({
    id: 'optimistic:resolved-draft-owner-123456789',
    idempotencyKey: 'resolved-draft-owner-key-123456789',
    activeDeliveryKey: 'resolved-draft-owner-key-123456789',
    delivery: 'delivered',
    retrySafe: false,
    definitelyUnsent: false,
    receiptObservedAt: 1_777_777_778_000,
  });
  const snapshot = {
    version: 2,
    messages: [firstMessage],
    tombstones: [],
    draftClaims: [{
      sessionId: firstMessage.sessionId,
      draftRevision: 'resolved-draft-revision-123456789',
      payloadFingerprint: 'resolved-draft-payload-123456789',
      messageId: firstMessage.id,
      activeDeliveryKey: firstMessage.activeDeliveryKey,
      deliveryAttempt: firstMessage.deliveryAttempt,
      at: 1_777_777_777_000,
    }],
  };
  const expired = transition(
    snapshot,
    {
      type: 'expire-receipt',
      message: firstMessage,
      observedAt: firstMessage.receiptObservedAt,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_779_000 },
  );
  const secondMessage = persistedMessage({
    id: 'optimistic:later-identical-send-123456789',
    idempotencyKey: 'later-identical-send-key-123456789',
    activeDeliveryKey: 'later-identical-send-key-123456789',
    delivery: 'delivering',
  });
  const second = transition(
    expired.snapshot,
    {
      type: 'claim-draft-send',
      sessionId: secondMessage.sessionId,
      draftRevision: 'later-identical-draft-revision-123456789',
      payloadFingerprint: 'resolved-draft-payload-123456789',
      message: secondMessage,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_780_000 },
  );

  assert.equal(expired.value?.id, firstMessage.id);
  assert.deepEqual(expired.snapshot.draftClaims, []);
  assert.equal(second.value?.id, secondMessage.id);
});

test('snapshot normalization clears a legacy draft claim whose delivery already resolved', () => {
  const ownerId = 'optimistic:legacy-resolved-owner-123456789';
  const normalized = deliveryReceipts.pendingDeliverySnapshotTransition(
    {
      version: 2,
      messages: [],
      tombstones: [{
        id: ownerId,
        activeDeliveryKey: 'legacy-resolved-owner-key-123456789',
        deliveryAttempt: 1,
        action: 'resolved',
        at: 1_777_777_777_000,
      }],
      draftClaims: [{
        sessionId: 'session-1',
        draftRevision: 'legacy-resolved-revision-123456789',
        payloadFingerprint: 'legacy-resolved-payload-123456789',
        messageId: ownerId,
        activeDeliveryKey: 'legacy-resolved-owner-key-123456789',
        deliveryAttempt: 1,
        at: 1_777_777_777_000,
      }],
    },
    { type: 'mutate' },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );

  assert.deepEqual(normalized.snapshot.draftClaims, []);
});

test('deleting a definitely unsent legacy delivery releases its matching payload claim', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const message = persistedMessage({
    id: 'optimistic:legacy-delete-123456789',
    definitelyUnsent: true,
  });
  const snapshot = {
    version: 2,
    messages: [message],
    tombstones: [],
    draftClaims: [{
      sessionId: message.sessionId,
      draftRevision: 'draft-legacy-delete-123456789',
      payloadFingerprint: 'payload-legacy-delete-123456789',
      at: 1_777_777_777_000,
    }],
  };
  const deleted = transition(
    snapshot,
    {
      type: 'claim-terminal',
      action: 'delete',
      payloadFingerprint: 'payload-legacy-delete-123456789',
      message,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );

  assert.equal(deleted.value?.id, message.id);
  assert.deepEqual(deleted.snapshot.draftClaims, []);
});

test('draft claim conflicts explain the owning delivery without changing layout', () => {
  assert.equal(
    deliveryReceipts.draftClaimConflictCopy?.({
      message: { delivery: 'delivered' },
    }),
    'This exact message already delivered. Clear this leftover draft before writing the next one.',
  );
  assert.equal(
    deliveryReceipts.draftClaimConflictCopy?.({
      message: { delivery: 'failed', definitelyUnsent: true },
    }),
    'This exact message already has a failed send. Use Retry or Edit on that message.',
  );
  assert.equal(
    deliveryReceipts.draftClaimConflictCopy?.({ message: null }),
    'This exact draft already started earlier. Check the chat before sending it again.',
  );
});

test('two Pocket windows cannot send one visible payload through divergent revisions', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const firstMessage = persistedMessage({
    id: 'optimistic:first-payload-123456789',
    delivery: 'delivering',
  });
  const duplicateMessage = persistedMessage({
    id: 'optimistic:duplicate-payload-123456789',
    idempotencyKey: 'idempotency-key-duplicate-123456789',
    activeDeliveryKey: 'idempotency-key-duplicate-123456789',
    delivery: 'delivering',
  });
  const changedMessage = persistedMessage({
    id: 'optimistic:changed-payload-123456789',
    idempotencyKey: 'idempotency-key-changed-123456789',
    activeDeliveryKey: 'idempotency-key-changed-123456789',
    text: 'This is a legitimately changed message',
    delivery: 'delivering',
  });
  const claim = (message, draftRevision, payloadFingerprint) => ({
    type: 'claim-draft-send',
    sessionId: 'session-1',
    draftRevision,
    payloadFingerprint,
    message,
  });

  const firstWindow = transition(
    [],
    claim(firstMessage, 'draft-revision-first-123456789', 'payload-same-123456789'),
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const staleSecondWindow = transition(
    firstWindow.snapshot,
    claim(
      duplicateMessage,
      'draft-revision-second-123456789',
      'payload-same-123456789',
    ),
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  const changedSecondWindow = transition(
    staleSecondWindow.snapshot,
    claim(
      changedMessage,
      'draft-revision-first-123456789',
      'payload-changed-123456789',
    ),
    { sanitize: acceptPersistedMessage, now: 1_777_777_779_000 },
  );

  assert.equal(firstWindow.value?.id, firstMessage.id);
  assert.equal(staleSecondWindow.value?.kind, 'draft-claim-conflict');
  assert.equal(staleSecondWindow.value?.message?.id, firstMessage.id);
  assert.equal(changedSecondWindow.value?.id, changedMessage.id);
  assert.deepEqual(
    changedSecondWindow.snapshot.messages.map((item) => item.id),
    [firstMessage.id, changedMessage.id],
  );
});

test('a visible payload claim blocks divergent revisions for its full durable lifetime', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const firstMessage = persistedMessage({
    id: 'optimistic:full-life-first-123456789',
    delivery: 'delivering',
  });
  const delayedDuplicate = persistedMessage({
    id: 'optimistic:full-life-delayed-123456789',
    idempotencyKey: 'idempotency-full-life-delayed-123456789',
    activeDeliveryKey: 'idempotency-full-life-delayed-123456789',
    delivery: 'delivering',
  });
  const command = (message, revision) => ({
    type: 'claim-draft-send',
    sessionId: 'session-1',
    draftRevision: revision,
    payloadFingerprint: 'payload-full-life-123456789',
    message,
  });
  const now = 1_777_777_777_000;
  const first = transition(
    [],
    command(firstMessage, 'draft-full-life-first-123456789'),
    { sanitize: acceptPersistedMessage, now },
  );
  const beforeExpiry = transition(
    first.snapshot,
    command(delayedDuplicate, 'draft-full-life-delayed-123456789'),
    {
      sanitize: acceptPersistedMessage,
      now: now + 7 * 24 * 60 * 60 * 1000 - 1,
    },
  );
  const afterExpiry = transition(
    first.snapshot,
    command(delayedDuplicate, 'draft-full-life-delayed-123456789'),
    {
      sanitize: acceptPersistedMessage,
      now: now + 7 * 24 * 60 * 60 * 1000 + 1,
    },
  );

  assert.equal(beforeExpiry.value?.kind, 'draft-claim-conflict');
  assert.equal(beforeExpiry.value?.message?.id, firstMessage.id);
  assert.equal(afterExpiry.value?.id, delayedDuplicate.id);
});

test('draft send fingerprints follow visible text and ordered attachment identity', async () => {
  const fingerprint = deliveryReceipts.draftSendPayloadFingerprint;
  const first = await fingerprint?.({
    text: '  hello from Pocket  ',
    attachments: [{ id: 'photo_one' }],
  });
  const sameVisiblePayload = await fingerprint?.({
    text: 'hello from Pocket',
    attachments: [{ id: 'photo_one' }],
  });
  const changedAttachment = await fingerprint?.({
    text: 'hello from Pocket',
    attachments: [{ id: 'photo_two' }],
  });

  assert.equal(typeof first, 'string');
  assert.equal(first, sameVisiblePayload);
  assert.notEqual(first, changedAttachment);
});

test('a second Pocket window keeps newer text or photos when the first claim resolves', () => {
  const canClear = deliveryReceipts.claimedDraftClearIsAuthorized;
  const firstWindow = {
    revision: 'draft-revision-first-123456789',
    payloadFingerprint: 'payload-first-123456789',
  };

  assert.equal(
    canClear?.({
      claimedRevision: firstWindow.revision,
      claimedPayloadFingerprint: firstWindow.payloadFingerprint,
      currentRevision: firstWindow.revision,
      currentPayloadFingerprint: firstWindow.payloadFingerprint,
    }),
    true,
    'the unchanged draft may clear after its durable claim commits',
  );
  assert.equal(
    canClear?.({
      claimedRevision: firstWindow.revision,
      claimedPayloadFingerprint: firstWindow.payloadFingerprint,
      currentRevision: 'draft-revision-second-123456789',
      currentPayloadFingerprint: 'payload-second-text-123456789',
    }),
    false,
    'newer text from the second window must survive the first claim',
  );
  assert.equal(
    canClear?.({
      claimedRevision: firstWindow.revision,
      claimedPayloadFingerprint: firstWindow.payloadFingerprint,
      currentRevision: firstWindow.revision,
      currentPayloadFingerprint: 'payload-second-photo-123456789',
    }),
    false,
    'newer photos must survive even when the text revision did not change',
  );
});

test('the browser rechecks shared draft authority after the awaited claim', async () => {
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  const start = js.indexOf('async function sendCurrentMessage()');
  const end = js.indexOf('function restoredAttachmentItems', start);
  const send = js.slice(start, end);
  const claim = send.indexOf(
    'await claimDraftSendRequired(optimistic, draftRevision, payloadFingerprint)',
  );
  const authority = send.indexOf('claimedDraftClearIsAuthorized', claim);
  const attachmentClear = send.indexOf('state.attachmentsBySession.delete(sessionId)', claim);
  const textClear = send.indexOf("saveDraft(sessionId, ''", claim);

  assert.ok(claim >= 0, 'the durable send claim must exist');
  assert.ok(authority > claim, 'shared draft authority must be reread after the claim');
  assert.ok(attachmentClear > authority, 'photos may clear only after authority matches');
  assert.ok(textClear > authority, 'text may clear only after authority matches');
  assert.match(
    send.slice(authority, end),
    /field\.dataset\.draftRevision === draftRevision[\s\S]*field\.value\.replace\(\/\\r\\n\?\/g, '\\n'\) === text/,
    'the mounted composer must still display the claimed revision and payload before it clears',
  );
});

test('same attempt delivery keys change only through an exact authorized transition', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const original = persistedMessage({
    activeDeliveryKey: 'delivery-key-original-123456789',
    delivery: 'delivering',
  });
  const replacement = persistedMessage({
    activeDeliveryKey: 'delivery-key-replacement-123456789',
    delivery: 'confirming',
  });
  const staleOriginalWriter = persistedMessage({
    activeDeliveryKey: 'delivery-key-original-123456789',
    delivery: 'failed',
  });
  const initial = transition(
    [],
    { type: 'mutate', upserts: [original] },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const incompleteAuthorization = transition(
    initial.snapshot,
    {
      type: 'mutate',
      upserts: [replacement],
      deliveryKeyTransitions: [{
        id: original.id,
        from: original.activeDeliveryKey,
        to: replacement.activeDeliveryKey,
      }],
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_500 },
  );
  const authorized = transition(
    initial.snapshot,
    {
      type: 'mutate',
      upserts: [replacement],
      deliveryKeyTransitions: [{
        id: original.id,
        deliveryAttempt: 1,
        from: original.activeDeliveryKey,
        to: replacement.activeDeliveryKey,
      }],
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  const staleRollback = transition(
    authorized.snapshot,
    { type: 'mutate', upserts: [staleOriginalWriter] },
    { sanitize: acceptPersistedMessage, now: 1_777_777_779_000 },
  );

  assert.equal(
    incompleteAuthorization.snapshot.messages[0].activeDeliveryKey,
    original.activeDeliveryKey,
  );
  assert.equal(
    authorized.snapshot.messages[0].activeDeliveryKey,
    replacement.activeDeliveryKey,
  );
  assert.equal(
    staleRollback.snapshot.messages[0].activeDeliveryKey,
    replacement.activeDeliveryKey,
  );
  assert.equal(staleRollback.snapshot.messages[0].delivery, 'confirming');
});

test('authoritative active state can replace failure only through an exact transition', () => {
  const transition = deliveryReceipts.pendingDeliverySnapshotTransition;
  const failed = persistedMessage({
    delivery: 'failed',
    retrySafe: false,
    definitelyUnsent: false,
  });
  const delivering = persistedMessage({
    delivery: 'delivering',
    deliveryPhase: 'queued',
    retrySafe: false,
    definitelyUnsent: false,
  });
  const initial = transition(
    [],
    { type: 'mutate', upserts: [failed] },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  const stale = transition(
    initial.snapshot,
    { type: 'mutate', upserts: [delivering] },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  const wrongAuthority = transition(
    initial.snapshot,
    {
      type: 'mutate',
      upserts: [delivering],
      deliveryStateTransitions: [{
        id: failed.id,
        deliveryAttempt: failed.deliveryAttempt,
        activeDeliveryKey: 'wrong-active-key-123456789',
        from: 'failed',
        to: 'delivering',
      }],
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  const authorized = transition(
    initial.snapshot,
    {
      type: 'mutate',
      upserts: [delivering],
      deliveryStateTransitions: [{
        id: failed.id,
        deliveryAttempt: failed.deliveryAttempt,
        activeDeliveryKey: failed.activeDeliveryKey,
        from: 'failed',
        to: 'delivering',
      }],
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );

  assert.equal(stale.snapshot.messages[0].delivery, 'failed');
  assert.equal(wrongAuthority.snapshot.messages[0].delivery, 'failed');
  assert.equal(authorized.snapshot.messages[0].delivery, 'delivering');
  assert.equal(authorized.snapshot.messages[0].deliveryPhase, 'queued');
});

test('recovered draft retries do not duplicate text already restored', () => {
  const merge = deliveryReceipts.mergeRecoveredDraftText;

  assert.equal(merge?.('failed message', 'new typing'), 'failed message\n\nnew typing');
  assert.equal(
    merge?.('failed message', 'failed message\n\nnew typing'),
    'failed message\n\nnew typing',
  );
  assert.equal(
    merge?.('failed message', 'failed message\n\nnew typing\ncontinued typing'),
    'failed message\n\nnew typing\ncontinued typing',
  );
});

test('recovered attachment retries reuse one durable photo across restored local ids', () => {
  const merge = deliveryReceipts.mergeRecoveredAttachmentItems;
  const recovered = {
    id: 'photo_durable_one',
    localId: 'restored:photo_durable_one',
    state: 'ready',
  };
  const current = {
    id: 'photo_durable_one',
    localId: 'upload-local-one',
    state: 'ready',
    previewUrl: 'blob:current-preview',
  };
  const newer = {
    id: 'photo_durable_two',
    localId: 'upload-local-two',
    state: 'ready',
  };

  const merged = merge?.([recovered], [current, newer]);

  assert.deepEqual(merged, [current, newer]);
});

test('a failed edit claim release returns a recoverable result without rejecting', async () => {
  const result = await deliveryReceipts.persistRecoveredDraftBeforeFinalizing?.({
    persistDraft: () => false,
    finalize: () => assert.fail('finalize must not run'),
    release: () => Promise.reject(new Error('indexed_db_unavailable')),
  });

  assert.deepEqual(result, { status: 'release-failed', value: null });
});

test('a missing edit claim release is treated as a recoverable release failure', async () => {
  const result = await deliveryReceipts.persistRecoveredDraftBeforeFinalizing?.({
    persistDraft: () => true,
    finalize: () => null,
    release: () => null,
  });

  assert.deepEqual(result, { status: 'release-failed', value: null });
});

test('the browser wires shared delivery authority before mutating visible state', async () => {
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );

  assert.match(
    js,
    /pendingDeliverySnapshotTransition[\s\S]*pendingDeliveryMessages[\s\S]*persistRecoveredDraftBeforeFinalizing/,
  );
  assert.match(
    js,
    /function mutatePendingDeliveriesRequired[\s\S]*pendingDeliverySnapshotTransition\([\s\S]*store\.put\(transition\.snapshot, PENDING_DELIVERIES_KEY\)/,
  );
  assert.match(
    js,
    /function claimDraftSendRequired[\s\S]*type: 'claim-draft-send'[\s\S]*draftRevision[\s\S]*payloadFingerprint/,
  );
  const sendStart = js.indexOf('async function sendCurrentMessage()');
  const sendEnd = js.indexOf('function restoredAttachmentItems', sendStart);
  const send = js.slice(sendStart, sendEnd);
  assert.match(send, /await draftSendPayloadFingerprint\(/);
  assert.match(
    send,
    /await claimDraftSendRequired\(optimistic, draftRevision, payloadFingerprint\)/,
  );
  assert.match(
    send,
    /claimed\?\.kind === 'draft-claim-conflict'[\s\S]*await restorePendingDeliveries\(\)[\s\S]*renderTranscript\(\)[\s\S]*announce\(draftClaimConflictCopy\(claimed\)\)/,
  );
  assert.doesNotMatch(
    send,
    /showComposerSendError\([\s\S]{0,180}draft is already sending from another Pocket window/,
  );
  assert.ok(
    send.indexOf(
      'await claimDraftSendRequired(optimistic, draftRevision, payloadFingerprint)',
    ) <
      send.indexOf("field.value = ''"),
    'the shared draft claim must commit before the visible draft clears',
  );
  assert.match(
    send,
    /const mountedComposerStillClaimed =[\s\S]*state\.route\.sessionId === sessionId[\s\S]*field\.dataset\.draftRevision === draftRevision[\s\S]*if \(\s*durableDraftCleared &&\s*mountedComposerStillClaimed\s*\) \{[\s\S]*field\.value = '';[\s\S]*field\.dataset\.draftRevision/,
  );

  const editStart = js.indexOf('async function editFailedMessage(message)');
  const editEnd = js.indexOf('async function persistPendingDeliveries', editStart);
  const edit = js.slice(editStart, editEnd);
  assert.match(edit, /return recoverClaimedFailedMessage\(message\)/);
  assert.doesNotMatch(edit, /persistPendingDeliveries\(\{ removeIds:/);

  const recoveryStart = js.indexOf('async function recoverClaimedFailedMessage(message)');
  const recoveryEnd = js.indexOf('async function editFailedMessage(message)', recoveryStart);
  const recovery = js.slice(recoveryStart, recoveryEnd);
  assert.match(
    recovery,
    /mergeRecoveredDraftText\(\s*recoveredText,\s*existingDraft,?\s*\)/,
  );
  assert.match(recovery, /persistRecoveredDraftBeforeFinalizing\(\{/);
  assert.match(recovery, /const savedDraft = saveDraft\(sessionId, combinedDraft\)/);
  assert.match(recovery, /persistAttachmentDrafts\(\{[\s\S]*sessionId,[\s\S]*items: mergedItems/);
  assert.ok(
    recovery.indexOf('persistAttachmentDrafts({') <
      recovery.indexOf('finalizeTerminalDeliveryEditRequired('),
    'restored attachment metadata must be durable before terminal removal',
  );
  assert.doesNotMatch(
    recovery.slice(recovery.indexOf("if (recovery.status !== 'recovered')")),
    /field\.value = combinedDraft/,
  );
  assert.match(recovery, /recovery\.status === 'release-failed'/);

  const deliveryStart = js.indexOf('async function deliverOptimistic(');
  const deliveryEnd = js.indexOf('function applyDeliveryReceipt', deliveryStart);
  const delivery = js.slice(deliveryStart, deliveryEnd);
  assert.match(delivery, /deliveryKeyTransitions:/);
  assert.match(js, /deliveryStateTransitions:/);

  const restoreStart = js.indexOf('async function restorePendingDeliveries()');
  const restoreEnd = js.indexOf('async function clearTranscriptCache', restoreStart);
  const restore = js.slice(restoreStart, restoreEnd);
  assert.match(restore, /cacheGetRequired\(PENDING_DELIVERIES_KEY\)/);
  assert.match(restore, /catch[\s\S]{0,100}return false/);
  assert.doesNotMatch(restore, /cacheGet\(PENDING_DELIVERIES_KEY\)/);
  assert.match(restore, /currentById/);
  assert.match(restore, /applyAuthoritativePendingDelivery\(current, authoritative\)/);

  const conflictStart = js.indexOf("text: 'Keep the Mac draft'");
  const conflictWiring = js.slice(conflictStart, conflictStart + 700);
  assert.match(conflictWiring, /await recoverClaimedFailedMessage\(message\)/);
  assert.doesNotMatch(conflictWiring, /draftConflictFlow\.keepMacDraft\(message\)/);

  const manualStart = js.indexOf('async function checkDeliveryNow(message)');
  const manualEnd = js.indexOf('function checkDelivery(message', manualStart);
  const manual = js.slice(manualStart, manualEnd);
  assert.match(manual, /readAuthoritativePendingDeliveryRequired\(message\)/);
  assert.ok(
    manual.indexOf('readAuthoritativePendingDeliveryRequired(message)') <
      manual.indexOf('requestDeliveryStatus(message)'),
    'manual checks must read shared authority before the network request',
  );

  const automaticStart = js.indexOf('async function checkDeliveryOnce(entry)');
  const automaticEnd = js.indexOf('async function recoverPendingDeliveries', automaticStart);
  const automatic = js.slice(automaticStart, automaticEnd);
  assert.match(automatic, /refreshDeliveryRecoveryAuthority\(entry\)/);
  assert.ok(
    automatic.indexOf('refreshDeliveryRecoveryAuthority(entry)') <
      automatic.indexOf("message.delivery = 'confirming'"),
    'automatic recovery must read shared authority before changing status',
  );
});

test('manual discovery of a pending send immediately resumes recovery controls', async () => {
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  const verifyStart = js.indexOf('async function verifyTerminalDeliveryAction(message)');
  const verifyEnd = js.indexOf('async function readAuthoritativePendingDeliveryRequired', verifyStart);
  const checkStart = js.indexOf('async function checkDeliveryNow(message)');
  const checkEnd = js.indexOf('function checkDelivery(message', checkStart);
  const verify = js.slice(verifyStart, verifyEnd);
  const check = js.slice(checkStart, checkEnd);

  for (const body of [verify, check]) {
    const pendingStart = body.indexOf("if (disposition === 'pending')");
    assert.ok(pendingStart >= 0, 'the pending status branch must exist');
    const pending = body.slice(pendingStart);
    assert.match(pending, /message\.delivery = 'confirming'/);
    assert.match(pending, /void checkDelivery\(message, \{ force: true \}\)/);
  }
});

test('the client receipt parser preserves body aborts and rejects malformed success', async () => {
  const abort = new Error('timed out');
  abort.name = 'AbortError';
  await assert.rejects(
    readDeliveryStatusResponse({
      ok: true,
      status: 200,
      async json() {
        throw abort;
      },
    }),
    (error) => error === abort,
  );
  await assert.rejects(
    readDeliveryStatusResponse({
      ok: true,
      status: 200,
      async json() {
        return {};
      },
    }),
    { code: 'delivery_status_invalid_response' },
  );
  assert.deepEqual(
    await readDeliveryStatusResponse({
      ok: true,
      status: 200,
      async json() {
        return { delivery: { state: 'delivered', rowId: 42 } };
      },
    }),
    { state: 'delivered', rowId: 42 },
  );
});

test('delivered and authoritative final delivery statuses are terminal', () => {
  assert.equal(deliveryStatusIsTerminal({ state: 'delivered' }), true);
  assert.equal(
    deliveryStatusIsTerminal({
      state: 'failed',
      code: 'workspace_not_visible',
      retrySafe: true,
    }),
    true,
  );
  assert.equal(
    deliveryStatusIsTerminal({
      state: 'failed',
      code: 'automation_timeout',
      retrySafe: false,
      final: true,
    }),
    true,
  );
  assert.equal(
    deliveryStatusIsTerminal({
      state: 'failed',
      code: 'send_not_confirmed',
      retrySafe: false,
    }),
    false,
  );
  assert.equal(deliveryStatusIsTerminal({ state: 'unknown' }), false);
  assert.equal(deliveryStatusIsTerminal({ state: 'pending' }), false);
});

test('terminal delivery actions continue only for authoritative failures', () => {
  assert.equal(
    terminalDeliveryActionDisposition({ state: 'delivered' }),
    'resolved',
  );
  assert.equal(
    terminalDeliveryActionDisposition({
      state: 'failed',
      retrySafe: true,
    }),
    'actionable',
  );
  assert.equal(
    terminalDeliveryActionDisposition({
      state: 'failed',
      retrySafe: false,
      final: true,
    }),
    'actionable',
  );
  assert.equal(
    terminalDeliveryActionDisposition({
      state: 'failed',
      retrySafe: false,
    }),
    'unverified',
  );
  assert.equal(
    terminalDeliveryActionDisposition({
      state: 'pending',
      phase: 'automating',
    }),
    'pending',
  );
  assert.equal(
    terminalDeliveryActionDisposition({ state: 'unknown' }),
    'unverified',
  );
});

test('rapid terminal action taps run one operation and expose its busy label', async () => {
  const changes = [];
  const coordinator = createDeliveryActionCoordinator({
    onChange(key, action) {
      changes.push([key, action]);
    },
  });
  let release;
  let calls = 0;
  const first = coordinator.run('optimistic-1', 'retry', async () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const second = await coordinator.run(
    'optimistic-1',
    'edit',
    async () => {
      calls += 1;
      return 'duplicate';
    },
  );

  assert.equal(calls, 1);
  assert.equal(coordinator.current('optimistic-1'), 'retry');
  assert.deepEqual(second, { started: false, value: null });

  release('claimed');
  assert.deepEqual(await first, { started: true, value: 'claimed' });
  assert.equal(coordinator.current('optimistic-1'), null);
  assert.deepEqual(changes, [
    ['optimistic-1', 'retry'],
    ['optimistic-1', null],
  ]);
});

test('a terminal action still runs and releases when its busy-state render fails', async () => {
  let operationCalls = 0;
  const coordinator = createDeliveryActionCoordinator({
    onChange() {
      throw new Error('test_render_failed');
    },
  });

  const result = await coordinator.run('optimistic-1', 'retry', async () => {
    operationCalls += 1;
    return 'posted';
  });

  assert.deepEqual(result, { started: true, value: 'posted' });
  assert.equal(operationCalls, 1);
  assert.equal(coordinator.current('optimistic-1'), null);
});

test('inconclusive delivery statuses remain recoverable through slow receipt checks', () => {
  let inconclusiveChecks = 0;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const decision = deliveryRecoveryDecision(
      { state: 'unknown' },
      inconclusiveChecks,
    );
    inconclusiveChecks = decision.inconclusiveChecks;
    assert.equal(decision.action, 'retry');
    assert.equal(inconclusiveChecks, attempt);
  }

  assert.deepEqual(
    deliveryRecoveryDecision({ state: 'delivered' }, inconclusiveChecks),
    { action: 'settle', inconclusiveChecks: 0 },
  );

  assert.deepEqual(
    deliveryRecoveryDecision(
      { state: 'failed', retrySafe: false, final: true },
      2,
    ),
    { action: 'settle', inconclusiveChecks: 0 },
  );
  assert.deepEqual(
    deliveryRecoveryDecision({ state: 'pending', phase: 'confirming' }, 2),
    { action: 'poll', inconclusiveChecks: 0 },
  );
});

test('an exhausted recovery waits for one explicit rearm event', () => {
  assert.equal(
    deliveryNeedsAutomaticRecovery({ delivery: 'delivering' }),
    true,
  );
  assert.equal(
    deliveryNeedsAutomaticRecovery({ delivery: 'confirming' }),
    true,
  );
  assert.equal(
    deliveryNeedsAutomaticRecovery({
      delivery: 'failed',
      definitelyUnsent: false,
    }),
    true,
  );
  assert.equal(
    deliveryNeedsAutomaticRecovery({
      delivery: 'failed',
      definitelyUnsent: false,
      deliveryRecoveryExhausted: true,
      errorCode: 'delivery_unknown',
    }),
    false,
  );
  const exhausted = {
    delivery: 'failed',
    definitelyUnsent: false,
    deliveryRecoveryExhausted: true,
    errorCode: 'delivery_unknown',
  };
  assert.equal(rearmDeliveryRecovery(exhausted), true);
  assert.equal(exhausted.deliveryRecoveryExhausted, false);
  assert.equal(deliveryNeedsAutomaticRecovery(exhausted), true);
  assert.equal(rearmDeliveryRecovery(exhausted), false);
  assert.equal(
    deliveryNeedsAutomaticRecovery({
      delivery: 'failed',
      definitelyUnsent: true,
    }),
    false,
  );
  assert.equal(
    deliveryNeedsAutomaticRecovery({
      delivery: 'failed',
      definitelyUnsent: false,
      deliveryRecoveryExhausted: true,
      errorCode: 'automation_timeout',
    }),
    false,
  );
  assert.equal(
    deliveryNeedsAutomaticRecovery({
      delivery: 'failed',
      definitelyUnsent: false,
      deliveryRecoveryExhausted: true,
      errorCode: 'relay_restarted_during_send',
    }),
    false,
  );
  assert.equal(
    deliveryNeedsAutomaticRecovery({
      delivery: 'failed',
      definitelyUnsent: false,
      deliveryRecoveryExhausted: true,
      errorCode: 'device_locked',
    }),
    false,
  );
});

function optimistic(overrides = {}) {
  return {
    id: 'optimistic-1',
    kind: 'optimistic',
    sessionId: 'session-1',
    delivery: 'delivered',
    receiptBaselineCursor: 10,
    receiptRowId: null,
    receiptMessageId: null,
    ...overrides,
  };
}

test('a delivery receipt reconciles only after its transcript boundary arrives', () => {
  const message = optimistic();
  assert.equal(receiptReachedTranscript(message, 10), false);
  assert.equal(receiptReachedTranscript(message, 11), true);
  assert.equal(
    receiptReachedTranscript(
      optimistic({ receiptRowId: 12 }),
      11,
    ),
    false,
  );
  assert.equal(
    receiptReachedTranscript(
      optimistic({ receiptRowId: 12 }),
      12,
    ),
    true,
  );
});

test('a confirmed receipt stays visible until its exact transcript row exists', () => {
  const message = optimistic({
    receiptRowId: 12,
    receiptMessageId: 'server-user-12',
  });
  const missing = reconcileDeliveryReceipts(
    [message],
    'session-1',
    12,
    [],
  );
  assert.deepEqual(missing.remaining, [message]);
  assert.deepEqual(missing.reconciled, []);
  assert.deepEqual(missing.missing, [message]);

  const present = reconcileDeliveryReceipts(
    [message],
    'session-1',
    12,
    [{ id: 'server-user-12' }],
  );
  assert.deepEqual(present.remaining, [message]);
  assert.deepEqual(present.reconciled, [message]);
  assert.deepEqual(present.missing, []);

  const cancelledLater = reconcileDeliveryReceipts(
    present.remaining,
    'session-1',
    12,
    [],
  );
  assert.deepEqual(cancelledLater.remaining, [message]);
  assert.deepEqual(cancelledLater.reconciled, []);
  assert.deepEqual(cancelledLater.missing, [message]);
});

test('a confirmed receipt safely settles after its row leaves the transcript window', () => {
  const disposition = deliveryReceipts.receiptTranscriptDisposition;
  assert.equal(typeof disposition, 'function');
  assert.equal(
    disposition(
      { messageId: 'server-user-12', rowId: 12 },
      [
        { id: 'later-user-20', rowId: 20 },
        { id: 'later-answer-21', rowId: 21 },
      ],
    ),
    'before-window',
  );
  assert.equal(
    disposition(
      { messageId: 'server-user-20', rowId: 20 },
      [
        { id: 'different-user-20', rowId: 20 },
        { id: 'later-answer-21', rowId: 21 },
      ],
    ),
    'unresolved',
  );
  assert.equal(
    disposition(
      { messageId: 'server-user-20', rowId: 20 },
      [
        { id: 'server-user-20', rowId: 20 },
        { id: 'later-answer-21', rowId: 21 },
      ],
    ),
    'present',
  );
});

test('a delivered receipt is tracked while its transcript row has not appeared', () => {
  const message = optimistic({
    receiptRowId: 12,
    receiptMessageId: 'server-user-12',
    receiptObservedAt: null,
  });
  const otherSession = optimistic({
    id: 'optimistic-other-session',
    sessionId: 'session-2',
    receiptRowId: 20,
    receiptMessageId: 'server-user-20',
    receiptObservedAt: null,
  });

  const result = reconcileDeliveryReceipts(
    [message, otherSession],
    'session-1',
    11,
    [],
  );

  assert.deepEqual(result.remaining, [message, otherSession]);
  assert.deepEqual(result.reconciled, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unreconciled, [message]);
});

test('an existing delivered receipt keeps one observation clock across refreshes', async () => {
  const observed = persistedMessage({
    delivery: 'delivered',
    retrySafe: false,
    definitelyUnsent: false,
    receiptMessageId: 'server-user-12',
    receiptRowId: 12,
    receiptObservedAt: 1_777_777_777_000,
    deliveredAt: '2026-05-02T00:00:00.000Z',
  });
  const sameStatus = {
    state: 'delivered',
    messageId: observed.receiptMessageId,
    rowId: observed.receiptRowId,
  };

  assert.equal(sameDeliveredReceiptIdentity(observed, sameStatus), true);
  assert.equal(
    missingDeliveredReceiptDisposition(observed, sameStatus),
    'resume-observation',
  );
  assert.equal(
    missingDeliveredReceiptDisposition(observed, {
      ...sameStatus,
      rowId: 13,
    }),
    'identity-mismatch',
  );
  assert.equal(
    missingDeliveredReceiptDisposition(observed, {
      state: 'failed',
      final: true,
      code: 'conductor_message_cancelled',
    }),
    'settle-terminal',
  );
  assert.equal(
    missingDeliveredReceiptDisposition(observed, { state: 'pending' }),
    'wait',
  );
  assert.equal(
    sameDeliveredReceiptIdentity(observed, {
      ...sameStatus,
      rowId: 13,
    }),
    false,
  );
  assert.equal(
    sameDeliveredReceiptIdentity(observed, {
      ...sameStatus,
      messageId: 'different-user-12',
    }),
    false,
  );

  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  assert.match(
    js,
    /for \(const message of result\.unreconciled\) \{[\s\S]*observeDeliveredReceipt\(message\)[\s\S]*verifyStalledDeliveredReceipt\(message\)/,
  );
  const missingStart = js.indexOf('async function verifyMissingDeliveryReceipt');
  const missingEnd = js.indexOf('async function verifyStalledDeliveredReceipt');
  const missingVerifier = js.slice(missingStart, missingEnd);
  assert.match(
    missingVerifier,
    /missingDeliveredReceiptDisposition\([\s\S]*message,[\s\S]*delivery,[\s\S]*\)/,
  );
  assert.match(
    missingVerifier,
    /if \(disposition === 'resume-observation'\) \{[\s\S]*return;[\s\S]*\}\s*if \(disposition !== 'settle-terminal'\) return;/,
  );
});

test('receipt observation stops at its deadline instead of polling without delay', () => {
  const message = persistedMessage({
    delivery: 'delivered',
    receiptMessageId: 'server-user-12',
    receiptRowId: 12,
  });
  assert.equal(
    deliveryReceiptObservationDisposition(
      message,
      { state: 'absent' },
      20_000,
      20_000,
    ),
    'stop',
  );
  assert.equal(
    deliveryReceiptObservationDisposition(
      message,
      { state: 'unknown' },
      19_999,
      20_000,
    ),
    'wait',
  );
  assert.equal(
    deliveryReceiptObservationDisposition(
      message,
      {
        state: 'delivered',
        messageId: message.receiptMessageId,
        rowId: message.receiptRowId,
      },
      20_000,
      20_000,
    ),
    'expire',
  );
  assert.equal(
    deliveryReceiptObservationDisposition(
      message,
      {
        state: 'delivered',
        messageId: message.receiptMessageId,
        rowId: message.receiptRowId,
      },
      19_999,
      20_000,
    ),
    'wait',
  );
  assert.equal(
    deliveryReceiptObservationDisposition(
      message,
      {
        state: 'delivered',
        messageId: 'different-user-13',
        rowId: 13,
      },
      20_000,
      20_000,
    ),
    'stop',
  );
});

test('legacy delivered receipts verify immediately and can be dismissed safely', () => {
  const legacy = persistedMessage({
    delivery: 'delivered',
    retrySafe: false,
    definitelyUnsent: false,
    deliveredAt: null,
    receiptMessageId: 'server-user-12',
    receiptRowId: 12,
    receiptObservedAt: null,
  });
  assert.equal(
    deliveredReceiptVerificationDelay(legacy, 1_000_000, 30_000),
    0,
  );
  assert.equal(
    deliveredReceiptCanDismiss(
      legacy,
      Date.parse(legacy.createdAt) + 60_000,
      60_000,
    ),
    true,
  );

  const unverified = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [legacy] },
    { type: 'dismiss-delivered-receipt', message: legacy },
    { sanitize: acceptPersistedMessage, now: 1_000_000 },
  );
  assert.equal(unverified.value, null);
  assert.deepEqual(unverified.snapshot.messages, [legacy]);

  const dismissed = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [legacy] },
    {
      type: 'dismiss-delivered-receipt',
      message: legacy,
      verifiedReceipt: {
        messageId: legacy.receiptMessageId,
        rowId: legacy.receiptRowId,
      },
    },
    { sanitize: acceptPersistedMessage, now: 1_000_000 },
  );
  assert.equal(dismissed.value?.id, legacy.id);
  assert.deepEqual(dismissed.snapshot.messages, []);
  assert.equal(dismissed.snapshot.tombstones.length, 1);

  const staleWriter = deliveryReceipts.pendingDeliverySnapshotTransition(
    dismissed.snapshot,
    { type: 'mutate', upserts: [legacy] },
    { sanitize: acceptPersistedMessage, now: 1_000_001 },
  );
  assert.deepEqual(staleWriter.snapshot.messages, []);

  const mismatchedProof = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [legacy] },
    {
      type: 'dismiss-delivered-receipt',
      message: legacy,
      verifiedReceipt: {
        messageId: 'different-user-13',
        rowId: 13,
      },
    },
    { sanitize: acceptPersistedMessage, now: 1_000_000 },
  );
  assert.equal(mismatchedProof.value, null);
  assert.deepEqual(mismatchedProof.snapshot.messages, [legacy]);

  const changedIdentity = {
    ...legacy,
    activeDeliveryKey: 'different-delivery-key-123456789',
  };
  const rejected = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [legacy] },
    { type: 'dismiss-delivered-receipt', message: changedIdentity },
    { sanitize: acceptPersistedMessage, now: 1_000_000 },
  );
  assert.equal(rejected.value, null);
  assert.deepEqual(rejected.snapshot.messages, [legacy]);

  const newerReceipt = {
    ...legacy,
    receiptMessageId: 'server-user-13',
    receiptRowId: 13,
    receiptObservedAt: 1_000_000,
  };
  const staleReceipt = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [newerReceipt] },
    { type: 'dismiss-delivered-receipt', message: legacy },
    { sanitize: acceptPersistedMessage, now: 1_000_001 },
  );
  assert.equal(staleReceipt.value, null);
  assert.deepEqual(staleReceipt.snapshot.messages, [newerReceipt]);

  return fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  ).then((js) => {
    const start = js.indexOf('async function dismissDeliveredReceipt');
    const end = js.indexOf('async function stopCheckingDelivery');
    const dismiss = js.slice(start, end);
    assert.match(
      dismiss,
      /requestDeliveryStatus\(message\)[\s\S]*sameDeliveredReceiptIdentity\(message, delivery\)[\s\S]*type: 'dismiss-delivered-receipt'/,
    );
  });
});

test('server-verified stalled receipt observation cannot erase a transcript observation or cancellation', () => {
  const stalled = persistedMessage({
    delivery: 'delivered',
    retrySafe: false,
    definitelyUnsent: false,
    receiptMessageId: 'server-user-12',
    receiptRowId: 12,
    receiptObservedAt: null,
  });
  const command = {
    type: 'observe-stalled-receipt',
    message: stalled,
    messageId: stalled.receiptMessageId,
    rowId: stalled.receiptRowId,
    observedAt: 1_777_777_787_000,
  };
  const observedResult = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [stalled] },
    command,
    { sanitize: acceptPersistedMessage, now: 1_777_777_787_000 },
  );
  assert.equal(observedResult.value?.id, stalled.id);
  assert.equal(
    observedResult.snapshot.messages[0].receiptObservedAt,
    command.observedAt,
  );

  const observed = {
    ...stalled,
    receiptObservedAt: 1_777_777_777_000,
  };
  const observationWins = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [observed] },
    command,
    { sanitize: acceptPersistedMessage, now: 1_777_777_787_000 },
  );
  assert.equal(observationWins.value, null);
  assert.deepEqual(observationWins.snapshot.messages, [observed]);

  const cancelled = {
    ...stalled,
    delivery: 'failed',
    errorCode: 'conductor_message_cancelled',
  };
  const cancellationWins = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [cancelled] },
    command,
    { sanitize: acceptPersistedMessage, now: 1_777_777_787_000 },
  );
  assert.equal(cancellationWins.value, null);
  assert.deepEqual(cancellationWins.snapshot.messages, [cancelled]);
});

test('receipt expiry cannot erase a cancellation written by another window', () => {
  const observed = persistedMessage({
    delivery: 'delivered',
    retrySafe: false,
    definitelyUnsent: false,
    receiptMessageId: 'server-user-12',
    receiptRowId: 12,
    receiptObservedAt: 1_777_777_777_000,
  });
  const expired = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [observed] },
    {
      type: 'expire-receipt',
      message: observed,
      observedAt: observed.receiptObservedAt,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_787_000 },
  );
  assert.equal(expired.value?.id, observed.id);
  assert.deepEqual(expired.snapshot.messages, []);

  const cancelled = {
    ...observed,
    delivery: 'failed',
    errorCode: 'conductor_message_cancelled',
  };
  const protectedResult = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [cancelled] },
    {
      type: 'expire-receipt',
      message: observed,
      observedAt: observed.receiptObservedAt,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_787_000 },
  );
  assert.equal(protectedResult.value, null);
  assert.deepEqual(protectedResult.snapshot.messages, [cancelled]);
});

test('a cancellation durably replaces an observed delivered receipt', () => {
  const delivered = persistedMessage({
    delivery: 'delivered',
    retrySafe: false,
    definitelyUnsent: false,
    receiptMessageId: 'server-user-12',
    receiptRowId: 12,
    receiptObservedAt: 1_777_777_777_000,
  });
  const cancelled = {
    ...delivered,
    delivery: 'failed',
    errorCode: 'conductor_message_cancelled',
  };
  const unauthorized = deliveryReceipts.pendingDeliverySnapshotTransition(
    { messages: [delivered] },
    { type: 'mutate', upserts: [cancelled] },
    { sanitize: acceptPersistedMessage, now: 1_777_777_778_000 },
  );
  const authorized = deliveryReceipts.pendingDeliverySnapshotTransition(
    unauthorized.snapshot,
    {
      type: 'mutate',
      upserts: [cancelled],
      deliveryStateTransitions: [{
        id: delivered.id,
        deliveryAttempt: delivered.deliveryAttempt,
        activeDeliveryKey: delivered.activeDeliveryKey,
        from: 'delivered',
        to: 'failed',
      }],
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_779_000 },
  );
  const staleDeliveredWriter = deliveryReceipts.pendingDeliverySnapshotTransition(
    authorized.snapshot,
    { type: 'mutate', upserts: [delivered] },
    { sanitize: acceptPersistedMessage, now: 1_777_777_780_000 },
  );
  assert.equal(unauthorized.snapshot.messages[0].delivery, 'delivered');
  assert.equal(authorized.snapshot.messages[0].delivery, 'failed');
  assert.equal(
    staleDeliveredWriter.snapshot.messages[0].delivery,
    'failed',
  );
  assert.equal(
    staleDeliveredWriter.snapshot.messages[0].errorCode,
    'conductor_message_cancelled',
  );
});

test('the browser observes confirmed receipts before expiring them', async () => {
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  assert.match(js, /DELIVERY_RECEIPT_OBSERVATION_MS = 10_000/);
  assert.match(
    js,
    /observeDeliveredReceipt\(message\)[\s\S]*requestDeliveryStatus\(message\)[\s\S]*type: 'expire-receipt'/,
  );
  assert.match(
    js,
    /for \(const message of result\.reconciled\)[\s\S]*receiptObservedAt = Date\.now\(\)[\s\S]*observeDeliveredReceipt\(message\)/,
  );
  assert.match(
    js,
    /for \(const message of result\.unreconciled\)[\s\S]*verifyStalledDeliveredReceipt\(message\)/,
  );
  assert.match(
    js,
    /function verifyStalledDeliveredReceipt[\s\S]*requestDeliveryStatus\(message\)[\s\S]*refreshMessages\(message\.sessionId, \{ full: true \}\)[\s\S]*receiptTranscriptDisposition[\s\S]*type: 'observe-stalled-receipt'[\s\S]*observeDeliveredReceipt\(message\)/,
  );
  assert.match(
    js,
    /const previousDelivery = message\.delivery[\s\S]*deliveryStateTransitions: authorizedDeliveryStateTransition\([\s\S]*previousDelivery/,
  );
  assert.match(
    js,
    /composer_tree_transient:\s*'Conductor was redrawing the message box\. Retry this message\.'/,
  );
});

test('an accepted queued send keeps its recovery window while the relay reports pending', async () => {
  assert.equal(
    extendDeliveryRecoveryDeadline(
      { state: 'pending' },
      120_000,
      100_000,
      120_000,
    ),
    220_000,
  );
  assert.equal(
    extendDeliveryRecoveryDeadline(
      { state: 'failed' },
      220_000,
      200_000,
      120_000,
    ),
    220_000,
  );
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  assert.match(
    js,
    /let deadline = Date\.now\(\) \+ DELIVERY_RECOVERY_MS/,
  );
  assert.match(
    js,
    /deadline = extendDeliveryRecoveryDeadline\([\s\S]*delivery,[\s\S]*deadline,[\s\S]*Date\.now\(\),[\s\S]*DELIVERY_RECOVERY_MS/,
  );
});

test('the backstop rearms only stranded automatic recovery states', () => {
  const needsRecovery = deliveryReceipts.deliveryBackstopNeedsRecovery;
  assert.equal(typeof needsRecovery, 'function');
  assert.equal(needsRecovery({ delivery: 'failed' }), true);
  assert.equal(needsRecovery({ delivery: 'confirming' }), true);
  assert.equal(needsRecovery({ delivery: 'delivering' }), true);
  assert.equal(
    needsRecovery({ delivery: 'delivering' }, { activePost: true }),
    false,
  );
  assert.equal(needsRecovery({ delivery: 'delivered' }), false);
  assert.equal(
    needsRecovery({ delivery: 'failed', definitelyUnsent: true }),
    false,
  );
});

test('reconciliation is receipt-based and never compares message text', () => {
  const delivered = optimistic({ id: 'delivered', text: 'same text' });
  const failed = optimistic({
    id: 'failed',
    text: 'same text',
    delivery: 'failed',
  });
  const otherSession = optimistic({
    id: 'other-session',
    sessionId: 'session-2',
  });

  const result = reconcileDeliveryReceipts(
    [delivered, failed, otherSession],
    'session-1',
    11,
  );

  assert.deepEqual(result.reconciled, [delivered]);
  assert.deepEqual(result.remaining, [failed, otherSession]);
});

test('invalid or absent receipt cursors fail closed', () => {
  for (const receipt of [
    optimistic({
      receiptBaselineCursor: null,
      receiptRowId: null,
    }),
    optimistic({ receiptBaselineCursor: -1 }),
    optimistic({ receiptBaselineCursor: 1.5 }),
    optimistic({ receiptBaselineCursor: Number.MAX_SAFE_INTEGER + 1 }),
  ]) {
    assert.equal(receiptReachedTranscript(receipt, 50), false);
  }
});

test('failed and definitely-unsent messages survive receipt reconciliation', () => {
  const unknown = optimistic({
    id: 'unknown',
    delivery: 'failed',
    retrySafe: false,
    errorCode: 'send_not_confirmed',
  });
  const definitelyUnsent = optimistic({
    id: 'not-sent',
    delivery: 'failed',
    retrySafe: true,
    definitelyUnsent: true,
    errorCode: 'workspace_list_unavailable',
  });
  const delivered = optimistic({ id: 'delivered' });

  const result = reconcileDeliveryReceipts(
    [unknown, definitelyUnsent, delivered],
    'session-1',
    11,
  );

  assert.deepEqual(result.reconciled, [delivered]);
  assert.deepEqual(result.remaining, [unknown, definitelyUnsent]);
});

test('recovering typed text never requires proof, resending always does', async () => {
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );

  // An absent ledger entry looks like proof a message was never sent and is
  // not: the ledger evicts on CAPACITY as well as age, so a delivered receipt
  // can be dropped early and no age check can see that. Acting on it resends a
  // message that already went out. An earlier version of this file did exactly
  // that, so the invariant is pinned rather than left to memory.
  const settleStart = js.indexOf('async function settleTerminalDeliveryStatus');
  assert.ok(settleStart > 0, 'settleTerminalDeliveryStatus must exist');
  const settleBody = js.slice(settleStart, js.indexOf('\n}\n', settleStart));
  assert.doesNotMatch(
    settleBody,
    /delivery\.state === 'absent'[\s\S]*definitelyUnsent = true/,
    'an absent ledger entry must never be treated as proof a message was unsent',
  );

  // Editing returns the text to the composer and sends nothing, so it is safe
  // whatever happened to the original. Requiring proof left an ambiguous
  // failure with no way to recover what was typed.
  const editStart = js.indexOf('async function editFailedMessage(message)');
  assert.ok(editStart > 0, 'editFailedMessage must exist');
  const editBody = js.slice(editStart, js.indexOf('\n}\n', editStart));
  assert.doesNotMatch(
    editBody,
    /message\.definitelyUnsent !== true/,
    'recovering typed text must not require proof the send failed',
  );
  assert.doesNotMatch(
    editBody,
    /verifyTerminalDeliveryAction\(message\)/,
    'recovering typed text must not depend on a reachable status endpoint',
  );
  assert.match(
    editBody,
    /claimTerminalDeliveryActionRequired\(message, 'edit'\)/,
    'the atomic local claim remains the cross-window edit gate',
  );

  // The shared claim gate must treat edit like delete, not like retry.
  const ambiguous = persistedMessage({
    retrySafe: false,
    definitelyUnsent: false,
  });
  const editClaim = deliveryReceipts.pendingDeliverySnapshotTransition(
    [ambiguous],
    {
      type: 'claim-terminal',
      action: 'edit',
      claimToken: 'ambiguous-edit-claim-123456789',
      message: ambiguous,
    },
    { sanitize: acceptPersistedMessage, now: 1_777_777_777_000 },
  );
  assert.equal(editClaim.value?.id, ambiguous.id);

  // Retry keeps its proof requirement, because it is the one that resends.
  const canRetryStart = js.indexOf('function deliveryCanRetry(message) {');
  const canRetryBody = js.slice(canRetryStart, js.indexOf('\n}\n', canRetryStart));
  assert.match(canRetryBody, /message\.retrySafe === true/);
  assert.match(canRetryBody, /message\.definitelyUnsent === true/);
})

test('failed terminal verification reaches one visible action path', async () => {
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  const verifyStart = js.indexOf(
    'async function verifyTerminalDeliveryAction(message)',
  );
  const verifyEnd = js.indexOf(
    'function applyAuthoritativePendingDelivery',
    verifyStart,
  );
  const verify = js.slice(verifyStart, verifyEnd);
  assert.match(verify, /terminalDeliveryActionDisposition\(delivery\)/);
  const actionableStart = verify.indexOf("if (disposition === 'actionable')");
  const actionableEnd = verify.indexOf(
    "if (disposition === 'pending')",
    actionableStart,
  );
  const actionable = verify.slice(actionableStart, actionableEnd);
  assert.match(
    actionable,
    /settleTerminalDeliveryStatus\(message, delivery\)[\s\S]*return message/,
  );
  assert.doesNotMatch(actionable, /return null/);
  assert.match(
    verify,
    /disposition === 'resolved'[\s\S]*settleTerminalDeliveryStatus\(message, delivery\)[\s\S]*return null/,
  );

  const retryStart = js.indexOf('async function retryMessage(message)');
  const retryEnd = js.indexOf('async function claimConflictAction', retryStart);
  const retry = js.slice(retryStart, retryEnd);
  assert.match(retry, /deliveryActionCoordinator\.run\(/);
  assert.match(retry, /runDefinitelyUnsentRetry\(\{/);
  assert.match(
    retry,
    /claimTerminalDeliveryActionRequired\(candidate, 'retry'\)/,
  );
  assert.match(retry, /void deliverOptimistic\(message/);
  assert.doesNotMatch(
    retry,
    /verifyTerminalDeliveryAction\(message\)/,
    'a certified unsent Retry must use the same-key authoritative POST directly',
  );

  const checkStart = js.indexOf('async function checkDeliveryNow(message)');
  const checkEnd = js.indexOf('function checkDelivery(message', checkStart);
  const check = js.slice(checkStart, checkEnd);
  assert.match(check, /requestDeliveryStatus\(message\)/);
  assert.match(check, /terminalDeliveryActionDisposition\(delivery\)/);
  assert.equal(
    (check.match(/checkDelivery\(message, \{ force: true \}\)/g) || []).length,
    1,
    'manual Check may resume recovery only after the server proves the send is pending',
  );
  assert.match(
    js,
    /text: 'Retry'[\s\S]*'aria-busy': activeAction === 'retry'/,
  );
  assert.match(js, /click: \(\) => void checkDeliveryNow\(message\)/);
});

test('manual delivery actions cancel stale automatic recovery work', async () => {
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  const recoveryStart = js.indexOf('function checkDelivery(message');
  const recoveryEnd = js.indexOf('async function recoverPendingDeliveries');
  const recovery = js.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /function cancelDeliveryRecovery\(message\)/);
  assert.match(recovery, /cancelled: false/);
  assert.match(recovery, /deliveryRecoveryEntryIsCurrent\(entry\)/);
  assert.match(
    recovery,
    /deliveryNeedsAutomaticRecovery\(message\)[\s\S]*message\.delivery = 'confirming'/,
    'a queued recovery must recheck eligibility before changing visible state',
  );
  assert.match(
    recovery,
    /requestDeliveryStatus\(message\)[\s\S]*deliveryRecoveryEntryIsCurrent\(entry\)/,
    'an active recovery must stop after a manual action cancels it',
  );

  for (const functionName of [
    'discardFailedMessage',
    'editFailedMessage',
    'checkDeliveryNow',
    'retryMessage',
    'claimConflictAction',
  ]) {
    const start = js.indexOf(`function ${functionName}`);
    assert.ok(start > 0, `${functionName} must exist`);
    const body = js.slice(start, js.indexOf('\n}\n', start));
    assert.match(
      body,
      /cancelDeliveryRecovery\(message\)/,
      `${functionName} must cancel background recovery first`,
    );
  }
});

test('a forced recovery request survives the cancelled recovery it replaces', async () => {
  const js = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  const start = js.indexOf('function checkDelivery(message');
  const end = js.indexOf('async function checkDeliveryOnce', start);
  const coordinator = js.slice(start, end);

  assert.match(
    coordinator,
    /if \(existing\) \{[\s\S]*existing\.cancelled && force[\s\S]*existing\.restartRequested = true[\s\S]*return existing\.operation/,
  );
  assert.match(
    coordinator,
    /const restart =[\s\S]*entry\.restartRequested === true[\s\S]*if \(restart\) \{[\s\S]*void checkDelivery\(entry\.message, \{ force: true \}\)/,
  );
});
