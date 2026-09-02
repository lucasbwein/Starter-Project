function validCursor(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

const RECOVERY_TERMINAL_AUTH_CODES = new Set([
  'authentication_required',
  'device_locked',
  'device_revoked',
  'device_session_expired',
]);
const AUTHORITATIVE_POST_RECEIPT_FAILURE_CODES = new Set([
  'conductor_message_cancelled',
  'conductor_turn_rejected',
]);
const PENDING_SNAPSHOT_VERSION = 2;
const TERMINAL_TOMBSTONE_LIMIT = 256;
const TERMINAL_TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DRAFT_CLAIM_LIMIT = 256;
const DRAFT_CLAIM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const EDIT_CLAIM_MAX_AGE_MS = 5 * 60 * 1000;

function authorityString(value, maximum = 300) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function deliveryAttempt(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function deliveryIdentityMatches(left, right) {
  return (
    left?.id === right?.id &&
    deliveryAttempt(left?.deliveryAttempt) ===
      deliveryAttempt(right?.deliveryAttempt) &&
    left?.activeDeliveryKey === right?.activeDeliveryKey
  );
}

function deliveryStateRank(message) {
  return {
    delivering: 0,
    confirming: 1,
    failed: 2,
    delivered: 3,
  }[message?.delivery] ?? 0;
}

function deliveryKeyTransitionAllows(current, candidate, transitions) {
  return transitions.some(
    (transition) =>
      transition?.id === current.id &&
      Number.isSafeInteger(transition.deliveryAttempt) &&
      transition.deliveryAttempt === current.deliveryAttempt &&
      transition.from === current.activeDeliveryKey &&
      transition.to === candidate.activeDeliveryKey,
  );
}

function deliveryStateTransitionAllows(current, candidate, transitions) {
  return transitions.some(
    (transition) =>
      transition?.id === current.id &&
      Number.isSafeInteger(transition.deliveryAttempt) &&
      transition.deliveryAttempt === current.deliveryAttempt &&
      transition.activeDeliveryKey === current.activeDeliveryKey &&
      transition.from === current.delivery &&
      transition.to === candidate.delivery,
  );
}

function newerPendingDelivery(
  current,
  candidate,
  deliveryKeyTransitions,
  deliveryStateTransitions,
) {
  if (!current) return candidate;
  if (candidate.deliveryAttempt !== current.deliveryAttempt) {
    return candidate.deliveryAttempt > current.deliveryAttempt
      ? candidate
      : current;
  }
  if (candidate.activeDeliveryKey !== current.activeDeliveryKey) {
    return deliveryKeyTransitionAllows(
      current,
      candidate,
      deliveryKeyTransitions,
    )
      ? candidate
      : current;
  }
  const stateTransitionAuthorized = deliveryStateTransitionAllows(
    current,
    candidate,
    deliveryStateTransitions,
  );
  if (
    current.delivery === 'failed' &&
    AUTHORITATIVE_POST_RECEIPT_FAILURE_CODES.has(current.errorCode) &&
    candidate.delivery !== current.delivery &&
    !stateTransitionAuthorized
  ) {
    return current;
  }
  const candidateIsNewer =
    deliveryStateRank(candidate) >= deliveryStateRank(current);
  const newer =
    candidateIsNewer ||
    stateTransitionAuthorized
      ? candidate
      : current;
  if (
    current.terminalActionClaim &&
    deliveryIdentityMatches(current, newer)
  ) {
    return {
      ...newer,
      terminalActionClaim: current.terminalActionClaim,
    };
  }
  return newer;
}

function normalizedEditClaim(value, now) {
  const token = authorityString(value?.token, 200);
  const at = Number(value?.at);
  if (
    value?.action !== 'edit' ||
    !token ||
    !Number.isFinite(at) ||
    at > now ||
    now - at > EDIT_CLAIM_MAX_AGE_MS
  ) {
    return null;
  }
  return { action: 'edit', token, at };
}

function normalizePendingSnapshot(raw, sanitize, now) {
  const sourceMessages = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.messages)
      ? raw.messages
      : [];
  const messages = sourceMessages
    .map((value) => sanitize(value))
    .filter(Boolean)
    .map((message) => {
      const terminalActionClaim = normalizedEditClaim(
        message.terminalActionClaim,
        now,
      );
      if (terminalActionClaim) {
        return { ...message, terminalActionClaim };
      }
      const normalized = { ...message };
      delete normalized.terminalActionClaim;
      return normalized;
    });
  const tombstones = (Array.isArray(raw?.tombstones) ? raw.tombstones : [])
    .map((value) => {
      const id = authorityString(value?.id, 500);
      const activeDeliveryKey = authorityString(value?.activeDeliveryKey, 200);
      const action = new Set(['delete', 'edit', 'resolved']).has(value?.action)
        ? value.action
        : null;
      const at = Number(value?.at);
      if (
        !id ||
        !activeDeliveryKey ||
        !action ||
        !Number.isFinite(at) ||
        at > now ||
        now - at > TERMINAL_TOMBSTONE_MAX_AGE_MS
      ) {
        return null;
      }
      return {
        id,
        activeDeliveryKey,
        deliveryAttempt: deliveryAttempt(value.deliveryAttempt),
        action,
        at,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.at - left.at)
    .slice(0, TERMINAL_TOMBSTONE_LIMIT);
  const resolvedMessageIds = new Set(
    tombstones
      .filter((item) => item.action === 'resolved')
      .map((item) => item.id),
  );
  const draftClaims = (Array.isArray(raw?.draftClaims) ? raw.draftClaims : [])
    .map((value) => {
      const sessionId = authorityString(value?.sessionId, 300);
      const draftRevision = authorityString(value?.draftRevision, 200);
      const payloadFingerprint = authorityString(
        value?.payloadFingerprint,
        200,
      );
      const messageId = authorityString(value?.messageId, 500);
      const activeDeliveryKey = authorityString(
        value?.activeDeliveryKey,
        200,
      );
      const at = Number(value?.at);
      if (
        !sessionId ||
        !draftRevision ||
        !Number.isFinite(at) ||
        at > now ||
        now - at > DRAFT_CLAIM_MAX_AGE_MS
      ) {
        return null;
      }
      const claim = {
        sessionId,
        draftRevision,
        payloadFingerprint,
        at,
      };
      if (messageId && activeDeliveryKey) {
        claim.messageId = messageId;
        claim.activeDeliveryKey = activeDeliveryKey;
        claim.deliveryAttempt = deliveryAttempt(value?.deliveryAttempt);
      }
      return claim;
    })
    .filter(Boolean)
    .filter(
      (claim) => !claim.messageId || !resolvedMessageIds.has(claim.messageId),
    )
    .sort((left, right) => right.at - left.at)
    .slice(0, DRAFT_CLAIM_LIMIT);
  return {
    version: PENDING_SNAPSHOT_VERSION,
    messages,
    tombstones,
    draftClaims,
  };
}

function terminalTombstoneFor(message, action, now) {
  return {
    id: message.id,
    activeDeliveryKey: message.activeDeliveryKey,
    deliveryAttempt: deliveryAttempt(message.deliveryAttempt),
    action,
    at: now,
  };
}

function addTerminalTombstone(snapshot, message, action, now) {
  snapshot.tombstones = [
    terminalTombstoneFor(message, action, now),
    ...snapshot.tombstones.filter((item) => item.id !== message.id),
  ].slice(0, TERMINAL_TOMBSTONE_LIMIT);
}

function tombstoneBlocks(snapshot, candidate) {
  return snapshot.tombstones.some(
    (item) =>
      item.id === candidate.id &&
      deliveryAttempt(candidate.deliveryAttempt) <= item.deliveryAttempt,
  );
}

function draftClaimOwnsMessage(claim, message) {
  // The optimistic id is created once for the human-visible send and remains
  // stable through retries and draft-conflict delivery-key changes. Those
  // changes are the same attempt continuing, not a new draft owner.
  return claim?.messageId === message?.id;
}

function releaseDefinitelyUnsentDraftClaim(
  snapshot,
  message,
  payloadFingerprint,
) {
  if (message?.definitelyUnsent !== true) return;
  const fingerprint = authorityString(
    payloadFingerprint || message?.draftPayloadFingerprint,
    200,
  );
  snapshot.draftClaims = snapshot.draftClaims.filter((claim) => {
    if (claim.sessionId !== message.sessionId) return true;
    if (draftClaimOwnsMessage(claim, message)) return false;
    return !(
      fingerprint &&
      claim.payloadFingerprint === fingerprint
    );
  });
}

function mergePendingUpserts(
  snapshot,
  upserts,
  removeIds,
  deliveryKeyTransitions,
  deliveryStateTransitions,
  sanitize,
  now,
) {
  const merged = new Map(
    snapshot.messages.map((message) => [message.id, message]),
  );
  const removed = new Set(removeIds.filter((id) => typeof id === 'string'));
  for (const id of removed) {
    const current = merged.get(id);
    if (current) addTerminalTombstone(snapshot, current, 'resolved', now);
    merged.delete(id);
  }
  for (const value of upserts) {
    const candidate = sanitize(value);
    if (
      !candidate ||
      removed.has(candidate.id) ||
      tombstoneBlocks(snapshot, candidate)
    ) {
      continue;
    }
    merged.set(
      candidate.id,
      newerPendingDelivery(
        merged.get(candidate.id),
        candidate,
        deliveryKeyTransitions,
        deliveryStateTransitions,
      ),
    );
  }
  snapshot.messages = [...merged.values()];
}

export function pendingDeliverySnapshotTransition(
  raw,
  command,
  { sanitize = (value) => value, now = Date.now() } = {},
) {
  if (typeof sanitize !== 'function') {
    throw new TypeError('invalid_pending_delivery_sanitizer');
  }
  const snapshot = normalizePendingSnapshot(raw, sanitize, now);
  if (command?.type === 'mutate') {
    mergePendingUpserts(
      snapshot,
      Array.isArray(command.upserts) ? command.upserts : [],
      Array.isArray(command.removeIds) ? command.removeIds : [],
      Array.isArray(command.deliveryKeyTransitions)
        ? command.deliveryKeyTransitions
        : [],
      Array.isArray(command.deliveryStateTransitions)
        ? command.deliveryStateTransitions
        : [],
      sanitize,
      now,
    );
    return { snapshot, value: snapshot.messages };
  }
  if (command?.type === 'claim-draft-send') {
    const sessionId = authorityString(command.sessionId, 300);
    const draftRevision = authorityString(command.draftRevision, 200);
    const payloadFingerprint = authorityString(
      command.payloadFingerprint,
      200,
    );
    const candidate = sanitize(command.message);
    const existingClaim = snapshot.draftClaims.find(
      (item) => {
        if (item.sessionId !== sessionId) return false;
        const sameRevision = item.draftRevision === draftRevision;
        const samePayload =
          payloadFingerprint &&
          item.payloadFingerprint === payloadFingerprint;
        if (sameRevision) {
          return (
            !payloadFingerprint ||
            !item.payloadFingerprint ||
            samePayload
          );
        }
        return samePayload;
      },
    );
    if (
      !sessionId ||
      !draftRevision ||
      !candidate ||
      candidate.sessionId !== sessionId ||
      tombstoneBlocks(snapshot, candidate)
    ) {
      return { snapshot, value: null };
    }
    if (existingClaim) {
      const message = snapshot.messages.find(
        (item) => draftClaimOwnsMessage(existingClaim, item),
      ) || null;
      return {
        snapshot,
        value: {
          kind: 'draft-claim-conflict',
          claim: existingClaim,
          message,
        },
      };
    }
    snapshot.draftClaims = [
      {
        sessionId,
        draftRevision,
        payloadFingerprint,
        messageId: candidate.id,
        activeDeliveryKey: candidate.activeDeliveryKey,
        deliveryAttempt: deliveryAttempt(candidate.deliveryAttempt),
        at: now,
      },
      ...snapshot.draftClaims,
    ].slice(0, DRAFT_CLAIM_LIMIT);
    mergePendingUpserts(snapshot, [candidate], [], [], [], sanitize, now);
    return { snapshot, value: candidate };
  }
  if (command?.type === 'claim-terminal') {
    const action = command.action;
    if (!new Set(['retry', 'edit', 'delete']).has(action)) {
      throw new Error('delivery_action_invalid');
    }
    const index = snapshot.messages.findIndex(
      (candidate) => candidate.id === command.message?.id,
    );
    const candidate = index >= 0 ? snapshot.messages[index] : null;
    const matches =
      candidate?.delivery === 'failed' &&
      deliveryIdentityMatches(candidate, command.message) &&
      !candidate.terminalActionClaim &&
      (action === 'delete' ||
        action === 'edit' ||
        candidate.definitelyUnsent === true) &&
      (action !== 'retry' || candidate.retrySafe === true);
    if (!matches) return { snapshot, value: null };
    if (action === 'edit') {
      const claimToken = authorityString(command.claimToken, 200);
      if (!claimToken) throw new Error('delivery_edit_claim_invalid');
      const claimed = {
        ...candidate,
        terminalActionClaim: {
          action: 'edit',
          token: claimToken,
          at: now,
        },
      };
      snapshot.messages[index] = claimed;
      return { snapshot, value: claimed };
    }
    if (action === 'delete') {
      snapshot.messages.splice(index, 1);
      addTerminalTombstone(snapshot, candidate, 'delete', now);
      releaseDefinitelyUnsentDraftClaim(
        snapshot,
        candidate,
        command.payloadFingerprint,
      );
      return { snapshot, value: candidate };
    }
    const claimed = {
      ...candidate,
      delivery: 'delivering',
      deliveryPhase: null,
      retrySafe: false,
      definitelyUnsent: false,
      deliveryRecoveryExhausted: false,
      errorCode: null,
      errorProjectName: null,
      deliveryAttempt: candidate.deliveryAttempt + 1,
    };
    snapshot.messages[index] = claimed;
    return { snapshot, value: claimed };
  }
  if (command?.type === 'stop-check') {
    const index = snapshot.messages.findIndex(
      (candidate) => candidate.id === command.message?.id,
    );
    const candidate = index >= 0 ? snapshot.messages[index] : null;
    if (
      candidate?.delivery !== 'confirming' ||
      !deliveryIdentityMatches(candidate, command.message) ||
      candidate.terminalActionClaim
    ) {
      return { snapshot, value: null };
    }
    const stopped = {
      ...candidate,
      delivery: 'failed',
      deliveryPhase: null,
      retrySafe: false,
      definitelyUnsent: false,
      deliveryRecoveryExhausted: true,
      errorCode: 'delivery_check_stopped',
      errorProjectName: null,
    };
    snapshot.messages[index] = stopped;
    return { snapshot, value: stopped };
  }
  if (command?.type === 'dismiss-delivered-receipt') {
    const index = snapshot.messages.findIndex(
      (candidate) => candidate.id === command.message?.id,
    );
    const candidate = index >= 0 ? snapshot.messages[index] : null;
    const verifiedReceipt = {
      state: 'delivered',
      messageId: command.verifiedReceipt?.messageId,
      rowId: command.verifiedReceipt?.rowId,
    };
    if (
      candidate?.delivery !== 'delivered' ||
      !deliveryIdentityMatches(candidate, command.message) ||
      candidate.receiptRowId !== command.message?.receiptRowId ||
      candidate.receiptMessageId !== command.message?.receiptMessageId ||
      candidate.receiptObservedAt !== command.message?.receiptObservedAt ||
      !sameDeliveredReceiptIdentity(candidate, verifiedReceipt)
    ) {
      return { snapshot, value: null };
    }
    snapshot.messages.splice(index, 1);
    addTerminalTombstone(snapshot, candidate, 'resolved', now);
    snapshot.draftClaims = snapshot.draftClaims.filter(
      (claim) => !draftClaimOwnsMessage(claim, candidate),
    );
    return { snapshot, value: candidate };
  }
  if (command?.type === 'expire-receipt') {
    const index = snapshot.messages.findIndex(
      (candidate) => candidate.id === command.message?.id,
    );
    const candidate = index >= 0 ? snapshot.messages[index] : null;
    const observedAt = Number(command.observedAt);
    if (
      candidate?.delivery !== 'delivered' ||
      !deliveryIdentityMatches(candidate, command.message) ||
      !Number.isFinite(observedAt) ||
      candidate.receiptObservedAt !== observedAt
    ) {
      return { snapshot, value: null };
    }
    snapshot.messages.splice(index, 1);
    addTerminalTombstone(snapshot, candidate, 'resolved', now);
    snapshot.draftClaims = snapshot.draftClaims.filter(
      (claim) => !draftClaimOwnsMessage(claim, candidate),
    );
    return { snapshot, value: candidate };
  }
  if (command?.type === 'observe-stalled-receipt') {
    const index = snapshot.messages.findIndex(
      (candidate) => candidate.id === command.message?.id,
    );
    const candidate = index >= 0 ? snapshot.messages[index] : null;
    const messageId = authorityString(command.messageId, 500);
    const rowId = Number(command.rowId);
    const observedAt = Number(command.observedAt);
    if (
      candidate?.delivery !== 'delivered' ||
      !deliveryIdentityMatches(candidate, command.message) ||
      Number.isFinite(candidate.receiptObservedAt) ||
      !messageId ||
      !Number.isSafeInteger(rowId) ||
      rowId <= 0 ||
      !Number.isFinite(observedAt) ||
      observedAt <= 0 ||
      observedAt > now ||
      candidate.receiptMessageId !== messageId ||
      candidate.receiptRowId !== rowId
    ) {
      return { snapshot, value: null };
    }
    const observed = { ...candidate, receiptObservedAt: observedAt };
    snapshot.messages[index] = observed;
    return { snapshot, value: observed };
  }
  if (
    command?.type === 'finalize-edit' ||
    command?.type === 'release-edit'
  ) {
    const index = snapshot.messages.findIndex(
      (candidate) => candidate.id === command.message?.id,
    );
    const candidate = index >= 0 ? snapshot.messages[index] : null;
    const matches =
      candidate &&
      deliveryIdentityMatches(candidate, command.message) &&
      candidate.terminalActionClaim?.token === command.claimToken;
    if (!matches) return { snapshot, value: null };
    if (command.type === 'finalize-edit') {
      snapshot.messages.splice(index, 1);
      addTerminalTombstone(snapshot, candidate, 'edit', now);
      releaseDefinitelyUnsentDraftClaim(
        snapshot,
        candidate,
        command.payloadFingerprint,
      );
      return { snapshot, value: candidate };
    }
    const released = { ...candidate };
    delete released.terminalActionClaim;
    snapshot.messages[index] = released;
    return { snapshot, value: released };
  }
  throw new Error('pending_delivery_transition_invalid');
}

export function draftClaimConflictCopy(conflict) {
  const message = conflict?.message;
  if (message?.delivery === 'delivered') {
    return 'This exact message already delivered. Clear this leftover draft before writing the next one.';
  }
  if (
    message?.delivery === 'delivering' ||
    message?.delivery === 'confirming'
  ) {
    return 'This exact message is already sending. Watch the existing message in this chat.';
  }
  if (message?.delivery === 'failed' && message.definitelyUnsent === true) {
    return 'This exact message already has a failed send. Use Retry or Edit on that message.';
  }
  if (message?.delivery === 'failed') {
    return 'This exact message has an unconfirmed send. Use Check or Edit on that message.';
  }
  return 'This exact draft already started earlier. Check the chat before sending it again.';
}

export function pendingDeliveryMessages(
  raw,
  { sanitize = (value) => value, now = Date.now() } = {},
) {
  return normalizePendingSnapshot(raw, sanitize, now).messages;
}

export async function draftSendPayloadFingerprint({
  text,
  attachments = [],
}) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('secure_payload_fingerprint_unavailable');
  }
  const visiblePayload = JSON.stringify({
    text: String(text || '').trim(),
    attachments: attachments.map((attachment) => String(attachment?.id || '')),
  });
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(visiblePayload),
  );
  return `sha256-${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function claimedDraftClearIsAuthorized({
  claimedRevision,
  claimedPayloadFingerprint,
  currentRevision,
  currentPayloadFingerprint,
}) {
  return (
    typeof claimedRevision === 'string' &&
    claimedRevision.length > 0 &&
    typeof claimedPayloadFingerprint === 'string' &&
    claimedPayloadFingerprint.length > 0 &&
    currentRevision === claimedRevision &&
    currentPayloadFingerprint === claimedPayloadFingerprint
  );
}

export function mergeRecoveredDraftText(recoveredText, existingDraft) {
  const recovered = String(recoveredText || '');
  const existing = String(existingDraft || '');
  if (!recovered) return existing;
  if (!existing) return recovered;
  if (
    existing === recovered ||
    existing.startsWith(`${recovered}\n\n`)
  ) {
    return existing;
  }
  return `${recovered}\n\n${existing}`;
}

export function mergeRecoveredAttachmentItems(
  recoveredItems = [],
  currentItems = [],
) {
  const keyFor = (item) => item?.id || item?.localId || null;
  const currentByKey = new Map(
    currentItems
      .map((item) => [keyFor(item), item])
      .filter(([key]) => Boolean(key)),
  );
  const merged = [];
  const seen = new Set();
  for (const item of [...recoveredItems, ...currentItems]) {
    const key = keyFor(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(currentByKey.get(key) || item);
  }
  return merged;
}

export async function persistRecoveredDraftBeforeFinalizing({
  persistDraft,
  finalize,
  release,
}) {
  async function releaseSafely() {
    try {
      return Boolean(await release());
    } catch {
      return false;
    }
  }

  let persisted = false;
  try {
    persisted = (await persistDraft()) === true;
  } catch {
    persisted = false;
  }
  if (!persisted) {
    return {
      status: (await releaseSafely()) ? 'draft-failed' : 'release-failed',
      value: null,
    };
  }
  try {
    const value = await finalize();
    if (value) return { status: 'recovered', value };
  } catch {
    // The durable delivery is released below so recovery can be retried.
  }
  return {
    status: (await releaseSafely()) ? 'finalize-failed' : 'release-failed',
    value: null,
  };
}

export function workspaceProjectCollapsedCopy(projectName) {
  const safeName =
    typeof projectName === 'string' &&
    projectName.length > 0 &&
    projectName.length <= 160 &&
    projectName === projectName.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(projectName)
      ? projectName
      : null;
  if (!safeName) {
    return "A project is collapsed in Conductor's sidebar. Expand it to send.";
  }
  return `The '${safeName}' project is collapsed in Conductor's sidebar. Expand it to send.`;
}

export function deliveryStatusIsTerminal(delivery) {
  return (
    delivery?.state === 'delivered' ||
    (delivery?.state === 'failed' &&
      (delivery.retrySafe === true || delivery.final === true))
  );
}

export function terminalDeliveryActionDisposition(delivery) {
  if (delivery?.state === 'delivered') return 'resolved';
  if (
    delivery?.state === 'failed' &&
    deliveryStatusIsTerminal(delivery)
  ) {
    return 'actionable';
  }
  if (delivery?.state === 'pending') return 'pending';
  return 'unverified';
}

export async function runDefinitelyUnsentRetry({
  message,
  canRetry,
  claim,
  apply,
  deliver,
}) {
  if (
    typeof canRetry !== 'function' ||
    typeof claim !== 'function' ||
    typeof apply !== 'function' ||
    typeof deliver !== 'function'
  ) {
    throw new TypeError('invalid_delivery_retry');
  }
  if (!canRetry(message)) {
    return { status: 'not-retryable', message: null };
  }
  const claimed = await claim(message);
  if (!claimed) return { status: 'conflict', message: null };
  apply(claimed);
  deliver(claimed);
  return { status: 'started', message: claimed };
}

export function createDeliveryActionCoordinator({
  onChange = () => {},
} = {}) {
  if (typeof onChange !== 'function') {
    throw new TypeError('invalid_delivery_action_change_handler');
  }
  const active = new Map();
  const notify = (key, action) => {
    try {
      onChange(key, action);
    } catch {
      // Busy-state presentation is advisory. It must never block the action
      // or leave its cross-tap coordinator permanently occupied.
    }
  };
  return {
    current(key) {
      return active.get(key) || null;
    },
    async run(key, action, operation) {
      if (
        typeof key !== 'string' ||
        key.length === 0 ||
        typeof action !== 'string' ||
        action.length === 0 ||
        typeof operation !== 'function'
      ) {
        throw new TypeError('invalid_delivery_action');
      }
      if (active.has(key)) return { started: false, value: null };
      active.set(key, action);
      notify(key, action);
      try {
        return { started: true, value: await operation() };
      } finally {
        active.delete(key);
        notify(key, null);
      }
    },
  };
}

export async function readDeliveryStatusResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    const invalidResponse = new Error('delivery_status_invalid_response');
    invalidResponse.code = 'delivery_status_invalid_response';
    throw invalidResponse;
  }
  if (!response.ok) {
    const error = new Error(
      payload?.error?.code || `http_${response.status}`,
    );
    error.code = payload?.error?.code || `http_${response.status}`;
    error.status = response.status;
    throw error;
  }
  if (!payload?.delivery || typeof payload.delivery !== 'object') {
    const invalidResponse = new Error('delivery_status_invalid_response');
    invalidResponse.code = 'delivery_status_invalid_response';
    throw invalidResponse;
  }
  return payload.delivery;
}

export function deliveryRecoveryDecision(
  delivery,
  inconclusiveChecks = 0,
) {
  if (deliveryStatusIsTerminal(delivery)) {
    return { action: 'settle', inconclusiveChecks: 0 };
  }
  if (delivery?.state === 'pending') {
    return { action: 'poll', inconclusiveChecks: 0 };
  }
  const currentInconclusiveChecks =
    Number.isSafeInteger(inconclusiveChecks) && inconclusiveChecks >= 0
      ? inconclusiveChecks
      : 0;
  const nextInconclusiveChecks = currentInconclusiveChecks + 1;
  return {
    // An absent, delayed, or timed-out receipt is never proof that delivery
    // failed. The caller owns the polling window and may re-arm recovery when
    // the app becomes visible or the network reconnects.
    action: 'retry',
    inconclusiveChecks: nextInconclusiveChecks,
  };
}

export function extendDeliveryRecoveryDeadline(
  delivery,
  deadline,
  now,
  recoveryMs,
) {
  const currentDeadline = Number(deadline);
  const checkedAt = Number(now);
  const recoveryWindow = Number(recoveryMs);
  if (
    delivery?.state !== 'pending' ||
    !Number.isFinite(currentDeadline) ||
    !Number.isFinite(checkedAt) ||
    !Number.isFinite(recoveryWindow) ||
    recoveryWindow <= 0
  ) {
    return currentDeadline;
  }
  return Math.max(currentDeadline, checkedAt + recoveryWindow);
}

export function deliveryBackstopNeedsRecovery(
  message,
  { activePost = false } = {},
) {
  if (!deliveryNeedsAutomaticRecovery(message)) return false;
  if (
    message.delivery === 'failed' ||
    message.delivery === 'confirming'
  ) {
    return true;
  }
  return message.delivery === 'delivering' && activePost !== true;
}

export function deliveryNeedsAutomaticRecovery(message) {
  return (
    message?.definitelyUnsent !== true &&
    !RECOVERY_TERMINAL_AUTH_CODES.has(message?.errorCode) &&
    message?.deliveryRecoveryExhausted !== true &&
    (message?.delivery === 'delivering' ||
      message?.delivery === 'confirming' ||
      (message?.delivery === 'failed' &&
        message.definitelyUnsent !== true))
  );
}

export function rearmDeliveryRecovery(message) {
  if (
    message?.deliveryRecoveryExhausted !== true ||
    message?.definitelyUnsent === true ||
    RECOVERY_TERMINAL_AUTH_CODES.has(message?.errorCode) ||
    !['delivering', 'confirming', 'failed'].includes(message?.delivery)
  ) {
    return false;
  }
  message.deliveryRecoveryExhausted = false;
  return true;
}

export function receiptReachedTranscript(
  message,
  transcriptCursor,
  transcriptMessages = null,
) {
  if (message.delivery !== 'delivered' || !validCursor(transcriptCursor)) {
    return false;
  }
  const boundaryReached = validCursor(message.receiptRowId)
    ? transcriptCursor >= message.receiptRowId
    : validCursor(message.receiptBaselineCursor)
      ? transcriptCursor > message.receiptBaselineCursor
      : false;
  if (!boundaryReached) return false;
  if (
    Array.isArray(transcriptMessages) &&
    typeof message.receiptMessageId === 'string' &&
    message.receiptMessageId.length > 0
  ) {
    return transcriptMessages.some(
      (candidate) => candidate?.id === message.receiptMessageId,
    );
  }
  return true;
}

export function receiptTranscriptDisposition(
  receipt,
  transcriptMessages,
) {
  const messageId = authorityString(receipt?.messageId, 500);
  const rowId = Number(receipt?.rowId);
  if (
    !messageId ||
    !Number.isSafeInteger(rowId) ||
    rowId <= 0 ||
    !Array.isArray(transcriptMessages)
  ) {
    return 'unresolved';
  }
  if (
    transcriptMessages.some(
      (candidate) =>
        candidate?.id === messageId && candidate?.rowId === rowId,
    )
  ) {
    return 'present';
  }
  const visibleRowIds = transcriptMessages
    .map((candidate) => Number(candidate?.rowId))
    .filter((candidateRowId) =>
      Number.isSafeInteger(candidateRowId) && candidateRowId > 0,
    );
  if (
    visibleRowIds.length > 0 &&
    rowId < Math.min(...visibleRowIds)
  ) {
    return 'before-window';
  }
  return 'unresolved';
}

export function sameDeliveredReceiptIdentity(message, delivery) {
  if (
    message?.delivery !== 'delivered' ||
    delivery?.state !== 'delivered'
  ) {
    return false;
  }
  const messageRowId = Number(message.receiptRowId);
  const deliveryRowId = Number(delivery.rowId);
  if (
    !Number.isSafeInteger(messageRowId) ||
    messageRowId <= 0 ||
    deliveryRowId !== messageRowId
  ) {
    return false;
  }
  const messageId = authorityString(message.receiptMessageId, 500);
  const deliveryMessageId = authorityString(delivery.messageId, 500);
  return messageId || deliveryMessageId
    ? messageId === deliveryMessageId
    : true;
}

export function missingDeliveredReceiptDisposition(message, delivery) {
  if (sameDeliveredReceiptIdentity(message, delivery)) {
    return 'resume-observation';
  }
  if (delivery?.state === 'delivered') return 'identity-mismatch';
  if (deliveryStatusIsTerminal(delivery)) return 'settle-terminal';
  return 'wait';
}

export function deliveredReceiptVerificationDelay(
  message,
  now,
  stallMs,
) {
  const deliveredAt = Date.parse(message?.deliveredAt || '');
  const checkedAt = Number(now);
  const delay = Number(stallMs);
  if (
    !Number.isFinite(deliveredAt) ||
    !Number.isFinite(checkedAt) ||
    !Number.isFinite(delay) ||
    delay < 0
  ) {
    return 0;
  }
  return Math.max(0, deliveredAt + delay - checkedAt);
}

export function deliveryReceiptObservationDisposition(
  message,
  delivery,
  now,
  deadline,
) {
  const checkedAt = Number(now);
  const stopAt = Number(deadline);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(stopAt)) {
    return 'stop';
  }
  if (checkedAt < stopAt) return 'wait';
  return sameDeliveredReceiptIdentity(message, delivery)
    ? 'expire'
    : 'stop';
}

export function deliveredReceiptCanDismiss(message, now, minimumAgeMs) {
  if (message?.delivery !== 'delivered') return false;
  const checkedAt = Number(now);
  const minimumAge = Number(minimumAgeMs);
  if (
    !Number.isFinite(checkedAt) ||
    !Number.isFinite(minimumAge) ||
    minimumAge < 0
  ) {
    return false;
  }
  const deliveredAt = Date.parse(
    message.deliveredAt || message.createdAt || '',
  );
  return !Number.isFinite(deliveredAt) ||
    checkedAt >= deliveredAt + minimumAge;
}

export function reconcileDeliveryReceipts(
  optimisticMessages,
  sessionId,
  transcriptCursor,
  transcriptMessages = null,
) {
  const reconciled = [];
  const missing = [];
  const remaining = optimisticMessages.filter((message) => {
    if (message.sessionId !== sessionId) return true;
    if (!receiptReachedTranscript(message, transcriptCursor)) return true;
    if (!receiptReachedTranscript(
      message,
      transcriptCursor,
      transcriptMessages,
    )) {
      missing.push(message);
      return true;
    }
    reconciled.push(message);
    return (
      Array.isArray(transcriptMessages) &&
      typeof message.receiptMessageId === 'string' &&
      message.receiptMessageId.length > 0
    );
  });
  const reconciledMessages = new Set(reconciled);
  const unreconciled = remaining.filter(
    (message) =>
      message.sessionId === sessionId &&
      message.delivery === 'delivered' &&
      !reconciledMessages.has(message),
  );
  return { remaining, reconciled, missing, unreconciled };
}
