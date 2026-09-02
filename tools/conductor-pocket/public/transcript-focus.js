const ACTIVITY_KINDS = new Set(['assistant', 'tool']);
const HIDDEN_KINDS = new Set(['status', 'tool-result', 'turn-result']);

export function reconcileMountedChildren(container, desiredChildren) {
  const desired = Array.from(desiredChildren || []).filter(Boolean);
  const desiredSet = new Set(desired);
  const ownerDocument = container?.ownerDocument || null;
  const focusedElement = ownerDocument?.activeElement || null;
  const restoreFocus = Boolean(
    focusedElement && container?.contains?.(focusedElement),
  );
  for (const child of Array.from(container?.children || [])) {
    if (!desiredSet.has(child)) container.removeChild(child);
  }
  for (let index = 0; index < desired.length; index += 1) {
    const child = desired[index];
    const current = container.children[index] || null;
    if (current !== child) container.insertBefore(child, current);
  }
  if (
    restoreFocus &&
    focusedElement?.isConnected &&
    container?.contains?.(focusedElement) &&
    ownerDocument.activeElement !== focusedElement
  ) {
    focusedElement.focus({ preventScroll: true });
  }
  return desired;
}

export function captureScrollAnchor(scroller, { pinThreshold = 48 } = {}) {
  const scrollHeight = Math.max(0, Number(scroller?.scrollHeight) || 0);
  const clientHeight = Math.max(0, Number(scroller?.clientHeight) || 0);
  const scrollTop = Math.max(0, Number(scroller?.scrollTop) || 0);
  const distance = Math.max(0, scrollHeight - clientHeight - scrollTop);
  return {
    pinned: distance < pinThreshold,
    scrollTop,
    viewportTop: Number(scroller?.getBoundingClientRect?.().top) || 0,
  };
}

export function restoreScrollAnchor(
  scroller,
  anchor,
  { latestThreshold = 120 } = {},
) {
  const scrollHeight = Math.max(0, Number(scroller?.scrollHeight) || 0);
  const clientHeight = Math.max(0, Number(scroller?.clientHeight) || 0);
  const maximum = Math.max(0, scrollHeight - clientHeight);
  const viewportTop = Number(scroller?.getBoundingClientRect?.().top) || 0;
  const viewportDelta = viewportTop - (Number(anchor?.viewportTop) || 0);
  scroller.scrollTop = anchor?.pinned
    ? maximum
    : Math.min(
        maximum,
        Math.max(0, (Number(anchor?.scrollTop) || 0) + viewportDelta),
      );
  const distance = Math.max(
    0,
    scrollHeight - clientHeight - (Number(scroller.scrollTop) || 0),
  );
  return {
    latestVisible: distance >= latestThreshold,
    distance,
  };
}

export function captureHorizontalScrollAnchor(
  strip,
  children,
  { preferred = null, manual = false } = {},
) {
  const stripRect = strip?.getBoundingClientRect?.();
  const candidates = Array.from(children || []).filter(Boolean);
  const visible = stripRect
    ? candidates.find((child) => {
        const rect = child.getBoundingClientRect?.();
        return rect && rect.right > stripRect.left && rect.left < stripRect.right;
      })
    : null;
  const element = manual ? visible || preferred : preferred || visible;
  if (!element) return null;
  return {
    element,
    offsetLeft: Number(element.offsetLeft) || 0,
    scrollLeft: Math.max(0, Number(strip?.scrollLeft) || 0),
  };
}

export function restoreHorizontalScrollAnchor(strip, anchor) {
  if (!strip || !anchor?.element) return null;
  const maximum = Math.max(
    0,
    (Number(strip.scrollWidth) || 0) - (Number(strip.clientWidth) || 0),
  );
  const offsetDelta =
    (Number(anchor.element.offsetLeft) || 0) -
    (Number(anchor.offsetLeft) || 0);
  const next = Math.max(
    0,
    Math.min(maximum, (Number(anchor.scrollLeft) || 0) + offsetDelta),
  );
  strip.scrollLeft = next;
  return next;
}

export function transcriptMessageRenderIdentity(
  message,
  {
    resolvedState = null,
    newestRootEventRowId = 0,
    deliveryAction = null,
    deliveredReceiptDismissible = false,
  } = {},
) {
  const rowId = Number(message?.rowId);
  const superseded =
    message?.kind === 'agent-error' &&
    Number.isFinite(rowId) &&
    newestRootEventRowId > 0 &&
    rowId < newestRootEventRowId;
  return JSON.stringify([
    message?.kind,
    message?.text,
    Array.isArray(message?.attachments)
      ? message.attachments.map((attachment) =>
          typeof attachment === 'string'
            ? attachment
            : [
                attachment?.id,
                attachment?.mediaType,
                attachment?.width,
                attachment?.height,
                Boolean(attachment?.previewUrl),
              ],
        )
      : null,
    message?.delivery,
    message?.errorCode,
    message?.errorProjectName,
    message?.errorDetail,
    message?.retrySafe,
    message?.definitelyUnsent,
    message?.deliveryRecoveryExhausted,
    message?.deliveryPhase,
    message?.queued,
    message?.createdAt,
    message?.sentAt,
    message?.deliveredAt,
    resolvedState ?? message?.state,
    message?.code,
    message?.severity,
    message?.occurrenceCount,
    superseded,
    deliveryAction,
    deliveredReceiptDismissible,
  ]);
}

export function visibleQueuedRowIds(messages, { limit = 8 } = {}) {
  const result = [];
  const seen = new Set();
  for (const message of messages || []) {
    const rowId = Number(message?.rowId);
    if (
      message?.kind !== 'user' ||
      message?.queued !== true ||
      !Number.isSafeInteger(rowId) ||
      rowId <= 0 ||
      seen.has(rowId)
    ) {
      continue;
    }
    seen.add(rowId);
    result.push(rowId);
    if (result.length >= Math.max(1, limit)) break;
  }
  return result;
}

export function visibleQueuedRowRefreshKey(messages) {
  const seen = new Set();
  const queued = [];
  for (const message of messages || []) {
    const rowId = Number(message?.rowId);
    if (
      message?.kind !== 'user' ||
      message?.queued !== true ||
      typeof message?.id !== 'string' ||
      !Number.isSafeInteger(rowId) ||
      rowId <= 0 ||
      seen.has(rowId)
    ) {
      continue;
    }
    seen.add(rowId);
    queued.push([message.id, rowId]);
    if (queued.length >= 8) break;
  }
  return queued.length > 0 ? JSON.stringify(queued) : null;
}

export function stableTranscriptMessages(serverMessages, pendingMessages) {
  const serverIds = new Set(serverMessages.map((message) => message?.id));
  const failedByReceiptId = new Map(
    pendingMessages
      .filter(
        (message) =>
          message?.delivery === 'failed' &&
          typeof message.receiptMessageId === 'string' &&
          message.receiptMessageId.length > 0,
      )
      .map((message) => [message.receiptMessageId, message]),
  );
  const replacedPendingIds = new Set();
  const visibleServer = serverMessages.map((message) => {
    const replacement = failedByReceiptId.get(message?.id);
    if (!replacement) return message;
    replacedPendingIds.add(replacement.id);
    return replacement;
  });
  const visiblePending = pendingMessages.filter(
    (message) =>
      !replacedPendingIds.has(message?.id) &&
      !(
        message?.delivery === 'delivered' &&
        typeof message.receiptMessageId === 'string' &&
        serverIds.has(message.receiptMessageId)
      ),
  );
  return [...visibleServer, ...visiblePending];
}

export function reconciledTranscriptMessageIds(messages, reconciled) {
  const receiptRows = new Set(
    reconciled
      .map((message) => message?.receiptRowId)
      .filter((rowId) => Number.isSafeInteger(rowId)),
  );
  return messages
    .filter((message) => receiptRows.has(Number(message?.rowId)))
    .map((message) => String(message.id));
}

export function transcriptRefreshShouldWait(
  incomingMessages,
  pendingMessages,
  sessionId,
) {
  if (!incomingMessages.some((message) => message?.kind === 'user')) {
    return false;
  }
  return pendingMessages.some(
    (message) =>
      message?.sessionId === sessionId &&
      ['delivering', 'confirming'].includes(message.delivery),
  );
}

function isRootMessage(message) {
  return !message.parentToolUseId;
}

function isBackgroundFailure(message) {
  return (
    message.kind === 'agent-error' &&
    message.code === 'background_action_failed' &&
    Boolean(message.parentToolUseId)
  );
}

function numericRowId(message) {
  const value = Number(message.rowId);
  return Number.isFinite(value) ? value : 0;
}

export function hasCurrentTerminalAgentError(messages) {
  const rootEvents = messages.filter(
    (message) =>
      isRootMessage(message) &&
      ['user', 'assistant', 'agent-error', 'turn-result'].includes(message.kind),
  );
  if (rootEvents.length === 0) return false;
  const latestRowId = Math.max(...rootEvents.map(numericRowId));
  return rootEvents.some(
    (message) =>
      message.kind === 'agent-error' &&
      message.retrying !== true &&
      message.code !== 'background_action_failed' &&
      numericRowId(message) === latestRowId,
  );
}

function completedTurns(messages, sessionStatus) {
  const turns = new Map();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message.turnId) continue;
    if (!turns.has(message.turnId)) {
      turns.set(message.turnId, {
        assistants: [],
        result: null,
        firstIndex: index,
      });
    }
    const turn = turns.get(message.turnId);
    if (message.kind === 'assistant' && isRootMessage(message)) {
      turn.assistants.push(message);
    } else if (message.kind === 'turn-result' && isRootMessage(message)) {
      turn.result = message;
    }
  }

  const orderedTurns = [...turns.entries()].sort(
    (left, right) => left[1].firstIndex - right[1].firstIndex,
  );
  const finalRows = new Map();

  for (const [turnId, turn] of orderedTurns) {
    if (turn.result?.state === 'failed') continue;
    if (!turn.result && sessionStatus !== 'idle') continue;
    let candidates = turn.assistants;
    if (turn.result) {
      const resultRowId = numericRowId(turn.result);
      candidates = candidates.filter(
        (message) => numericRowId(message) < resultRowId,
      );
    }
    if (candidates.length === 0) continue;
    finalRows.set(
      turnId,
      Math.max(...candidates.map((message) => numericRowId(message))),
    );
  }

  return finalRows;
}

function activeTurnId(messages, sessionStatus) {
  if (sessionStatus !== 'working') return null;
  const terminalTurns = new Set(
    messages
      .filter(
        (message) =>
          message.kind === 'turn-result' &&
          message.turnId &&
          isRootMessage(message),
      )
      .map((message) => message.turnId),
  );
  return [...messages]
    .reverse()
    .find(
      (message) =>
        ACTIVITY_KINDS.has(message.kind) &&
        message.turnId &&
        isRootMessage(message) &&
        !terminalTurns.has(message.turnId),
    )?.turnId || null;
}

function resolvedToolState(message, toolResults) {
  return toolResults.get(message.toolCallId)?.state || message.state || 'running';
}

function repeatedFailedBashTurns(messages, toolResults) {
  const toolCallIdsByTurn = new Map();
  for (const message of messages) {
    if (
      message.kind !== 'tool' ||
      message.name !== 'Bash' ||
      !message.turnId ||
      !message.toolCallId ||
      !isRootMessage(message) ||
      toolResults.get(message.toolCallId)?.state !== 'failed'
    ) {
      continue;
    }
    if (!toolCallIdsByTurn.has(message.turnId)) {
      toolCallIdsByTurn.set(message.turnId, new Set());
    }
    toolCallIdsByTurn.get(message.turnId).add(message.toolCallId);
  }
  return new Set(
    [...toolCallIdsByTurn.entries()]
      .filter(([, toolCallIds]) => toolCallIds.size > 1)
      .map(([turnId]) => turnId),
  );
}

function activityEntry(turnId, firstMessage) {
  return {
    id: `activity:${turnId}:${firstMessage.id}`,
    kind: 'activity',
    turnId,
    items: [],
    messageCount: 0,
    toolCount: 0,
    failedToolCount: 0,
    failedToolNames: [],
    backgroundErrorCount: 0,
    running: false,
  };
}

/**
 * Mirrors Conductor's focused transcript hierarchy:
 * completed turns keep their final root answer prominent while intermediate
 * root prose and successful tool calls become a compact disclosure.
 */
export function buildFocusedTranscript(
  messages,
  { sessionStatus = 'unknown' } = {},
) {
  const toolResults = new Map(
    messages
      .filter((message) => message.kind === 'tool-result' && message.toolCallId)
      .map((message) => [message.toolCallId, message]),
  );
  const toolCallIds = new Set(
    messages
      .filter((message) => message.kind === 'tool' && message.toolCallId)
      .map((message) => message.toolCallId),
  );
  const backgroundFailuresByTurn = new Map();
  for (const message of messages) {
    if (!message.turnId || !isBackgroundFailure(message)) continue;
    const existing = backgroundFailuresByTurn.get(message.turnId);
    if (existing) {
      if (existing.ids.has(message.id)) continue;
      existing.ids.add(message.id);
      existing.count += 1;
    } else {
      backgroundFailuresByTurn.set(message.turnId, {
        count: 1,
        ids: new Set([message.id]),
        representative: message,
      });
    }
  }
  const finalRows = completedTurns(messages, sessionStatus);
  const activeTurn = activeTurnId(messages, sessionStatus);
  const compactBashFailureTurns = repeatedFailedBashTurns(messages, toolResults);
  const entries = [];
  const emittedBackgroundFailureTurns = new Set();
  const emittedCompactBashToolCalls = new Set();
  let activity = null;

  const flushActivity = () => {
    if (!activity) return;
    entries.push(activity);
    activity = null;
  };

  const appendActivity = (message) => {
    if (!activity || activity.turnId !== message.turnId) {
      flushActivity();
      activity = activityEntry(message.turnId, message);
    }
    const previousItem = activity.items.at(-1);
    if (
      message.compactFailure === true &&
      previousItem?.compactFailure === true &&
      previousItem.name === message.name
    ) {
      previousItem.occurrenceCount =
        (Number(previousItem.occurrenceCount) || 1) + 1;
    } else {
      activity.items.push(message);
    }
    if (message.kind === 'assistant') activity.messageCount += 1;
    if (message.kind === 'tool') {
      activity.toolCount += 1;
      const state = resolvedToolState(message, toolResults);
      if (message.compactFailure === true && state === 'failed') {
        activity.failedToolCount += 1;
        if (!activity.failedToolNames.includes(message.name)) {
          activity.failedToolNames.push(message.name);
        }
      } else if (state === 'running') {
        activity.running = true;
      }
    }
  };

  for (const message of messages) {
    if (HIDDEN_KINDS.has(message.kind)) continue;

    if (
      message.kind === 'assistant' &&
      message.turnId &&
      isRootMessage(message)
    ) {
      const finalRow = finalRows.get(message.turnId);
      if (finalRow != null && numericRowId(message) === finalRow) {
        flushActivity();
        entries.push({ ...message, importance: 'primary' });
      } else {
        appendActivity({ ...message, importance: 'progress' });
      }
      continue;
    }

    if (message.kind === 'tool' && message.turnId && isRootMessage(message)) {
      const state = resolvedToolState(message, toolResults);
      if (state === 'failed') {
        if (
          message.name === 'Bash' &&
          compactBashFailureTurns.has(message.turnId)
        ) {
          if (emittedCompactBashToolCalls.has(message.toolCallId)) continue;
          emittedCompactBashToolCalls.add(message.toolCallId);
          appendActivity({
            ...message,
            resolvedState: state,
            compactFailure: true,
            occurrenceCount: 1,
          });
        } else {
          flushActivity();
          entries.push({ ...message, resolvedState: state });
        }
      } else {
        appendActivity({ ...message, resolvedState: state });
      }
      continue;
    }

    if (isBackgroundFailure(message) && message.turnId) {
      if (emittedBackgroundFailureTurns.has(message.turnId)) continue;
      const group = backgroundFailuresByTurn.get(message.turnId);
      if (!group) continue;
      if (!activity || activity.turnId !== message.turnId) {
        flushActivity();
        activity = activityEntry(message.turnId, message);
      }
      activity.backgroundErrorCount = group.count;
      activity.items.push({
        ...group.representative,
        occurrenceCount: group.count,
      });
      emittedBackgroundFailureTurns.add(message.turnId);
      continue;
    }

    if (message.kind === 'tool-failure') {
      if (message.toolCallId && toolCallIds.has(message.toolCallId)) continue;
      flushActivity();
      entries.push({ ...message, kind: 'agent-error' });
      continue;
    }

    if (message.kind === 'assistant' && !isRootMessage(message)) {
      continue;
    }

    if (ACTIVITY_KINDS.has(message.kind) && message.turnId) {
      appendActivity(message);
      continue;
    }

    flushActivity();
    entries.push(message);
  }

  flushActivity();
  if (activeTurn) {
    const activeEntry = [...entries]
      .reverse()
      .find(
        (entry) =>
          entry.kind === 'activity' && entry.turnId === activeTurn,
      );
    if (activeEntry) activeEntry.running = true;
  }
  return { entries, toolResults };
}

function countPhrase(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function activityLabel(activity) {
  const parts = [];
  if (activity.failedToolCount > 0) {
    const failedToolNames = Array.isArray(activity.failedToolNames)
      ? activity.failedToolNames.filter(Boolean)
      : [];
    if (failedToolNames.length === 1) {
      parts.push(
        countPhrase(
          activity.failedToolCount,
          `${failedToolNames[0]} failure`,
          `${failedToolNames[0]} failures`,
        ),
      );
    } else {
      parts.push(
        countPhrase(
          activity.failedToolCount,
          'failed action',
          'failed actions',
        ),
      );
    }
  }
  if (activity.backgroundErrorCount > 0) {
    parts.push(
      countPhrase(
        activity.backgroundErrorCount,
        'background failure',
        'background failures',
      ),
    );
  }
  const remainingToolCount =
    activity.toolCount - (Number(activity.failedToolCount) || 0);
  if (remainingToolCount > 0) {
    parts.push(
      countPhrase(remainingToolCount, 'tool call', 'tool calls'),
    );
  }
  if (activity.messageCount > 0) {
    parts.push(countPhrase(activity.messageCount, 'message', 'messages'));
  }
  return parts.join(', ') || 'Activity';
}
