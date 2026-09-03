import {
  claimedDraftClearIsAuthorized,
  createDeliveryActionCoordinator,
  deliveryBackstopNeedsRecovery,
  deliveryNeedsAutomaticRecovery,
  deliveryRecoveryDecision,
  deliveryStatusIsTerminal,
  draftClaimConflictCopy,
  draftSendPayloadFingerprint,
  extendDeliveryRecoveryDeadline,
  mergeRecoveredAttachmentItems,
  mergeRecoveredDraftText,
  pendingDeliverySnapshotTransition,
  pendingDeliveryMessages,
  persistRecoveredDraftBeforeFinalizing,
  readDeliveryStatusResponse,
  rearmDeliveryRecovery,
  reconcileDeliveryReceipts,
  receiptTranscriptDisposition,
  runDefinitelyUnsentRetry,
  terminalDeliveryActionDisposition,
  workspaceProjectCollapsedCopy,
} from './delivery-receipts.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  appUpdateReloadIsSafe,
  createAppUpdateCoordinator,
  createServiceWorkerRegistrationGetter,
} from './app-update.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  BOOTSTRAP_REQUEST_MS,
  createBootstrapCoordinator,
} from './bootstrap-recovery.js?v=0.2.0-mac-off-diagnosis-20260903';
import { createDraftConflictFlow } from './draft-conflict.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  CONNECTION_REACHED_KEY,
  diagnoseConnection,
} from './connection-diagnosis.js?v=0.2.0-mac-off-diagnosis-20260903';
import { fetchJson } from './http.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  attachmentMessageByteLength,
  imageErrorCopy,
  imageErrorIsRetryable,
  imageMediaType,
  imageSelectionError,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_MESSAGE_BYTES,
  prepareImageForUpload,
} from './image-attachments.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  applyConnectionAvailability,
  createLiveRefreshCoordinator,
  createSessionMessageRequestCoordinator,
} from './live-refresh.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  renderRichText,
  richTextProfile,
} from './rich-text.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  READ_DWELL_MS,
  advanceReadProgress,
  effectiveSessionUnreadCount,
  effectiveWorkspaceUnreadCount,
  emptyReadProgress,
  normalizeReadReceipts,
  normalizeUnreadHeads,
  readableResponseRange,
  readReceiptSnapshot,
} from './read-state.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  activityLabel,
  buildFocusedTranscript,
  captureHorizontalScrollAnchor,
  captureScrollAnchor,
  hasCurrentTerminalAgentError,
  reconcileMountedChildren,
  reconciledTranscriptMessageIds,
  restoreHorizontalScrollAnchor,
  restoreScrollAnchor,
  stableTranscriptMessages,
  transcriptMessageRenderIdentity,
  transcriptRefreshShouldWait,
  visibleQueuedRowIds,
  visibleQueuedRowRefreshKey,
} from './transcript-focus.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  isRecentChatsSwipe,
} from './swipe-navigation.js?v=0.2.0-mac-off-diagnosis-20260903';
import {
  activeGptUsage,
  createUsageReader,
  usageAccountStatus,
} from './usage-state.js?v=0.2.0-mac-off-diagnosis-20260903';

const app = document.querySelector('#app');
const overlayRoot = document.querySelector('#overlay-root');
const announcer = document.querySelector('#announcer');
const PHONE_LAYOUT = window.matchMedia('(max-width: 599px)');
const AWAY_LOCK_MS = 5 * 60 * 1000;
const ACTIVITY_HEARTBEAT_MS = 60 * 1000;
const RESUME_REQUEST_MS = 6 * 1000;
const LIVE_REFRESH_DEBOUNCE_MS = 100;
const METADATA_REFRESH_DEBOUNCE_MS = 800;
const LIVE_REFRESH_REQUEST_MS = 6 * 1000;
const INITIAL_STREAM_RESTART_MS = 10_000;
const QUEUED_ROW_REFRESH_DELAY_MS = 800;
const QUEUED_ROW_REFRESH_MAX_ATTEMPTS = 3;
const TAB_ACTION_REQUEST_MS = 60_000;
// Spacing between attempts to rebuild a dead event stream. Long enough that a
// relay that is genuinely down is not hammered once per second, short enough
// that a dropped stream recovers before it is worth reaching for the app
// switcher.
const STREAM_REVIVE_MS = 15 * 1000;
// Backstop refresh while the app is on screen. The stream revive above only
// triggers once the connection is detectably dead; a stream that stays open but
// silently stops delivering change events looks perfectly healthy, and finished
// output then sits invisible until the app is backgrounded and foregrounded.
// This bounds that staleness without replacing the stream, which still delivers
// the common case in about two seconds.
const TRANSCRIPT_BACKSTOP_MS = 8 * 1000;
const APP_UPDATE_CHECK_INTERVAL_MS = 30 * 1000;
const HIDDEN_AT_KEY = 'cp:hidden-at:v1';
const CLIENT_VERSION = '0.2.0';
const SHELL_CACHE_PREFIX = 'conductor-pocket-shell-';
const CACHE_PURGE_CHANNEL = 'conductor-pocket-cache-purge-v1';
const SHARED_STATE_CHANNEL = 'conductor-pocket-shared-state-v1';
const ORIGIN_RETIRED_KEY = 'cp:origin-retired:v1';
const PENDING_DELIVERIES_KEY = 'pending-deliveries:v1';
const DRAFTS_KEY = 'cp:drafts:v1';
const ATTACHMENT_DRAFTS_KEY = 'cp:attachment-drafts:v1';
const READ_RECEIPTS_KEY = 'cp:read-receipts:v1';
const READ_RECEIPTS_CHANNEL = 'conductor-pocket-read-receipts-v1';
const ROUTE_KEY = 'cp:last-route:v2';
const LEGACY_ROUTE_KEY = 'cp:last-route:v1';
const CHAT_CREATION_ATTEMPTS_KEY = 'cp:chat-creation-attempts:v2';
const LEGACY_CHAT_CREATION_ATTEMPT_KEY = 'cp:chat-creation-attempt:v1';
const CHAT_CREATION_LEASE_KEY = 'cp:chat-creation-attempt-lease:v1';
const CHAT_CREATION_LOCK_NAME = 'conductor-pocket-chat-creation-attempts-v2';
const CHAT_CREATION_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const CHAT_CREATION_ATTEMPT_MAX = 32;
const CHAT_CREATION_LEASE_MS = 2_000;
const CHAT_CREATION_SETTLED_GRACE_MS = 5_000;
const DELIVERY_RECOVERY_MS = 120_000;
const DELIVERY_STATUS_REQUEST_MS = 8_000;
const DELIVERY_RECOVERY_POLL_MS = 1_000;
const DELIVERY_PROGRESS_POLL_MS = 1_000;
const DELIVERY_RECEIPT_OBSERVATION_MS = 10_000;
const DELIVERY_RECEIPT_OBSERVATION_POLL_MS = 1_000;
const DELIVERY_RECEIPT_STALL_MS = 30_000;
const MAX_CONCURRENT_DELIVERY_RECOVERIES = 2;
const DELIVERY_POST_TIMEOUT_MS = 90_000;
const TAILSCALE_SESSION_MODE = 'tailscale-session';
const CLIENT_SHELL_REVISION = '0.2.0-mac-off-diagnosis-20260903';
const MAX_CONCURRENT_IMAGE_UPLOADS = 2;
const IMAGE_UPLOAD_TIMEOUT_MS = 45_000;
const MOTION_MS = Object.freeze({
  quick: 100,
  content: 140,
  overlayExit: 160,
});

const state = {
  auth: null,
  csrfToken: null,
  connection: 'connecting',
  lastHeartbeat: 0,
  connectionProbe: null,
  // The error behind the current failure, so the gate can say WHY the Mac is
  // unreachable instead of only that it is. Cleared on every success.
  connectionError: null,
  eventSource: null,
  initialStreamTimer: null,
  heartbeatTimer: null,
  activityTimer: null,
  workspaces: [],
  workspacesLoaded: false,
  workspacesError: null,
  recentSessions: [],
  recentSessionsLoad: 'idle',
  recentSessionsError: null,
  recentSessionsRequestGeneration: 0,
  sessionsByWorkspace: new Map(),
  sessionErrorsByWorkspace: new Map(),
  messagesBySession: new Map(),
  cursorsBySession: new Map(),
  messageBaselinesBySession: new Set(),
  messageLiveEpochBySession: new Map(),
  sessionOpenController: null,
  route: { view: 'recent', workspaceId: null, sessionId: null },
  optimistic: [],
  attachmentsBySession: loadAttachmentDrafts(),
  attachmentSendIntents: new Set(),
  composerSendErrors: new Map(),
  sendInFlight: new Set(),
  searchQuery: '',
  shell: null,
  hiddenAt: null,
  visibilityEpoch: 0,
  seenMessageIds: new Set(),
  expandedActivities: new Set(),
  unreadHeads: new Map(),
  unreadHeadsLoaded: false,
  unreadMetadataEpoch: 0,
  workspaceRequestGeneration: 0,
  readReceipts: new Map(),
};

let activeImageUploads = 0;
const pendingImageUploads = [];
let imagePreparationQueue = Promise.resolve();
let readProgress = emptyReadProgress();
let readEvaluationTimer = null;
let readGestureSequence = 0;
let readReceiptWriteQueue = Promise.resolve();
const readReceiptCommits = new Set();
const deliveryRecoveryInFlight = new Map();
const missingReceiptChecks = new Map();
const deliveryReceiptObservations = new Map();
const stalledReceiptChecks = new Map();
const deliveryPostsInFlight = new Set();
const deliveryRecoveryQueue = [];
let activeDeliveryRecoveryCount = 0;
let bootstrapCoordinator = null;
const deliveryActionCoordinator = createDeliveryActionCoordinator({
  onChange() {
    if (state.shell) renderTranscript();
  },
});

const sessionMessageRequests = createSessionMessageRequestCoordinator();
let queuedRowRefresh = null;

function stopVisibleQueuedRowRefresh() {
  if (queuedRowRefresh?.timer) clearTimeout(queuedRowRefresh.timer);
  queuedRowRefresh = null;
}

function scheduleQueuedRowRefreshAttempt(task) {
  if (
    queuedRowRefresh !== task ||
    task.running ||
    task.timer ||
    task.attempts >= QUEUED_ROW_REFRESH_MAX_ATTEMPTS
  ) {
    return;
  }
  task.timer = setTimeout(async () => {
    task.timer = null;
    if (
      queuedRowRefresh !== task ||
      state.route.sessionId !== task.sessionId ||
      document.hidden
    ) {
      return;
    }
    task.running = true;
    task.attempts += 1;
    try {
      await refreshMessages(task.sessionId, {
        full: true,
        timeoutMs: LIVE_REFRESH_REQUEST_MS,
      });
    } finally {
      task.running = false;
      if (queuedRowRefresh === task) scheduleQueuedRowRefreshAttempt(task);
    }
  }, QUEUED_ROW_REFRESH_DELAY_MS);
}

function scheduleVisibleQueuedRowRefresh(messages) {
  const sessionId = state.route.sessionId;
  const key = visibleQueuedRowRefreshKey(messages);
  if (!sessionId || !key) {
    stopVisibleQueuedRowRefresh();
    return;
  }
  if (
    queuedRowRefresh?.sessionId === sessionId &&
    queuedRowRefresh.key === key
  ) {
    scheduleQueuedRowRefreshAttempt(queuedRowRefresh);
    return;
  }
  stopVisibleQueuedRowRefresh();
  queuedRowRefresh = {
    sessionId,
    key,
    rowIds: visibleQueuedRowIds(messages),
    attempts: 0,
    running: false,
    timer: null,
  };
  scheduleQueuedRowRefreshAttempt(queuedRowRefresh);
}

function resetSessionMessageState() {
  state.sessionOpenController?.abort();
  state.sessionOpenController = null;
  sessionMessageRequests.reset();
  state.messagesBySession.clear();
  state.cursorsBySession.clear();
  state.messageBaselinesBySession.clear();
  state.messageLiveEpochBySession.clear();
  stopVisibleQueuedRowRefresh();
  cancelReadTracking();
}

const transcriptRefresh = createLiveRefreshCoordinator({
  delayMs: LIVE_REFRESH_DEBOUNCE_MS,
  async run({ signal }) {
    const sessionId = state.route.sessionId;
    const requestOptions = {
      signal,
      timeoutMs: LIVE_REFRESH_REQUEST_MS,
    };
    if (sessionId) await refreshMessages(sessionId, requestOptions);
  },
  onError: handleRuntimeError,
});

const metadataRefresh = createLiveRefreshCoordinator({
  delayMs: METADATA_REFRESH_DEBOUNCE_MS,
  async run({ signal }) {
    const workspaceId = state.route.workspaceId;
    const requestOptions = {
      signal,
      timeoutMs: LIVE_REFRESH_REQUEST_MS,
    };
    await Promise.all([
      refreshWorkspaces(requestOptions),
      loadRecentSessions(requestOptions),
      workspaceId
        ? loadSessions(workspaceId, requestOptions)
        : Promise.resolve(),
    ]);
  },
  onError: handleRuntimeError,
});

const ICONS = {
  arrowUp: 'i-arrow-up',
  back: 'i-back',
  bolt: 'i-bolt',
  check: 'i-check',
  checkDouble: 'i-check-double',
  chevronDown: 'i-chevron-down',
  close: 'i-close',
  copy: 'i-copy',
  faceid: 'i-faceid',
  gear: 'i-gear',
  laptop: 'i-laptop',
  branch: 'i-branch',
  lock: 'i-lock',
  phone: 'i-phone',
  photo: 'i-photo',
  plus: 'i-plus',
  refresh: 'i-refresh',
  search: 'i-search',
  share: 'i-share',
  squares: 'i-squares',
  terminal: 'i-terminal',
  warn: 'i-warn',
  wifiOff: 'i-wifi-off',
};

// Why a send failed, in words a phone user can act on. Codes come from the
// Mac's automation layer; anything unmapped falls back to the sanitized
// detail when the relay preserved one.
const SEND_FAILURE_REASONS = Object.freeze({
  session_locked: 'The Mac is locked.',
  accessibility_disabled: 'Automation permission is off on the Mac.',
  conductor_not_running: 'Conductor is not running on the Mac.',
  conductor_window_unavailable:
    'Conductor has no window on the Mac. Quit and reopen it there.',
  composer_unavailable: 'The message box was not found in Conductor.',
  workspace_list_unavailable: 'The workspace list was not found in Conductor.',
  workspace_not_visible: 'This workspace is not visible in Conductor.',
  workspace_project_collapsed:
    "A project is collapsed in Conductor's sidebar. Expand it to send.",
  session_not_visible: 'This chat is not visible in Conductor.',
  user_input_active: 'Someone was using the Mac keyboard.',
  send_unavailable: 'The send button was not available in Conductor.',
  route_changed: 'The Conductor window changed mid-send.',
  composer_focus_changed: 'The message box lost focus mid-send.',
  draft_changed: 'The Mac draft changed mid-send.',
  input_helper_unavailable: 'The automation helper failed on the Mac.',
  automation_timeout: 'The Mac took too long.',
  automation_failed: 'Automation failed on the Mac.',
});

const AGENT_ERROR_PRESENTATIONS = Object.freeze({
  provider_reconnecting: {
    title: 'Agent connection interrupted',
    guidance: 'Conductor is reconnecting automatically.',
  },
  provider_unavailable: {
    title: 'Agent service unavailable',
    guidance: 'Try again in a moment. Your chat is still safe.',
  },
  usage_limit: {
    title: 'Out of usage for this session',
    // Names the wait, because the previous copy read as an account problem and
    // the one before that said "Reconnecting", which sent the operator looking
    // at a connection that was never broken.
    guidance: 'This resets on a timer. Switch accounts in Conductor on the Mac, or wait it out.',
  },
  model_unavailable: {
    title: 'Model unavailable',
    guidance: 'Choose another model in Conductor on the Mac, then try again.',
  },
  provider_auth_required: {
    title: 'Agent sign-in required',
    guidance: 'Reconnect the account in Conductor on the Mac.',
  },
  permission_required: {
    title: 'Permission required',
    guidance: 'Open Conductor on the Mac to approve the requested permission.',
  },
  policy_blocked: {
    title: 'Request blocked by provider policy',
    guidance: 'Rephrase your message, or open Conductor on the Mac for more guidance.',
  },
  cybersecurity_policy: {
    title: 'Blocked: cybersecurity policy',
    guidanceBefore:
      'The provider declined this request under its cybersecurity policy. Rephrase to make authorized, defensive intent clear, or request trusted access at ',
    guidanceLink: 'chatgpt.com/cyber',
    guidanceAfter: '.',
    helpUrl: 'https://chatgpt.com/cyber',
  },
  turn_interrupted: {
    title: 'Agent turn interrupted',
    guidance: 'Send again when you’re ready.',
  },
  agent_failed: {
    title: 'Request failed',
    guidance: 'Try again, or rephrase your message. Details are logged on the Mac.',
  },
  background_action_failed: {
    title: 'Background action failed',
    guidance:
      'This does not by itself stop the main turn. Open Conductor on the Mac only if you need private action details.',
  },
  tool_action_failed: {
    title: 'Tool action failed',
    guidance:
      'A Conductor action failed. Open the turn on your Mac for private details.',
  },
});

const UNKNOWN_AGENT_ERROR_PRESENTATION = Object.freeze({
  title: 'Request failed',
  guidance: 'Try again, or rephrase your message. Details are logged on the Mac.',
});

function safeAgentErrorCode(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value
    : 'unknown_error';
}

function agentErrorPresentation(code) {
  const safeCode = safeAgentErrorCode(code);
  return {
    code: safeCode,
    ...(AGENT_ERROR_PRESENTATIONS[safeCode] ||
      UNKNOWN_AGENT_ERROR_PRESENTATION),
  };
}

const DELIVERY_ERROR_COPY = Object.freeze({
  accessibility_disabled: 'Accessibility sending is disabled on your Mac.',
  attachment_unavailable: 'A photo is no longer available.',
  automation_failed: 'The Mac could not complete the Conductor action.',
  automation_invalid_response: 'The Mac returned an invalid send result.',
  automation_timeout: 'Conductor took too long to respond.',
  composer_tree_transient:
    'Conductor was redrawing the message box. Retry this message.',
  composer_changed_pre_send: 'The Conductor composer changed before sending.',
  composer_unavailable: 'The message box is not ready on your Mac.',
  conductor_message_cancelled: 'Conductor canceled this message after it entered the chat.',
  conductor_turn_rejected: 'Conductor rejected this message because the chat no longer has an active turn.',
  conductor_not_running: 'Conductor is not open on your Mac.',
  conductor_window_unavailable:
    'Conductor has no window on your Mac. Quit and reopen it there.',
  delivery_confirmation_timeout: 'Pocket could not verify delivery in time.',
  delivery_check_stopped: 'Automatic delivery checking was stopped.',
  delivery_unknown: 'Pocket could not verify whether Conductor accepted it.',
  draft_conflict: 'The Conductor composer already has unsent text.',
  draft_recheck_required: 'The Mac draft needs to be checked again.',
  input_helper_unavailable: 'The Mac input helper is unavailable.',
  message_empty: 'The message is empty.',
  message_invalid: 'The message contains unsupported content.',
  message_too_large: 'The message is too long.',
  predecessor_failed:
    'An earlier message in this chat needs Retry, Edit, or Delete first.',
  relay_restarted_before_send: 'The relay restarted before sending it.',
  relay_restarted_during_send:
    'The relay restarted during this send, so Pocket cannot safely send it again.',
  send_not_confirmed: 'Pocket could not verify whether Conductor accepted it.',
  send_unavailable: 'Conductor’s Send control is not ready.',
  secure_delivery_storage_unavailable: 'Secure delivery storage is unavailable on this phone.',
  session_locked: 'Your Mac is locked.',
  session_not_visible: 'That chat is not visible in Conductor.',
  session_route_changed: 'That chat changed on your Mac.',
  user_input_active: 'Your Mac was being used, so Pocket stopped safely.',
  workspace_list_unavailable: 'Pocket could not read the Conductor workspace list.',
  workspace_not_visible: 'That workspace is not visible in Conductor.',
  workspace_project_collapsed:
    "A project is collapsed in Conductor's sidebar. Expand it to send.",
});

const EDIT_BEFORE_RETRY_CODES = new Set([
  'attachment_unavailable',
  'draft_conflict',
  'message_empty',
  'message_invalid',
  'message_too_large',
  'secure_delivery_storage_unavailable',
]);

function safeDeliveryErrorCode(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value
    : 'delivery_unknown';
}

function deliveryErrorCopy(code, projectName = null) {
  const safeCode = safeDeliveryErrorCode(code);
  if (safeCode === 'workspace_project_collapsed') {
    return workspaceProjectCollapsedCopy(projectName);
  }
  return DELIVERY_ERROR_COPY[safeCode] || `Conductor reported ${safeCode.replaceAll('_', ' ')}.`;
}

function safeCollapsedProjectName(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 160 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
    ? value
    : null;
}

function deliveryCanRetry(message) {
  return (
    message?.delivery === 'failed' &&
    message.retrySafe === true &&
    message.definitelyUnsent === true &&
    !EDIT_BEFORE_RETRY_CODES.has(message.errorCode)
  );
}

function showComposerSendError(sessionId, message) {
  state.composerSendErrors.set(sessionId, message);
  renderComposerState();
  announce(message);
}

function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  if (className) svg.classList.add(...className.split(' '));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${ICONS[name] || name}`);
  svg.append(use);
  return svg;
}

function node(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (key === 'className') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key === 'on') {
      for (const [eventName, listener] of Object.entries(value)) {
        element.addEventListener(eventName, listener);
      }
    } else if (key in element && !key.startsWith('aria')) {
      element[key] = value;
    } else {
      element.setAttribute(key, value);
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function button(label, { iconName, className = 'icon-button', onClick } = {}) {
  const attributes = {
    className,
    type: 'button',
    'aria-label': label,
  };
  if (typeof onClick === 'function') attributes.on = { click: onClick };
  const control = node('button', attributes);
  if (iconName) control.append(icon(iconName));
  else control.textContent = label;
  return control;
}

const toastElement = document.querySelector('#toast');
let toastTimer = null;

// Announcements were screen-reader only, so on a phone a successful action and
// a failed one looked identical: nothing moved. That is why a slow operation
// read as broken and got tapped again. The visible half is deliberately plain,
// no motion beyond a fade, because a status pill that animates is the thing
// this app was asked not to do.
function announce(message) {
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.hidden = false;
  // Reflow between hidden=false and the class so the fade runs on a re-shown
  // toast rather than being collapsed away by the style recalculation.
  void toastElement.offsetHeight;
  toastElement.classList.add('is-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastElement.classList.remove('is-visible');
    toastTimer = setTimeout(() => {
      toastElement.hidden = true;
      toastTimer = null;
    }, 200);
  }, 3200);
}

function legacyCopyText(text) {
  const field = node('textarea', {
    className: 'clipboard-proxy',
    value: text,
    readOnly: true,
    'aria-hidden': 'true',
  });
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    return (
      typeof document.execCommand === 'function' &&
      document.execCommand('copy')
    );
  } finally {
    field.remove();
  }
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Older standalone Safari builds can expose the API but reject it.
    }
  }
  if (!legacyCopyText(text)) throw new Error('clipboard_unavailable');
}

function copyControl(
  text,
  {
    label,
    className,
    compact = false,
  },
) {
  const labelNode = node('span', {
    className: compact ? 'copy-control-label sr-only' : 'copy-control-label',
    text: label,
  });
  const control = node('button', {
    className,
    type: 'button',
    'aria-label': label,
  }, [icon('copy'), labelNode]);
  control.addEventListener('click', async () => {
    if (control.disabled) return;
    control.disabled = true;
    try {
      await writeClipboardText(text);
      control.classList.remove('is-failed');
      control.classList.add('is-copied');
      control.setAttribute('aria-label', 'Copied');
      labelNode.textContent = 'Copied';
      control.replaceChildren(icon('check'), labelNode);
      announce('Copied to clipboard');
    } catch {
      control.classList.remove('is-copied');
      control.classList.add('is-failed');
      control.setAttribute('aria-label', 'Copy failed');
      labelNode.textContent = 'Copy failed';
      control.replaceChildren(icon('warn'), labelNode);
      announce('Copy failed. Touch and hold the text to select it.');
    } finally {
      control.disabled = false;
      window.setTimeout(() => {
        if (!control.isConnected) return;
        control.classList.remove('is-copied', 'is-failed');
        control.setAttribute('aria-label', label);
        labelNode.textContent = label;
        control.replaceChildren(icon('copy'), labelNode);
      }, 1_600);
    }
  });
  return control;
}

function addCodeCopyControls(content) {
  for (const pre of content.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const wrapper = node('div', { className: 'code-block' });
    pre.replaceWith(wrapper);
    wrapper.append(
      pre,
      copyControl(code.textContent, {
        label: 'Copy code',
        className: 'code-copy-button',
        compact: true,
      }),
    );
  }
  return content;
}

function formatRelative(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatTime(value = new Date().toISOString()) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function initials(value) {
  return (
    String(value || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function cappedCount(count) {
  return count > 99 ? '99+' : String(count);
}

function unreadBadge(count) {
  return node('span', {
    className: 'badge',
    text: cappedCount(count),
    'aria-label': `${count} unread ${count === 1 ? 'message' : 'messages'}`,
  });
}

function randomIdempotencyKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return toBase64Url(bytes);
}

function fromBase64Url(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function toBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function registrationOptions(options) {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    user: { ...options.user, id: fromBase64Url(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
      ...credential,
      id: fromBase64Url(credential.id),
    })),
  };
}

function authenticationOptions(options) {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((credential) => ({
      ...credential,
      id: fromBase64Url(credential.id),
    })),
  };
}

function registrationResponse(credential) {
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(credential.response.clientDataJSON),
      attestationObject: toBase64Url(credential.response.attestationObject),
      transports: credential.response.getTransports?.() || [],
      publicKeyAlgorithm: credential.response.getPublicKeyAlgorithm?.(),
      publicKey: credential.response.getPublicKey?.()
        ? toBase64Url(credential.response.getPublicKey())
        : undefined,
      authenticatorData: credential.response.getAuthenticatorData?.()
        ? toBase64Url(credential.response.getAuthenticatorData())
        : undefined,
    },
  };
}

function authenticationResponse(credential) {
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(credential.response.clientDataJSON),
      authenticatorData: toBase64Url(credential.response.authenticatorData),
      signature: toBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? toBase64Url(credential.response.userHandle)
        : null,
    },
  };
}

async function request(
  pathname,
  {
    method = 'GET',
    body,
    csrf = false,
    timeoutMs = 0,
    signal,
  } = {},
) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  const { response, payload } = await fetchJson(pathname, {
    method,
    headers,
    timeoutMs,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error(payload.error?.code || `http_${response.status}`);
    error.code = payload.error?.code || `http_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function revealGateSurface() {
  document.querySelector('#privacy-shield')?.remove();
  app.removeAttribute('aria-hidden');
}

function bootView() {
  state.shell?.composer.observer?.disconnect();
  state.shell?.readObserver?.disconnect();
  cancelReadTracking();
  state.shell = null;
  const view =
    node(
      'main',
      {
        className: 'gate boot-gate connection-anchor-gate',
        role: 'status',
        'aria-live': 'polite',
      },
      node('div', { className: 'gate-column' }, [
        node('div', { className: 'app-mark', 'aria-hidden': 'true' }, icon('bolt')),
        node('h1', { className: 'sr-only', text: 'Conductor Pocket' }),
        node('p', {
          className: 'gate-lede boot-connecting',
          text: 'Connecting to your Mac…',
        }),
        node('p', {
          className: 'gate-lede boot-stalled',
          text: 'Still connecting. Check that Conductor is running on your Mac, then reopen Pocket.',
        }),
      ]),
    );
  app.replaceChildren(view);
  revealGateSurface();
  appUpdateCoordinator?.stateChanged();
}

function gateView({
  mark = 'bolt',
  title,
  body,
  content,
  action,
  secondary,
  connectionAnchor = false,
}) {
  void closeOverlay({ immediate: true });
  state.shell?.composer.observer?.disconnect();
  state.shell?.readObserver?.disconnect();
  cancelReadTracking();
  state.shell = null;
  const markNode = node('div', { className: 'app-mark' }, icon(mark));
  const column = node('div', { className: 'gate-column' }, [
    markNode,
    node('h1', { text: title }),
    body ? node('p', { className: 'gate-lede', text: body }) : null,
    content,
    action,
    secondary,
  ]);
  app.replaceChildren(
    node('main', {
      className: connectionAnchor ? 'gate connection-anchor-gate' : 'gate',
    }, column),
  );
  revealGateSurface();
  appUpdateCoordinator?.stateChanged();
}

function skeletonRows(count = 6) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    fragment.append(
      node('div', { className: 'skeleton-row', 'aria-hidden': 'true' }, [
        node('div', { className: 'skeleton-block skeleton-monogram' }),
        node('div', {}, [
          node('div', { className: 'skeleton-block skeleton-copy' }),
          node('div', { className: 'skeleton-block skeleton-copy short' }),
        ]),
      ]),
    );
  }
  return fragment;
}

async function initializePairing(code) {
  gateView({
    title: 'Conductor Pocket',
    body: "Remote for your Mac's Conductor",
    content: node('div', { className: 'pair-card' }, skeletonRows(3)),
  });
  try {
    const pairing = await request('/api/pair/start', {
      method: 'POST',
      body: { code, deviceName: /iPhone/i.test(navigator.userAgent) ? 'This iPhone' : 'This device' },
    });
    renderPairing(pairing);
  } catch (error) {
    renderPairingExpired(error.code);
  }
}

function renderPairing(pairing) {
  const card = node('section', { className: 'pair-card' }, [
    node('div', { className: 'micro-caps', text: 'Pairing with' }),
    node('div', { className: 'pair-mac', text: pairing.macName }),
    node('div', { className: 'machine-fact', text: pairing.hostname }),
    node('div', { className: 'pair-divider' }),
    node('div', { className: 'micro-caps', text: 'Verification code' }),
    node('div', { className: 'verification-code', text: pairing.verificationCode }),
    node('p', {
      className: 'pair-help',
      text: "The Mac terminal is showing the same code. If they don't match, don't pair.",
    }),
  ]);
  const action = node('button', {
    className: 'primary-button',
    type: 'button',
    text: 'The code matches - Pair',
    on: {
      click: async (event) => {
        const control = event.currentTarget;
        control.disabled = true;
        control.textContent = 'Waiting for Face ID…';
        try {
          await runWithAppUpdatePaused(async () => {
            if (!window.PublicKeyCredential) {
              throw new Error('passkey_unavailable');
            }
            const credential = await navigator.credentials.create({
              publicKey: registrationOptions(pairing.options),
            });
            const result = await request('/api/pair/finish', {
              method: 'POST',
              body: { response: registrationResponse(credential) },
            });
            history.replaceState({}, '', '/');
            state.auth = result;
            state.csrfToken = result.csrfToken;
            if (isStandalone()) {
              await startApplication();
            } else {
              renderInstallGuidance({ firstRun: true });
            }
          });
        } catch (error) {
          control.disabled = false;
          control.textContent = 'The code matches - Pair';
          let errorLine = card.querySelector('.inline-error');
          if (!errorLine) {
            errorLine = node('p', { className: 'inline-error' });
            card.append(errorLine);
          }
          errorLine.textContent =
            error.name === 'NotAllowedError'
              ? "Face ID wasn't set up. Try again."
              : 'Pairing could not be completed. Generate a new link on your Mac.';
        }
      },
    },
  });
  gateView({
    title: 'Conductor Pocket',
    body: "Remote for your Mac's Conductor",
    content: card,
    action,
  });
}

function renderPairingExpired(code) {
  const card = node('section', { className: 'pair-card' }, [
    icon('warn'),
    node('div', { className: 'pair-mac', text: 'This link has expired' }),
    node('p', {
      className: 'pair-help',
      text:
        code === 'tailscale_identity_required'
          ? 'Connect this phone to the same Tailscale network, then open a fresh pairing link.'
          : 'Pairing links work once. Generate a new one from the Conductor Pocket setup command on your Mac.',
    }),
  ]);
  gateView({
    mark: 'warn',
    title: 'Pairing unavailable',
    content: card,
  });
}

function bootstrap() {
  bootstrapCoordinator ||= createBootstrapCoordinator({
    timeoutMs: BOOTSTRAP_REQUEST_MS,
    load: ({ signal, timeoutMs }) =>
      request('/api/auth/bootstrap', { signal, timeoutMs }),
    onStart: bootView,
    onSuccess: async (auth) => {
      state.auth = auth;
      state.csrfToken = auth.csrfToken;
      recordConnectionReached();
      if (auth.unlocked) await startApplication();
      else renderLock();
    },
    onFailure: async (error) => {
      if (error.status === 401 || error.code === 'device_revoked') {
        await purgeThenRenderSignedOut();
      } else {
        state.connectionError = error;
        renderConnectionGate(error.code);
      }
    },
  });
  return bootstrapCoordinator.run();
}

function renderLock({ errorMessage = '' } = {}) {
  stopEvents();
  state.shell = null;
  resetSessionMessageState();
  state.optimistic = [];
  state.seenMessageIds.clear();
  const action = node('button', {
    className: 'primary-button',
    type: 'button',
    text: 'Unlock with Face ID',
    on: {
      click: async (event) => {
        const control = event.currentTarget;
        control.disabled = true;
        control.textContent = 'Waiting for Face ID…';
        try {
          await runWithAppUpdatePaused(async () => {
            const options = await request('/api/auth/options', {
              method: 'POST',
              body: {},
              csrf: true,
            });
            const credential = await navigator.credentials.get({
              publicKey: authenticationOptions(options),
            });
            let verificationError = null;
            try {
              await request('/api/auth/verify', {
                method: 'POST',
                body: { response: authenticationResponse(credential) },
                csrf: true,
              });
            } catch (error) {
              verificationError = error;
            }
            let auth;
            try {
              auth = await request('/api/auth/bootstrap');
            } catch (error) {
              throw verificationError || error;
            }
            state.auth = { ...state.auth, ...auth };
            state.csrfToken = auth.csrfToken;
            if (!auth.unlocked) {
              renderLock({
                errorMessage:
                  verificationError || auth.sessionRotationRequired
                  ? 'Face ID did not finish syncing. Use it once more.'
                  : '',
              });
              return;
            }
            await startApplication();
          });
        } catch (error) {
          if (
            error.code === 'device_session_expired' ||
            error.code === 'device_revoked' ||
            error.code === 'authentication_required'
          ) {
            await purgeThenRenderSignedOut();
            return;
          }
          if (
            error.code === 'tailscale_identity_required' ||
            error.code === 'tailscale_identity_denied' ||
            error.code === 'tailscale_identity_unpaired' ||
            error.code === 'device_identity_mismatch'
          ) {
            renderConnectionGate(error.code);
            return;
          }
          renderLock({
            errorMessage:
              error.name === 'NotAllowedError'
                ? 'Face ID was canceled. Try again.'
                : 'Face ID could not unlock this remote. Try again.',
          });
        }
      },
    },
  });
  const content = errorMessage
    ? node('p', { className: 'inline-error', text: errorMessage })
    : null;
  gateView({
    mark: 'bolt',
    title: 'Locked',
    body: 'Your Conductor chats stay hidden until you verify.',
    content,
    action,
  });
}

function renderSignedOut() {
  stopEvents();
  clearAttachmentState();
  state.auth = null;
  state.csrfToken = null;
  state.workspaces = [];
  state.recentSessions = [];
  state.recentSessionsLoad = 'idle';
  state.recentSessionsError = null;
  state.recentSessionsRequestGeneration += 1;
  state.workspaceRequestGeneration += 1;
  state.unreadMetadataEpoch += 1;
  state.sessionsByWorkspace.clear();
  state.unreadHeads.clear();
  state.unreadHeadsLoaded = false;
  state.readReceipts.clear();
  resetSessionMessageState();
  state.optimistic = [];
  state.seenMessageIds.clear();
  gateView({
    mark: 'lock',
    title: 'This device was signed out',
    body:
      'Its access was revoked or expired. Pair again with a fresh link from your Mac.',
    content: node('p', {
      className: 'machine-fact',
      text: 'npm run pair',
    }),
  });
}

function isLocalPurgeFailure(error) {
  return /transcript_cache_delete|service_worker_retirement|other_pocket_window|origin_retired|cache/i.test(
    error?.message || '',
  );
}

function renderLocalPurgeFailure(retry) {
  stopEvents();
  gateView({
    mark: 'warn',
    title: 'Local data was not erased',
    body:
      'Close every other Pocket window on this phone, then retry. This device stays enrolled until the cleanup finishes.',
    action: node('button', {
      className: 'primary-button',
      type: 'button',
      text: 'Retry cleanup',
      on: { click: retry },
    }),
  });
}

async function purgeThenRenderSignedOut() {
  try {
    await purgeLocalData();
    renderSignedOut();
  } catch {
    renderLocalPurgeFailure(() => purgeThenRenderSignedOut());
  }
}

// A cold launch forgets state.lastHeartbeat, and a cold launch is exactly when
// "when did this last work" is the useful fact, so reachability is persisted.
// Written at most once a minute because live() fires on every 5s heartbeat.
function recordConnectionReached(now = Date.now()) {
  state.connectionError = null;
  try {
    const previous = Number(localStorage.getItem(CONNECTION_REACHED_KEY));
    if (Number.isFinite(previous) && now - previous < 60_000) return;
    localStorage.setItem(CONNECTION_REACHED_KEY, String(now));
  } catch {
    // A blocked or full store costs only the "last reached" sentence.
  }
}

function lastConnectionReachedAt() {
  try {
    const stored = Number(localStorage.getItem(CONNECTION_REACHED_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // Fall through to whatever this session has seen.
  }
  return state.lastHeartbeat || null;
}

function connectionDiagnosis(error = state.connectionError) {
  return diagnoseConnection({
    error,
    online: navigator.onLine !== false,
    lastReachedAt: lastConnectionReachedAt(),
  });
}

function renderConnectionGate(code) {
  const upgradeRequired = code === 'retirement_client_upgrade_required';
  const identityProblem =
    code === 'tailscale_identity_required' ||
    code === 'tailscale_identity_denied' ||
    code === 'tailscale_identity_unpaired' ||
    code === 'device_identity_mismatch';
  // The failure that produced this code, when it is the same failure. A stale
  // error from an earlier problem must not narrate the current one, so the two
  // have to agree on the code before the richer object is trusted.
  const failure =
    state.connectionError &&
    (state.connectionError.code || null) === (code || null)
      ? state.connectionError
      : code;
  const verdict = connectionDiagnosis(failure);
  gateView({
    connectionAnchor: !upgradeRequired && !identityProblem,
    mark: upgradeRequired ? 'refresh' : 'wifiOff',
    title: verdict.title,
    body: verdict.body,
    action: node('button', {
      className: 'primary-button',
      type: 'button',
      text: verdict.retryLabel,
      on: {
        click: () => {
          if (upgradeRequired) location.reload();
          else bootstrap();
        },
      },
    }),
  });
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function renderInstallGuidance({ firstRun = false } = {}) {
  const steps = node('ol', { className: 'install-steps' });
  const values = [
    ['Tap the Share button in Safari', 'share'],
    ['Choose “Add to Home Screen”', 'plus'],
    ['Open Conductor Pocket from your Home Screen', 'bolt'],
  ];
  values.forEach(([copy, iconName], index) => {
    steps.append(
      node('li', { className: 'install-step' }, [
        node('span', { className: 'install-number', text: String(index + 1) }),
        node('span', { text: copy }),
        icon(iconName),
      ]),
    );
  });
  gateView({
    title: 'Install Conductor Pocket',
    body: 'Run it full-screen, off the Home Screen, like an app.',
    content: steps,
    action: node('button', {
      className: 'primary-button',
      type: 'button',
      text: firstRun ? 'Continue in Safari' : 'Done',
      on: { click: () => startApplication() },
    }),
  });
}

function loadRoute() {
  try {
    const current = JSON.parse(localStorage.getItem(ROUTE_KEY));
    if (
      current &&
      ['recent', 'workspaces', 'sessions', 'transcript'].includes(current.view)
    ) {
      return current;
    }
    const parsed = JSON.parse(localStorage.getItem(LEGACY_ROUTE_KEY));
    if (
      parsed &&
      ['recent', 'workspaces', 'sessions', 'transcript'].includes(parsed.view)
    ) {
      if (parsed.view === 'workspaces') {
        return { view: 'recent', workspaceId: null, sessionId: null };
      }
      return parsed;
    }
  } catch {
    // Ignore malformed local state.
  }
  return { view: 'recent', workspaceId: null, sessionId: null };
}

function persistRoute() {
  localStorage.setItem(ROUTE_KEY, JSON.stringify(state.route));
}

function loadDrafts() {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || {};
  } catch {
    return {};
  }
}

function stableDraftRevision(sessionId, text) {
  let hash = 2166136261;
  for (const character of `${sessionId}\u0000${text}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(36)}-${text.length}`;
}

function normalizeDraftRecord(sessionId, value) {
  if (typeof value === 'string') {
    const text = value.slice(0, 16 * 1024);
    return { text, revision: stableDraftRevision(sessionId, text) };
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof value.text === 'string' &&
    validPersistedKey(value.revision)
  ) {
    return {
      text: value.text.slice(0, 16 * 1024),
      revision: value.revision,
    };
  }
  return { text: '', revision: stableDraftRevision(sessionId, '') };
}

function draftRecordFor(sessionId) {
  if (!sessionId) return { text: '', revision: '' };
  return normalizeDraftRecord(sessionId, loadDrafts()[sessionId]);
}

function draftFor(sessionId) {
  return draftRecordFor(sessionId).text;
}

function saveDraft(sessionId, value, { expectedRevision = null } = {}) {
  if (!sessionId) return null;
  try {
    const drafts = loadDrafts();
    if (
      expectedRevision !== null &&
      normalizeDraftRecord(sessionId, drafts[sessionId]).revision !== expectedRevision
    ) {
      return null;
    }
    const record = {
      text: String(value || '').slice(0, 16 * 1024),
      revision: randomIdempotencyKey(),
    };
    drafts[sessionId] = record;
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    return record;
  } catch {
    return null;
  }
}

window.addEventListener('storage', (event) => {
  if (event.key !== DRAFTS_KEY) return;
  const sessionId = state.route.sessionId;
  const field = state.shell?.composer.field;
  if (!sessionId || !field) return;
  let previous = {};
  try {
    previous = JSON.parse(event.oldValue) || {};
  } catch {
    previous = {};
  }
  const previousRecord = normalizeDraftRecord(
    sessionId,
    previous[sessionId],
  );
  if (
    field.dataset.draftRevision !== previousRecord.revision ||
    field.value !== previousRecord.text
  ) {
    return;
  }
  const currentRecord = draftRecordFor(sessionId);
  field.value = currentRecord.text;
  field.dataset.draftRevision = currentRecord.revision;
  state.shell.composer.resize();
  renderComposerState();
});

function safeAttachmentId(value) {
  return (
    typeof value === 'string' &&
    value.length >= 6 &&
    value.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function normalizeAttachmentMetadata(value) {
  const source =
    typeof value === 'string'
      ? { id: value }
      : value && typeof value === 'object'
        ? value
        : null;
  if (!source || !safeAttachmentId(source.id)) return null;
  const attachment = { id: source.id };
  const mediaType = String(source.mediaType || source.mimeType || '').toLowerCase();
  if (['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(mediaType)) {
    attachment.mediaType = mediaType;
  }
  if (Number.isSafeInteger(source.width) && source.width > 0 && source.width <= 20_000) {
    attachment.width = source.width;
  }
  if (Number.isSafeInteger(source.height) && source.height > 0 && source.height <= 20_000) {
    attachment.height = source.height;
  }
  return attachment;
}

function loadAttachmentDrafts() {
  const result = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(ATTACHMENT_DRAFTS_KEY));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
    for (const [sessionId, values] of Object.entries(saved)) {
      if (
        !sessionId ||
        sessionId.length > 200 ||
        !Array.isArray(values)
      ) {
        continue;
      }
      const attachments = values
        .slice(0, MAX_ATTACHMENTS_PER_MESSAGE * 2)
        .map(normalizeAttachmentMetadata)
        .filter(Boolean)
        .map((attachment) => ({
          ...attachment,
          localId: `restored:${attachment.id}`,
          state: 'ready',
          restored: true,
        }));
      if (attachments.length > 0) result.set(sessionId, attachments);
    }
  } catch {
    // Invalid or unavailable local storage means there are no restorable photos.
  }
  return result;
}

function persistAttachmentDrafts({
  sessionId: overrideSessionId = null,
  items: overrideItems = null,
} = {}) {
  try {
    const saved = {};
    const attachmentDrafts = new Map(state.attachmentsBySession);
    if (overrideSessionId) {
      attachmentDrafts.set(
        overrideSessionId,
        Array.isArray(overrideItems) ? overrideItems : [],
      );
    }
    for (const [sessionId, values] of attachmentDrafts) {
      const ready = values
        .filter(
          (item) => item.state === 'ready' || item.restored === true,
        )
        .map(normalizeAttachmentMetadata)
        .filter(Boolean);
      if (ready.length > 0) saved[sessionId] = ready;
    }
    localStorage.setItem(ATTACHMENT_DRAFTS_KEY, JSON.stringify(saved));
    broadcastSharedStateInvalidation('attachment-drafts-invalidated');
    return true;
  } catch {
    return false;
  }
}

function attachmentsFor(sessionId) {
  return sessionId
    ? state.attachmentsBySession.get(sessionId) || []
    : [];
}

function unsafeAttachmentOperationCount() {
  let count = 0;
  for (const items of state.attachmentsBySession.values()) {
    count += items.filter(
      (item) => item.state !== 'ready' || item.uploadInFlight,
    ).length;
  }
  return count;
}

function attachmentPreviewUrl(
  sessionId,
  attachmentId,
  { thumbnail = false } = {},
) {
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`;
  return thumbnail ? `${base}?variant=thumbnail` : base;
}

function releaseAttachmentPreview(item) {
  if (!item?.previewUrl) return;
  URL.revokeObjectURL(item.previewUrl);
  item.previewUrl = null;
}

function releaseAttachmentResources(item) {
  if (!item) return;
  item.controller?.abort();
  item.controller = null;
  item.file = null;
  item.preparedBlob = null;
  item.preparePromise = null;
  item.uploadPromise = null;
  item.uploadInFlight = false;
}

function releaseAllAttachmentPreviews() {
  for (const items of state.attachmentsBySession.values()) {
    for (const item of items) {
      item.removed = true;
      releaseAttachmentResources(item);
      releaseAttachmentPreview(item);
    }
  }
  for (const message of state.optimistic) {
    for (const attachment of message.attachments || []) {
      releaseAttachmentPreview(attachment);
    }
  }
}

function clearAttachmentState() {
  releaseAllAttachmentPreviews();
  state.attachmentsBySession.clear();
  state.attachmentSendIntents.clear();
}

function attachmentStateChanged(sessionId, { persist = true } = {}) {
  if (persist) persistAttachmentDrafts();
  if (state.route.sessionId === sessionId) {
    renderComposerAttachments();
    renderComposerState();
  }
  appUpdateCoordinator?.stateChanged();
}

function pumpImageUploads() {
  while (
    activeImageUploads < MAX_CONCURRENT_IMAGE_UPLOADS &&
    pendingImageUploads.length > 0
  ) {
    const next = pendingImageUploads.shift();
    activeImageUploads += 1;
    Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .finally(() => {
        activeImageUploads -= 1;
        pumpImageUploads();
      });
  }
}

function enqueueImageUpload(task) {
  return new Promise((resolve, reject) => {
    pendingImageUploads.push({ task, resolve, reject });
    pumpImageUploads();
  });
}

function prepareAttachmentItem(item) {
  if (item.preparedBlob) {
    return Promise.resolve({ blob: item.preparedBlob });
  }
  if (item.preparePromise) return item.preparePromise;
  const preparation = imagePreparationQueue.then(
    () => prepareImageForUpload(item.file),
    () => prepareImageForUpload(item.file),
  );
  imagePreparationQueue = preparation.then(
    () => undefined,
    () => undefined,
  );
  const tracked = preparation
    .then((prepared) => {
      if (!item.removed) {
        item.preparedBlob = prepared.blob;
        if (prepared.blob !== item.file) {
          releaseAttachmentPreview(item);
          item.previewUrl = URL.createObjectURL(prepared.blob);
        }
      }
      return prepared;
    })
    .finally(() => {
      if (item.preparePromise === tracked) item.preparePromise = null;
    });
  item.preparePromise = tracked;
  return tracked;
}

async function uploadAttachmentItem(sessionId, item) {
  if (item.removed) return false;
  item.errorCode = null;
  item.state = 'preparing';
  attachmentStateChanged(sessionId, { persist: false });
  let uploadTimeout = null;
  let uploadTimedOut = false;
  try {
    const prepared = await prepareAttachmentItem(item);
    if (item.removed) return false;
    item.state = 'uploading';
    item.controller = new AbortController();
    uploadTimeout = setTimeout(() => {
      uploadTimedOut = true;
      item.controller?.abort();
    }, IMAGE_UPLOAD_TIMEOUT_MS);
    attachmentStateChanged(sessionId, { persist: false });
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/attachments`,
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: item.controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type':
            prepared.blob.type || imageMediaType(item.file) || 'application/octet-stream',
          'X-CSRF-Token': state.csrfToken,
          'Idempotency-Key': item.uploadKey,
        },
        body: prepared.blob,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.code || `http_${response.status}`);
      error.code = payload.error?.code || `http_${response.status}`;
      error.status = response.status;
      throw error;
    }
    const uploaded = normalizeAttachmentMetadata(payload.attachment);
    if (!uploaded) {
      const error = new Error('attachment_unavailable');
      error.code = 'attachment_unavailable';
      throw error;
    }
    if (item.removed) {
      void deleteUploadedAttachment(sessionId, uploaded.id);
      return false;
    }
    Object.assign(item, uploaded, {
      state: 'ready',
      restored: false,
      controller: null,
    });
    releaseAttachmentPreview(item);
    item.file = null;
    item.preparedBlob = null;
    item.preparePromise = null;
    attachmentStateChanged(sessionId);
    return true;
  } catch (error) {
    item.controller = null;
    if (item.removed) return false;
    if (error?.name === 'AbortError') {
      if (!uploadTimedOut) return false;
      error.code = 'image_upload_timeout';
    }
    item.state = 'failed';
    item.errorCode =
      error.code ||
      (error instanceof TypeError
        ? 'image_upload_failed'
        : error.message) ||
      'image_upload_failed';
    attachmentStateChanged(sessionId, { persist: false });
    if (error.status === 401 || error.status === 423) handleRuntimeError(error);
    return false;
  } finally {
    if (uploadTimeout) clearTimeout(uploadTimeout);
  }
}

function startAttachmentUpload(sessionId, item) {
  if (item.removed || item.uploadInFlight) {
    return item.uploadPromise || Promise.resolve(false);
  }
  item.uploadInFlight = true;
  item.state = 'queued';
  attachmentStateChanged(sessionId, { persist: false });
  const operation = enqueueImageUpload(() =>
    uploadAttachmentItem(sessionId, item),
  );
  const tracked = operation.finally(() => {
    item.uploadInFlight = false;
    if (item.uploadPromise === tracked) item.uploadPromise = null;
  });
  item.uploadPromise = tracked;
  return tracked;
}

function retryAttachmentUpload(sessionId, item) {
  if (item.state !== 'failed' || item.removed) return;
  if (!item.file) {
    announce('That photo expired. Remove it and choose it again.');
    return;
  }
  if (
    item.errorCode === 'attachment_unavailable' ||
    item.errorCode === 'idempotency_key_reused'
  ) {
    item.id = null;
    item.uploadKey = randomIdempotencyKey();
  }
  startAttachmentUpload(sessionId, item);
  announce('Retrying photo upload');
}

async function deleteUploadedAttachment(sessionId, attachmentId) {
  if (!safeAttachmentId(attachmentId)) return;
  try {
    await fetch(
      attachmentPreviewUrl(sessionId, attachmentId),
      {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': state.csrfToken,
        },
      },
    );
  } catch {
    // The server prunes abandoned staged uploads as a second line of cleanup.
  }
}

function removeAttachment(sessionId, item) {
  const sendWasQueued = state.attachmentSendIntents.delete(sessionId);
  const current = attachmentsFor(sessionId);
  const next = current.filter((candidate) => candidate !== item);
  const uploadedId =
    item.state === 'ready' && safeAttachmentId(item.id)
      ? item.id
      : null;
  if (next.length > 0) state.attachmentsBySession.set(sessionId, next);
  else state.attachmentsBySession.delete(sessionId);
  item.removed = true;
  releaseAttachmentResources(item);
  releaseAttachmentPreview(item);
  if (uploadedId) {
    void deleteUploadedAttachment(sessionId, uploadedId);
  }
  attachmentStateChanged(sessionId);
  if (sendWasQueued) {
    announce('Automatic send canceled because the photos changed');
  }
}

function addSelectedImages(sessionId, fileList) {
  if (!sessionId || !fileList) return;
  const attachmentDeliveryInFlight = state.optimistic.some(
    (message) =>
      message.sessionId === sessionId &&
      ['delivering', 'confirming'].includes(message.delivery) &&
      Array.isArray(message.draftAttachmentItems) &&
      message.draftAttachmentItems.length > 0,
  );
  if (attachmentDeliveryInFlight) {
    announce('Wait for the current photo message to finish first');
    return;
  }
  const current = [...attachmentsFor(sessionId)];
  let available = Math.max(
    0,
    MAX_ATTACHMENTS_PER_MESSAGE - current.length,
  );
  let rejectedCode = null;
  let added = 0;
  for (const file of Array.from(fileList)) {
    if (available <= 0) {
      rejectedCode ||= 'attachment_limit_exceeded';
      break;
    }
    const selectionError = imageSelectionError(file);
    if (selectionError) {
      rejectedCode ||= selectionError;
      continue;
    }
    const item = {
      localId: `local:${randomIdempotencyKey()}`,
      uploadKey: randomIdempotencyKey(),
      file,
      previewUrl: URL.createObjectURL(file),
      state: 'queued',
      errorCode: null,
      removed: false,
    };
    current.push(item);
    added += 1;
    available -= 1;
  }
  if (current.length > 0) state.attachmentsBySession.set(sessionId, current);
  if (added > 0) {
    attachmentStateChanged(sessionId, { persist: false });
    for (const item of current.slice(-added)) {
      startAttachmentUpload(sessionId, item);
    }
    announce(
      added === 1
        ? 'Photo added and uploading'
        : `${added} photos added and uploading`,
    );
  }
  if (rejectedCode) announce(imageErrorCopy(rejectedCode));
}

function composerAttachmentStatus(item) {
  if (item.state === 'failed') return imageErrorCopy(item.errorCode);
  if (item.state === 'ready') return 'Ready';
  if (item.state === 'preparing') return 'Preparing';
  return 'Uploading';
}

function attachmentCanRetry(item) {
  return (
    Boolean(item?.file) &&
    (imageErrorIsRetryable(item.errorCode) ||
      item.errorCode === 'attachment_unavailable' ||
      item.errorCode === 'idempotency_key_reused')
  );
}

function renderComposerAttachments() {
  const composer = state.shell?.composer;
  if (!composer) return;
  const sessionId = state.route.sessionId;
  const attachments = attachmentsFor(sessionId);
  composer.tray.replaceChildren();
  composer.tray.hidden = attachments.length === 0;
  for (const item of attachments) {
    const source =
      item.previewUrl ||
      (safeAttachmentId(item.id)
        ? attachmentPreviewUrl(sessionId, item.id, {
            thumbnail: true,
          })
        : null);
    const preview = source
      ? node('img', {
          className: 'composer-attachment-image',
          src: source,
          alt: '',
          decoding: 'async',
        })
      : icon('photo');
    const status = node('span', {
      className: 'composer-attachment-status',
      text: composerAttachmentStatus(item),
    });
    const tile = node('div', {
      className: `composer-attachment is-${item.state}`,
    }, [
      preview,
      status,
      item.state === 'failed' && attachmentCanRetry(item)
        ? node('button', {
            className: 'composer-attachment-retry',
            type: 'button',
            'aria-label': `Retry photo. ${composerAttachmentStatus(item)}`,
            on: {
              click: () => retryAttachmentUpload(sessionId, item),
            },
          }, [icon('refresh')])
        : null,
      node('button', {
        className: 'composer-attachment-remove',
        type: 'button',
        'aria-label': 'Remove photo',
        on: {
          click: () => removeAttachment(sessionId, item),
        },
      }, [icon('close')]),
    ]);
    composer.tray.append(tile);
  }
}

let cacheDatabasePromise;
// Retirement is a property of THIS page's lifetime, not of the origin forever.
// It used to be persisted, and every ordinary sign-out persisted it: a revoked
// or expired session ran purgeLocalData(), the flag stuck in localStorage, and
// from then on cacheDatabase() rejected every read and write with
// origin_retired. The phone showed "Secure delivery storage is unavailable on
// this phone" on every send, forever, and no relay reinstall could clear it
// because the flag lived on the phone. Clear any flag left by that bug.
let originRetired = false;
try {
  localStorage.removeItem(ORIGIN_RETIRED_KEY);
} catch {
  // No storage here means there is no stale flag to clear.
}
const cachePurgeChannel =
  'BroadcastChannel' in window
    ? new BroadcastChannel(CACHE_PURGE_CHANNEL)
    : null;
const readReceiptChannel =
  'BroadcastChannel' in window
    ? new BroadcastChannel(READ_RECEIPTS_CHANNEL)
    : null;
const sharedStateChannel =
  'BroadcastChannel' in window
    ? new BroadcastChannel(SHARED_STATE_CHANNEL)
    : null;
let getServiceWorkerRegistration = null;
let appUpdateCoordinator = null;
let appUpdateSensitiveOperations = 0;

function broadcastSharedStateInvalidation(type) {
  sharedStateChannel?.postMessage({ type });
}

function syncAttachmentDraftsFromAuthority(
  authoritativeDrafts = loadAttachmentDrafts(),
) {
  const mergedDrafts = new Map();
  const sessionIds = new Set([
    ...state.attachmentsBySession.keys(),
    ...authoritativeDrafts.keys(),
  ]);
  for (const sessionId of sessionIds) {
    const current = state.attachmentsBySession.get(sessionId) || [];
    const authoritative = authoritativeDrafts.get(sessionId) || [];
    const authoritativeById = new Map(
      authoritative.map((item) => [item.id, item]),
    );
    const consumed = new Set();
    const merged = [];
    for (const item of current) {
      if (item.state !== 'ready' && item.restored !== true) {
        merged.push(item);
        continue;
      }
      const saved = authoritativeById.get(item.id);
      if (!saved || consumed.has(item.id)) continue;
      Object.assign(item, saved);
      merged.push(item);
      consumed.add(item.id);
    }
    for (const item of authoritative) {
      if (consumed.has(item.id)) continue;
      merged.push(item);
      consumed.add(item.id);
    }
    if (merged.length > 0) mergedDrafts.set(sessionId, merged);
  }
  state.attachmentsBySession = mergedDrafts;
  if (state.shell) {
    renderComposerAttachments();
    renderComposerState();
  }
}

async function runWithAppUpdatePaused(operation) {
  appUpdateSensitiveOperations += 1;
  try {
    return await operation();
  } finally {
    appUpdateSensitiveOperations = Math.max(
      0,
      appUpdateSensitiveOperations - 1,
    );
    appUpdateCoordinator?.stateChanged();
  }
}

function cacheDatabase() {
  if (originRetired) {
    return Promise.reject(new Error('origin_retired'));
  }
  if (!cacheDatabasePromise) {
    cacheDatabasePromise = new Promise((resolve, reject) => {
      const open = indexedDB.open('conductor-pocket-v1', 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('snapshots')) {
          open.result.createObjectStore('snapshots');
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  return cacheDatabasePromise;
}

async function closeCacheDatabase() {
  try {
    const database = await cacheDatabasePromise;
    database?.close();
  } catch {
    // A failed cache open has nothing to close.
  }
  cacheDatabasePromise = null;
}

cachePurgeChannel?.addEventListener('message', (event) => {
  if (event.data?.type === 'retire-origin') {
    originRetired = true;
    appUpdateCoordinator?.stop();
    stopEvents();
    void closeCacheDatabase();
  } else if (event.data?.type === 'close-transcript-database') {
    void closeCacheDatabase();
  }
});

async function cacheGet(key) {
  try {
    const database = await cacheDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('snapshots', 'readonly');
      const requestValue = transaction.objectStore('snapshots').get(key);
      requestValue.onsuccess = () => resolve(requestValue.result);
      requestValue.onerror = () => reject(requestValue.error);
    });
  } catch {
    return null;
  }
}

async function cacheGetRequired(key) {
  const database = await cacheDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('snapshots', 'readonly');
    const requestValue = transaction.objectStore('snapshots').get(key);
    requestValue.onsuccess = () => resolve(requestValue.result);
    requestValue.onerror = () =>
      reject(requestValue.error || new Error('cache_read_failed'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('cache_read_aborted'));
  });
}

async function cacheSet(key, value) {
  try {
    const database = await cacheDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').put(value, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Cache failures never block the live path.
  }
}

async function mergeReadReceiptRequired(receipt) {
  const database = await cacheDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const currentRequest = store.get(READ_RECEIPTS_KEY);
    let snapshot = null;
    currentRequest.onsuccess = () => {
      const current = normalizeReadReceipts(currentRequest.result);
      snapshot = readReceiptSnapshot(
        normalizeReadReceipts([...current.values(), receipt]),
      );
      store.put(snapshot, READ_RECEIPTS_KEY);
    };
    currentRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(snapshot || []);
    transaction.onerror = () =>
      reject(transaction.error || new Error('cache_write_failed'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('cache_write_aborted'));
  });
}

async function restoreReadReceipts() {
  state.readReceipts = normalizeReadReceipts(
    await cacheGet(READ_RECEIPTS_KEY),
  );
}

function sessionUnreadHead(sessionId) {
  return state.unreadHeads.get(sessionId) || null;
}

function sessionUnreadCount(session) {
  return effectiveSessionUnreadCount({
    sessionId: session?.id,
    nativeUnreadCount: session?.unreadCount,
    unreadHeads: state.unreadHeads,
    readReceipts: state.readReceipts,
    headsLoaded: state.unreadHeadsLoaded && state.connection === 'live',
  });
}

function workspaceUnreadCount(workspace) {
  return effectiveWorkspaceUnreadCount({
    workspaceId: workspace?.id,
    nativeUnreadCount: workspace?.unreadCount,
    unreadHeads: state.unreadHeads,
    readReceipts: state.readReceipts,
    headsLoaded: state.unreadHeadsLoaded && state.connection === 'live',
  });
}

function readHeadStillCurrent(candidate) {
  const head = sessionUnreadHead(candidate.sessionId);
  return (
    state.unreadHeadsLoaded &&
    state.unreadMetadataEpoch === candidate.metadataEpoch &&
    head?.responseId === candidate.responseId &&
    head.unreadCount === candidate.unreadCount &&
    head.status === candidate.status
  );
}

function commitReadReceipt(candidate) {
  const {
    sessionId,
    responseId,
    unreadCount,
  } = candidate;
  const commitKey = `${sessionId}:${responseId}:${unreadCount}`;
  if (readReceiptCommits.has(commitKey)) return;
  readReceiptCommits.add(commitKey);
  const commit = async () => {
    if (!readHeadStillCurrent(candidate)) return;
    const snapshot = await mergeReadReceiptRequired({
      sessionId,
      responseId,
      unreadCount,
      readAt: Date.now(),
    });
    if (!readHeadStillCurrent(candidate)) return;
    state.readReceipts = normalizeReadReceipts(snapshot);
    readReceiptChannel?.postMessage({ type: 'read-receipts-updated' });
    renderWorkspacePanel();
    renderSessionsPanel();
    renderChatStrip();
    appUpdateCoordinator?.stateChanged();
  };
  const operation = readReceiptWriteQueue.then(commit, commit);
  readReceiptWriteQueue = operation.catch(() => {});
  void operation
    .catch(() => {
      readProgress = emptyReadProgress();
    })
    .finally(() => {
      readReceiptCommits.delete(commitKey);
    });
}

readReceiptChannel?.addEventListener('message', (event) => {
  if (event.data?.type !== 'read-receipts-updated') return;
  void cacheGet(READ_RECEIPTS_KEY).then((snapshot) => {
    state.readReceipts = normalizeReadReceipts(snapshot);
    renderWorkspacePanel();
    renderSessionsPanel();
    renderChatStrip();
    scheduleReadEvaluation();
  });
});

sharedStateChannel?.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'attachment-drafts-invalidated') {
    const attachmentDrafts = loadAttachmentDrafts();
    syncAttachmentDraftsFromAuthority(attachmentDrafts);
  } else if (type === 'pending-deliveries-invalidated') {
    void restorePendingDeliveries().then((restored) => {
      if (restored && state.shell) renderTranscript();
    });
  }
});

window.addEventListener('storage', (event) => {
  if (!sharedStateChannel && event.key === ATTACHMENT_DRAFTS_KEY) {
    syncAttachmentDraftsFromAuthority();
  }
});

function validPersistedKey(value) {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 100 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function sanitizePendingDelivery(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.kind !== 'optimistic' ||
    typeof value.id !== 'string' ||
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    value.sessionId.length > 200 ||
    typeof value.text !== 'string' ||
    value.text.length > 16 * 1024 ||
    !validPersistedKey(value.idempotencyKey)
  ) {
    return null;
  }
  const delivery = new Set([
    'delivering',
    'confirming',
    'delivered',
    'failed',
  ]).has(value.delivery)
    ? value.delivery
    : 'confirming';
  return {
    id: value.id,
    idempotencyKey: value.idempotencyKey,
    activeDeliveryKey: validPersistedKey(value.activeDeliveryKey)
      ? value.activeDeliveryKey
      : value.idempotencyKey,
    replaceIdempotencyKey: validPersistedKey(value.replaceIdempotencyKey)
      ? value.replaceIdempotencyKey
      : null,
    kind: 'optimistic',
    sessionId: value.sessionId,
    text: value.text,
    draftRevision:
      validPersistedKey(value.draftRevision) ? value.draftRevision : null,
    draftPayloadFingerprint:
      typeof value.draftPayloadFingerprint === 'string' &&
      value.draftPayloadFingerprint.length > 0 &&
      value.draftPayloadFingerprint.length <= 200
        ? value.draftPayloadFingerprint
        : null,
    attachments: Array.isArray(value.attachments)
      ? value.attachments
          .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
          .map(normalizeAttachmentMetadata)
          .filter(Boolean)
      : [],
    delivery,
    createdAt:
      typeof value.createdAt === 'string'
        ? value.createdAt
        : new Date().toISOString(),
    deliveredAt:
      typeof value.deliveredAt === 'string' ? value.deliveredAt : null,
    receiptBaselineCursor: Number.isSafeInteger(
      value.receiptBaselineCursor,
    )
      ? value.receiptBaselineCursor
      : null,
    receiptRowId: Number.isSafeInteger(value.receiptRowId)
      ? value.receiptRowId
      : null,
    receiptMessageId:
      typeof value.receiptMessageId === 'string' &&
      value.receiptMessageId.length > 0 &&
      value.receiptMessageId.length <= 200
        ? value.receiptMessageId
        : null,
    receiptObservedAt:
      Number.isFinite(value.receiptObservedAt) &&
      value.receiptObservedAt > 0
        ? value.receiptObservedAt
        : null,
    retrySafe: value.retrySafe === true,
    definitelyUnsent: value.definitelyUnsent === true,
    deliveryRecoveryExhausted:
      value.deliveryRecoveryExhausted === true,
    errorCode:
      typeof value.errorCode === 'string' ? value.errorCode : null,
    errorProjectName: safeCollapsedProjectName(value.errorProjectName),
    deliveryPhase: new Set([
      'queued',
      'automating',
      'confirming',
    ]).has(value.deliveryPhase)
      ? value.deliveryPhase
      : null,
    deliveryAttempt:
      Number.isSafeInteger(value.deliveryAttempt) &&
      value.deliveryAttempt > 0
        ? value.deliveryAttempt
        : 1,
    errorDetail:
      typeof value.errorDetail === 'string'
        ? value.errorDetail.slice(0, 300)
        : null,
    replaceDraft: value.replaceDraft === true,
    macDraft:
      typeof value.macDraft === 'string'
        ? value.macDraft.slice(0, 16 * 1024)
        : null,
    terminalActionClaim:
      value.terminalActionClaim?.action === 'edit' &&
      validPersistedKey(value.terminalActionClaim.token) &&
      Number.isFinite(value.terminalActionClaim.at)
        ? {
            action: 'edit',
            token: value.terminalActionClaim.token,
            at: value.terminalActionClaim.at,
          }
        : null,
  };
}

async function mutatePendingDeliveriesRequired({
  upserts = [],
  removeIds = [],
  deliveryKeyTransitions = [],
  deliveryStateTransitions = [],
}) {
  const database = await cacheDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const currentRequest = store.get(PENDING_DELIVERIES_KEY);
    let transition = null;
    currentRequest.onsuccess = () => {
      transition = pendingDeliverySnapshotTransition(
        currentRequest.result,
        {
          type: 'mutate',
          upserts,
          removeIds,
          deliveryKeyTransitions,
          deliveryStateTransitions,
        },
        { sanitize: sanitizePendingDelivery },
      );
      store.put(transition.snapshot, PENDING_DELIVERIES_KEY);
    };
    currentRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => {
      broadcastSharedStateInvalidation('pending-deliveries-invalidated');
      resolve(transition?.snapshot || null);
    };
    transaction.onerror = () =>
      reject(transaction.error || new Error('cache_write_failed'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('cache_write_aborted'));
  });
}

async function claimTerminalDeliveryActionRequired(
  message,
  action,
  payloadFingerprint = null,
) {
  if (!new Set(['retry', 'edit', 'delete']).has(action)) {
    throw new Error('delivery_action_invalid');
  }
  const database = await cacheDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const currentRequest = store.get(PENDING_DELIVERIES_KEY);
    let claimed = null;
    currentRequest.onsuccess = () => {
      const transition = pendingDeliverySnapshotTransition(
        currentRequest.result,
        {
          type: 'claim-terminal',
          action,
          claimToken: action === 'edit' ? randomIdempotencyKey() : null,
          payloadFingerprint,
          message,
        },
        { sanitize: sanitizePendingDelivery },
      );
      claimed = transition.value;
      store.put(transition.snapshot, PENDING_DELIVERIES_KEY);
    };
    currentRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => {
      broadcastSharedStateInvalidation('pending-deliveries-invalidated');
      resolve(claimed);
    };
    transaction.onerror = () =>
      reject(transaction.error || new Error('cache_write_failed'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('cache_write_aborted'));
  });
}

async function transitionPendingDeliveryRequired(command) {
  const database = await cacheDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const currentRequest = store.get(PENDING_DELIVERIES_KEY);
    let value = null;
    currentRequest.onsuccess = () => {
      const transition = pendingDeliverySnapshotTransition(
        currentRequest.result,
        command,
        { sanitize: sanitizePendingDelivery },
      );
      value = transition.value;
      store.put(transition.snapshot, PENDING_DELIVERIES_KEY);
    };
    currentRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => {
      broadcastSharedStateInvalidation('pending-deliveries-invalidated');
      resolve(value);
    };
    transaction.onerror = () =>
      reject(transaction.error || new Error('cache_write_failed'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('cache_write_aborted'));
  });
}

function finalizeTerminalDeliveryEditRequired(message, payloadFingerprint) {
  return transitionPendingDeliveryRequired({
    type: 'finalize-edit',
    claimToken: message.terminalActionClaim?.token,
    payloadFingerprint,
    message,
  });
}

function releaseTerminalDeliveryEditRequired(message) {
  return transitionPendingDeliveryRequired({
    type: 'release-edit',
    claimToken: message.terminalActionClaim?.token,
    message,
  });
}

async function pendingMessagePayloadFingerprint(message) {
  if (
    typeof message?.draftPayloadFingerprint === 'string' &&
    message.draftPayloadFingerprint.length > 0
  ) {
    return message.draftPayloadFingerprint;
  }
  try {
    return await draftSendPayloadFingerprint({
      text: message?.text || '',
      attachments: message?.attachments || [],
    });
  } catch {
    return null;
  }
}

function claimDraftSendRequired(
  message,
  draftRevision,
  payloadFingerprint,
) {
  return transitionPendingDeliveryRequired({
    type: 'claim-draft-send',
    sessionId: message.sessionId,
    draftRevision,
    payloadFingerprint,
    message,
  });
}

async function discardFailedMessage(message) {
  if (message?.kind !== 'optimistic' || message.delivery !== 'failed') return;
  cancelDeliveryRecovery(message);
  const result = await deliveryActionCoordinator.run(
    message.id,
    'delete',
    async () => {
      let claimed;
      try {
        claimed = await claimTerminalDeliveryActionRequired(
          message,
          'delete',
          await pendingMessagePayloadFingerprint(message),
        );
      } catch {
        announce('Could not safely delete this notice yet. Try again.');
        return false;
      }
      if (!claimed) {
        announce('This delivery changed in another Pocket window.');
        await restorePendingDeliveries();
        renderTranscript();
        return false;
      }
      for (const attachment of message.attachments || []) {
        releaseAttachmentPreview(attachment);
        if (safeAttachmentId(attachment.id)) {
          void deleteUploadedAttachment(message.sessionId, attachment.id);
        }
      }
      for (const item of message.draftAttachmentItems || []) {
        releaseAttachmentResources(item);
        releaseAttachmentPreview(item);
      }
      message.draftAttachmentItems = null;
      state.optimistic = state.optimistic.filter((item) => item !== message);
      renderTranscript();
      return true;
    },
  );
  return result.value;
}

async function stopCheckingDelivery(message) {
  if (message?.kind !== 'optimistic' || message.delivery !== 'confirming') {
    return false;
  }
  cancelDeliveryRecovery(message);
  const result = await deliveryActionCoordinator.run(
    message.id,
    'stop-check',
    async () => {
      let stopped;
      try {
        stopped = await transitionPendingDeliveryRequired({
          type: 'stop-check',
          message,
        });
      } catch {
        announce('Could not stop checking yet. Try again.');
        return false;
      }
      if (!stopped) {
        await restorePendingDeliveries();
        renderTranscript();
        announce('This delivery changed in another Pocket window.');
        return false;
      }
      applyAuthoritativePendingDelivery(message, stopped);
      renderTranscript();
      announce('Delivery checking stopped. You can check, edit, or delete it.');
      return true;
    },
  );
  return result.value;
}

async function verifyTerminalDeliveryAction(message) {
  let authoritative;
  try {
    authoritative = await readAuthoritativePendingDeliveryRequired(message);
  } catch {
    announce('Could not verify this delivery yet. Try again.');
    return null;
  }
  if (!authoritative) {
    state.optimistic = state.optimistic.filter(
      (candidate) => candidate !== message,
    );
    renderTranscript();
    announce('This delivery was already resolved in another Pocket window.');
    return null;
  }

  applyAuthoritativePendingDelivery(message, authoritative);

  if (message.delivery !== 'failed') {
    renderTranscript();
    announce('This delivery changed in another Pocket window.');
    return null;
  }
  try {
    const delivery = await requestDeliveryStatus(message);
    const disposition = terminalDeliveryActionDisposition(delivery);
    if (disposition === 'resolved') {
      await settleTerminalDeliveryStatus(message, delivery);
      return null;
    }
    if (disposition === 'actionable') {
      await settleTerminalDeliveryStatus(message, delivery);
      return message;
    }
    if (disposition === 'pending') {
      const previousDelivery = message.delivery;
      message.delivery = 'confirming';
      message.deliveryPhase = delivery.phase || 'queued';
      message.retrySafe = false;
      message.definitelyUnsent = false;
      await persistPendingDeliveries({
        upserts: [message],
        deliveryStateTransitions: authorizedDeliveryStateTransition(
          message,
          previousDelivery,
        ),
      });
      renderTranscript();
      void checkDelivery(message, { force: true }).catch(() => {});
      announce('This message is still sending on the Mac. Pocket will keep checking.');
      return null;
    }
    announce('Could not verify this delivery yet. Try again.');
    return null;
  } catch {
    announce('Could not verify this delivery yet. Try again.');
    return null;
  }
  return message;
}

async function readAuthoritativePendingDeliveryRequired(message) {
  const cached = await cacheGetRequired(PENDING_DELIVERIES_KEY);
  return pendingDeliveryMessages(cached, {
    sanitize: sanitizePendingDelivery,
  }).find((candidate) => candidate.id === message?.id) || null;
}

function samePendingDeliveryIdentity(left, right) {
  return (
    left?.id === right?.id &&
    left?.deliveryAttempt === right?.deliveryAttempt &&
    left?.activeDeliveryKey === right?.activeDeliveryKey
  );
}

function authorizedDeliveryStateTransition(message, from) {
  if (!message || from === message.delivery) return [];
  return [{
    id: message.id,
    deliveryAttempt: message.deliveryAttempt,
    activeDeliveryKey: message.activeDeliveryKey,
    from,
    to: message.delivery,
  }];
}

function applyAuthoritativePendingDelivery(message, authoritative) {
  const draftAttachmentItems = message.draftAttachmentItems;
  const previewUrls = new Map(
    (message.attachments || []).map((attachment) => [
      attachment.id,
      attachment.previewUrl,
    ]),
  );
  Object.assign(message, authoritative);
  if (draftAttachmentItems) message.draftAttachmentItems = draftAttachmentItems;
  message.attachments = (message.attachments || []).map((attachment) => ({
    ...attachment,
    previewUrl: previewUrls.get(attachment.id) || null,
  }));
}

async function recoverClaimedFailedMessage(message) {
  const sessionId = message.sessionId;
  const restoredItems = restoredAttachmentItems(
    message,
    message.errorCode,
  );
  const currentItems = attachmentsFor(sessionId);
  const mergedItems = mergeRecoveredAttachmentItems(
    restoredItems,
    currentItems,
  );
  const existingDraft = draftFor(sessionId);
  const recoveredText = message.text || '';
  const combinedDraft = mergeRecoveredDraftText(
    recoveredText,
    existingDraft,
  );
  const payloadFingerprint = await pendingMessagePayloadFingerprint(message);
  const recovery = await persistRecoveredDraftBeforeFinalizing({
    persistDraft: () => {
      const savedDraft = saveDraft(sessionId, combinedDraft);
      if (!savedDraft) return false;
      if (state.route.sessionId === sessionId && state.shell?.composer.field) {
        state.shell.composer.field.value = combinedDraft;
        state.shell.composer.field.dataset.draftRevision =
          savedDraft.revision;
        state.shell.composer.resize();
      }
      const attachmentsPersisted = persistAttachmentDrafts({
        sessionId,
        items: mergedItems,
      });
      if (!attachmentsPersisted) return false;
      if (mergedItems.length > 0) {
        state.attachmentsBySession.set(sessionId, mergedItems);
      } else {
        state.attachmentsBySession.delete(sessionId);
      }
      message.draftAttachmentItems = null;
      renderComposerAttachments();
      renderComposerState();
      return true;
    },
    finalize: () =>
      finalizeTerminalDeliveryEditRequired(message, payloadFingerprint),
    release: () => releaseTerminalDeliveryEditRequired(message),
  });
  if (recovery.status !== 'recovered') {
    if (recovery.status !== 'release-failed') {
      await restorePendingDeliveries();
    }
    renderTranscript();
    announce(
      recovery.status === 'draft-failed'
        ? 'Could not save the recovered text and photos. The failed message is still here.'
        : recovery.status === 'release-failed'
          ? 'The failed message is still here, but its secure edit lock could not be released. Reload Pocket and try Edit again.'
          : 'The recovered draft is saved, but the failed message could not be cleared. Try Edit again.',
    );
    return false;
  }
  state.optimistic = state.optimistic.filter((item) => item !== message);
  if (state.route.sessionId === sessionId && state.shell?.composer.field) {
    state.shell.composer.field.focus({ preventScroll: true });
  }
  renderTranscript();
  announce('Message moved back to the editor.');
  return true;
}

async function editFailedMessage(message) {
  // definitelyUnsent is deliberately NOT required. This returns the text to the
  // composer and sends nothing, so it is safe whatever happened to the original,
  // and requiring proof was what left an ambiguous failure with no way to
  // recover what was typed. Retry keeps its proof requirement, because it
  // resends.
  if (message?.kind !== 'optimistic' || message.delivery !== 'failed') return;
  cancelDeliveryRecovery(message);
  const result = await deliveryActionCoordinator.run(
    message.id,
    'edit',
    async () => {
      let claimed;
      try {
        claimed = await claimTerminalDeliveryActionRequired(message, 'edit');
      } catch {
        announce('Could not safely move this message yet. Try again.');
        return false;
      }
      if (!claimed) {
        announce('This delivery changed in another Pocket window.');
        await restorePendingDeliveries();
        renderTranscript();
        return false;
      }
      applyAuthoritativePendingDelivery(message, claimed);
      return recoverClaimedFailedMessage(message);
    },
  );
  return result.value;
}

async function persistPendingDeliveries({
  required = false,
  upserts = [],
  removeIds = [],
  deliveryKeyTransitions = [],
  deliveryStateTransitions = [],
} = {}) {
  try {
    return await mutatePendingDeliveriesRequired({
      upserts,
      removeIds,
      deliveryKeyTransitions,
      deliveryStateTransitions,
    });
  } catch (error) {
    if (required) throw error;
    return null;
  }
}

async function restorePendingDeliveries() {
  let cached;
  try {
    cached = await cacheGetRequired(PENDING_DELIVERIES_KEY);
  } catch {
    return false;
  }
  const authoritativeMessages = pendingDeliveryMessages(cached, {
    sanitize: sanitizePendingDelivery,
  });
  const currentById = new Map(
    state.optimistic.map((message) => [message.id, message]),
  );
  state.optimistic = authoritativeMessages.map((authoritative) => {
    const current = currentById.get(authoritative.id);
    if (!current) return authoritative;
    applyAuthoritativePendingDelivery(current, authoritative);
    return current;
  });
  return true;
}

async function clearTranscriptCache() {
  cachePurgeChannel?.postMessage({ type: 'close-transcript-database' });
  await closeCacheDatabase();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('transcript_cache_delete_blocked')),
      5_000,
    );
    const requestValue = indexedDB.deleteDatabase('conductor-pocket-v1');
    requestValue.onsuccess = () => {
      clearTimeout(timeout);
      resolve();
    };
    requestValue.onerror = () => {
      clearTimeout(timeout);
      reject(requestValue.error || new Error('transcript_cache_delete_failed'));
    };
    requestValue.onblocked = () => {
      // Another Pocket window receives the BroadcastChannel close request.
      // If it does not release the database, the timeout fails closed.
    };
  });
}

async function assertOnlyRetiringWindow() {
  if (!('serviceWorker' in navigator)) return;
  const registration = getServiceWorkerRegistration
    ? await getServiceWorkerRegistration()
    : await navigator.serviceWorker.ready;
  await registration.update();
  const candidate = registration.installing || registration.waiting;
  if (candidate && candidate.state !== 'activated') {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('service_worker_retirement_timeout')),
        4_000,
      );
      const onStateChange = () => {
        if (candidate.state === 'activated') {
          clearTimeout(timeout);
          candidate.removeEventListener('statechange', onStateChange);
          resolve();
        } else if (candidate.state === 'redundant') {
          clearTimeout(timeout);
          candidate.removeEventListener('statechange', onStateChange);
          reject(new Error('service_worker_retirement_unavailable'));
        }
      };
      candidate.addEventListener('statechange', onStateChange);
      onStateChange();
    });
  }
  const worker =
    registration.active || registration.waiting || registration.installing;
  if (!worker) throw new Error('service_worker_retirement_unavailable');
  const requestId = crypto.randomUUID
    ? crypto.randomUUID()
    : randomIdempotencyKey();
  const response = await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(
      () => reject(new Error('service_worker_retirement_timeout')),
      2_000,
    );
    channel.port1.onmessage = (event) => {
      if (
        event.data?.type === 'retirement-window-count' &&
        event.data?.requestId === requestId
      ) {
        clearTimeout(timeout);
        resolve(event.data);
      }
    };
    worker.postMessage(
      { type: 'retirement-window-count', requestId },
      [channel.port2],
    );
  });
  if (response.count !== 1) {
    throw new Error('other_pocket_window_open');
  }
}

async function purgeLocalData() {
  // In-memory only. This blocks writes for the rest of this page's life, which
  // is what a purge needs, without outliving the purge itself.
  originRetired = true;
  appUpdateCoordinator?.stop();
  cachePurgeChannel?.postMessage({ type: 'retire-origin' });
  await assertOnlyRetiringWindow();
  localStorage.removeItem(ROUTE_KEY);
  localStorage.removeItem(LEGACY_ROUTE_KEY);
  localStorage.removeItem('cp:drafts:v1');
  localStorage.removeItem(ATTACHMENT_DRAFTS_KEY);
  localStorage.removeItem(CHAT_CREATION_ATTEMPTS_KEY);
  localStorage.removeItem(LEGACY_CHAT_CREATION_ATTEMPT_KEY);
  localStorage.removeItem(CHAT_CREATION_LEASE_KEY);
  localStorage.removeItem(HIDDEN_AT_KEY);
  await clearTranscriptCache();
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(SHELL_CACHE_PREFIX))
        .map((name) => caches.delete(name)),
    );
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map(async (registration) => {
        const worker =
          registration.active || registration.waiting || registration.installing;
        if (!worker) return;
        const scriptUrl = new URL(worker.scriptURL);
        if (
          scriptUrl.origin === location.origin &&
          scriptUrl.pathname === '/service-worker.js'
        ) {
          await registration.unregister();
        }
      }),
    );
    const remaining = await navigator.serviceWorker.getRegistrations();
    if (
      remaining.some((registration) => {
        const worker =
          registration.active || registration.waiting || registration.installing;
        if (!worker) return false;
        const scriptUrl = new URL(worker.scriptURL);
        return (
          scriptUrl.origin === location.origin &&
          scriptUrl.pathname === '/service-worker.js'
        );
      })
    ) {
      throw new Error('service_worker_retirement_failed');
    }
  }
}

async function startApplication() {
  localStorage.removeItem(HIDDEN_AT_KEY);
  state.hiddenAt = null;
  state.workspaceRequestGeneration += 1;
  state.unreadMetadataEpoch += 1;
  state.unreadHeadsLoaded = false;
  cancelReadTracking();
  state.route = loadRoute();
  state.workspacesLoaded = false;
  await Promise.all([
    restorePendingDeliveries(),
    restoreReadReceipts(),
  ]);
  ensureShell();
  updateRoutePanels();
  const [cachedWorkspaces, cachedRecentSessions, cachedUnreadHeads] = await Promise.all([
    cacheGet('workspaces'),
    cacheGet('recent-sessions'),
    cacheGet('unread-session-heads'),
  ]);
  if (Array.isArray(cachedUnreadHeads)) {
    state.unreadHeads = normalizeUnreadHeads(cachedUnreadHeads);
    // Cached heads may paint context, but only a current network response can
    // authorize a persisted receipt to suppress an unread badge.
    state.unreadHeadsLoaded = false;
  }
  if (Array.isArray(cachedWorkspaces)) {
    state.workspaces = cachedWorkspaces;
    renderWorkspacePanel();
  }
  if (Array.isArray(cachedRecentSessions)) {
    state.recentSessions = cachedRecentSessions;
  }
  await Promise.all([
    refreshWorkspaces(),
    loadRecentSessions(),
  ]);
  await restoreRoute();
  startEvents();
  void recoverPendingDeliveries();
}

async function restoreRoute() {
  if (state.route.view === 'recent' || state.route.view === 'workspaces') {
    navigate(
      { view: state.route.view, workspaceId: null, sessionId: null },
      false,
    );
    return;
  }
  if (!state.route.workspaceId && state.route.sessionId) {
    const recent = state.recentSessions.find((session) => session.id === state.route.sessionId);
    state.route.workspaceId = recent?.workspaceId || null;
  }
  const workspace = state.workspaces.find((item) => item.id === state.route.workspaceId);
  if (!workspace) {
    navigate({ view: 'recent', workspaceId: null, sessionId: null }, false);
    return;
  }
  await loadSessions(workspace.id);
  if (state.route.view === 'transcript') {
    const session = sessionsFor(workspace.id).find(
      (item) => item.id === state.route.sessionId,
    );
    if (!session) {
      navigate({ view: 'sessions', workspaceId: workspace.id, sessionId: null }, false);
      return;
    }
    await openSession(session.id, { push: false });
  } else {
    renderSessionsPanel();
  }
}

function ensureShell() {
  if (state.shell && app.contains(state.shell.root)) return;
  const workspacePanel = node('aside', {
    className: 'panel workspace-panel',
    'aria-label': 'Recent chats and workspaces',
  });
  const sessionPanel = node('aside', {
    className: 'panel sessions-panel',
    'aria-label': 'Chats',
  });
  const transcriptPanel = node('main', {
    className: 'panel transcript-panel',
    'aria-label': 'Transcript',
  });
  const root = node('div', { className: 'app-shell' }, [
    workspacePanel,
    sessionPanel,
    transcriptPanel,
  ]);
  app.replaceChildren(root);

  const sessionNav = createPanelNav({
    backLabel: 'Recent',
    onBack: () => navigate({ view: 'recent', workspaceId: null, sessionId: null }),
    onSwitcher: openSwitcher,
  });
  const sessionContent = node('div', { className: 'panel-content' });
  sessionPanel.append(sessionNav.root, sessionContent);

  const transcriptNav = createPanelNav({
    backLabel: 'Recent',
    onBack: () => navigate({ view: 'recent', workspaceId: null, sessionId: null }),
    onSwitcher: openSwitcher,
    titleClick: openSwitcher,
    onChats: openChatsSheet,
    onUsage: openUsageSheet,
  });
  const transcriptBanner = node('div');
  const transcriptScroll = node('div', { className: 'transcript-scroll' });
  const transcriptColumn = node('div', { className: 'transcript-column' });
  const messageList = node('ol', {
    className: 'message-list',
    'aria-label': 'Conversation',
  });
  const statusRow = node('div');
  transcriptColumn.append(messageList, statusRow);
  transcriptScroll.append(transcriptColumn);
  const latestButton = node(
    'button',
    {
      className: 'latest-button',
      type: 'button',
      'aria-hidden': 'true',
      tabindex: '-1',
      on: {
        click: () => {
          noteReadGesture();
          transcriptScroll.scrollTo({ top: transcriptScroll.scrollHeight, behavior: 'smooth' });
          setLatestButtonVisible(latestButton, false);
        },
      },
    },
    [icon('chevronDown'), 'Latest'],
  );
  const composer = createComposer();
  // Switching chats was a sheet: open, scan, tap, dismiss. On a phone that is
  // four interactions to do the single most common thing. This strip puts every
  // chat one tap away without leaving the conversation, and scrolls
  // horizontally so a full tab bar costs no vertical room.
  const chatStrip = node('div', {
    className: 'chat-strip',
    'aria-label': 'Switch chat',
  });
  for (const eventName of ['touchstart', 'pointerdown', 'wheel']) {
    chatStrip.addEventListener(eventName, () => {
      chatStripMovedByHand = true;
    }, { passive: true });
  }
  transcriptPanel.append(
    transcriptNav.root,
    chatStrip,
    transcriptBanner,
    transcriptScroll,
    latestButton,
    composer.root,
  );
  transcriptScroll.addEventListener('scroll', () => {
    const distance =
      transcriptScroll.scrollHeight -
      transcriptScroll.clientHeight -
      transcriptScroll.scrollTop;
    setLatestButtonVisible(latestButton, distance >= 120);
    transcriptNav.root.classList.toggle('is-scrolled', transcriptScroll.scrollTop > 1);
    scheduleReadEvaluation();
  });
  for (const eventName of ['touchstart', 'pointerdown', 'wheel']) {
    transcriptScroll.addEventListener(eventName, noteReadGesture, {
      passive: true,
    });
  }
  transcriptScroll.addEventListener('keydown', (event) => {
    if (
      ['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']
        .includes(event.key)
    ) {
      noteReadGesture();
    }
  });
  const readObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => scheduleReadEvaluation())
    : null;
  readObserver?.observe(transcriptColumn);
  installRecentChatsSwipe(transcriptScroll);

  state.shell = {
    root,
    workspacePanel,
    sessionPanel,
    sessionContent,
    sessionNav,
    transcriptPanel,
    transcriptNav,
    chatStrip,
    transcriptBanner,
    transcriptScroll,
    transcriptColumn,
    messageList,
    statusRow,
    latestButton,
    composer,
    readObserver,
  };
  appUpdateCoordinator?.stateChanged();
  renderWorkspacePanel();
  renderSessionsPanel();
}

function cancelReadTracking() {
  if (readEvaluationTimer !== null) clearTimeout(readEvaluationTimer);
  readEvaluationTimer = null;
  readProgress = emptyReadProgress();
}

function setLatestButtonVisible(button, visible) {
  if (!button) return;
  button.classList.toggle('is-visible', visible);
  button.setAttribute('aria-hidden', visible ? 'false' : 'true');
  button.tabIndex = visible ? 0 : -1;
}

function invalidateUnreadHeadEvidence({ render = true } = {}) {
  state.unreadMetadataEpoch += 1;
  state.unreadHeadsLoaded = false;
  cancelReadTracking();
  if (render) {
    renderWorkspacePanel();
    renderSessionsPanel();
    renderChatStrip();
  }
}

function noteReadGesture() {
  readGestureSequence += 1;
  // A real touch, wheel or arrow key in the transcript, never a programmatic
  // scroll. Until this happens the view follows the newest message, so content
  // arriving after the first paint cannot strand the reader up the page.
  transcriptMovedByHand = true;
  scheduleReadEvaluation();
}

function scheduleReadEvaluation(delayMs = 0) {
  if (readEvaluationTimer !== null) clearTimeout(readEvaluationTimer);
  readEvaluationTimer = setTimeout(evaluateReadPosition, Math.max(0, delayMs));
}

function readCandidate() {
  if (
    document.hidden ||
    !document.hasFocus() ||
    state.connection !== 'live' ||
    !state.shell ||
    state.route.view !== 'transcript' ||
    !state.route.sessionId ||
    app.getAttribute('aria-hidden') === 'true' ||
    document.querySelector('#privacy-shield') ||
    overlayRoot.childElementCount > 0
  ) {
    return null;
  }
  const sessionId = state.route.sessionId;
  const session = currentSession();
  const head = sessionUnreadHead(sessionId);
  if (
    !session ||
    session.status === 'working' ||
    head?.status === 'working' ||
    head?.status !== session.status ||
    head?.unreadCount !== Number(session.unreadCount) ||
    sessionUnreadCount(session) === 0 ||
    !head?.responseId ||
    !state.messageBaselinesBySession.has(sessionId) ||
    state.messageLiveEpochBySession.get(sessionId) !== state.visibilityEpoch
  ) {
    return null;
  }
  const messages = [
    ...(state.messagesBySession.get(sessionId) || []),
    ...state.optimistic.filter((item) => item.sessionId === sessionId),
  ];
  const { entries } = buildFocusedTranscript(messages, {
    sessionStatus: session.status || 'unknown',
  });
  const range = readableResponseRange(entries, head.responseId);
  if (!range) return null;
  const elements = [...state.shell.messageList.children];
  const first = elements.find(
    (element) => element.dataset.messageId === range.firstMessageId,
  );
  const last = elements.find(
    (element) => element.dataset.messageId === range.lastMessageId,
  );
  if (!first || !last) return null;
  const viewport = state.shell.transcriptScroll.getBoundingClientRect();
  const firstRect = first.getBoundingClientRect();
  const lastRect = last.getBoundingClientRect();
  const viewportHeight = Math.max(0, viewport.bottom - viewport.top);
  const responseHeight = Math.max(0, lastRect.bottom - firstRect.top);
  if (viewportHeight <= 0 || responseHeight <= 0) return null;
  const tolerance = 1;
  const topVisible =
    firstRect.top >= viewport.top - tolerance &&
    firstRect.top <= viewport.bottom + tolerance;
  const bottomVisible =
    lastRect.bottom >= viewport.top - tolerance &&
    lastRect.bottom <= viewport.bottom + tolerance;
  const fullyVisible =
    firstRect.top >= viewport.top - tolerance &&
    lastRect.bottom <= viewport.bottom + tolerance;
  return {
    sessionId,
    responseId: head.responseId,
    unreadCount: head.unreadCount,
    status: head.status,
    metadataEpoch: state.unreadMetadataEpoch,
    sample: {
      eligible: true,
      key: `${head.responseId}:${Math.round(responseHeight)}`,
      gestureSequence: readGestureSequence,
      long: responseHeight > viewportHeight + tolerance,
      topVisible,
      bottomVisible,
      fullyVisible,
    },
  };
}

function evaluateReadPosition() {
  readEvaluationTimer = null;
  const candidate = readCandidate();
  if (!candidate) {
    readProgress = emptyReadProgress();
    return;
  }
  const result = advanceReadProgress(
    readProgress,
    candidate.sample,
    Date.now(),
  );
  readProgress = result.progress;
  if (result.acknowledge) {
    commitReadReceipt(candidate);
    return;
  }
  if (readProgress.bottomSince !== null) {
    const remaining = Math.max(
      0,
      READ_DWELL_MS - (Date.now() - readProgress.bottomSince),
    );
    scheduleReadEvaluation(remaining);
  }
}

function installRecentChatsSwipe(element) {
  let start = null;
  const reset = () => {
    start = null;
  };
  element.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      const blockedTarget =
        event.target instanceof Element
          ? event.target.closest(
              'a, button, input, textarea, select, summary, details, pre, code, table, [contenteditable="true"], [role="button"]',
            )
          : null;
      if (
        state.route.view !== 'transcript' ||
        overlayRoot.childElementCount > 0 ||
        event.touches.length !== 1 ||
        !touch ||
        touch.clientX < 24 ||
        blockedTarget
      ) {
        reset();
        return;
      }
      start = {
        x: touch.clientX,
        y: touch.clientY,
        at: event.timeStamp,
      };
    },
    { passive: true },
  );
  element.addEventListener(
    'touchend',
    (event) => {
      const touch = event.changedTouches[0];
      const candidate = start;
      reset();
      if (
        !candidate ||
        !touch ||
        window.getSelection()?.toString() ||
        !isRecentChatsSwipe({
          startX: candidate.x,
          startY: candidate.y,
          endX: touch.clientX,
          endY: touch.clientY,
          durationMs: event.timeStamp - candidate.at,
          viewportWidth: window.innerWidth,
        })
      ) {
        return;
      }
      void openSwitcher();
    },
    { passive: true },
  );
  element.addEventListener('touchcancel', reset, { passive: true });
}

function createPanelNav({ backLabel, onBack, onSwitcher, titleClick, onChats, onUsage }) {
  const back = button(backLabel, {
    iconName: 'back',
    className: 'icon-button nav-back',
    onClick: onBack,
  });
  const titleButton = node('button', {
    type: 'button',
    'aria-label': titleClick ? 'Open chat switcher' : undefined,
    on: titleClick ? { click: titleClick } : undefined,
  });
  const heading = node('span', { className: 'nav-heading' });
  const subtitle = node('span', { className: 'nav-subtitle' });
  titleButton.append(heading, subtitle);
  const title = node('div', { className: 'panel-nav-title' }, titleButton);
  const switcher = button('Open chat switcher', {
    iconName: 'squares',
    onClick: onSwitcher,
  });
  const actions = [];
  if (onUsage) {
    actions.push(
      button('Usage', { className: 'usage-nav-button', onClick: onUsage }),
    );
  }
  if (onChats) {
    actions.push(
      button('New chat or close chats', { iconName: 'plus', onClick: onChats }),
    );
  }
  actions.push(switcher);
  const root = node('header', { className: 'panel-nav' }, [
    back,
    title,
    node('div', { className: 'panel-nav-actions' }, actions),
  ]);
  return { root, heading, subtitle, back, switcher };
}

function createComposer() {
  const draftNote = node('div', { className: 'draft-note', hidden: true });
  const tray = node('div', {
    className: 'composer-attachments',
    hidden: true,
    'aria-label': 'Photos to send',
  });
  const imageInput = node('input', {
    className: 'composer-image-input',
    type: 'file',
    accept: 'image/*',
    multiple: true,
    hidden: true,
    'aria-label': 'Choose photos',
  });
  const picker = node('button', {
    className: 'composer-image-button',
    type: 'button',
    'aria-label': 'Add photos',
    on: {
      click: () => imageInput.click(),
    },
  }, [icon('photo')]);
  const field = node('textarea', {
    className: 'composer-field',
    placeholder: 'Message',
    rows: 1,
    maxlength: 16384,
    'aria-label': 'Message',
  });
  const disc = node('span', { className: 'button-disc' }, icon('arrowUp'));
  const send = node('button', {
    className: 'send-button',
    type: 'button',
    disabled: true,
    'aria-label': 'Send message',
  }, disc);
  const reason = node('button', {
    className: 'send-reason',
    type: 'button',
    hidden: true,
    on: { click: openConnectionSheet },
  });
  const inner = node('div', { className: 'composer-inner' }, [
    picker,
    imageInput,
    field,
    send,
    reason,
  ]);
  const root = node('div', { className: 'composer-dock' }, [
    draftNote,
    tray,
    inner,
  ]);
  let lastComposerHeight = 0;
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    const borderBox = Array.isArray(entry?.borderBoxSize)
      ? entry.borderBoxSize[0]
      : entry?.borderBoxSize;
    const height = Math.ceil(borderBox?.blockSize || root.getBoundingClientRect().height);
    if (height <= 0 || height === lastComposerHeight) return;
    lastComposerHeight = height;
    // The dock is position: absolute (app.css .composer-dock), so it is out of
    // flow and changing it does not resize the scroller. The composer height
    // variable feeds only the transcript's bottom padding, which changes
    // scrollHeight while clientHeight and every rendered message stay in
    // place. So a reader who is not at the bottom needs no correction at all:
    // an earlier version of this handler assumed the viewport shrank and moved
    // scrollTop to compensate, which yanked a transcript that was sitting
    // still. Doing nothing is the correct behaviour there.
    //
    // A reader at the bottom does need one. Growth adds padding and shrinking
    // after Send removes it. Re-pinning both directions keeps the last message
    // stable while the dock changes height.
    const scroller = state.shell?.transcriptScroll;
    const wasPinned = scroller
      ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 48
      : false;
    document.documentElement.style.setProperty(
      '--composer-height',
      `${height}px`,
    );
    if (!scroller || !wasPinned) return;
    // Synchronous, NOT in a requestAnimationFrame. A ResizeObserver callback
    // runs after layout but before paint, so writing here lands in the same
    // frame as the changed composer. Deferring it by a frame meant the browser
    // painted one dock height and then snapped the scroll on the next frame.
    // Reading scrollHeight forces one synchronous layout, and this whole block
    // only runs when the dock height actually changed, never per keystroke.
    scroller.scrollTop = scroller.scrollHeight;
  });
  observer.observe(root);
  const resize = () => {
    // Counting newlines ignored soft wrapping, so a single long wrapped line
    // still reported one row. Where field-sizing: content is unsupported that
    // left the box too short and the textarea scrolled its own content under
    // the caret. Collapsing to one row first makes scrollHeight report the true
    // content height, including wraps, and it also lets the box shrink again
    // when text is deleted. Both writes happen in one synchronous block, so no
    // intermediate state is ever painted.
    // Where field-sizing: content is supported the box already tracks its own
    // content, wraps included, and rows cannot change its height. Measuring
    // anyway forced two style recalcs and a synchronous layout on every
    // keystroke to compute a value with no effect, on exactly the browsers this
    // runs on. The measurement is kept only as the fallback it always was.
    if (supportsFieldSizing) return;
    const style = getComputedStyle(field);
    const lineHeight = parseFloat(style.lineHeight) || 24;
    const padding =
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    field.rows = 1;
    const wrapped = Math.round((field.scrollHeight - padding) / lineHeight);
    field.rows = Math.max(1, Math.min(6, wrapped || 1));
  };
  field.addEventListener('input', () => {
    const savedDraft = saveDraft(state.route.sessionId, field.value);
    if (savedDraft) field.dataset.draftRevision = savedDraft.revision;
    state.composerSendErrors.delete(state.route.sessionId);
    resize();
    renderComposerState();
    appUpdateCoordinator?.stateChanged();
  });
  field.addEventListener('keydown', (event) => {
    const touchAppleDevice =
      /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const hardwareKeyboard = !touchAppleDevice && event.key === 'Enter';
    if (hardwareKeyboard && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });
  imageInput.addEventListener('change', () => {
    const files = Array.from(imageInput.files || []);
    imageInput.value = '';
    addSelectedImages(state.route.sessionId, files);
  });
  send.addEventListener('click', sendCurrentMessage);
  return {
    root,
    field,
    send,
    reason,
    draftNote,
    tray,
    picker,
    imageInput,
    resize,
    observer,
  };
}

function syncPanelExposure() {
  if (!state.shell) return;
  const rootRoute = state.shell.root.classList.contains('is-root-route');
  const panels = [
    state.shell.workspacePanel,
    state.shell.sessionPanel,
    state.shell.transcriptPanel,
  ];
  for (const panel of panels) {
    const active = PHONE_LAYOUT.matches || rootRoute
      ? panel.classList.contains('is-active')
      : panel !== state.shell.workspacePanel;
    panel.toggleAttribute('inert', !active);
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  }
}

function updateRoutePanels() {
  if (!state.shell) return;
  const { view } = state.route;
  const rootRoute = view === 'recent' || view === 'workspaces';
  const routeChanged = view !== lastPanelView;
  const scroller = state.shell.transcriptScroll;
  const wasShowingTranscript =
    state.shell.transcriptPanel.classList.contains('is-active');
  // Measured before the class flips, because hidden panels can lose their
  // scroll position. New rows append below the reader, so keeping scrollTop
  // holds the same visible text in place while the transcript is hidden.
  if (wasShowingTranscript && view !== 'transcript' && scroller?.clientHeight > 0) {
    transcriptHiddenScrollTop = scroller.scrollTop;
  }
  state.shell.workspacePanel.classList.toggle(
    'is-active',
    rootRoute,
  );
  state.shell.sessionPanel.classList.toggle('is-active', view === 'sessions');
  state.shell.transcriptPanel.classList.toggle('is-active', view === 'transcript');
  state.shell.root.classList.toggle('is-root-route', rootRoute);
  syncPanelExposure();
  if (routeChanged && PHONE_LAYOUT.matches) {
    const enteringPanel = [
      state.shell.workspacePanel,
      state.shell.sessionPanel,
      state.shell.transcriptPanel,
    ].find((panel) => panel.classList.contains('is-active'));
    if (enteringPanel) {
      enteringPanel.classList.remove('is-entering');
      void enteringPanel.offsetWidth;
      enteringPanel.classList.add('is-entering');
      setTimeout(
        () => enteringPanel.classList.remove('is-entering'),
        MOTION_MS.content,
      );
    }
  }
  lastPanelView = view;
  if (view !== 'transcript' || transcriptHiddenScrollTop === null || !scroller) return;
  // Reading scrollHeight forces the layout the panel just gained, so this lands
  // in the same frame the panel becomes visible and nothing renders at the top
  // first. renderTranscript measures afterwards and sees the restored position.
  scroller.scrollTop = Math.max(0, transcriptHiddenScrollTop);
  transcriptHiddenScrollTop = null;
}

function clearRenderedSessionView() {
  const composer = state.shell?.composer;
  if (!composer) return;
  // The draft belongs to its session and is already persisted on every input.
  // Clear only the mounted controls before the wide layout reveals this column
  // beside another workspace's chat list.
  composer.field.value = '';
  delete composer.field.dataset.draftRevision;
  composer.resize();
  renderComposerAttachments();
  renderTranscript();
}

function navigate(route, push = true) {
  cancelReadTracking();
  if (route.view === 'transcript' && route.sessionId) {
    return openSession(route.sessionId, {
      workspaceId: route.workspaceId,
      push,
    });
  }
  state.sessionOpenController?.abort();
  state.shell?.transcriptColumn.classList.remove(
    'is-switching-in',
    'is-switching-out',
  );
  state.shell?.transcriptPanel.removeAttribute('aria-busy');
  if (
    state.route.view !== route.view &&
    (route.view === 'recent' || route.view === 'workspaces')
  ) {
    state.searchQuery = '';
  }
  state.route = route;
  persistRoute();
  if (push) history.pushState({ pocketRoute: route }, '', '/');
  updateRoutePanels();
  renderWorkspacePanel();
  renderSessionsPanel();
  if (route.view === 'sessions' && !route.sessionId) {
    clearRenderedSessionView();
  }
}

async function refreshWorkspaces({ signal, timeoutMs = 0 } = {}) {
  const generation = state.workspaceRequestGeneration + 1;
  state.workspaceRequestGeneration = generation;
  const metadataEpoch = state.unreadMetadataEpoch;
  try {
    const data = await request('/api/workspaces', { signal, timeoutMs });
    if (
      generation !== state.workspaceRequestGeneration ||
      metadataEpoch !== state.unreadMetadataEpoch
    ) {
      return;
    }
    state.workspaces = data.workspaces;
    state.workspacesError = null;
    if (Array.isArray(data.unreadSessions)) {
      state.unreadHeads = normalizeUnreadHeads(data.unreadSessions);
      state.unreadHeadsLoaded = true;
    } else {
      state.unreadHeads.clear();
      state.unreadHeadsLoaded = false;
    }
    state.workspacesLoaded = true;
    renderWorkspacePanel();
    void cacheSet('workspaces', state.workspaces);
    if (Array.isArray(data.unreadSessions)) {
      void cacheSet(
        'unread-session-heads',
        [...state.unreadHeads.values()],
      );
    }
    if (state.route.view === 'transcript') renderChatStrip();
    scheduleReadEvaluation();
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') return;
    if (
      generation !== state.workspaceRequestGeneration ||
      metadataEpoch !== state.unreadMetadataEpoch
    ) {
      return;
    }
    state.workspacesError =
      state.workspaces.length > 0
        ? 'Could not refresh workspaces. Showing saved workspaces.'
        : 'Workspaces are unavailable. Check the Mac connection and try again.';
    renderWorkspacePanel();
    handleRuntimeError(error);
  }
}

async function loadRecentSessions({ signal, timeoutMs = 0 } = {}) {
  const generation = state.recentSessionsRequestGeneration + 1;
  state.recentSessionsRequestGeneration = generation;
  state.recentSessionsLoad = 'loading';
  state.recentSessionsError = null;
  if (state.route.view === 'recent') renderWorkspacePanel();
  try {
    const data = await request('/api/sessions/recent?limit=100', {
      signal,
      timeoutMs,
    });
    if (generation !== state.recentSessionsRequestGeneration) {
      return { ok: false, superseded: true };
    }
    state.recentSessions = data.sessions;
    state.recentSessionsLoad = 'ready';
    if (state.route.view === 'recent') renderWorkspacePanel();
    if (state.route.view === 'transcript') renderChatStrip();
    scheduleReadEvaluation();
    void cacheSet('recent-sessions', data.sessions);
    return { ok: true, cached: false };
  } catch (error) {
    if (generation !== state.recentSessionsRequestGeneration) {
      return { ok: false, superseded: true };
    }
    if (signal?.aborted || error?.name === 'AbortError') {
      state.recentSessionsLoad =
        state.recentSessions.length > 0 ? 'ready' : 'idle';
      return { ok: false, aborted: true };
    }
    const cached = await cacheGet('recent-sessions');
    if (generation !== state.recentSessionsRequestGeneration) {
      return { ok: false, superseded: true };
    }
    if (Array.isArray(cached)) state.recentSessions = cached;
    state.recentSessionsLoad = 'error';
    state.recentSessionsError =
      state.recentSessions.length > 0
        ? 'Couldn’t refresh recent chats. Showing saved chats.'
        : 'Recent chats are unavailable. Check the Mac connection and try again.';
    if (state.route.view === 'recent') renderWorkspacePanel();
    if (state.route.view === 'transcript') renderChatStrip();
    return {
      ok: false,
      cached: state.recentSessions.length > 0,
    };
  }
}

async function loadSessions(
  workspaceId,
  { signal, timeoutMs = 0 } = {},
) {
  state.sessionErrorsByWorkspace.delete(workspaceId);
  if (state.sessionsByWorkspace.has(workspaceId)) {
    if (state.route.workspaceId === workspaceId) renderSessionsPanel();
  } else {
    void cacheGet(`sessions:${workspaceId}`).then((cached) => {
      if (
        Array.isArray(cached) &&
        !state.sessionsByWorkspace.has(workspaceId)
      ) {
        state.sessionsByWorkspace.set(workspaceId, cached);
        if (state.route.workspaceId === workspaceId) {
          renderSessionsPanel();
          renderChatStrip();
        }
      }
    });
  }
  try {
    const data = await request(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
      { signal, timeoutMs },
    );
    state.sessionsByWorkspace.set(workspaceId, data.sessions);
    state.sessionErrorsByWorkspace.delete(workspaceId);
    if (state.route.workspaceId === workspaceId) renderSessionsPanel();
    void cacheSet(`sessions:${workspaceId}`, data.sessions);
    if (state.route.workspaceId === workspaceId) renderChatStrip();
    scheduleReadEvaluation();
    return data.sessions;
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      return sessionsFor(workspaceId);
    }
    state.sessionErrorsByWorkspace.set(
      workspaceId,
      sessionsFor(workspaceId).length > 0
        ? 'Could not refresh chats. Showing saved chats.'
        : 'Chats are unavailable. Check the Mac connection and try again.',
    );
    if (state.route.workspaceId === workspaceId) renderSessionsPanel();
    handleRuntimeError(error);
    return sessionsFor(workspaceId);
  }
}

function sessionsFor(workspaceId) {
  return state.sessionsByWorkspace.get(workspaceId) || [];
}

function recentSessionsNewestFirst() {
  const workspaceDetails = new Map(
    state.workspaces.map((workspace) => [workspace.id, workspace]),
  );
  return state.recentSessions
    .map((session) => {
      const workspace = workspaceDetails.get(session.workspaceId);
      return {
        ...session,
        repositoryName: session.repositoryName || workspace?.repositoryName || null,
        workspaceName: session.workspaceName || workspace?.name || 'Workspace',
      };
    })
    .sort((left, right) => {
      const leftActivity = Date.parse(left.activityAt || '') || 0;
      const rightActivity = Date.parse(right.activityAt || '') || 0;
      return rightActivity - leftActivity || left.id.localeCompare(right.id);
    });
}

function stableChatStripSessions(sessions, previousIds) {
  void previousIds;
  return [...sessions];
}

function sessionLocationLabel(session) {
  const workspaceName = session?.workspaceName || 'Workspace';
  const repositoryName =
    typeof session?.repositoryName === 'string'
      ? session.repositoryName.trim()
      : '';
  if (!repositoryName || repositoryName === workspaceName) return workspaceName;
  return `${repositoryName} \u00b7 ${workspaceName}`;
}

function connectionVoice() {
  if (state.connection === 'live') return { text: 'Live', className: '', dot: 'live' };
  if (state.connection === 'offline') {
    // Short enough for the chip. A phone with no network is the one cause that
    // is knowable without making a request, and it is not the Mac's fault.
    return {
      text: navigator.onLine === false ? 'Phone offline' : 'Mac unreachable',
      className: 'down',
      iconName: 'wifiOff',
    };
  }
  return { text: 'Reconnecting…', className: 'wait', iconName: 'refresh' };
}

function renderConnectionVoice(container) {
  if (!container) return;
  const voice = connectionVoice();
  container.replaceChildren();
  container.className = `connection-voice ${voice.className === 'down' ? 'is-down' : voice.className === 'wait' ? 'is-wait' : ''}`;
  if (voice.dot) container.append(node('span', { className: `status-dot ${voice.dot}` }));
  else container.append(icon(voice.iconName));
  container.append(document.createTextNode(voice.text));
  // GPT is the active agent provider for Pocket. The higher window stays
  // visible because either one can stop a turn.
  const seat = activeSeat();
  if (!seat) return;
  const worst = Math.max(
    Number.isFinite(seat.weeklyPercent) ? seat.weeklyPercent : -1,
    Number.isFinite(seat.fiveHourPercent) ? seat.fiveHourPercent : -1,
  );
  if (worst < 0) return;
  const blocked = seat.blocked || seat.weeklyBlocked || seat.fiveHourBlocked;
  container.append(
    node('span', {
      className: `connection-usage${blocked ? ' is-blocked' : ''}`,
      text: blocked
        ? `· GPT out${seat.stale ? ' cached' : ''}`
        : `· GPT ${worst}%${seat.stale ? ' cached' : ''}`,
    }),
  );
}

function renderWorkspacePanel() {
  if (!state.shell) return;
  const panel = state.shell.workspacePanel;
  const recentHome = state.route.view === 'recent';
  const connection = node('button', {
    className: 'connection-voice',
    type: 'button',
    'aria-label': 'Connection and account usage',
    on: { click: () => openConnectionSheet() },
  });
  state.shell.connectionVoice = connection;
  renderConnectionVoice(connection);
  void refreshSeatUsage();
  const header = node('header', { className: 'root-header' }, [
    node('div', {}, [
      node('h1', {
        className: 'root-title',
        text: recentHome ? 'Recent Chats' : 'Workspaces',
      }),
      connection,
    ]),
    node('div', { className: 'root-actions' }, [
      recentHome
        ? button('Workspaces', {
            className: 'text-button root-mode-button',
            onClick: () =>
              navigate({ view: 'workspaces', workspaceId: null, sessionId: null }),
          })
        : button('Recent', {
            className: 'text-button root-mode-button',
            onClick: () =>
              navigate({ view: 'recent', workspaceId: null, sessionId: null }),
          }),
      button('Security and devices', { iconName: 'gear', onClick: openSecurity }),
    ]),
  ]);
  const searchInput = node('input', {
    className: 'search-input',
    type: 'search',
    value: state.searchQuery,
    placeholder: recentHome ? 'Search recent chats' : 'Search workspaces and chats',
    'aria-label': recentHome ? 'Search recent chats' : 'Search workspaces and chats',
    on: {
      input: (event) => {
        state.searchQuery = event.currentTarget.value;
        renderWorkspacePanel();
        requestAnimationFrame(() => {
          const replacement = state.shell.workspacePanel.querySelector('.search-input');
          replacement?.focus({ preventScroll: true });
          replacement?.setSelectionRange(
            state.searchQuery.length,
            state.searchQuery.length,
          );
        });
      },
    },
  });
  const search = node('div', { className: 'search-wrap' }, [
    icon('search'),
    searchInput,
  ]);
  const content = node('div', { className: 'panel-content' }, [header, search]);

  if (recentHome) {
    if (state.recentSessionsError) {
      content.append(
        node('div', { className: 'switcher-notice is-error', role: 'alert' }, [
          icon('warn'),
          node('span', { text: state.recentSessionsError }),
          node('button', {
            className: 'text-button',
            type: 'button',
            text: 'Retry',
            on: { click: () => void loadRecentSessions() },
          }),
        ]),
      );
    }
    const query = state.searchQuery.trim().toLowerCase();
    const sessions = state.recentSessions.filter((session) =>
      `${session.title} ${session.repositoryName || ''} ${session.workspaceName}`
        .toLowerCase()
        .includes(query),
    );
    if (sessions.length > 0) {
      const list = node('ul', { className: 'row-list' });
      sessions.forEach((session) =>
        list.append(sessionRow(session, { crossWorkspace: true })),
      );
      content.append(list);
    } else if (
      state.recentSessionsLoad === 'loading' &&
      !state.recentSessionsError
    ) {
      content.append(skeletonRows(6));
    } else if (!state.recentSessionsError) {
      content.append(
        node('div', { className: 'empty-state' }, [
          icon(query ? 'search' : 'terminal'),
          node('h2', {
            text: query
              ? `No matches for “${state.searchQuery.trim()}”`
              : 'No recent chats yet',
          }),
          query
            ? null
            : node('p', { text: 'Open a chat from Workspaces to get started.' }),
        ]),
      );
    }
  } else {
    if (state.workspacesError) {
      content.append(
        node('div', { className: 'switcher-notice is-error', role: 'alert' }, [
          icon('warn'),
          node('span', { text: state.workspacesError }),
          node('button', {
            className: 'text-button',
            type: 'button',
            text: 'Retry',
            on: { click: () => void refreshWorkspaces() },
          }),
        ]),
      );
    }
    if (
      !state.workspacesLoaded &&
      state.workspaces.length === 0 &&
      !state.workspacesError
    ) {
      content.append(skeletonRows(6));
    } else if (state.workspaces.length === 0 && !state.workspacesError) {
      content.append(
        node('div', { className: 'empty-state' }, [
          icon('laptop'),
          node('h2', { text: 'No workspaces yet' }),
          node('p', {
            text: "Open Conductor on your Mac and they'll appear here.",
          }),
        ]),
      );
    } else if (state.searchQuery.trim()) {
      renderSearchResults(content);
    } else {
      const active = state.workspaces.filter(
        (workspace) => workspace.workingCount > 0,
      );
      const recent = state.workspaces
        .filter((workspace) => !active.includes(workspace))
        .slice(0, 5);
      const remainder = state.workspaces
        .filter(
          (workspace) =>
            !active.includes(workspace) && !recent.includes(workspace),
        )
        .sort((left, right) => left.name.localeCompare(right.name));
      appendWorkspaceSection(content, 'Active', active);
      appendWorkspaceSection(content, 'Recent', recent);
      appendWorkspaceSection(content, 'All', remainder);
    }
  }
  // This swaps the SCROLL CONTAINER itself, and it runs on every workspaces
  // response: an 8s backstop poll plus every stream event, whether or not
  // anything changed. A fresh element always starts at scrollTop 0, so the list
  // snapped back to the top on its own every few seconds, and the search input
  // lives in the same replaced subtree, so it was destroyed mid-word and the
  // keyboard closed. Rebuilding is left alone here; what carries across is the
  // state a rebuild has no business discarding.
  const previousContent = panel.querySelector('.panel-content');
  const previousScrollTop = previousContent ? previousContent.scrollTop : 0;
  const previousSearch = panel.querySelector('.search-input');
  const searchWasFocused = previousSearch && document.activeElement === previousSearch;
  const selectionStart = searchWasFocused ? previousSearch.selectionStart : null;
  const selectionEnd = searchWasFocused ? previousSearch.selectionEnd : null;
  panel.replaceChildren(content);
  const restoredContent = panel.querySelector('.panel-content');
  // Same frame as the swap, so the top of the list is never painted first.
  if (restoredContent && previousScrollTop > 0) {
    restoredContent.scrollTop = previousScrollTop;
  }
  if (!searchWasFocused) return;
  const restoredSearch = panel.querySelector('.search-input');
  if (!restoredSearch) return;
  restoredSearch.focus({ preventScroll: true });
  if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
    restoredSearch.setSelectionRange(selectionStart, selectionEnd);
  }
}

function renderSearchResults(content) {
  const query = state.searchQuery.trim().toLowerCase();
  const workspaces = state.workspaces.filter((workspace) =>
    `${workspace.name} ${workspace.branch || ''}`.toLowerCase().includes(query),
  );
  const sessions = state.recentSessions.filter((session) =>
    `${session.title} ${session.repositoryName || ''} ${session.workspaceName}`
      .toLowerCase()
      .includes(query),
  );
  appendWorkspaceSection(content, 'Workspaces', workspaces);
  if (sessions.length) {
    const list = node('ul', { className: 'row-list' });
    for (const session of sessions) list.append(sessionRow(session, { crossWorkspace: true }));
    content.append(node('h2', { className: 'section-heading', text: 'Chats' }), list);
  }
  if (!workspaces.length && !sessions.length) {
    content.append(
      node('div', { className: 'empty-state' }, [
        icon('search'),
        node('h2', { text: `No matches for “${state.searchQuery.trim()}”` }),
      ]),
    );
  }
}

function appendWorkspaceSection(content, title, workspaces) {
  if (!workspaces.length) return;
  const list = node('ul', { className: 'row-list' });
  for (const workspace of workspaces) list.append(workspaceRow(workspace));
  content.append(node('h2', { className: 'section-heading', text: title }), list);
}

function workspaceRow(workspace) {
  const unreadCount = workspaceUnreadCount(workspace);
  const subtitle = node('span', { className: 'row-subtitle' }, [
    icon('branch'),
    workspace.branch || 'No branch',
  ]);
  const meta = node('span', { className: 'row-meta' });
  if (workspace.workingCount > 0) {
    meta.append(
      node('span', { className: 'row-status' }, [
        node('span', { className: 'status-dot working' }),
        workspace.workingCount > 1 ? String(workspace.workingCount) : null,
      ]),
    );
  } else if (unreadCount > 0) {
    meta.append(unreadBadge(unreadCount));
  } else {
    meta.textContent = formatRelative(workspace.activityAt);
  }
  const control = node('button', {
    className: 'data-row',
    type: 'button',
    'aria-current': state.route.workspaceId === workspace.id ? 'true' : 'false',
    on: {
      click: () => {
        navigate({ view: 'sessions', workspaceId: workspace.id, sessionId: null });
        void loadSessions(workspace.id);
      },
    },
  }, [
    node('span', { className: 'row-monogram', text: initials(workspace.name) }),
    node('span', { className: 'row-copy' }, [
      node('span', { className: 'row-title', text: workspace.name }),
      subtitle,
    ]),
    meta,
  ]);
  return node('li', {}, control);
}

function renderSessionsPanel() {
  if (!state.shell) return;
  const workspace = state.workspaces.find((item) => item.id === state.route.workspaceId);
  const { sessionNav, sessionContent } = state.shell;
  sessionNav.heading.textContent = workspace?.name || 'Chats';
  updateNavSubtitle(sessionNav.subtitle, workspace?.branch || connectionVoice().text);
  sessionContent.replaceChildren();
  if (!workspace) {
    sessionContent.append(
      node('div', { className: 'empty-state' }, [
        icon('terminal'),
        node('h2', { text: 'Choose a workspace' }),
      ]),
    );
    return;
  }
  const sessions = sessionsFor(workspace.id);
  const sessionError = state.sessionErrorsByWorkspace.get(workspace.id);
  if (sessionError) {
    sessionContent.append(
      node('div', { className: 'switcher-notice is-error', role: 'alert' }, [
        icon('warn'),
        node('span', { text: sessionError }),
        node('button', {
          className: 'text-button',
          type: 'button',
          text: 'Retry',
          on: { click: () => void loadSessions(workspace.id) },
        }),
      ]),
    );
  }
  if (!state.sessionsByWorkspace.has(workspace.id) && !sessionError) {
    sessionContent.append(skeletonRows(6));
    return;
  }
  if (!sessions.length) {
    if (sessionError) return;
    sessionContent.append(
      node('div', { className: 'empty-state' }, [
        icon('terminal'),
        node('h2', { text: 'No chats in this workspace' }),
        node('p', { text: 'Start one from your Mac.' }),
      ]),
    );
    return;
  }
  const list = node('ul', { className: 'row-list' });
  sessions.forEach((session) => list.append(sessionRow(session)));
  sessionContent.append(list);
}

function sessionRow(session, { crossWorkspace = false } = {}) {
  const isWorking = session.status === 'working';
  const isError = session.status === 'error';
  const unreadCount = sessionUnreadCount(session);
  const subtitleText = crossWorkspace
    ? sessionLocationLabel(session)
    : `${session.agentType || 'agent'}${session.model ? ` · ${session.model}` : ''}`;
  const meta = node('span', { className: 'row-meta' }, [
    node('span', { text: formatRelative(session.activityAt) }),
    isError
      ? node('span', { className: 'row-error' }, [
        icon('warn'),
        document.createTextNode('Error'),
      ])
      : isWorking
      ? node('span', { className: 'status-dot working' })
      : unreadCount > 0
        ? unreadBadge(unreadCount)
        : null,
  ]);
  const control = node('button', {
    className: 'data-row chat-row',
    type: 'button',
    'aria-current': state.route.sessionId === session.id ? 'true' : 'false',
    on: {
      click: async () => {
        if (crossWorkspace && session.workspaceId !== state.route.workspaceId) {
          void loadSessions(session.workspaceId);
        }
        closeOverlay();
        await openSession(session.id, {
          workspaceId: session.workspaceId,
          push: true,
        });
      },
    },
  }, [
    node('span', { className: 'row-monogram', text: initials(session.agentType) }),
    node('span', { className: 'row-copy' }, [
      node('span', { className: 'row-title', text: session.title }),
      node('span', { className: 'row-subtitle', text: subtitleText }),
    ]),
    meta,
  ]);
  return node('li', {}, control);
}

function updateNavSubtitle(element, fallback) {
  const voice = connectionVoice();
  element.className = `nav-subtitle ${voice.className}`;
  element.replaceChildren();
  if (state.connection === 'live') element.textContent = fallback || 'Live';
  else {
    element.append(icon(voice.iconName), document.createTextNode(voice.text));
  }
}

async function openSession(sessionId, { workspaceId = state.route.workspaceId, push = true } = {}) {
  cancelReadTracking();
  state.sessionOpenController?.abort();
  const controller = new AbortController();
  state.sessionOpenController = controller;
  const switchingSession =
    state.route.view === 'transcript' &&
    Boolean(state.route.sessionId) &&
    state.route.sessionId !== sessionId;
  if (switchingSession) {
    await transitionTranscriptOut(controller.signal);
    if (controller.signal.aborted) return;
  }
  const isCurrent = () =>
    !controller.signal.aborted &&
    state.route.sessionId === sessionId &&
    state.route.workspaceId === workspaceId;
  if (state.route.sessionId !== sessionId) state.expandedActivities.clear();
  state.route = { view: 'transcript', workspaceId, sessionId };
  persistRoute();
  if (push) history.pushState({ pocketRoute: state.route }, '', '/');
  updateRoutePanels();
  renderWorkspacePanel();
  renderSessionsPanel();
  const composer = state.shell.composer;
  const draftRecord = draftRecordFor(sessionId);
  composer.field.value = draftRecord.text;
  composer.field.dataset.draftRevision = draftRecord.revision;
  composer.resize();
  renderComposerAttachments();
  renderComposerState();
  const hasMemorySnapshot = state.messagesBySession.has(sessionId);
  const hasLiveBaseline =
    state.messageBaselinesBySession.has(sessionId);
  renderTranscript();

  if (hasMemorySnapshot && hasLiveBaseline) {
    await refreshMessages(sessionId, {
      signal: controller.signal,
    });
  } else {
    const cachedSnapshot = cacheGet(`messages:${sessionId}`).then((cached) => {
      if (
        cached?.messages &&
        isCurrent() &&
        !state.messagesBySession.has(sessionId)
      ) {
        state.messagesBySession.set(sessionId, cached.messages);
        state.cursorsBySession.set(sessionId, cached.cursor || 0);
        renderTranscript();
      }
    });
    const networkSnapshot = refreshMessages(sessionId, {
      full: true,
      signal: controller.signal,
    });
    await Promise.allSettled([cachedSnapshot, networkSnapshot]);
  }
  if (!isCurrent()) return;
  state.connectionProbe = null;
  renderTranscript();
  if (state.sessionOpenController === controller) {
    state.sessionOpenController = null;
  }
}

async function refreshMessages(
  sessionId,
  { full = false, signal, timeoutMs = 0 } = {},
) {
  if (!sessionId) return [];
  const requestVisibilityEpoch = state.visibilityEpoch;
  const effectiveFull =
    full || !state.messageBaselinesBySession.has(sessionId);
  try {
    return await sessionMessageRequests.run({
      sessionId,
      full: effectiveFull,
      signal,
      load: async () => {
        const cursor = effectiveFull
          ? 0
          : state.cursorsBySession.get(sessionId) || 0;
        const queuedRowIds =
          queuedRowRefresh?.sessionId === sessionId
            ? queuedRowRefresh.rowIds.slice(0, 8)
            : [];
        const queuedRowsQuery =
          queuedRowIds.length > 0
            ? `&queuedRowIds=${encodeURIComponent(queuedRowIds.join(','))}`
            : '';
        const data = await request(
          `/api/sessions/${encodeURIComponent(sessionId)}/messages?after=${cursor}${queuedRowsQuery}`,
          { signal, timeoutMs },
        );
        return { cursor, data, queuedRowIds };
      },
      commit: ({ cursor, data, queuedRowIds }) => {
        // The database event can beat the POST receipt by a few hundred
        // milliseconds. Hold a batch containing a user row until that receipt
        // settles, or the Mac row and its optimistic bubble briefly render as
        // two messages. The cursor stays unchanged, so the next refresh reads
        // the held row again and reconciles it before painting.
        if (
          transcriptRefreshShouldWait(
            data.messages,
            state.optimistic,
            sessionId,
          )
        ) {
          return [];
        }
        const currentCursor = state.cursorsBySession.get(sessionId) || 0;
        const responseCursor = Math.max(0, Number(data.cursor) || 0);
        if (effectiveFull && responseCursor < currentCursor) {
          return [];
        }
        const existing = effectiveFull
          ? []
          : state.messagesBySession.get(sessionId) || [];
        const messages = effectiveFull
          ? data.messages
          : [...existing, ...data.messages];
        const requestedRowIds = new Set(queuedRowIds);
        const existingById = new Map(
          messages.map((message) => [message.id, message]),
        );
        const refreshed = Array.isArray(data.refreshed)
          ? data.refreshed.slice(0, queuedRowIds.length)
          : [];
        const refreshedById = new Map(
          refreshed
            .filter(
              (message) =>
                existingById.has(message?.id) &&
                requestedRowIds.has(Number(message?.rowId)),
            )
            .map((message) => [message.id, message]),
        );
        const missingQueuedRowIds = new Set(
          (Array.isArray(data.missingQueuedRowIds)
            ? data.missingQueuedRowIds.slice(0, queuedRowIds.length)
            : []
          )
            .map(Number)
            .filter(
              (rowId) =>
                Number.isSafeInteger(rowId) && requestedRowIds.has(rowId),
            ),
        );
        const refreshedMessages = messages
          .filter(
            (message) =>
              !(
                message?.kind === 'user' &&
                message.queued === true &&
                missingQueuedRowIds.has(Number(message.rowId)) &&
                !refreshedById.has(message.id)
              ),
          )
          .map((message) => refreshedById.get(message.id) || message);
        const nextCursor = Math.max(cursor, currentCursor, responseCursor);
        state.messagesBySession.set(
          sessionId,
          dedupeMessages(refreshedMessages),
        );
        state.cursorsBySession.set(sessionId, nextCursor);
        if (effectiveFull) {
          state.messageBaselinesBySession.add(sessionId);
        }
        state.messageLiveEpochBySession.set(
          sessionId,
          requestVisibilityEpoch,
        );
        const reconciled = reconcileOptimistic(sessionId);
        if (state.route.sessionId === sessionId) renderTranscript();
        void cacheSet(`messages:${sessionId}`, {
          cursor: nextCursor,
          messages: state.messagesBySession.get(sessionId).slice(-50),
        });
        return reconciled;
      },
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') return [];
    handleRuntimeError(error);
    return [];
  }
}

function dedupeMessages(messages) {
  const seen = new Set();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

function reconcileOptimistic(sessionId) {
  const result = reconcileDeliveryReceipts(
    state.optimistic,
    sessionId,
    state.cursorsBySession.get(sessionId),
    state.messagesBySession.get(sessionId) || [],
  );
  state.optimistic = result.remaining;
  if (result.reconciled.length > 0) {
    for (const messageId of reconciledTranscriptMessageIds(
      state.messagesBySession.get(sessionId) || [],
      result.reconciled,
    )) {
      state.seenMessageIds.add(messageId);
    }
    for (const message of result.reconciled) {
      if (!Number.isFinite(message.receiptObservedAt)) {
        message.receiptObservedAt = Date.now();
        void persistPendingDeliveries({ upserts: [message] });
      }
      void observeDeliveredReceipt(message);
      for (const attachment of message.attachments || []) {
        releaseAttachmentPreview(attachment);
      }
    }
  }
  for (const message of result.unreconciled) {
    void verifyStalledDeliveredReceipt(message);
  }
  for (const message of result.missing) {
    void verifyMissingDeliveryReceipt(message);
  }
  return result.reconciled;
}

function currentSession() {
  return sessionsFor(state.route.workspaceId).find(
    (session) => session.id === state.route.sessionId,
  ) || state.recentSessions.find((session) => session.id === state.route.sessionId);
}

// One tap to switch, rendered from the workspace's own session list. The active
// chip scrolls itself into view so the current chat is always visible after a
// switch or a fresh open. Closing deliberately stays in the Chats sheet: an
// irreversible action does not belong in a strip you swipe through.
// Only states worth interrupting for. idle is absent on purpose: a strip where
// most chips carry a dot communicates nothing.
const STRIP_STATUS = {
  working: { className: 'is-working', dot: 'is-working', label: 'working' },
  needs_plan_response: {
    className: 'is-waiting',
    dot: 'is-waiting',
    label: 'waiting for you',
  },
  error: { className: 'is-error', dot: 'is-error', label: 'error' },
};

// field-sizing: content makes the textarea track its own content, wraps
// included, so the manual row measurement below is only needed where it is
// unsupported. Probed once rather than per keystroke.
const supportsFieldSizing =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('field-sizing', 'content');

let lastCentredSessionId = null;
let chatStripMovedByHand = false;
let chatStripOwner = null;
let newChatStripChip = null;
const chatStripChips = new Map();
let chatStripSessionOrder = [];
// Which chat the transcript scroller currently holds. The scroll position is
// measured before the list is replaced, so without this the reading position
// from one chat is applied to the next one opened.
let lastTranscriptSessionId = null;
// Row id of the newest root event on screen. An agent error is a record of a
// moment, not a running state, so once anything newer exists its "do this now"
// guidance is no longer true and must stop being shown as advice.
let newestRootEventRowId = 0;
// Seat usage is cached because it is rendered from the always-visible header.
// Fetching per render would loop: fetch, store, render, fetch.
// Scroll position at the moment the transcript panel was hidden.
// Panels are toggled with display:none, and the browser DISCARDS the scroll
// position of anything display:none, so leaving the transcript and coming back
// always returned scrollTop to 0. No amount of correcting when the scroll is
// written can fix that, because nothing in the app did the resetting. Captured
// on the way out, reapplied on the way in.
let transcriptHiddenScrollTop = null;
let lastPanelView = null;

const seatUsageReader = createUsageReader({
  load: () => request('/api/usage'),
  ttlMs: 60_000,
});
let seatUsageCache = null;

async function refreshSeatUsage({ force = false } = {}) {
  seatUsageCache = await seatUsageReader.read({ force });
  if (state.shell) renderConnectionVoice(state.shell.connectionVoice);
  return seatUsageCache;
}

// The seat the agent is actually running on, which is the only one whose limit
// can stop a turn.
function activeSeat() {
  return activeGptUsage(seatUsageCache);
}
// Whether the operator has moved this transcript themselves since it opened.
// A chat's messages arrive in two passes, a memory snapshot and then the
// network refresh, and returning from the background re-runs that. The first
// paint can therefore hold a fraction of the messages, and every message that
// lands afterwards is inserted ABOVE the reader, pushing them further from the
// end. The old logic measured distance-from-bottom on that partial paint and
// then faithfully preserved it, which is why coming back to the app left the
// view stranded far up the page. Following the newest message until a real
// gesture says otherwise is what makes that impossible.
let transcriptMovedByHand = false;

async function transitionTranscriptOut(signal) {
  const column = state.shell?.transcriptColumn;
  if (!column) return;
  column.classList.remove('is-switching-in');
  column.classList.add('is-switching-out');
  state.shell.transcriptPanel.setAttribute('aria-busy', 'true');
  await waitForVisualMotion(column, {
    durationMs: MOTION_MS.quick,
    signal,
  });
}

function transitionTranscriptIn() {
  const column = state.shell?.transcriptColumn;
  if (!column) return;
  column.classList.remove('is-switching-out');
  column.classList.add('is-switching-in');
  state.shell.transcriptPanel.removeAttribute('aria-busy');
  void waitForVisualMotion(column, {
    durationMs: MOTION_MS.content,
  }).then(() => column.classList.remove('is-switching-in'));
}

function renderTranscriptPlaceholder({ loading, selected = true }) {
  const opening = selected && loading;
  return node('li', {
    className: `transcript-placeholder${opening ? ' is-loading' : ''}`,
    role: 'status',
  }, [
    opening
      ? node('span', { className: 'status-dot working', 'aria-hidden': 'true' })
      : icon('terminal'),
    node('h2', {
      text: !selected ? 'Choose a chat' : opening ? 'Opening chat…' : 'No messages yet',
    }),
    node('p', {
      text: !selected
        ? 'Select one from the list to open it here.'
        : opening
          ? 'Keeping this screen steady while Pocket loads it.'
          : 'Send the first message from Pocket or your Mac.',
    }),
  ]);
}

function syncChatStripChip(chip, {
  session,
  active,
  className,
  ariaLabel,
  markerFactory,
  renderKey,
}) {
  if (chip.dataset.renderKey === renderKey) return;
  chip.dataset.renderKey = renderKey;
  chip.dataset.sessionId = session.id;
  chip.dataset.workspaceId = session.workspaceId;
  chip.className = className;
  chip.setAttribute('aria-label', ariaLabel);
  if (active) chip.setAttribute('aria-current', 'page');
  else chip.removeAttribute('aria-current');
  const marker = markerFactory();
  chip.querySelector('.chip-indicator')
    ?.replaceChildren(...(marker ? [marker] : []));
  const label = chip.querySelector('.chip-label');
  const workspace = chip.querySelector('.chip-workspace');
  if (label) label.textContent = session.title;
  if (workspace) workspace.textContent = sessionLocationLabel(session);
}

function reconcileChatStripChildren(strip, desiredChildren) {
  reconcileMountedChildren(strip, desiredChildren);
}

function renderChatStrip() {
  const strip = state.shell?.chatStrip;
  if (!strip) return;
  if (chatStripOwner !== strip) {
    chatStripOwner = strip;
    newChatStripChip = null;
    chatStripChips.clear();
    chatStripSessionOrder = [];
    lastCentredSessionId = null;
  }
  const sessions = stableChatStripSessions(
    recentSessionsNewestFirst(),
    chatStripSessionOrder,
  );
  chatStripSessionOrder = sessions.map((session) => session.id);
  const chatStates = sessions.map((session) => ({
    session,
    unreadCount: sessionUnreadCount(session),
  }));
  const renderKey = JSON.stringify([
    state.route.sessionId,
    chatStates.map(({ session, unreadCount }) => [
      session.id,
      session.title,
      session.repositoryName,
      session.workspaceName,
      session.status,
      unreadCount,
    ]),
  ]);
  if (strip.dataset.renderKey === renderKey) return;
  strip.dataset.renderKey = renderKey;
  if (sessions.length === 0) {
    strip.replaceChildren();
    chatStripChips.clear();
    newChatStripChip = null;
    strip.hidden = true;
    return;
  }
  strip.hidden = false;
  const previousActive = strip.querySelector('.chat-chip.is-active');
  const previousActiveSessionId = previousActive?.dataset.sessionId || null;
  const previousActiveOffset = previousActive?.offsetLeft ?? null;
  const previousScrollLeft = strip.scrollLeft;
  const manualScrollAnchor = captureHorizontalScrollAnchor(
    strip,
    [...strip.children].filter((child) => child !== newChatStripChip),
    {
      preferred: previousActive,
      manual: chatStripMovedByHand,
    },
  );
  const currentSessionIds = new Set(sessions.map((session) => session.id));
  for (const sessionId of chatStripChips.keys()) {
    if (!currentSessionIds.has(sessionId)) chatStripChips.delete(sessionId);
  }
  let activeChip = null;
  const chips = chatStates.map(({ session, unreadCount }) => {
    const active = session.id === state.route.sessionId;
    // Status rides along on the session rows the app already loads, and
    // metadataRefresh reloads those on every live change event, so this costs
    // no extra query, no polling and no accessibility work. An unchanged chip
    // keeps its exact DOM node, which preserves a finger scroll in progress.
    const state_ = STRIP_STATUS[session.status] || null;
    const unread = !state_ && unreadCount > 0;
    const location = sessionLocationLabel(session);
    const className = `chat-chip${active ? ' is-active' : ''}${state_ ? ` ${state_.className}` : ''}${unread ? ' is-unread' : ''}`;
    const accessibility = {
      'aria-label': state_
        ? `${session.title}, ${location}, ${state_.label}`
        : unread
          ? `${session.title}, ${location}, reply ready, ${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}`
          : `${session.title}, ${location}`,
    };
    const ariaLabel = accessibility['aria-label'];
    const chipRenderKey = JSON.stringify([
      className,
      ariaLabel,
      session.id,
      session.workspaceId,
      session.title,
      location,
    ]);
    let chip = chatStripChips.get(session.id);
    if (!chip) {
      chip = node('button', {
        className: 'chat-chip',
        type: 'button',
        on: {
          click: () => {
            if (session.id === state.route.sessionId) return;
            navigate({
              view: 'transcript',
              workspaceId: session.workspaceId,
              sessionId: session.id,
            });
          },
        },
      }, [
        node('span', { className: 'chip-indicator', 'aria-hidden': 'true' }),
        node('span', { className: 'chip-copy' }, [
          node('span', { className: 'chip-label', text: session.title }),
          node('span', {
            className: 'chip-workspace',
            text: location,
          }),
        ]),
      ]);
      chatStripChips.set(session.id, chip);
    }
    syncChatStripChip(chip, {
      session,
      active,
      className,
      ariaLabel,
      markerFactory: () => state_
        ? node('span', { className: `chip-dot ${state_.dot}`, 'aria-hidden': 'true' })
        : unread
          ? node('span', {
              className: 'chip-unread',
              text: cappedCount(unreadCount),
              'aria-hidden': 'true',
            })
          : null,
      renderKey: chipRenderKey,
    });
    if (active) activeChip = chip;
    return chip;
  });
  if (!newChatStripChip) {
    newChatStripChip = node('button', {
      className: 'chat-chip is-new',
      type: 'button',
      text: '+',
      on: { click: (event) => void createChat({ control: event.currentTarget }) },
    });
  }
  // Names the destination because a new chat lands in the workspace of the
  // chat that is currently open.
  newChatStripChip.setAttribute(
    'aria-label',
    `New chat in ${currentWorkspaceName() || 'this workspace'}`,
  );
  reconcileChatStripChildren(strip, [...chips, newChatStripChip]);

  // A newest activity refresh may move chips in the list. Keep the selected
  // chip at the same screen position, including during a manual strip scroll.
  if (
    activeChip &&
    previousActiveSessionId === state.route.sessionId &&
    previousActiveOffset !== null
  ) {
    if (chatStripMovedByHand && manualScrollAnchor) {
      restoreHorizontalScrollAnchor(strip, manualScrollAnchor);
    } else {
      const anchored =
        previousScrollLeft + activeChip.offsetLeft - previousActiveOffset;
      const maximum = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const nextScrollLeft = Math.max(0, Math.min(maximum, anchored));
      if (Math.abs(strip.scrollLeft - nextScrollLeft) > 0.5) {
        strip.scrollLeft = nextScrollLeft;
      }
    }
    lastCentredSessionId = state.route.sessionId;
  } else if (activeChip && lastCentredSessionId !== state.route.sessionId) {
    chatStripMovedByHand = false;
    lastCentredSessionId = state.route.sessionId;
    const centred =
      activeChip.offsetLeft - (strip.clientWidth - activeChip.offsetWidth) / 2;
    strip.scrollLeft = Math.max(0, centred);
  }
}

function renderTranscript() {
  renderChatStrip();
  if (!state.shell) return;
  const session = currentSession();
  const workspace = state.workspaces.find((item) => item.id === state.route.workspaceId);
  const { transcriptNav, transcriptBanner, transcriptScroll, messageList, statusRow } =
    state.shell;
  transcriptNav.heading.textContent = session?.title || 'Transcript';
  // The header is the one thing always on screen: the strip scrolls, so the
  // current chat's chip can sit off to the side while you are reading it.
  // needs_plan_response was previously unhandled here and fell through to the
  // workspace name, which hid the one state actually blocked ON YOU.
  const headerStatus = STRIP_STATUS[session?.status] || null;
  updateNavSubtitle(
    transcriptNav.subtitle,
    session?.status === 'error'
      ? 'Error'
      : session?.status === 'working'
        ? 'Working'
        : session?.status === 'needs_plan_response'
          ? 'Waiting for you'
          : workspace?.name || 'Live',
  );
  // A still marker, matching the strip, so status is scannable rather than
  // something you have to read. Only while live: during a connection problem
  // the subtitle is reporting the connection, not the chat.
  if (state.connection === 'live' && headerStatus && session?.status !== 'error') {
    transcriptNav.subtitle.prepend(
      node('span', { className: `chip-dot ${headerStatus.dot}` }),
    );
  }
  if (state.connection === 'live' && session?.status === 'error') {
    transcriptNav.subtitle.className = 'nav-subtitle down';
    transcriptNav.subtitle.replaceChildren(
      icon('warn'),
      document.createTextNode('Error'),
    );
  }
  const bannerAnchor = captureScrollAnchor(transcriptScroll);
  if (renderBanner(transcriptBanner)) {
    const restoredBannerAnchor = restoreScrollAnchor(transcriptScroll, bannerAnchor);
    setLatestButtonVisible(
      state.shell.latestButton,
      restoredBannerAnchor.latestVisible,
    );
  }

  // Measured against the content still on screen, which is the PREVIOUS chat's
  // when a different one is being opened. Two ways that lands the reader high
  // up on a transcript instead of on the newest message:
  //
  //   1. Opening a chat while scrolled up in the last one. That distance from
  //      the end gets restored against the new chat's content, so the newest
  //      message is off screen and nothing ever asked to go there: opening a
  //      chat has no scroll-to-bottom of its own, it relies on this pinning.
  //   2. Measuring with no layout. A hidden or backgrounded scroller reports
  //      clientHeight 0, which inflates the distance by exactly one viewport,
  //      and restoring it later scrolls a full screen too high.
  //
  // Both mean the measurement is not about the content being rendered, so the
  // newest message wins instead.
  const transcriptSessionChanged =
    lastTranscriptSessionId !== state.route.sessionId;
  lastTranscriptSessionId = state.route.sessionId;
  if (transcriptSessionChanged) transcriptMovedByHand = false;
  const measurable = transcriptScroll.clientHeight > 0;
  const scrollTopBefore = transcriptScroll.scrollTop;
  const distanceBefore =
    transcriptScroll.scrollHeight -
    transcriptScroll.clientHeight -
    transcriptScroll.scrollTop;
  const pinned =
    transcriptSessionChanged ||
    !measurable ||
    !transcriptMovedByHand ||
    distanceBefore < 48;
  const messages = stableTranscriptMessages(
    state.messagesBySession.get(state.route.sessionId) || [],
    state.optimistic.filter((item) => item.sessionId === state.route.sessionId),
  );
  newestRootEventRowId = messages.reduce((newest, message) => {
    if (!['user', 'assistant', 'agent-error', 'turn-result'].includes(message.kind)) {
      return newest;
    }
    const rowId = Number(message.rowId);
    return Number.isFinite(rowId) && rowId > newest ? rowId : newest;
  }, 0);
  const { entries, toolResults } = buildFocusedTranscript(messages, {
    sessionStatus: session?.status || 'unknown',
  });
  scheduleVisibleQueuedRowRefresh(entries);
  const existingNodes = new Map(
    [...messageList.children].map((element) => [
      element.dataset.messageId,
      element,
    ]),
  );
  const desiredChildren = [];
  let previousVisibleMessage = null;
  for (const message of entries) {
    if (message.kind === 'agent-error' && message.retrying) continue;
    const messageId = String(message.id);
    const renderKey = messageRenderKey(message, toolResults);
    let rendered = existingNodes.get(messageId);
    if (!rendered || rendered.__pocketRenderKey !== renderKey) {
      rendered = renderMessage(message, toolResults);
      if (!rendered) continue;
      rendered.dataset.messageId = messageId;
      rendered.__pocketRenderKey = renderKey;
      if (!state.seenMessageIds.has(messageId) && !transcriptSessionChanged) {
        rendered.classList.add('is-new');
        rendered.addEventListener(
          'animationend',
          () => rendered.classList.remove('is-new'),
          { once: true },
        );
      }
    }
    if (
      message.kind === 'activity' &&
      (message.backgroundErrorCount > 0 || message.failedToolCount > 0)
    ) {
      const announcementId = `${messageId}:background-errors`;
      if (!state.seenMessageIds.has(announcementId)) {
        announce(
          `${activityLabel(message)}. Private action details stay on your Mac.`,
        );
        state.seenMessageIds.add(announcementId);
      }
    }
    rendered.classList.toggle(
      'is-continuation',
      isMessageContinuation(previousVisibleMessage, message),
    );
    state.seenMessageIds.add(messageId);
    desiredChildren.push(rendered);
    previousVisibleMessage = message;
  }
  if (desiredChildren.length === 0) {
    desiredChildren.push(
      renderTranscriptPlaceholder({
        selected: Boolean(state.route.sessionId),
        loading:
          Boolean(state.route.sessionId) &&
          !state.messagesBySession.has(state.route.sessionId) &&
          !state.messageBaselinesBySession.has(state.route.sessionId),
      }),
    );
  }
  reconcileMountedChildren(messageList, desiredChildren);
  renderAgentStatus(statusRow, session, messages);
  // Corrected in the SAME frame as the content change, never a frame later.
  // Reading scrollHeight forces the layout this needs, so the corrected
  // position is the first thing painted. Deferring it into a rAF meant every
  // render painted the old position and then snapped, which during streaming is
  // a jump on every update. It also made two renders in one tick fight: the
  // second measured against the first's grown content but its uncorrected
  // scrollTop, so a reader at the bottom could read as un-pinned.
  if (state.shell) {
    if (pinned) {
      transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
    } else {
      // New transcript rows append below an unpinned reader. Preserving the
      // previous scrollTop keeps the same text under their eye instead of
      // pulling them down by the height of every new update.
      if (Math.abs(scrollTopBefore - transcriptScroll.scrollTop) > 1) {
        transcriptScroll.scrollTop = Math.max(0, scrollTopBefore);
      }
    }
    // Same threshold the scroll handler uses. It was an unconditional reveal
    // against a 48px pin threshold while the handler hides below 120px, so any
    // render with the reader between the two flashed the button on and the next
    // scroll event flashed it back off.
    setLatestButtonVisible(
      state.shell.latestButton,
      transcriptScroll.scrollHeight -
        transcriptScroll.clientHeight -
        transcriptScroll.scrollTop >=
        120,
    );
    scheduleReadEvaluation();
  }
  if (transcriptSessionChanged) transitionTranscriptIn();
  renderComposerState();
  appUpdateCoordinator?.stateChanged();
}

function isMessageContinuation(previous, message) {
  if (!previous) return false;
  if (
    ['user', 'optimistic'].includes(previous.kind) ||
    ['user', 'optimistic'].includes(message.kind)
  ) {
    return false;
  }
  if (
    message.turnId &&
    previous.turnId &&
    message.turnId === previous.turnId
  ) {
    return true;
  }
  return ['assistant', 'activity', 'tool', 'agent-error'].includes(previous.kind) &&
    ['assistant', 'activity', 'tool', 'agent-error'].includes(message.kind);
}

function messageRenderKey(message, toolResults) {
  if (message.kind === 'activity') {
    const expanded = state.expandedActivities.has(message.id);
    return JSON.stringify([
      message.kind,
      message.id,
      message.running,
      message.messageCount,
      message.toolCount,
      message.failedToolCount,
      message.failedToolNames,
      message.backgroundErrorCount,
      expanded,
      expanded
        ? message.items.map((item) => [
            item.id,
            item.text,
            item.occurrenceCount,
            item.compactFailure,
            item.code,
            item.resolvedState ||
              (item.kind === 'tool'
                ? toolResults.get(item.toolCallId)?.state || item.state
                : item.state),
          ])
        : null,
    ]);
  }
  const toolResult =
    message.kind === 'tool' ? toolResults.get(message.toolCallId) : null;
  return transcriptMessageRenderIdentity(message, {
    resolvedState:
      message.kind === 'tool'
        ? toolResult?.state || message.state
        : message.state,
    newestRootEventRowId,
    deliveryAction: deliveryActionCoordinator.current(message.id),
  });
}

function offlineBannerCopy() {
  if (navigator.onLine === false) return 'This phone is offline';
  if (state.connectionError) return connectionDiagnosis().title;
  return state.lastHeartbeat
    ? `Mac unreachable · Last synced ${formatTime(state.lastHeartbeat)}`
    : 'Mac unreachable';
}

function renderBanner(container) {
  const down = state.connection === 'offline';
  // Losing the event stream only proves the stream stopped, so the banner must
  // not invent a cause. It upgrades its copy on the two things it can actually
  // prove: this phone having no network, and a request that really did fail.
  const copy =
    state.connection === 'live'
      ? ''
      : down
        ? offlineBannerCopy()
        : 'Reconnecting…';
  const renderKey = JSON.stringify([state.connection, copy]);
  if (container.dataset.renderKey === renderKey) return false;
  container.dataset.renderKey = renderKey;
  container.replaceChildren();
  if (state.connection === 'live') return true;
  const banner = node('div', {
    className: `banner ${down ? 'down' : 'wait'}`,
    role: 'status',
  }, [
    icon(down ? 'wifiOff' : 'refresh'),
    node('span', {
      className: 'banner-copy',
      text: copy,
    }),
    node('button', {
      className: 'banner-action',
      type: 'button',
      text: 'Details',
      on: { click: openConnectionSheet },
    }),
  ]);
  container.append(banner);
  return true;
}

function messageAttachments(message) {
  if (!Array.isArray(message.attachments)) return [];
  return message.attachments
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
    .map((value) => {
      const attachment = normalizeAttachmentMetadata(value);
      if (!attachment) return null;
      if (value && typeof value === 'object' && value.previewUrl) {
        attachment.previewUrl = value.previewUrl;
      }
      return attachment;
    })
    .filter(Boolean);
}

function openImagePreview(source, position, total) {
  const fallback = node('div', {
    className: 'image-preview-error',
    hidden: true,
  }, [
    icon('photo'),
    node('span', { text: 'Photo unavailable' }),
  ]);
  const image = node('img', {
    className: 'image-preview-image',
    src: source,
    alt: total > 1 ? `Photo ${position} of ${total}` : 'Attached photo',
    decoding: 'async',
  });
  image.addEventListener('error', () => {
    image.hidden = true;
    fallback.hidden = false;
  });
  openSheet(
    total > 1 ? `Photo ${position} of ${total}` : 'Photo',
    node('div', { className: 'image-preview-stage' }, [image, fallback]),
    { className: 'image-preview' },
  );
}

function renderUserImages(message, attachments) {
  if (attachments.length === 0) return null;
  const sessionId = message.sessionId || state.route.sessionId;
  const grid = node('div', {
    className: `user-image-grid count-${attachments.length}`,
  });
  attachments.forEach((attachment, index) => {
    const fullSource =
      attachment.previewUrl ||
      attachmentPreviewUrl(sessionId, attachment.id);
    const gridSource =
      attachment.previewUrl ||
      attachmentPreviewUrl(sessionId, attachment.id, {
        thumbnail: true,
      });
    const unavailable = node('span', {
      className: 'user-image-unavailable',
      hidden: true,
    }, [icon('photo'), document.createTextNode('Unavailable')]);
    const image = node('img', {
      className: 'user-image',
      src: gridSource,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      unavailable.hidden = false;
    });
    grid.append(
      node('button', {
        className: 'user-image-button',
        type: 'button',
        'aria-label':
          attachments.length > 1
            ? `Open photo ${index + 1} of ${attachments.length}`
            : 'Open attached photo',
        on: {
          click: () =>
            openImagePreview(
              fullSource,
              index + 1,
              attachments.length,
            ),
        },
      }, [image, unavailable]),
    );
  });
  return grid;
}

function renderAgentErrorGuidance(presentation) {
  const guidance = node('p');
  if (!presentation.helpUrl) {
    guidance.textContent = presentation.guidance;
    return guidance;
  }
  guidance.append(
    document.createTextNode(presentation.guidanceBefore),
    node('a', {
      href: presentation.helpUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: presentation.guidanceLink,
    }),
    document.createTextNode(presentation.guidanceAfter),
  );
  return guidance;
}

function renderMessage(message, toolResults) {
  if (message.kind === 'activity') {
    return renderActivity(message, toolResults);
  }
  if (message.kind === 'assistant') {
    const profile = richTextProfile(message.text);
    const content = addCodeCopyControls(
      renderRichText(document, message.text),
    );
    const item = node('li', {
      className: `message assistant ${message.importance === 'progress' ? 'progress' : 'primary'} is-${profile.density}`,
    });
    item.append(
      node('span', {
        className: 'sr-only',
        text:
          message.importance === 'progress'
            ? 'Conductor progress:'
            : 'Conductor replied:',
      }),
      content,
    );
    if (message.importance !== 'progress') {
      item.append(
        copyControl(message.text, {
          label: 'Copy output',
          className: 'message-copy-button',
        }),
      );
    }
    return item;
  }
  if (message.kind === 'user' || message.kind === 'optimistic') {
    const attachments = messageAttachments(message);
    const messageText =
      typeof message.text === 'string' ? message.text : '';
    const meta = node('div', {
      className: 'message-meta',
      role: 'status',
    });
    if (message.delivery === 'delivering') {
      meta.textContent =
        message.deliveryPhase === 'queued'
          ? 'Waiting for the Mac…'
          : message.deliveryPhase === 'confirming'
            ? 'Confirming delivery…'
            : message.deliveryPhase === 'automating'
              ? 'Sending through Conductor…'
              : 'Sending…';
    } else if (message.delivery === 'confirming') {
      meta.append(
        document.createTextNode('Checking delivery…'),
        node('button', {
          className: 'message-retry',
          type: 'button',
          text: 'Stop checking',
          disabled: Boolean(deliveryActionCoordinator.current(message.id)),
          'aria-label': 'Stop checking this message’s delivery',
          on: { click: () => void stopCheckingDelivery(message) },
        }),
      );
    } else if (message.delivery === 'failed') {
      const definitelyUnsent = message.definitelyUnsent === true;
      const knownTerminalFailure =
        message.errorCode === 'conductor_turn_rejected' ||
        message.errorCode === 'conductor_message_cancelled';
      const activeAction = deliveryActionCoordinator.current(message.id);
      const actionBusy = Boolean(activeAction);
      meta.classList.add(
        'terminal',
        definitelyUnsent || knownTerminalFailure ? 'failed' : 'unknown',
      );
      const summary = node('span', {
        className: 'delivery-summary',
      }, [
        icon('warn'),
        node('span', {
          text: `${knownTerminalFailure ? 'Rejected' : definitelyUnsent ? 'Not sent' : 'Delivery unknown'} · ${deliveryErrorCopy(message.errorCode, message.errorProjectName)}`,
        }),
      ]);
      const actions = node('span', { className: 'delivery-actions' });
      if (deliveryCanRetry(message)) {
        actions.append(
          node('button', {
            className: 'message-retry',
            type: 'button',
            text: 'Retry',
            disabled: actionBusy,
            'aria-busy': activeAction === 'retry' ? 'true' : null,
            'aria-label':
              activeAction === 'retry'
                ? 'Retry in progress'
                : 'Retry this message',
            on: { click: () => void retryMessage(message) },
          }),
        );
      }
      if (definitelyUnsent || knownTerminalFailure) {
        actions.append(
          node('button', {
            className: 'message-retry',
            type: 'button',
            text: 'Edit',
            disabled: actionBusy,
            'aria-busy': activeAction === 'edit' ? 'true' : null,
            'aria-label':
              activeAction === 'edit'
                ? 'Edit recovery in progress'
                : 'Move this message back to the editor',
            on: { click: () => void editFailedMessage(message) },
          }),
        );
      } else {
        actions.append(
          node('button', {
            className: 'message-retry',
            type: 'button',
            text: 'Check',
            disabled: actionBusy,
            'aria-busy': activeAction === 'check' ? 'true' : null,
            'aria-label':
              activeAction === 'check'
                ? 'Delivery check in progress'
                : 'Check this message’s delivery',
            on: {
              click: () => void checkDeliveryNow(message),
            },
          }),
          // Also offered when delivery is UNKNOWN. Editing returns the text to
          // the composer and sends nothing, so it needs no proof the message
          // failed, and withholding it was what stranded the typed text with no
          // way to get it back. Retry stays gated on proof, because that one
          // does resend.
          node('button', {
            className: 'message-retry',
            type: 'button',
            text: 'Edit',
            disabled: actionBusy,
            'aria-busy': activeAction === 'edit' ? 'true' : null,
            'aria-label':
              activeAction === 'edit'
                ? 'Edit recovery in progress'
                : 'Move this message back to the editor',
            on: { click: () => void editFailedMessage(message) },
          }),
        );
      }
      actions.append(
        node('button', {
          className: 'message-retry',
          type: 'button',
          text: 'Delete',
          disabled: actionBusy,
          'aria-busy': activeAction === 'delete' ? 'true' : null,
          'aria-label':
            activeAction === 'delete'
              ? 'Delete in progress'
              : 'Delete this delivery notice',
          on: { click: () => void discardFailedMessage(message) },
        }),
      );
      meta.append(
        summary,
        actions,
      );
      const reason =
        message.errorCode === 'workspace_project_collapsed'
          ? workspaceProjectCollapsedCopy(message.errorProjectName)
          : SEND_FAILURE_REASONS[message.errorCode] || null;
      const detail =
        typeof message.errorDetail === 'string' && message.errorDetail !== ''
          ? message.errorDetail
          : null;
      const reasonText =
        message.errorCode === 'automation_failed' && detail ? detail : reason;
      if (reasonText) {
        meta.append(
          node('span', { className: 'failure-reason', text: reasonText }),
        );
      }
    } else if (
      message.kind === 'optimistic' &&
      message.delivery === 'delivered'
    ) {
      meta.append(
        icon('checkDouble'),
        document.createTextNode('Delivered · Syncing…'),
      );
    } else if (message.queued) {
      meta.textContent = 'Queued';
    } else {
      meta.append(
        icon('checkDouble'),
        document.createTextNode(`Delivered ${formatTime(message.deliveredAt || message.sentAt || message.createdAt)}`),
      );
    }
    const content = node('div', {
      className: `user-content${attachments.length > 0 ? ' has-images' : ' text-only'}`,
    });
    const images = renderUserImages(message, attachments);
    if (images) content.append(images);
    if (messageText.trim()) {
      content.append(
        node('div', { className: 'user-bubble', text: messageText }),
      );
    }
    return node('li', {
      className: 'message user',
      'aria-label': messageText.trim()
        ? `You said ${messageText}`
        : `You sent ${attachments.length === 1 ? 'a photo' : `${attachments.length} photos`}`,
    }, [
      content,
      meta,
    ]);
  }
  if (message.kind === 'tool') {
    const result = toolResults.get(message.toolCallId);
    const stateValue = message.resolvedState || result?.state || message.state;
    const failed = stateValue === 'failed';
    const occurrenceCount = Number(message.occurrenceCount) || 1;
    const groupedFailure = failed && occurrenceCount > 1;
    const details = node('details', {
      className: `tool-card ${failed ? 'failed' : stateValue === 'running' ? 'running' : 'completed'}`,
      open: failed,
    });
    const summary = node('summary', { className: 'tool-summary' }, [
      failed
        ? icon('warn')
        : stateValue === 'running'
          ? node('span', { className: 'status-dot working' })
          : icon('terminal'),
      node('span', { className: 'tool-summary-copy', text: message.name }),
      node('span', {
        className: 'tool-duration',
        text:
          stateValue === 'running'
            ? 'Running'
            : failed
              ? groupedFailure
                ? `${occurrenceCount} failed`
                : 'Failed'
              : 'Done',
      }),
      icon('chevronDown', 'chevron'),
    ]);
    const detail = node('div', {
      className: 'tool-details',
      text:
        groupedFailure
          ? `Pocket grouped ${occurrenceCount} repeated ${message.name} failures. Sensitive inputs and full output stay on your Mac.`
          : failed
          ? 'This action failed. Sensitive inputs and full output stay on your Mac.'
          : 'Full tool inputs and outputs stay on the Mac.',
    });
    details.append(summary, detail);
    return node('li', { className: 'message tool' }, details);
  }
  if (message.kind === 'agent-error') {
    const occurrenceCount = Number(message.occurrenceCount) || 1;
    const groupedBackgroundFailure =
      message.code === 'background_action_failed' && occurrenceCount > 1;
    const presentation = agentErrorPresentation(message.code);
    const title = groupedBackgroundFailure
      ? `${occurrenceCount} background actions failed`
      : presentation.title;
    const guidance = groupedBackgroundFailure
      ? node('p', {
          text: 'Pocket grouped these repeated failures. They do not by themselves stop the main turn; open it on your Mac only if you need the private action details.',
        })
      : renderAgentErrorGuidance(presentation);
    // Superseded means the agent has produced something since, so whatever this
    // said about the current state is over. "Out of usage for this session"
    // sitting under a finished reply reads as a live state, and sent the
    // operator chasing a limit that had already reset.
    const rowId = Number(message.rowId);
    const superseded =
      Number.isFinite(rowId) && newestRootEventRowId > 0 && rowId < newestRootEventRowId;
    const card = node('li', {
      className: 'message agent-error',
      role: 'alert',
    }, [
      node('div', { className: `agent-error-row ${message.severity}` }, [
        icon('warn'),
        node('div', { className: 'agent-error-copy' }, [
          node('strong', { className: 'agent-error-title', text: title }),
          superseded ? null : guidance,
          node('code', {
            className: 'agent-error-code',
            text: presentation.code,
          }),
        ].filter(Boolean)),
      ]),
    ]);
    if (superseded) card.classList.add('is-past');
    return card;
  }
  return null;
}

function renderActivity(activity, toolResults) {
  const expanded = state.expandedActivities.has(activity.id);
  const hasErrors =
    activity.backgroundErrorCount > 0 || activity.failedToolCount > 0;
  const label = activityLabel(activity);
  const accessibleLabel = `${label}${activity.running ? ', Working' : ''}`;
  const detailsId = `activity-${String(activity.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const itemList = node('ul', {
    className: 'activity-items',
    id: detailsId,
    hidden: !expanded,
  });

  function populateItems() {
    if (itemList.childElementCount > 0) return;
    for (const item of activity.items) {
      const rendered = renderMessage(item, toolResults);
      if (rendered) itemList.append(rendered);
    }
  }
  if (expanded) populateItems();

  const card = node('div', {
    className: `activity-card${expanded ? ' is-expanded' : ''}${activity.running ? ' is-running' : ''}${hasErrors ? ' has-errors' : ''}`,
  });
  const action = node('button', {
    className: 'activity-summary',
    type: 'button',
    'aria-expanded': String(expanded),
    'aria-controls': detailsId,
    'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${accessibleLabel}`,
  }, [
    hasErrors
      ? icon('warn')
      : activity.running
        ? node('span', { className: 'status-dot working' })
        : icon('squares'),
    node('span', { className: 'activity-label', text: label }),
    node('span', {
      className: 'activity-state',
      text: activity.running ? 'Working' : '',
    }),
    icon('chevronDown', 'activity-chevron'),
  ]);

  action.addEventListener('click', () => {
    const nextExpanded = !state.expandedActivities.has(activity.id);
    if (nextExpanded) state.expandedActivities.add(activity.id);
    else state.expandedActivities.delete(activity.id);
    if (nextExpanded) populateItems();
    card.classList.toggle('is-expanded', nextExpanded);
    itemList.hidden = !nextExpanded;
    action.setAttribute('aria-expanded', String(nextExpanded));
    action.setAttribute(
      'aria-label',
      `${nextExpanded ? 'Collapse' : 'Expand'} ${accessibleLabel}`,
    );
  });

  card.append(action, itemList);
  return node('li', {
    className: 'message activity',
  }, card);
}

function renderAgentStatus(container, session, messages = []) {
  container.replaceChildren();
  container.className = '';
  const lastMeaningful = [...messages]
    .reverse()
    .find((message) => !['tool-result', 'status', 'tool'].includes(message.kind));
  if (lastMeaningful?.kind === 'agent-error' && lastMeaningful.retrying) {
    container.className = 'status-row reconnecting';
    container.append(
      node('span', { className: 'status-dot working' }),
      document.createTextNode('Reconnecting to agent'),
    );
    return;
  }
  if (session?.status === 'error') {
    if (hasCurrentTerminalAgentError(messages)) return;
    container.className = 'status-row failed';
    container.append(icon('warn'), document.createTextNode('Agent stopped with an error'));
    return;
  }
  if (session?.status !== 'working') return;
  container.className = 'status-row';
  container.append(
    node('span', { className: 'status-dot working' }),
    document.createTextNode('Working'),
  );
}

function renderComposerState() {
  if (!state.shell) return;
  const { field, send, reason, draftNote, picker } = state.shell.composer;
  const sessionId = state.route.sessionId;
  const attachments = attachmentsFor(sessionId);
  const hasText = field.value.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const hasFailedAttachment = attachments.some(
    (item) => item.state === 'failed',
  );
  const sendQueued = state.attachmentSendIntents.has(sessionId);
  const sendError = state.composerSendErrors.get(sessionId) || '';
  field.readOnly = !sessionId || sendQueued;
  const down = state.connection === 'offline';
  const draftSaved =
    !hasText || draftFor(state.route.sessionId) === field.value;
  send.hidden = down;
  reason.hidden = !down;
  picker.disabled =
    down ||
    sendQueued ||
    !sessionId ||
    attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE;
  picker.setAttribute(
    'aria-label',
    attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE
      ? 'Maximum of 4 photos added'
      : 'Add photos',
  );
  if (down) {
    reason.setAttribute('aria-label', "Can't send - Mac unreachable");
    reason.replaceChildren(icon('wifiOff'), document.createTextNode("Can't send"));
  } else {
    reason.removeAttribute('aria-label');
  }
  send.disabled =
    !sessionId ||
    sendQueued ||
    hasFailedAttachment ||
    (!hasText && !hasAttachments);
  send.classList.toggle(
    'unverified',
    (hasText || hasAttachments) && !state.connectionProbe,
  );
  send.classList.toggle('is-waiting', sendQueued);
  send.setAttribute(
    'aria-label',
    sendQueued
      ? 'Sending when photos are ready'
      : hasFailedAttachment
        ? 'Retry or remove failed photos before sending'
        : 'Send message',
  );
  draftNote.hidden = !(
    sendError ||
    sendQueued ||
    (hasText && (down || !draftSaved))
  );
  draftNote.classList.toggle('is-error', Boolean(sendError) || !draftSaved);
  draftNote.textContent =
    sendError
      ? sendError
      : sendQueued
      ? 'Finishing your photos, then sending automatically…'
      : hasText && !draftSaved
      ? 'Keep this app open — this draft couldn’t be saved'
      : down && hasText
        ? 'Draft saved on this phone'
        : '';
}

async function sendCurrentMessage() {
  const sessionId = state.route.sessionId;
  const field = state.shell?.composer.field;
  if (!sessionId || !field) return;
  state.composerSendErrors.delete(sessionId);
  let text = field.value.replace(/\r\n?/g, '\n');
  let attachments = attachmentsFor(sessionId);
  if (
    (!text.trim() && attachments.length === 0) ||
    state.connection === 'offline' ||
    state.attachmentSendIntents.has(sessionId)
  ) {
    return;
  }
  if (attachments.some((item) => item.state === 'failed')) {
    showComposerSendError(
      sessionId,
      'Not sent — retry or remove the failed photo.',
    );
    return;
  }
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    showComposerSendError(
      sessionId,
      'Not sent — remove photos until 4 remain.',
    );
    return;
  }
  const pending = attachments.filter(
    (item) => item.state !== 'ready' && item.uploadPromise,
  );
  if (pending.length > 0) {
    const queuedText = text;
    const queuedAttachmentKeys = attachments.map(
      (item) => item.localId || item.id,
    );
    state.attachmentSendIntents.add(sessionId);
    renderComposerState();
    announce(
      pending.length === 1
        ? 'Sending as soon as the photo is ready'
        : 'Sending as soon as the photos are ready',
    );
    await Promise.allSettled(
      pending.map((item) => item.uploadPromise),
    );
    if (!state.attachmentSendIntents.has(sessionId)) {
      renderComposerState();
      return;
    }
    state.attachmentSendIntents.delete(sessionId);
    attachments = attachmentsFor(sessionId);
    const currentAttachmentKeys = attachments.map(
      (item) => item.localId || item.id,
    );
    if (
      queuedAttachmentKeys.length !== currentAttachmentKeys.length ||
      queuedAttachmentKeys.some(
        (key, index) => key !== currentAttachmentKeys[index],
      )
    ) {
      showComposerSendError(
        sessionId,
        'Not sent — automatic send was canceled because the photos changed.',
      );
      return;
    }
    if (attachments.some((item) => item.state === 'failed')) {
      showComposerSendError(
        sessionId,
        'Not sent — a photo failed to upload. Tap it to retry.',
      );
      return;
    }
    if (attachments.some((item) => item.state !== 'ready')) {
      showComposerSendError(
        sessionId,
        'Not sent — a photo is still processing. Try again.',
      );
      return;
    }
    text = queuedText;
  }
  const readyAttachments = attachments
    .filter((item) => item.state === 'ready')
    .map((item) => {
      const metadata = normalizeAttachmentMetadata(item);
      return metadata
        ? {
            ...metadata,
            previewUrl: item.previewUrl || null,
          }
        : null;
    })
    .filter(Boolean);
  if (
    attachmentMessageByteLength(text, readyAttachments) >
    MAX_ATTACHMENT_MESSAGE_BYTES
  ) {
    showComposerSendError(
      sessionId,
      'Not sent — shorten the caption before sending.',
    );
    return;
  }
  if (!text.trim() && readyAttachments.length === 0) {
    showComposerSendError(
      sessionId,
      'Not sent — add text or a ready photo.',
    );
    return;
  }
  const durableDraft = draftRecordFor(sessionId);
  const draftRevision = field.dataset.draftRevision || '';
  if (
    durableDraft.text !== text ||
    durableDraft.revision !== draftRevision
  ) {
    showComposerSendError(
      sessionId,
      'Not sent: save the draft on this phone, then try again.',
    );
    return;
  }
  // Synchronous re-entrancy gate for the window between here and the field
  // clearing after the durable persist below. A second tap or an
  // auto-repeating Enter landing in that window would otherwise re-read the
  // still-populated field and send the same text twice under two different
  // idempotency keys, which the server cannot dedupe. Released after the
  // field clears (a later tap then reads an empty field), never held through
  // delivery, so composing the next message is not blocked.
  if (state.sendInFlight.has(sessionId)) return;
  state.sendInFlight.add(sessionId);
  let payloadFingerprint;
  try {
    payloadFingerprint = await draftSendPayloadFingerprint({
      text,
      attachments: readyAttachments,
    });
  } catch {
    state.sendInFlight.delete(sessionId);
    showComposerSendError(
      sessionId,
      'Not sent: this phone could not secure the message against duplicates.',
    );
    return;
  }
  const currentDraft = draftRecordFor(sessionId);
  const currentAttachmentPayload = attachmentsFor(sessionId)
    .filter((item) => item.state === 'ready')
    .map(normalizeAttachmentMetadata)
    .filter(Boolean);
  const claimedAttachmentPayload = readyAttachments
    .map(normalizeAttachmentMetadata)
    .filter(Boolean);
  if (
    state.route.sessionId !== sessionId ||
    state.shell?.composer.field !== field ||
    field.value.replace(/\r\n?/g, '\n') !== text ||
    field.dataset.draftRevision !== draftRevision ||
    currentDraft.text !== text ||
    currentDraft.revision !== draftRevision ||
    JSON.stringify(currentAttachmentPayload) !==
      JSON.stringify(claimedAttachmentPayload)
  ) {
    state.sendInFlight.delete(sessionId);
    showComposerSendError(
      sessionId,
      'Not sent: the draft changed while the send was starting. Try again.',
    );
    return;
  }
  const idempotencyKey = randomIdempotencyKey();
  const optimistic = {
    id: `optimistic:${randomIdempotencyKey()}`,
    idempotencyKey,
    activeDeliveryKey: idempotencyKey,
    kind: 'optimistic',
    sessionId,
    text,
    draftRevision,
    draftPayloadFingerprint: payloadFingerprint,
    attachments: readyAttachments,
    draftAttachmentItems: attachments,
    delivery: 'delivering',
    deliveryPhase: null,
    definitelyUnsent: false,
    deliveryRecoveryExhausted: false,
    deliveryAttempt: 1,
    createdAt: new Date().toISOString(),
  };
  state.optimistic.push(optimistic);
  try {
    const claimed = await claimDraftSendRequired(optimistic, draftRevision, payloadFingerprint);
    if (claimed?.kind === 'draft-claim-conflict') {
      state.optimistic = state.optimistic.filter(
        (item) => item !== optimistic,
      );
      state.sendInFlight.delete(sessionId);
      await restorePendingDeliveries();
      renderTranscript();
      announce(draftClaimConflictCopy(claimed));
      return;
    }
    if (!claimed) {
      state.optimistic = state.optimistic.filter(
        (item) => item !== optimistic,
      );
      state.sendInFlight.delete(sessionId);
      showComposerSendError(
        sessionId,
        'Not sent: Pocket could not secure this draft. It is still in the editor.',
      );
      return;
    }
  } catch {
    state.optimistic = state.optimistic.filter(
      (item) => item !== optimistic,
    );
    state.sendInFlight.delete(sessionId);
    showComposerSendError(
      sessionId,
      'Not sent: the message is still here because secure delivery storage is unavailable.',
    );
    return;
  }

  // The IndexedDB claim is atomic, but the composer can change in another
  // Pocket window while this window is awaiting that transaction. Re-read the
  // shared text and photo metadata after the claim. The claimed message still
  // sends, because the tap already won durable delivery authority, but a newer
  // draft must remain in the composer for the next send.
  let draftClearAuthorized = false;
  try {
    const currentDurableDraft = draftRecordFor(sessionId);
    const currentDurableAttachments = loadAttachmentDrafts().get(sessionId) || [];
    const currentPayloadFingerprint = await draftSendPayloadFingerprint({
      text: currentDurableDraft.text,
      attachments: currentDurableAttachments,
    });
    draftClearAuthorized = claimedDraftClearIsAuthorized({
      claimedRevision: draftRevision,
      claimedPayloadFingerprint: payloadFingerprint,
      currentRevision: currentDurableDraft.revision,
      currentPayloadFingerprint,
    });
  } catch {
    // If shared draft authority cannot be reread, preserve it. The durable
    // delivery claim still makes proceeding with the already-claimed send safe.
  }

  const mountedComposerStillClaimed =
    state.route.sessionId === sessionId &&
    state.shell?.composer.field === field &&
    field.dataset.draftRevision === draftRevision &&
    field.value.replace(/\r\n?/g, '\n') === text &&
    JSON.stringify(
      attachmentsFor(sessionId)
        .filter((item) => item.state === 'ready')
        .map(normalizeAttachmentMetadata)
        .filter(Boolean),
    ) === JSON.stringify(claimedAttachmentPayload);
  let clearedDraft = null;
  let durableDraftCleared = false;
  if (draftClearAuthorized) {
    clearedDraft = saveDraft(sessionId, '', {
      expectedRevision: draftRevision,
    });
    if (clearedDraft) {
      durableDraftCleared = persistAttachmentDrafts({
        sessionId,
        items: [],
      });
    }
    if (durableDraftCleared) {
      state.attachmentsBySession.delete(sessionId);
    }
  }
  if (
    durableDraftCleared &&
    mountedComposerStillClaimed
  ) {
    field.value = '';
    field.dataset.draftRevision = clearedDraft.revision;
    state.shell.composer.resize();
  }
  renderComposerAttachments();
  renderTranscript();
  state.sendInFlight.delete(sessionId);
  await deliverOptimistic(optimistic, { deliveryIdentityPersisted: true });
}

function restoredAttachmentItems(optimistic, errorCode) {
  const originals =
    Array.isArray(optimistic.draftAttachmentItems) &&
    optimistic.draftAttachmentItems.length > 0
      ? optimistic.draftAttachmentItems
      : (optimistic.attachments || []).map((attachment) => ({
          ...attachment,
          localId: `restored:${attachment.id}`,
          state: 'ready',
          restored: true,
        }));
  const unavailable = new Set([
    'attachment_unavailable',
    'session_route_changed',
    'workspace_path_unavailable',
    'workspace_sandbox_unsupported',
  ]).has(errorCode);
  return originals.map((item) => {
    item.removed = false;
    item.controller = null;
    item.uploadInFlight = false;
    item.uploadPromise = null;
    if (unavailable) {
      item.state = 'failed';
      item.errorCode = 'attachment_unavailable';
    } else {
      item.state = 'ready';
      item.errorCode = null;
    }
    return item;
  });
}

async function markDefinitelyUnsent(optimistic, error) {
  optimistic.delivery = 'failed';
  optimistic.deliveryPhase = null;
  optimistic.errorCode = error.code;
  optimistic.errorProjectName = safeCollapsedProjectName(error.projectName);
  optimistic.retrySafe = error.retrySafe === true;
  optimistic.definitelyUnsent = true;
  optimistic.deliveryRecoveryExhausted = true;
  await persistPendingDeliveries({ upserts: [optimistic] });
  renderTranscript();
  announce(
    `Message was not sent. ${deliveryErrorCopy(error.code, error.projectName)}`,
  );
}

async function deliverOptimistic(
  optimistic,
  {
    replaceDraft = false,
    expectedMacDraft = optimistic.macDraft,
    deliveryIdentityPersisted = false,
  } = {},
) {
  const previousDeliveryKey = optimistic.activeDeliveryKey;
  const previousReplaceDraft = optimistic.replaceDraft === true;
  optimistic.replaceDraft = replaceDraft;
  optimistic.deliveryRecoveryExhausted = false;
  if (replaceDraft && !optimistic.replaceIdempotencyKey) {
    optimistic.replaceIdempotencyKey = randomIdempotencyKey();
  }
  const deliveryKey = replaceDraft
    ? optimistic.replaceIdempotencyKey
    : optimistic.idempotencyKey;
  optimistic.activeDeliveryKey = deliveryKey;
  const deliveryIdentityChanged =
    previousDeliveryKey !== deliveryKey ||
    previousReplaceDraft !== replaceDraft;
  if (!deliveryIdentityPersisted || deliveryIdentityChanged) {
    try {
      await persistPendingDeliveries({
        required: true,
        upserts: [optimistic],
        deliveryKeyTransitions:
          previousDeliveryKey !== deliveryKey
            ? [{
                id: optimistic.id,
                deliveryAttempt: optimistic.deliveryAttempt,
                from: previousDeliveryKey,
                to: deliveryKey,
              }]
            : [],
      });
    } catch {
      optimistic.delivery = 'failed';
      optimistic.errorCode = 'secure_delivery_storage_unavailable';
      optimistic.retrySafe = true;
      optimistic.definitelyUnsent = true;
      optimistic.deliveryPhase = null;
      renderTranscript();
      return;
    }
  }
  deliveryPostsInFlight.add(optimistic.id);
  let progressActive = true;
  let progressSettled = false;
  const deliveryController = new AbortController();
  const deliveryTimeout = setTimeout(
    () => deliveryController.abort(),
    DELIVERY_POST_TIMEOUT_MS,
  );
  void watchDeliveryProgress(
    optimistic,
    () => progressActive,
    async (delivery) => {
      if (
        !progressActive ||
        progressSettled ||
        optimistic.delivery !== 'delivering'
      ) {
        return false;
      }
      progressSettled = true;
      progressActive = false;
      deliveryController.abort();
      await settleTerminalDeliveryStatus(optimistic, delivery);
      return true;
    },
  );
  try {
    const result = await fetch(
      `/api/sessions/${encodeURIComponent(optimistic.sessionId)}/messages`,
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: deliveryController.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': state.csrfToken,
          'Idempotency-Key': deliveryKey,
          'X-Pocket-Shell-Revision': CLIENT_SHELL_REVISION,
        },
        body: JSON.stringify({
          message: optimistic.text,
          attachments: (optimistic.attachments || []).map(
            (attachment) => attachment.id,
          ),
          replaceDraft,
          expectedMacDraft: replaceDraft ? expectedMacDraft : undefined,
        }),
      },
    );
    const payload = await result.json().catch(() => ({}));
    if (progressSettled) return;
    if (!result.ok) {
      const error = new Error(payload.error?.code || `http_${result.status}`);
      error.code = payload.error?.code || `http_${result.status}`;
      error.status = result.status;
      error.draft = payload.error?.draft;
      error.retrySafe = payload.error?.retrySafe === true;
      error.definitelyUnsent =
        payload.error?.definitelyUnsent === true;
      error.final = payload.error?.final === true;
      error.messageId =
        typeof payload.error?.messageId === 'string' &&
        payload.error.messageId.length > 0 &&
        payload.error.messageId.length <= 200
          ? payload.error.messageId
          : null;
      error.rowId = Number.isSafeInteger(payload.error?.rowId)
        ? payload.error.rowId
        : null;
      error.detail =
        typeof payload.error?.detail === 'string'
          ? payload.error.detail.slice(0, 300)
          : null;
      error.projectName = safeCollapsedProjectName(payload.error?.projectName);
      throw error;
    }
    applyDeliveryReceipt(optimistic, payload);
    const persistence = persistPendingDeliveries({
      upserts: [optimistic],
    });
    state.connectionProbe = {
      sendPath: true,
      capabilities: { send: true },
    };
    renderTranscript();
    announce('Message delivered');
    void refreshMessages(optimistic.sessionId, { full: true });
    await persistence;
  } catch (error) {
    if (progressSettled) return;
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('delivery_confirmation_timeout');
      timeoutError.code = 'delivery_confirmation_timeout';
      timeoutError.retrySafe = false;
      timeoutError.definitelyUnsent = false;
      error = timeoutError;
    }
    optimistic.errorCode = error.code;
    applyDeliveryReceiptIdentity(optimistic, error);
    optimistic.deliveryPhase = null;
    optimistic.definitelyUnsent = error.definitelyUnsent === true;
    optimistic.errorDetail =
      typeof error.detail === 'string' && error.detail !== ''
        ? error.detail
        : null;
    optimistic.errorProjectName = safeCollapsedProjectName(error.projectName);
    if (error.definitelyUnsent === true) {
      await markDefinitelyUnsent(optimistic, error);
      if (error.status === 401 || error.status === 423) {
        handleRuntimeError(error);
      }
    } else if (error.code === 'draft_conflict') {
      optimistic.delivery = 'failed';
      optimistic.retrySafe = true;
      optimistic.definitelyUnsent = true;
      optimistic.deliveryRecoveryExhausted = true;
      optimistic.macDraft = error.draft;
      if (replaceDraft) optimistic.replaceIdempotencyKey = null;
      optimistic.replaceDraft = false;
      await persistPendingDeliveries({ upserts: [optimistic] });
      renderTranscript();
      if (optimistic.origin === 'macDraft') {
        // This entry's text belongs to the Mac composer, not the phone. The
        // conflict sheet would label it "from this phone" and offer to
        // overwrite the phone composer with it, so a re-conflict (the Mac
        // draft changed between reading and sending) settles as a plain
        // retryable failure instead.
        announce('The Mac draft changed before it could send. Nothing was replaced.');
      } else {
        openDraftConflict(optimistic);
      }
    } else if (error.final === true) {
      optimistic.delivery = 'failed';
      optimistic.retrySafe = false;
      optimistic.definitelyUnsent = false;
      optimistic.deliveryRecoveryExhausted = true;
      await persistPendingDeliveries({ upserts: [optimistic] });
      renderTranscript();
      announce(deliveryErrorCopy(error.code, error.projectName));
    } else if (error.status === 401 || error.status === 423) {
      optimistic.delivery = 'failed';
      optimistic.retrySafe = false;
      optimistic.deliveryRecoveryExhausted = true;
      await persistPendingDeliveries({ upserts: [optimistic] });
      renderTranscript();
      handleRuntimeError(error);
    } else {
      await checkDelivery(optimistic);
    }
  } finally {
    clearTimeout(deliveryTimeout);
    progressActive = false;
    deliveryPostsInFlight.delete(optimistic.id);
  }
}

function applyDeliveryReceiptIdentity(message, receipt) {
  message.receiptBaselineCursor = Number.isSafeInteger(receipt.baselineCursor)
    ? receipt.baselineCursor
    : message.receiptBaselineCursor || null;
  message.receiptRowId = Number.isSafeInteger(receipt.rowId)
    ? receipt.rowId
    : message.receiptRowId || null;
  message.receiptMessageId =
    typeof receipt.messageId === 'string' && receipt.messageId.length > 0
      ? receipt.messageId
      : message.receiptMessageId || null;
}

function applyDeliveryReceipt(message, receipt) {
  message.delivery = 'delivered';
  message.deliveredAt = receipt.deliveredAt;
  applyDeliveryReceiptIdentity(message, receipt);
  message.receiptObservedAt = null;
  message.retrySafe = false;
  message.definitelyUnsent = false;
  message.deliveryRecoveryExhausted = false;
  message.errorCode = null;
  message.errorProjectName = null;
  message.deliveryPhase = null;
  for (const attachment of message.attachments || []) {
    releaseAttachmentPreview(attachment);
  }
  for (const item of message.draftAttachmentItems || []) {
    releaseAttachmentResources(item);
    releaseAttachmentPreview(item);
  }
  message.draftAttachmentItems = null;
}

async function verifyMissingDeliveryReceipt(message) {
  if (
    missingReceiptChecks.has(message.id) ||
    message.delivery !== 'delivered' ||
    !state.optimistic.includes(message)
  ) {
    return;
  }
  const check = (async () => {
    try {
      const delivery = await requestDeliveryStatus(message);
      if (
        message.delivery === 'delivered' &&
        state.optimistic.includes(message) &&
        deliveryStatusIsTerminal(delivery)
      ) {
        await settleTerminalDeliveryStatus(message, delivery);
      }
    } catch {
      // The next live refresh can retry this read-only receipt check.
    }
  })().finally(() => {
    missingReceiptChecks.delete(message.id);
  });
  missingReceiptChecks.set(message.id, check);
  await check;
}

async function verifyStalledDeliveredReceipt(message) {
  if (
    stalledReceiptChecks.has(message.id) ||
    message.delivery !== 'delivered' ||
    Number.isFinite(message.receiptObservedAt) ||
    !state.optimistic.includes(message)
  ) {
    return;
  }
  const deliveredAt = Date.parse(message.deliveredAt || '');
  if (!Number.isFinite(deliveredAt)) return;
  const check = (async () => {
    const remaining = deliveredAt + DELIVERY_RECEIPT_STALL_MS - Date.now();
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    if (
      message.delivery !== 'delivered' ||
      Number.isFinite(message.receiptObservedAt) ||
      !state.optimistic.includes(message)
    ) {
      return;
    }
    let delivery;
    try {
      delivery = await requestDeliveryStatus(message);
    } catch {
      return;
    }
    if (
      delivery?.state === 'failed' &&
      deliveryStatusIsTerminal(delivery)
    ) {
      await settleTerminalDeliveryStatus(message, delivery);
      announce(deliveryErrorCopy(message.errorCode, message.errorProjectName));
      return;
    }
    if (
      delivery?.state !== 'delivered' ||
      delivery.messageId !== message.receiptMessageId ||
      delivery.rowId !== message.receiptRowId
    ) {
      return;
    }
    await refreshMessages(message.sessionId, { full: true });
    const transcriptReceipt = receiptTranscriptDisposition(
      delivery,
      state.messagesBySession.get(message.sessionId) || [],
    );
    if (
      message.delivery !== 'delivered' ||
      Number.isFinite(message.receiptObservedAt) ||
      !state.optimistic.includes(message) ||
      transcriptReceipt === 'unresolved'
    ) {
      return;
    }
    let observed;
    try {
      observed = await transitionPendingDeliveryRequired({
        type: 'observe-stalled-receipt',
        message,
        messageId: delivery.messageId,
        rowId: delivery.rowId,
        observedAt: Date.now(),
      });
    } catch {
      return;
    }
    if (!observed) {
      await restorePendingDeliveries();
      return;
    }
    message.receiptObservedAt = observed.receiptObservedAt;
    if (state.route.sessionId === message.sessionId) renderTranscript();
    await observeDeliveredReceipt(message);
  })().finally(() => {
    if (stalledReceiptChecks.get(message.id) === check) {
      stalledReceiptChecks.delete(message.id);
    }
  });
  stalledReceiptChecks.set(message.id, check);
  await check;
}

async function observeDeliveredReceipt(message) {
  if (
    deliveryReceiptObservations.has(message.id) ||
    message.delivery !== 'delivered' ||
    !Number.isFinite(message.receiptObservedAt) ||
    !state.optimistic.includes(message)
  ) {
    return;
  }
  const observedAt = message.receiptObservedAt;
  const deadline = observedAt + DELIVERY_RECEIPT_OBSERVATION_MS;
  const observation = (async () => {
    while (
      message.delivery === 'delivered' &&
      state.optimistic.includes(message)
    ) {
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(remaining, DELIVERY_RECEIPT_OBSERVATION_POLL_MS),
          ),
        );
      }
      if (
        message.delivery !== 'delivered' ||
        !state.optimistic.includes(message)
      ) {
        return;
      }
      let delivery;
      try {
        delivery = await requestDeliveryStatus(message);
      } catch {
        if (Date.now() >= deadline) return;
        continue;
      }
      if (
        delivery?.state === 'failed' &&
        deliveryStatusIsTerminal(delivery)
      ) {
        await settleTerminalDeliveryStatus(message, delivery);
        announce(deliveryErrorCopy(message.errorCode, message.errorProjectName));
        await refreshMessages(message.sessionId, { full: true });
        return;
      }
      if (delivery?.state !== 'delivered' || Date.now() < deadline) {
        continue;
      }
      let expired;
      try {
        expired = await transitionPendingDeliveryRequired({
          type: 'expire-receipt',
          message,
          observedAt,
        });
      } catch {
        return;
      }
      if (!expired) {
        await restorePendingDeliveries();
      } else {
        state.optimistic = state.optimistic.filter(
          (candidate) => candidate !== message,
        );
      }
      if (state.route.sessionId === message.sessionId) renderTranscript();
      return;
    }
  })().finally(() => {
    if (deliveryReceiptObservations.get(message.id) === observation) {
      deliveryReceiptObservations.delete(message.id);
    }
  });
  deliveryReceiptObservations.set(message.id, observation);
  await observation;
}

async function requestDeliveryStatus(message) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DELIVERY_STATUS_REQUEST_MS,
  );
  try {
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(message.sessionId)}/delivery-status`,
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': state.csrfToken,
          'Idempotency-Key':
            message.activeDeliveryKey || message.idempotencyKey,
          'X-Pocket-Shell-Revision': CLIENT_SHELL_REVISION,
        },
      },
    );
    return await readDeliveryStatusResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function settleTerminalDeliveryStatus(message, delivery) {
  if (delivery.state === 'delivered') {
    applyDeliveryReceipt(message, delivery);
    await persistPendingDeliveries({ upserts: [message] });
    state.connectionProbe = {
      sendPath: true,
      capabilities: { send: true },
    };
    renderTranscript();
    announce('Message delivered');
    await refreshMessages(message.sessionId, { full: true });
    return true;
  }
  // An 'absent' ledger entry is deliberately NOT treated as proof the message
  // was never sent. It looks like proof and is not: the ledger evicts on
  // CAPACITY as well as age (#makeRoomFor, 2048 entries, sorted by expiry and
  // ignoring how old an entry is), so a delivered receipt can be dropped early,
  // and an age check cannot see that. Acting on it would resend a message that
  // already went out, which is worse than the problem it was meant to solve.
  // Recovering the typed text is handled by making Edit available for ambiguous
  // failures instead, which returns the text to the composer without sending
  // anything and leaves the decision to a human who can see the transcript.
  if (delivery.state === 'failed') {
    if (!deliveryStatusIsTerminal(delivery)) return false;
    const previousDelivery = message.delivery;
    applyDeliveryReceiptIdentity(message, delivery);
    message.errorCode = delivery.code || 'delivery_unknown';
    message.errorProjectName = safeCollapsedProjectName(delivery.projectName);
    message.delivery = 'failed';
    message.deliveryPhase = null;
    message.retrySafe = delivery.retrySafe === true;
    message.definitelyUnsent = delivery.retrySafe === true;
    message.deliveryRecoveryExhausted = true;
    await persistPendingDeliveries({
      upserts: [message],
      deliveryStateTransitions: authorizedDeliveryStateTransition(
        message,
        previousDelivery,
      ),
    });
    renderTranscript();
    return true;
  }
  return false;
}

async function watchDeliveryProgress(message, isActive, onTerminal) {
  await new Promise((resolve) =>
    setTimeout(resolve, DELIVERY_PROGRESS_POLL_MS),
  );
  const phases = new Set(['queued', 'automating', 'confirming']);
  while (isActive() && message.delivery === 'delivering') {
    try {
      const delivery = await requestDeliveryStatus(message);
      if (
        deliveryStatusIsTerminal(delivery) &&
        await onTerminal(delivery)
      ) {
        return;
      }
      if (
        delivery.state === 'pending' &&
        phases.has(delivery.phase) &&
        message.deliveryPhase !== delivery.phase
      ) {
        message.deliveryPhase = delivery.phase;
        renderTranscript();
      }
    } catch {
      // The POST remains authoritative; progress polling is advisory only.
    }
    if (!isActive() || message.delivery !== 'delivering') return;
    await new Promise((resolve) =>
      setTimeout(resolve, DELIVERY_PROGRESS_POLL_MS),
    );
  }
}

async function checkDeliveryNow(message) {
  if (message?.kind !== 'optimistic' || message.delivery !== 'failed') {
    return false;
  }
  cancelDeliveryRecovery(message);
  const result = await deliveryActionCoordinator.run(
    message.id,
    'check',
    async () => {
      announce('Checking delivery...');
      try {
        const authoritative =
          await readAuthoritativePendingDeliveryRequired(message);
        if (!authoritative) {
          state.optimistic = state.optimistic.filter(
            (candidate) => candidate !== message,
          );
          renderTranscript();
          announce('This delivery was already resolved in another Pocket window.');
          return false;
        }
        applyAuthoritativePendingDelivery(message, authoritative);
        if (message.delivery !== 'failed') {
          renderTranscript();
          announce('This delivery changed in another Pocket window.');
          return false;
        }
        const checkedIdentity = { ...message };
        const delivery = await requestDeliveryStatus(message);
        const current = await readAuthoritativePendingDeliveryRequired(message);
        if (!samePendingDeliveryIdentity(current, checkedIdentity)) {
          if (current) applyAuthoritativePendingDelivery(message, current);
          else {
            state.optimistic = state.optimistic.filter(
              (candidate) => candidate !== message,
            );
          }
          renderTranscript();
          announce('This delivery changed in another Pocket window.');
          return false;
        }
        const disposition = terminalDeliveryActionDisposition(delivery);
        if (disposition === 'resolved') {
          await settleTerminalDeliveryStatus(message, delivery);
          return true;
        }
        if (disposition === 'actionable') {
          await settleTerminalDeliveryStatus(message, delivery);
          announce(
            message.definitelyUnsent === true
              ? `Message was not sent. ${deliveryErrorCopy(message.errorCode, message.errorProjectName)}`
              : 'Delivery is still unconfirmed. Edit the text if you need it.',
          );
          return false;
        }
        if (disposition === 'pending') {
          const previousDelivery = message.delivery;
          message.delivery = 'confirming';
          message.deliveryPhase = delivery.phase || 'queued';
          message.retrySafe = false;
          message.definitelyUnsent = false;
          await persistPendingDeliveries({
            upserts: [message],
            deliveryStateTransitions: authorizedDeliveryStateTransition(
              message,
              previousDelivery,
            ),
          });
          renderTranscript();
          void checkDelivery(message, { force: true }).catch(() => {});
          announce('This message is still sending on the Mac. Pocket will keep checking.');
          return false;
        }
        announce('Still unconfirmed. Check again later or edit the text.');
        return false;
      } catch {
        announce('Could not check delivery right now. Try again later.');
        return false;
      }
    },
  );
  return result.value;
}

function checkDelivery(message, { force = false } = {}) {
  const key = message?.id;
  if (typeof key !== 'string') return Promise.resolve(false);
  const existing = deliveryRecoveryInFlight.get(key);
  if (existing) {
    if (existing.cancelled && force) existing.restartRequested = true;
    return existing.operation;
  }
  let resolveOperation;
  let rejectOperation;
  const operation = new Promise((resolve, reject) => {
    resolveOperation = resolve;
    rejectOperation = reject;
  });
  const entry = {
    key,
    message,
    force,
    cancelled: false,
    restartRequested: false,
    operation,
    resolve: resolveOperation,
    reject: rejectOperation,
  };
  deliveryRecoveryInFlight.set(key, entry);
  if (force) deliveryRecoveryQueue.unshift(entry);
  else deliveryRecoveryQueue.push(entry);
  drainDeliveryRecoveryQueue();
  return operation;
}

function cancelDeliveryRecovery(message) {
  const key = message?.id;
  if (typeof key !== 'string') return;
  const entry = deliveryRecoveryInFlight.get(key);
  if (entry) entry.cancelled = true;
}

function deliveryRecoveryEntryIsCurrent(entry) {
  return (
    entry?.cancelled !== true &&
    deliveryRecoveryInFlight.get(entry?.key) === entry &&
    state.optimistic.includes(entry?.message)
  );
}

async function refreshDeliveryRecoveryAuthority(entry) {
  let authoritative;
  try {
    authoritative = await readAuthoritativePendingDeliveryRequired(
      entry.message,
    );
  } catch {
    return false;
  }
  if (!authoritative) {
    entry.cancelled = true;
    state.optimistic = state.optimistic.filter(
      (candidate) => candidate !== entry.message,
    );
    renderTranscript();
    return false;
  }
  if (!samePendingDeliveryIdentity(authoritative, entry.message)) {
    entry.cancelled = true;
    applyAuthoritativePendingDelivery(entry.message, authoritative);
    renderTranscript();
    return false;
  }
  applyAuthoritativePendingDelivery(entry.message, authoritative);
  return deliveryRecoveryEntryIsCurrent(entry);
}

function drainDeliveryRecoveryQueue() {
  while (
    activeDeliveryRecoveryCount < MAX_CONCURRENT_DELIVERY_RECOVERIES &&
    deliveryRecoveryQueue.length > 0
  ) {
    const entry = deliveryRecoveryQueue.shift();
    activeDeliveryRecoveryCount += 1;
    void checkDeliveryOnce(entry)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        const restart =
          entry.restartRequested === true &&
          state.optimistic.includes(entry.message);
        if (deliveryRecoveryInFlight.get(entry.key) === entry) {
          deliveryRecoveryInFlight.delete(entry.key);
        }
        activeDeliveryRecoveryCount -= 1;
        if (restart) {
          void checkDelivery(entry.message, { force: true }).catch(() => {});
        }
        drainDeliveryRecoveryQueue();
      });
  }
}

async function checkDeliveryOnce(entry) {
  const message = entry.message;
  const locallyRearmed = message.deliveryRecoveryExhausted === false;
  if (!deliveryRecoveryEntryIsCurrent(entry)) return false;
  if (!(await refreshDeliveryRecoveryAuthority(entry))) return false;
  if (entry.force || locallyRearmed) rearmDeliveryRecovery(message);
  if (!deliveryNeedsAutomaticRecovery(message)) {
    return message.delivery === 'delivered';
  }
  const previousDelivery = message.delivery;
  message.delivery = 'confirming';
  message.deliveryPhase = 'confirming';
  message.retrySafe = false;
  message.definitelyUnsent = false;
  message.deliveryRecoveryExhausted = false;
  message.errorCode = null;
  const persisted = await persistPendingDeliveries({
    required: true,
    upserts: [message],
    deliveryStateTransitions: authorizedDeliveryStateTransition(
      message,
      previousDelivery,
    ),
  }).catch(() => null);
  if (
    !pendingDeliveryMessages(persisted, {
      sanitize: sanitizePendingDelivery,
    }).some((candidate) => samePendingDeliveryIdentity(candidate, message))
  ) {
    await restorePendingDeliveries();
    return false;
  }
  if (!deliveryRecoveryEntryIsCurrent(entry)) return false;
  renderTranscript();
  let deadline = Date.now() + DELIVERY_RECOVERY_MS;
  let lastErrorCode = null;
  let lastDeliveryCode = null;
  let inconclusiveChecks = 0;
  let firstCheck = true;
  while (firstCheck || Date.now() < deadline) {
    if (!deliveryRecoveryEntryIsCurrent(entry)) return false;
    if (!(await refreshDeliveryRecoveryAuthority(entry))) return false;
    firstCheck = false;
    try {
      const delivery = await requestDeliveryStatus(message);
      if (!deliveryRecoveryEntryIsCurrent(entry)) return false;
      if (!(await refreshDeliveryRecoveryAuthority(entry))) return false;
      lastErrorCode = null;
      if (await settleTerminalDeliveryStatus(message, delivery)) {
        return delivery.state === 'delivered';
      }
      // A durable pending result proves this send is still waiting in the
      // relay queue. Keep its recovery lease alive so a later accepted send
      // cannot age into a false failure while earlier Mac work completes.
      deadline = extendDeliveryRecoveryDeadline(
        delivery,
        deadline,
        Date.now(),
        DELIVERY_RECOVERY_MS,
      );
      const decision = deliveryRecoveryDecision(
        delivery,
        inconclusiveChecks,
      );
      inconclusiveChecks = decision.inconclusiveChecks;
      if (delivery.state === 'failed' && delivery.code) {
        lastDeliveryCode = delivery.code;
      } else if (delivery.state === 'unknown') {
        lastDeliveryCode = delivery.code || 'delivery_unknown';
      } else if (delivery.state === 'pending') {
        lastDeliveryCode = null;
      } else {
        lastDeliveryCode = delivery.code || 'delivery_unknown';
      }
    } catch (error) {
      if (!deliveryRecoveryEntryIsCurrent(entry)) return false;
      if (error.status === 401 || error.status === 423) {
        message.delivery = 'failed';
        message.errorCode = error.code;
        message.retrySafe = false;
        message.definitelyUnsent = false;
        message.deliveryRecoveryExhausted = true;
        message.deliveryPhase = null;
        await persistPendingDeliveries({ upserts: [message] });
        renderTranscript();
        handleRuntimeError(error);
        return false;
      }
      lastErrorCode = safeDeliveryErrorCode(
        typeof error?.code === 'string'
          ? error.code
          : error?.name === 'AbortError'
            ? 'delivery_confirmation_timeout'
            : 'delivery_unknown',
      );
      const decision = deliveryRecoveryDecision(
        { state: 'unknown' },
        inconclusiveChecks,
      );
      inconclusiveChecks = decision.inconclusiveChecks;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(DELIVERY_RECOVERY_POLL_MS, remaining)),
      );
    }
  }
  if (!deliveryRecoveryEntryIsCurrent(entry)) return false;
  // One automatic recovery epoch has ended. A timer must not immediately
  // start another 120 second poll loop. Foreground, online, stream, and manual
  // Check events explicitly rearm this receipt.
  message.delivery = 'failed';
  message.errorCode = safeDeliveryErrorCode(
    lastDeliveryCode ||
      lastErrorCode ||
      'delivery_confirmation_timeout',
  );
  message.retrySafe = false;
  message.definitelyUnsent = false;
  message.deliveryRecoveryExhausted = true;
  message.deliveryPhase = null;
  await persistPendingDeliveries({ upserts: [message] });
  renderTranscript();
  return false;
}

async function recoverPendingDeliveries() {
  await Promise.all(
    state.optimistic.map(async (message) => {
      if (message.delivery === 'delivered') {
        await refreshMessages(message.sessionId, { full: true });
      } else if (deliveryNeedsAutomaticRecovery(message)) {
        await checkDelivery(message);
      }
    }),
  );
}

function recheckAmbiguousDeliveries(
  sessionId = null,
  { settlementOnly = false } = {},
) {
  for (const message of state.optimistic) {
    const recoveryNeeded = settlementOnly
      ? deliveryBackstopNeedsRecovery(message, {
        activePost: deliveryPostsInFlight.has(message.id),
      })
      : deliveryNeedsAutomaticRecovery(message);
    if (
      (sessionId === null || message.sessionId === sessionId) &&
      recoveryNeeded &&
      message.definitelyUnsent !== true
    ) {
      void checkDelivery(message).catch(() => {});
    }
  }
}

function rearmAmbiguousDeliveries(sessionId = null) {
  const rearmed = state.optimistic.filter(
    (message) =>
      (sessionId === null || message.sessionId === sessionId) &&
      rearmDeliveryRecovery(message),
  );
  if (rearmed.length > 0) {
    void persistPendingDeliveries({ upserts: rearmed }).catch(() => {});
  }
  return rearmed.length;
}

async function retryMessage(message) {
  // These three gates used to return silently, so tapping Retry could do
  // literally nothing with no explanation: the button was there, the finger
  // landed on it, and the app said nothing at all. Every exit now reports.
  if (!deliveryCanRetry(message)) {
    announce(
      message?.definitelyUnsent === true
        ? 'This one cannot be retried automatically. Edit it and send again.'
        : 'Not retried, because it is not certain this message failed to send.',
    );
    return false;
  }
  cancelDeliveryRecovery(message);
  const result = await deliveryActionCoordinator.run(
    message.id,
    'retry',
    async () => {
      announce('Retrying...');
      let retry;
      try {
        retry = await runDefinitelyUnsentRetry({
          message,
          canRetry: deliveryCanRetry,
          claim: (candidate) =>
            claimTerminalDeliveryActionRequired(candidate, 'retry'),
          apply: (claimed) => {
            applyAuthoritativePendingDelivery(message, claimed);
          },
          deliver: () => {
            void deliverOptimistic(message, {
              replaceDraft: message.replaceDraft === true,
              deliveryIdentityPersisted: true,
            });
          },
        });
      } catch {
        announce('Could not safely retry this message yet. Try again.');
        return false;
      }
      if (retry.status === 'not-retryable') {
        announce('This delivery changed. Check the chat before sending again.');
        return false;
      }
      if (retry.status === 'conflict') {
        announce('This delivery changed in another Pocket window.');
        await restorePendingDeliveries();
        renderTranscript();
        return false;
      }
      renderTranscript();
      return true;
    },
  );
  return result.value;
}

// Every conflict-sheet action first verifies this delivery is still the
// authoritative terminal record and claims it. Two Pocket windows can show
// the same sheet, and the claim is what keeps them from both acting on it.
async function claimConflictAction(message, action) {
  cancelDeliveryRecovery(message);
  const result = await deliveryActionCoordinator.run(
    message.id,
    action,
    async () => {
      if (!(await verifyTerminalDeliveryAction(message))) {
        closeOverlay();
        return null;
      }
      let claimed;
      try {
        claimed = await claimTerminalDeliveryActionRequired(message, action);
      } catch {
        announce('Could not safely send this message yet. Try again.');
        return null;
      }
      if (!claimed) {
        announce('This delivery changed in another Pocket window.');
        await restorePendingDeliveries();
        closeOverlay();
        renderTranscript();
        return null;
      }
      applyAuthoritativePendingDelivery(message, claimed);
      closeOverlay();
      renderTranscript();
      return claimed;
    },
  );
  return result.value;
}

const draftConflictFlow = createDraftConflictFlow({
  deliver: (optimistic, options) => deliverOptimistic(optimistic, options),
  makeOptimistic: (sessionId, text) => {
    const idempotencyKey = randomIdempotencyKey();
    return {
      id: `optimistic:${randomIdempotencyKey()}`,
      idempotencyKey,
      activeDeliveryKey: idempotencyKey,
      kind: 'optimistic',
      sessionId,
      text,
      attachments: [],
      draftAttachmentItems: null,
      delivery: 'delivering',
      createdAt: new Date().toISOString(),
    };
  },
  insertBefore: (entry, reference) => {
    const at = state.optimistic.indexOf(reference);
    state.optimistic.splice(at === -1 ? state.optimistic.length : at, 0, entry);
  },
  remove: (entry) => {
    state.optimistic = state.optimistic.filter((item) => item !== entry);
  },
  // Merged, never overwritten: a conflict can come back tens of seconds
  // after the send, and the user may have typed something new in the phone
  // composer meanwhile. Same combined-draft shape restoreDefinitelyUnsentDraft
  // uses: restored text first, newer typing after, no duplication when they
  // already match.
  restoreComposer: (sessionId, text) => {
    const current =
      state.route.sessionId === sessionId && state.shell?.composer.field
        ? state.shell.composer.field.value
        : draftFor(sessionId);
    const combined = mergeRecoveredDraftText(text, current);
    const savedDraft = saveDraft(sessionId, combined);
    if (!savedDraft) return false;
    if (state.route.sessionId === sessionId && state.shell?.composer.field) {
      state.shell.composer.field.value = combined;
      state.shell.composer.field.dataset.draftRevision =
        savedDraft.revision;
      state.shell.composer.resize();
    }
    return true;
  },
  // Same merge restoreDefinitelyUnsentDraft uses: without it, photos on the
  // conflicted phone message silently vanish (and their server-side uploads
  // leak) whenever the resolution returns the message to the composer.
  restoreAttachments: (optimistic) => {
    const restoredItems = restoredAttachmentItems(optimistic, null);
    if (restoredItems.length === 0) return true;
    const currentItems = attachmentsFor(optimistic.sessionId);
    const mergedItems = mergeRecoveredAttachmentItems(
      restoredItems,
      currentItems,
    );
    const attachmentsPersisted = persistAttachmentDrafts({
      sessionId: optimistic.sessionId,
      items: mergedItems,
    });
    if (!attachmentsPersisted) return false;
    state.attachmentsBySession.set(optimistic.sessionId, mergedItems);
    optimistic.draftAttachmentItems = null;
    renderComposerAttachments();
    return true;
  },
  persist: (options) => persistPendingDeliveries(options),
  render: () => renderTranscript(),
  announce,
});

function openDraftConflict(message) {
  const act = (run) => () => {
    closeOverlay();
    run();
  };
  const content = node('div', {}, [
    node('p', {
      className: 'gate-lede',
      text:
        'The Conductor composer on your Mac already contains unsent text. Pocket did not overwrite it.',
    }),
    node('section', { className: 'pair-card' }, [
      node('div', { className: 'micro-caps', text: 'On your Mac' }),
      node('div', { className: 'draft-preview' }, [
        node('p', {
          className: 'machine-fact',
          text: message.macDraft || 'Conductor has an unsent draft.',
        }),
      ]),
      node('div', { className: 'pair-divider' }),
      node('div', { className: 'micro-caps', text: 'From this phone' }),
      node('div', { className: 'draft-preview' }, [
        node('p', { text: message.text }),
      ]),
    ]),
    node('button', {
      className: 'primary-button',
      type: 'button',
      text: 'Replace and send mine',
      on: {
        click: async () => {
          if (!(await claimConflictAction(message, 'retry'))) return;
          void draftConflictFlow.replaceAndSend(message);
        },
      },
    }),
    node('button', {
      className: 'secondary-button',
      type: 'button',
      text: 'Send the Mac draft, then mine',
      on: {
        click: async () => {
          if (!(await claimConflictAction(message, 'retry'))) return;
          void draftConflictFlow.sendMacDraft(message, { thenPhone: true });
        },
      },
    }),
    node('button', {
      className: 'secondary-button',
      type: 'button',
      text: 'Send only the Mac draft',
      on: {
        click: async () => {
          if (!(await claimConflictAction(message, 'retry'))) return;
          void draftConflictFlow.sendMacDraft(message);
        },
      },
    }),
    node('button', {
      className: 'secondary-button',
      type: 'button',
      text: 'Keep the Mac draft',
      on: {
        click: async () => {
          if (!(await claimConflictAction(message, 'edit'))) return;
          await recoverClaimedFailedMessage(message);
        },
      },
    }),
  ]);
  openSheet('Unsent text on your Mac', content);
}

function startEvents() {
  startEventsAttempt();
}

function startEventsAttempt({ initialRetry = false } = {}) {
  stopEvents();
  const eventSource = new EventSource('/api/events');
  state.eventSource = eventSource;
  let initialConnected = false;
  const live = () => {
    if (state.eventSource !== eventSource) return;
    initialConnected = true;
    if (state.initialStreamTimer) {
      clearTimeout(state.initialStreamTimer);
      state.initialStreamTimer = null;
    }
    state.lastHeartbeat = Date.now();
    recordConnectionReached(state.lastHeartbeat);
    if (state.connection !== 'live') {
      state.connection = 'live';
      renderConnectionState();
    }
  };
  eventSource.addEventListener('ready', (event) => {
    live();
    invalidateUnreadHeadEvidence();
    try {
      appUpdateCoordinator?.serverRevision(
        JSON.parse(event.data).shellRevision,
      );
    } catch {
      // The periodic health check remains the update fallback.
    }
    void appUpdateCoordinator?.checkForUpdate({ force: true });
    void transcriptRefresh.flush();
    void metadataRefresh.flush();
    rearmAmbiguousDeliveries();
    recheckAmbiguousDeliveries();
  });
  eventSource.addEventListener('heartbeat', () => {
    const wasLive = state.connection === 'live';
    live();
    if (!wasLive) {
      invalidateUnreadHeadEvidence();
      void transcriptRefresh.flush();
      void metadataRefresh.flush();
      rearmAmbiguousDeliveries();
      recheckAmbiguousDeliveries();
    }
  });
  eventSource.addEventListener('change', () => {
    live();
    invalidateUnreadHeadEvidence();
    transcriptRefresh.schedule();
    metadataRefresh.schedule();
    rearmAmbiguousDeliveries();
    recheckAmbiguousDeliveries();
  });
  eventSource.addEventListener('locked', async (event) => {
    let code = 'device_locked';
    try {
      code = JSON.parse(event.data).code || code;
    } catch {
      // Keep the locked fallback.
    }
    if (
      code === 'device_revoked' ||
      code === 'authentication_required' ||
      code === 'device_session_expired'
    ) {
      await purgeThenRenderSignedOut();
    } else if (
      code === 'tailscale_identity_required' ||
      code === 'tailscale_identity_denied' ||
      code === 'tailscale_identity_unpaired' ||
      code === 'device_identity_mismatch'
    ) {
      renderConnectionGate(code);
    } else {
      renderLock();
    }
  });
  eventSource.onerror = () => {
    invalidateUnreadHeadEvidence();
    if (Date.now() - state.lastHeartbeat > 10_000) {
      state.connection = state.lastHeartbeat ? 'offline' : 'connecting';
      renderConnectionState();
    }
  };
  state.initialStreamTimer = setTimeout(() => {
    state.initialStreamTimer = null;
    if (
      initialConnected ||
      state.eventSource !== eventSource ||
      document.hidden ||
      !state.auth ||
      !state.shell
    ) {
      return;
    }
    if (!initialRetry) {
      startEventsAttempt({ initialRetry: true });
      transcriptRefresh.schedule();
      metadataRefresh.schedule();
    }
  }, INITIAL_STREAM_RESTART_MS);
  state.heartbeatTimer = setInterval(() => {
    if (Date.now() - state.lastHeartbeat > 10_000) {
      if (state.unreadHeadsLoaded) invalidateUnreadHeadEvidence();
      const nextConnection = state.lastHeartbeat ? 'offline' : 'connecting';
      // Only on an actual change. renderConnectionState fans out to all three
      // panel renderers, each of which rebuilds its DOM, so calling it every
      // tick rebuilt the whole app once a second for as long as the Mac was
      // unreachable. The offline banner's Details button became a different
      // node under the finger every second, which is why it often did nothing.
      const connectionChanged = state.connection !== nextConnection;
      state.connection = nextConnection;
      if (connectionChanged) renderConnectionState();
      // Losing the stream used to be reported and then left alone: EventSource
      // does not reliably reopen one that iOS tore down, and startEvents is
      // otherwise only reached from revealApplication. That is why a stale app
      // recovered only after being backgrounded and foregrounded. Rebuild here.
      //
      // Gated on a heartbeat having arrived at least once, so a first load that
      // has not connected yet is left to its original attempt rather than being
      // restarted out from under itself.
      if (
        state.lastHeartbeat &&
        !document.hidden &&
        state.auth &&
        state.shell &&
        Date.now() - (state.lastStreamRevive || 0) > STREAM_REVIVE_MS
      ) {
        state.lastStreamRevive = Date.now();
        // startEvents clears this interval through stopEvents and installs a
        // fresh one, so nothing below may touch timer state.
        startEvents();
        transcriptRefresh.schedule();
        metadataRefresh.schedule();
      }
    }
  }, 1_000);
  state.activityTimer = setInterval(() => {
    if (document.hidden || !state.auth || !state.shell) return;
    request('/api/auth/touch', {
      method: 'POST',
      body: {},
      csrf: true,
      timeoutMs: LIVE_REFRESH_REQUEST_MS,
    }).catch((error) => {
      if (
        error.status === 401 ||
        error.status === 423 ||
        error.code === 'device_revoked'
      ) {
        handleRuntimeError(error);
      }
    });
  }, ACTIVITY_HEARTBEAT_MS);
  // Only while on screen, so a backgrounded phone costs nothing. The refresh
  // coordinators debounce and drop duplicates against an in-flight request, so
  // this cannot stack up behind a slow response or race the stream's own
  // refresh: whichever arrives first wins and the other is dropped.
  state.backstopTimer = setInterval(() => {
    if (document.hidden || !state.auth || !state.shell) return;
    recheckAmbiguousDeliveries(state.route.sessionId, {
      settlementOnly: true,
    });
    transcriptRefresh.schedule();
    metadataRefresh.schedule();
  }, TRANSCRIPT_BACKSTOP_MS);
}

function stopEvents() {
  state.eventSource?.close();
  state.eventSource = null;
  transcriptRefresh.stop();
  metadataRefresh.stop();
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  if (state.activityTimer) clearInterval(state.activityTimer);
  if (state.initialStreamTimer) clearTimeout(state.initialStreamTimer);
  // Cleared with the rest. startEvents calls stopEvents first, so leaking this
  // would start a second backstop on every stream revive.
  if (state.backstopTimer) clearInterval(state.backstopTimer);
  state.heartbeatTimer = null;
  state.activityTimer = null;
  state.initialStreamTimer = null;
  state.backstopTimer = null;
}

function applyAppConnectionAvailability(status, { now = Date.now() } = {}) {
  const appReady = Boolean(state.auth && state.shell);
  applyConnectionAvailability({
    state,
    status,
    now,
    render: renderConnectionState,
    restartEvents: () => {
      if (appReady) startEvents();
    },
    refresh: () => {
      if (!appReady) return;
      invalidateUnreadHeadEvidence();
      void transcriptRefresh.flush();
      void metadataRefresh.flush();
    },
    recheckDeliveries: () => {
      if (appReady) recheckAmbiguousDeliveries();
    },
    recoverDeliveries: () => {
      if (appReady) void recoverPendingDeliveries();
    },
  });
}

function renderConnectionState() {
  renderWorkspacePanel();
  renderSessionsPanel();
  renderTranscript();
}

function handleRuntimeError(error) {
  if (error.status === 401 || error.code === 'device_revoked') {
    void purgeThenRenderSignedOut();
  } else if (error.status === 423 || error.code === 'device_locked') {
    renderLock();
  } else if (error.code === 'retirement_client_upgrade_required') {
    renderConnectionGate(error.code);
  }
}

let activeOverlay = null;
let overlayRequestGeneration = 0;

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function waitForVisualMotion(element, { durationMs, signal } = {}) {
  if (!element || prefersReducedMotion() || signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      element.removeEventListener('animationend', onAnimationEnd);
      signal?.removeEventListener('abort', finish);
      if (timer !== null) clearTimeout(timer);
      resolve();
    };
    const onAnimationEnd = (event) => {
      if (event.target === element) finish();
    };
    element.addEventListener('animationend', onAnimationEnd);
    signal?.addEventListener('abort', finish, { once: true });
    timer = setTimeout(finish, Math.max(0, durationMs || 0) + 80);
  });
}

function finishOverlayClose(options) {
  return closeOverlay({ ...options, preservePendingOpen: true });
}

async function openSheet(title, content, { className = '', onClose } = {}) {
  const requestGeneration = overlayRequestGeneration + 1;
  overlayRequestGeneration = requestGeneration;
  cancelReadTracking();
  await finishOverlayClose();
  if (requestGeneration !== overlayRequestGeneration) return;
  const previousFocus = document.activeElement;
  const close = button('Close', {
    iconName: 'close',
    onClick: () => closeOverlay(),
  });
  const sheet = node('section', {
    className: `sheet ${className}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  }, [
    node('div', { className: 'sheet-grabber', 'aria-hidden': 'true' }),
    node('header', { className: 'sheet-header' }, [
      node('h2', { className: 'sheet-title', text: title }),
      close,
    ]),
    node('div', { className: 'sheet-scroll' }, content),
  ]);
  const overlay = node('div', {
    className: `overlay${className ? ` ${className}-overlay` : ''}`,
    on: {
      pointerdown: (event) => {
        if (event.target === overlay) closeOverlay();
      },
    },
  }, sheet);
  overlayRoot.replaceChildren(overlay);
  activeOverlay = {
    overlay,
    sheet,
    onClose,
    previousFocus,
    closingPromise: null,
  };
  document.addEventListener('keydown', sheetEscape);
  close.focus({ preventScroll: true });
  appUpdateCoordinator?.stateChanged();
}

function sheetEscape(event) {
  if (event.key === 'Escape') closeOverlay();
}

async function closeOverlay({ immediate = false, preservePendingOpen = false } = {}) {
  if (!preservePendingOpen) overlayRequestGeneration += 1;
  document.removeEventListener('keydown', sheetEscape);
  const lifecycle = activeOverlay;
  if (!lifecycle) return;

  const finish = () => {
    if (activeOverlay !== lifecycle) return;
    activeOverlay = null;
    lifecycle.overlay.remove();
    lifecycle.onClose?.();
    if (!activeOverlay && lifecycle.previousFocus?.isConnected) {
      lifecycle.previousFocus.focus({ preventScroll: true });
    }
    appUpdateCoordinator?.stateChanged();
    scheduleReadEvaluation();
  };

  if (immediate || prefersReducedMotion()) {
    finish();
    return;
  }
  if (lifecycle.closingPromise) return lifecycle.closingPromise;
  lifecycle.overlay.classList.add('is-closing');
  lifecycle.closingPromise = waitForVisualMotion(lifecycle.sheet, {
    durationMs: MOTION_MS.overlayExit,
  }).then(finish);
  return lifecycle.closingPromise;
}

async function openSwitcher() {
  const search = node('input', {
    className: 'search-input',
    type: 'search',
    placeholder: 'Search',
    'aria-label': 'Search recent chats',
  });
  const list = node('ul', { className: 'row-list' });
  const render = () => {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const sessions = state.recentSessions.filter((session) =>
      `${session.title} ${session.repositoryName || ''} ${session.workspaceName}`
        .toLowerCase()
        .includes(query),
    );
    if (state.recentSessionsError) {
      list.append(
        node('li', {
          className: 'switcher-notice is-error',
          role: 'alert',
        }, [
          icon('warn'),
          node('span', { text: state.recentSessionsError }),
          node('button', {
            className: 'text-button',
            type: 'button',
            text: 'Retry',
            on: {
              click: () => {
                const pending = loadRecentSessions();
                render();
                void pending.then(render);
              },
            },
          }),
        ]),
      );
    }
    sessions.forEach((session) => list.append(sessionRow(session, { crossWorkspace: true })));
    if (!sessions.length) {
      if (
        state.recentSessionsLoad === 'loading' &&
        !state.recentSessionsError
      ) {
        list.append(
          node('li', {
            className: 'switcher-notice',
            role: 'status',
          }, [
            node('span', { className: 'status-dot working' }),
            node('span', { text: 'Loading recent chats…' }),
          ]),
        );
      } else if (!state.recentSessionsError) {
        list.append(
          node('li', { className: 'empty-state' }, [
            node('h2', {
              text: query
                ? `No matches for “${search.value.trim()}”`
                : 'No recent chats yet',
            }),
          ]),
        );
      }
    }
  };
  search.addEventListener('input', render);
  const pending = loadRecentSessions();
  render();
  openSheet(
    'Recent chats',
    node('div', {}, [
      node('div', { className: 'search-wrap' }, [icon('search'), search]),
      node('div', { className: 'micro-caps', text: 'Recent' }),
      list,
    ]),
    { className: 'switcher' },
  );
  void pending.then(render);
}


// Tab control from the phone. New chat is one tap. Closing is irreversible, so
// it is deliberately two taps with the chat's own name shown in the confirm
// label: a fat-fingered delete on a phone has no undo, and every other
// destructive path in this app fails closed the same way.
async function runTabAction(
  action,
  {
    confirm = false,
    sessionId: explicitId,
    idempotencyKey = null,
    requireDefinitive = false,
  } = {},
) {
  const sessionId = explicitId || state.route.sessionId;
  if (!sessionId) {
    announce('Open a chat first.');
    return null;
  }
  const { response, payload } = await fetchJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/tab`,
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': state.csrfToken,
        ...(idempotencyKey
          ? { 'Idempotency-Key': idempotencyKey }
          : {}),
      },
      body: JSON.stringify({ action, confirm }),
      timeoutMs: TAB_ACTION_REQUEST_MS,
    },
  );
  if (!response.ok || payload?.ok !== true) {
    const responseCode =
      typeof payload?.code === 'string'
        ? payload.code
        : typeof payload?.error?.code === 'string'
          ? payload.error.code
          : null;
    if (requireDefinitive && responseCode === 'session_not_found') {
      const error = new Error(responseCode);
      error.name = 'TabActionRouteUnavailableError';
      error.code = responseCode;
      throw error;
    }
    if (
      requireDefinitive &&
      (response.status >= 500 ||
        responseCode === null ||
        responseCode === 'tab_action_interrupted')
    ) {
      const error = new Error(responseCode || 'tab_action_result_unknown');
      error.name = 'TabActionIndeterminateError';
      error.code = responseCode || 'tab_action_result_unknown';
      throw error;
    }
    announce(TAB_ACTION_MESSAGES[responseCode] || 'That did not work on the Mac.');
    return null;
  }
  return payload;
}

function currentWorkspaceName() {
  const workspace = state.workspaces.find(
    (item) => item.id === state.route.workspaceId,
  );
  return workspace?.name || null;
}

function validChatCreationAttempt(attempt, now) {
  return Boolean(
    attempt &&
      typeof attempt === 'object' &&
      !Array.isArray(attempt) &&
      typeof attempt.key === 'string' &&
      attempt.key.length >= 16 &&
      attempt.key.length <= 100 &&
      /^[A-Za-z0-9_-]+$/.test(attempt.key) &&
      typeof attempt.workspaceId === 'string' &&
      attempt.workspaceId.length > 0 &&
      attempt.workspaceId.length <= 200 &&
      typeof attempt.anchorSessionId === 'string' &&
      attempt.anchorSessionId.length > 0 &&
      attempt.anchorSessionId.length <= 200 &&
      Number.isSafeInteger(attempt.createdAt) &&
      attempt.createdAt <= now &&
      now - attempt.createdAt <= CHAT_CREATION_ATTEMPT_TTL_MS &&
      (attempt.settledAt === undefined ||
        (Number.isSafeInteger(attempt.settledAt) &&
          attempt.settledAt >= attempt.createdAt &&
          attempt.settledAt <= now)),
  );
}

function readChatCreationAttempts(now = Date.now()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_CREATION_ATTEMPTS_KEY));
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(CHAT_CREATION_ATTEMPTS_KEY);
      return [];
    }
    const attempts = [];
    const workspaces = new Set();
    for (const attempt of parsed) {
      if (
        !validChatCreationAttempt(attempt, now) ||
        workspaces.has(attempt.workspaceId)
      ) {
        continue;
      }
      workspaces.add(attempt.workspaceId);
      attempts.push(attempt);
      if (attempts.length >= CHAT_CREATION_ATTEMPT_MAX) break;
    }
    return attempts;
  } catch {
    localStorage.removeItem(CHAT_CREATION_ATTEMPTS_KEY);
    return [];
  }
}

function writeChatCreationAttempts(attempts) {
  if (attempts.length === 0) {
    localStorage.removeItem(CHAT_CREATION_ATTEMPTS_KEY);
    return;
  }
  localStorage.setItem(
    CHAT_CREATION_ATTEMPTS_KEY,
    JSON.stringify(attempts.slice(0, CHAT_CREATION_ATTEMPT_MAX)),
  );
}

function readChatCreationLease(now = Date.now()) {
  try {
    const lease = JSON.parse(localStorage.getItem(CHAT_CREATION_LEASE_KEY));
    if (
      !lease ||
      typeof lease !== 'object' ||
      Array.isArray(lease) ||
      typeof lease.owner !== 'string' ||
      lease.owner.length < 16 ||
      lease.owner.length > 100 ||
      !Number.isSafeInteger(lease.expiresAt) ||
      lease.expiresAt <= now ||
      lease.expiresAt > now + CHAT_CREATION_LEASE_MS
    ) {
      localStorage.removeItem(CHAT_CREATION_LEASE_KEY);
      return null;
    }
    return lease;
  } catch {
    localStorage.removeItem(CHAT_CREATION_LEASE_KEY);
    return null;
  }
}

async function withChatCreationAttemptLock(task) {
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request(
      CHAT_CREATION_LOCK_NAME,
      { mode: 'exclusive' },
      task,
    );
  }

  const owner = randomIdempotencyKey();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!readChatCreationLease()) {
      localStorage.setItem(
        CHAT_CREATION_LEASE_KEY,
        JSON.stringify({
          owner,
          expiresAt: Date.now() + CHAT_CREATION_LEASE_MS,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 16));
      if (readChatCreationLease()?.owner === owner) {
        try {
          return await task();
        } finally {
          if (readChatCreationLease()?.owner === owner) {
            localStorage.removeItem(CHAT_CREATION_LEASE_KEY);
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('chat_creation_lock_unavailable');
}

function loadChatCreationAttempt(workspaceId, now = Date.now()) {
  return (
    readChatCreationAttempts(now).find(
      (attempt) => attempt.workspaceId === workspaceId,
    ) || null
  );
}

function saveChatCreationAttempt(
  workspaceId,
  anchorSessionId,
  now = Date.now(),
) {
  const attempt = {
    key: randomIdempotencyKey(),
    workspaceId,
    anchorSessionId,
    createdAt: now,
  };
  writeChatCreationAttempts(
    [attempt, ...readChatCreationAttempts(now)].filter(
      (candidate, index, attempts) =>
        index === 0 || candidate.workspaceId !== workspaceId,
    ),
  );
  return attempt;
}

function allocateChatCreationAttempt(workspaceId, anchorSessionId) {
  return withChatCreationAttemptLock(() => {
    const now = Date.now();
    const current = loadChatCreationAttempt(workspaceId, now);
    if (
      current &&
      (current.settledAt === undefined ||
        now - current.settledAt <= CHAT_CREATION_SETTLED_GRACE_MS)
    ) {
      return current;
    }
    return saveChatCreationAttempt(workspaceId, anchorSessionId, now);
  });
}

function rebindChatCreationAttempt(attempt, anchorSessionId) {
  return withChatCreationAttemptLock(() => {
    const current = loadChatCreationAttempt(attempt.workspaceId);
    if (current && current.key !== attempt.key) {
      throw new Error('chat_creation_attempt_changed');
    }
    const rebound = { ...attempt, anchorSessionId };
    writeChatCreationAttempts([
      rebound,
      ...readChatCreationAttempts().filter(
        (candidate) => candidate.workspaceId !== attempt.workspaceId,
      ),
    ]);
    return rebound;
  });
}

function clearChatCreationAttempt(key) {
  return withChatCreationAttemptLock(() => {
    writeChatCreationAttempts(
      readChatCreationAttempts().filter((attempt) => attempt.key !== key),
    );
  });
}

function settleChatCreationAttempt(attempt) {
  return withChatCreationAttemptLock(() => {
    const current = loadChatCreationAttempt(attempt.workspaceId);
    if (current && current.key !== attempt.key) return attempt;
    const settled = {
      ...attempt,
      settledAt: current?.settledAt || Date.now(),
    };
    writeChatCreationAttempts([
      settled,
      ...readChatCreationAttempts().filter(
        (candidate) => candidate.workspaceId !== attempt.workspaceId,
      ),
    ]);
    return settled;
  });
}

// One helper behind both entry points (the + on the chat strip and the Chats
// sheet), so creating a chat behaves identically wherever it is started.
//
// Creating a chat used to only refresh the list and leave the operator in the
// chat they were already in, with the new one arriving as "Untitled" among the
// others. On a phone that reads as nothing having happened, and the obvious
// response is to tap again, which creates a second chat. The server now names
// the chat it created, so we open it.
let chatCreationInFlight = false;

async function createChat({ onCreated, control } = {}) {
  // The Mac round trip runs several seconds. A second tap during it posts a
  // second shortcut and creates a second chat, so the whole operation is
  // single-flight and the control says it is working.
  if (chatCreationInFlight) return null;
  chatCreationInFlight = true;
  if (control) {
    control.setAttribute('aria-busy', 'true');
    control.disabled = true;
  }
  announce('Creating a chat on the Mac...');
  try {
    return await runCreateChat({ onCreated });
  } catch (error) {
    announce(
      error?.name === 'TimeoutError'
        ? 'Pocket stopped waiting for the Mac. Check Recent chats before trying again.'
        : error?.name === 'TabActionIndeterminateError'
          ? TAB_ACTION_MESSAGES[error.code] ||
            'Pocket could not confirm the Mac result. Check Recent chats before trying again.'
        : 'Pocket could not create a chat. Try again.',
    );
    return null;
  } finally {
    chatCreationInFlight = false;
    if (control) {
      control.removeAttribute('aria-busy');
      control.disabled = false;
    }
  }
}

async function runCreateChat({ onCreated } = {}) {
  const workspaceId = state.route.workspaceId;
  if (!workspaceId) {
    announce('Pick a repository first.');
    return null;
  }
  let attempt = loadChatCreationAttempt(workspaceId);
  let anchorSessionId = attempt?.anchorSessionId || state.route.sessionId;
  if (!anchorSessionId) {
    const sessions = await loadSessions(workspaceId);
    anchorSessionId = sessionsFor(workspaceId)[0]?.id || sessions[0]?.id || null;
  }
  if (!anchorSessionId) {
    announce('Pocket could not find a chat in this repository.');
    return null;
  }
  attempt = await allocateChatCreationAttempt(workspaceId, anchorSessionId);
  let done;
  try {
    done = await runTabAction('new', {
      sessionId: attempt.anchorSessionId,
      idempotencyKey: attempt.key,
      requireDefinitive: true,
    });
  } catch (error) {
    if (error?.name !== 'TabActionRouteUnavailableError') throw error;
    const refreshedSessions = await loadSessions(workspaceId);
    const replacementAnchor = [
      state.route.workspaceId === workspaceId ? state.route.sessionId : null,
      ...sessionsFor(workspaceId).map((session) => session.id),
      ...refreshedSessions.map((session) => session.id),
    ].find(
      (sessionId) =>
        typeof sessionId === 'string' &&
        sessionId.length > 0 &&
        sessionId !== attempt.anchorSessionId,
    );
    if (!replacementAnchor) throw error;
    attempt = await rebindChatCreationAttempt(attempt, replacementAnchor);
    done = await runTabAction('new', {
      sessionId: attempt.anchorSessionId,
      idempotencyKey: attempt.key,
      requireDefinitive: true,
    });
  }
  if (!done) {
    await clearChatCreationAttempt(attempt.key);
    return null;
  }
  attempt = await settleChatCreationAttempt(attempt);
  onCreated?.();
  // The server reports the workspace it actually acted on. Local route state
  // can disagree with it, because the Mac-side route proof presses the
  // workspace link and can land somewhere else.
  const where = done.workspaceName || currentWorkspaceName();
  if (done.createdSessionId) {
    announce(where ? `New chat in ${where}.` : 'New chat created.');
    // Refresh first so the chat exists in state before routing to it,
    // otherwise the transcript opens against a session the list does not know.
    await Promise.all([loadSessions(workspaceId), loadRecentSessions()]);
    await openSession(done.createdSessionId, { workspaceId });
    return done.createdSessionId;
  }
  // The Mac made a chat but it could not be uniquely identified, so say so
  // plainly rather than opening something that might be the wrong chat.
  announce(
    where
      ? `New chat created in ${where}. Pick it from the list.`
      : 'New chat created on the Mac. Pick it from the list.',
  );
  void loadSessions(workspaceId);
  return null;
}

const TAB_ACTION_MESSAGES = {
  close_not_confirmed: 'Not closed. Confirm first.',
  tab_action_interrupted:
    'New Chat stopped during a relay restart. Check Recent chats before trying a new one.',
  tab_action_queue_full:
    'New Chat history is full. Restart Pocket Conductor before trying again.',
  tab_close_unverified: 'Could not confirm the chat closed. Nothing assumed.',
  tab_not_closed: 'The chat did not close.',
  tab_not_created: 'The chat was not created.',
  session_not_visible: 'That chat is not open on the Mac.',
  user_input_active: 'Someone is using the Mac. Try again in a moment.',
  session_locked: 'The Mac is locked.',
  conductor_window_unavailable:
    'Conductor has no window on the Mac. Quit and reopen it there.',
};

function confirmCloseChat(session, { onClosed } = {}) {
  // Closing is irreversible and this is a phone, so the confirmation is a
  // separate sheet rather than an inline second tap: an armed control sitting
  // where the first tap landed can be double-tapped by accident, and on a
  // scrolling list the row can move under the finger between taps. Cancel is
  // listed first and styled as the primary action so the destructive choice is
  // never the default or the easiest target.
  openSheet(
    'Close this chat?',
    node('div', {}, [
      node('p', {
        className: 'confirm-target',
        text: session.title,
      }),
      node('p', {
        className: 'sheet-note',
        text: 'This closes the chat on your Mac. It cannot be undone.',
      }),
      node('button', {
        className: 'primary-button sheet-chats-action',
        type: 'button',
        text: 'Keep it',
        on: { click: () => closeOverlay() },
      }),
      node('button', {
        className: 'secondary-button danger sheet-chats-action',
        type: 'button',
        text: 'Close it',
        on: {
          click: async () => {
            const done = await runTabAction('close', {
              confirm: true,
              sessionId: session.id,
            });
            closeOverlay();
            if (done) {
              announce(`Closed ${session.title}.`);
              onClosed?.();
            }
          },
        },
      }),
    ]),
  );
}

function openChatsSheet() {
  const workspaceId = state.route.workspaceId;
  const sessions = recentSessionsNewestFirst();
  const list = node('div', { className: 'chats-list' });

  const rows = sessions.map((session) => {
    const active = session.id === state.route.sessionId;
    // The model comes from Conductor's own database, so it reflects what this
    // chat is actually running. It cannot be changed from the phone: Conductor
    // exposes nothing for its model and effort menus to accessibility.
    const meta = [sessionLocationLabel(session), session.model, active ? 'open' : null]
      .filter(Boolean)
      .join(' \u00b7 ');
    return node('div', { className: `chats-sheet-row${active ? ' is-active' : ''}` }, [
      node('button', {
        className: 'chats-sheet-row-main',
        type: 'button',
        on: {
          click: () => {
            closeOverlay();
            navigate({
              view: 'transcript',
              workspaceId: session.workspaceId,
              sessionId: session.id,
            });
          },
        },
      }, [
        node('span', { className: 'chats-sheet-row-title', text: session.title }),
        meta ? node('span', { className: 'chats-sheet-row-meta', text: meta }) : null,
      ].filter(Boolean)),
      node('button', {
        className: 'chats-sheet-row-close',
        type: 'button',
        'aria-label': `Close ${session.title}`,
        text: 'Close',
        on: {
          click: () =>
            confirmCloseChat(session, {
              onClosed: () =>
                void Promise.all([
                  loadRecentSessions(),
                  loadSessions(session.workspaceId),
                ]),
            }),
        },
      }),
    ]);
  });
  list.replaceChildren(
    ...(rows.length
      ? rows
      : [node('p', { className: 'sheet-note', text: 'No recent chats yet.' })]),
  );

  openSheet(
    'Recent chats',
    node('div', {}, [
      node('button', {
        className: 'primary-button sheet-chats-action',
        type: 'button',
        // The destination is in the label, so the answer to "where does this
        // land" is visible at the moment of the tap rather than after it.
        text: currentWorkspaceName()
          ? `New chat in ${currentWorkspaceName()}`
          : 'New chat',
        on: {
          click: (event) =>
            void createChat({
              control: event.currentTarget,
              onCreated: closeOverlay,
            }),
        },
      }),
      list,
      node('p', {
        className: 'sheet-note',
        text: 'Tap a chat to switch. Model is set on the Mac.',
      }),
    ]),
    { className: 'chats' },
  );
}


// Returns the section immediately and fills it in when the read lands, so a
// caller can place it without awaiting.
function accountUsageSection({ force = false } = {}) {
  const section = node('div', { className: 'usage-section' });
  section.append(skeletonRows(6));
  void fillAccountUsage(section, { force });
  return section;
}

async function appendAccountUsage(content, { force = false } = {}) {
  content.append(accountUsageSection({ force }));
}

function usageResetLabel(value) {
  if (!Number.isFinite(value) || value <= Date.now()) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function usageSampleDescription(account, provider, now = Date.now()) {
  const explicitSource =
    (typeof account.source === 'string' && account.source.trim()) ||
    (typeof provider.source === 'string' && provider.source.trim()) ||
    null;
  const source =
    explicitSource || (provider.id === 'gpt' ? 'SwiftBar cache' : null);
  const fetchedAt = Number(account.fetchedAt ?? provider.fetchedAt);
  let age = null;
  if (Number.isFinite(fetchedAt) && fetchedAt > 0) {
    if (fetchedAt > now) {
      age = 'Sample time unavailable';
    } else {
      const minutes = Math.floor((now - fetchedAt) / 60_000);
      if (minutes < 1) age = 'Sampled just now';
      else if (minutes < 60) age = `Sampled ${minutes}m ago`;
      else {
        const hours = Math.floor(minutes / 60);
        age = hours < 24
          ? `Sampled ${hours}h ago`
          : `Sampled ${Math.floor(hours / 24)}d ago`;
      }
    }
  }
  return [source, age].filter(Boolean).join(' · ');
}

async function fillAccountUsage(section, { force = false } = {}) {
  const usage = await refreshSeatUsage({ force });
  section.replaceChildren();
  const providers = Array.isArray(usage?.providers)
    ? usage.providers
    : Array.isArray(usage?.seats)
      ? [{
          id: 'claude',
          label: 'Claude',
          available: usage.available === true,
          accounts: usage.seats,
        }]
      : [];
  if (!usage?.available || providers.length === 0) {
    section.append(
      node('p', { className: 'sheet-note', text: 'Account usage is not being reported right now.' }),
    );
    return;
  }
  for (const provider of providers) {
    const providerSection = node('section', { className: 'usage-provider' }, [
      node('div', {
        className: 'usage-provider-heading',
        text: provider.label || provider.id,
      }),
    ]);
    section.append(providerSection);
    if (!provider.available) {
      providerSection.append(
        node('p', { className: 'sheet-note', text: 'Not available right now.' }),
      );
      continue;
    }
    const accounts = Array.isArray(provider.accounts) ? provider.accounts : [];
    if (accounts.length === 0) {
      providerSection.append(
        node('p', { className: 'sheet-note', text: 'No saved accounts.' }),
      );
      continue;
    }
    for (const account of accounts) {
      const status = usageAccountStatus(account);
      const blocked = status.blocked;
      const resetParts = [];
      const fiveHourReset = usageResetLabel(account.fiveHourResetAt);
      const weeklyReset = usageResetLabel(account.weeklyResetAt);
      if (fiveHourReset) resetParts.push(`5h ${fiveHourReset}`);
      if (weeklyReset) resetParts.push(`week ${weeklyReset}`);
      const name = node('span', { className: 'usage-seat-name' }, [
        account.active
          ? node('span', { className: 'usage-active', text: 'Active' })
          : null,
        document.createTextNode(account.label || account.name),
      ]);
      const row = node('div', {
        className: `usage-seat${blocked ? ' is-blocked' : ''}`,
      }, [
        name,
        node('span', {
          className: 'usage-seat-value',
          // Naming which window is spent is the whole point: "out of usage"
          // with no window named is what sent the operator looking in the
          // wrong place.
          text: status.text,
        }),
      ]);
      if (resetParts.length > 0) {
        row.append(
          node('span', {
            className: 'usage-seat-reset',
            text: `Resets ${resetParts.join(' · ')}`,
          }),
        );
      }
      const sampleDescription = usageSampleDescription(account, provider);
      if (sampleDescription) {
        row.append(
          node('span', {
            className: 'usage-seat-source',
            text: sampleDescription,
          }),
        );
      }
      providerSection.append(row);
    }
  }
}

function openUsageSheet() {
  openSheet('Account usage', accountUsageSection({ force: true }), {
    className: 'usage',
  });
}

async function runConnectionCheck(content) {
  if (content.dataset.connectionCheckBusy === 'true') return;
  content.dataset.connectionCheckBusy = 'true';
  content.setAttribute('aria-busy', 'true');
  const startedAt = performance.now();
  content.replaceChildren(skeletonRows(4));
  try {
    const probe = await request('/api/connection?force=1');
    state.connectionProbe = probe;
    recordConnectionReached();
    applyAppConnectionAvailability('live');
    const latency = Math.round(performance.now() - startedAt);
    const rows = [
      ['Private round trip', true, `${latency} ms`],
      ['Relay on your Mac', true, probe.relayVersion],
      ['Conductor app', probe.conductor, probe.conductor ? 'Ready' : 'Not ready'],
      ['Accessibility send path', probe.sendPath, probe.sendPath ? 'Verified' : probe.reason],
    ];
    content.replaceChildren();
    rows.forEach(([label, ok, value]) => {
      content.append(
        node('div', { className: 'connection-check' }, [
          ok ? icon('check') : icon('warn'),
          node('span', { text: label }),
          node('span', { className: 'value', text: value }),
        ]),
      );
    });
    // Seat usage, live from the local producer. The agent only reports a limit
    // at the moment it hits one, so an exhausted seat and a long-since-reset
    // one look identical afterwards. This answers "am I actually out" without
    // going to the Mac, and it shows the two windows separately because a seat
    // can sit at 0% on the five hour window while the weekly one is spent,
    // which is precisely the state that reads as unexplained.
    void appendAccountUsage(content, { force: true });
    renderComposerState();
  } catch (error) {
    state.connectionError = error;
    applyAppConnectionAvailability('offline');
    // This sheet just made a real request, so unlike the passive banner it has
    // first hand evidence of what failed and can name it.
    const verdict = connectionDiagnosis(error);
    content.replaceChildren(
      node('div', { className: 'empty-state' }, [
        icon('warn'),
        node('h2', { text: verdict.title }),
        node('p', { text: verdict.body }),
      ]),
    );
  }
  const rerunButton = node('button', {
    className: 'text-button',
    type: 'button',
    text: 'Run check again',
    on: {
      click: async () => {
        rerunButton.disabled = true;
        rerunButton.setAttribute('aria-busy', 'true');
        rerunButton.textContent = 'Checking…';
        await runConnectionCheck(content);
      },
    },
  });
  content.append(rerunButton);
  content.dataset.connectionCheckBusy = 'false';
  content.removeAttribute('aria-busy');
}

function openConnectionSheet() {
  const content = node('div', {}, skeletonRows(4));
  openSheet('Connection', content);
  void runConnectionCheck(content);
}

async function openSecurity() {
  const content = node('div', {}, skeletonRows(4));
  openSheet('Security & Devices', content, { className: 'security' });
  try {
    const [devicesResult, connection] = await Promise.all([
      request('/api/devices'),
      request('/api/connection'),
    ]);
    content.replaceChildren();
    const trustedSession =
      state.auth?.reauthenticationMode === TAILSCALE_SESSION_MODE;
    const thisPhoneSection = settingsSection('This phone');
    thisPhoneSection.card.append(
      settingsRow({
        iconName: 'phone',
        title: state.auth?.device?.name || 'This iPhone',
        subtitle: trustedSession
          ? `Paired ${formatRelative(state.auth?.device?.createdAt)} · Trusted on your Tailnet`
          : `Paired ${formatRelative(state.auth?.device?.createdAt)} · Face ID on`,
      }),
      settingsRow({
        iconName: 'lock',
        title: trustedSession ? 'Remembered access' : 'Auto-lock',
        subtitle: trustedSession
          ? 'Face ID after Lock now or remembered access expires'
          : 'After 5 minutes away',
        actionLabel: trustedSession ? 'Lock now' : null,
        onAction: trustedSession ? lockPocketNow : null,
      }),
      settingsRow({
        iconName: 'warn',
        title: 'Clear cached transcripts',
        actionLabel: 'Clear',
        destructive: true,
        onAction: confirmClearCache,
      }),
    );
    content.append(thisPhoneSection.root);

    const devicesSection = settingsSection('Paired devices');
    devicesResult.devices.forEach((device) => {
      devicesSection.card.append(
        settingsRow({
          iconName: 'phone',
          title: device.name,
          subtitle: `Last verified ${formatRelative(device.lastSeenAt)} · ${device.tailscaleLogin}`,
          actionLabel:
            device.id === state.auth?.device?.id ? 'Sign out' : 'Revoke',
          destructive: true,
          onAction: () => confirmRevoke(device),
        }),
      );
    });
    content.append(devicesSection.root);

    const connectionSection = settingsSection('Connection');
    connectionSection.card.append(
      settingsRow({
        iconName: connection.sendPath ? 'check' : 'warn',
        title: 'Send path',
        subtitle: connection.sendPath ? 'Verified' : connection.reason || 'Unavailable',
      }),
      settingsRow({
        iconName: 'refresh',
        title: 'Test send path',
        actionLabel: 'Run',
        onAction: openConnectionSheet,
      }),
    );
    content.append(connectionSection.root);

    const appSection = settingsSection('App');
    appSection.card.append(
      settingsRow({
        iconName: 'share',
        title: 'Install on this phone',
        subtitle: isStandalone() ? "Installed - you're running the app" : 'Safari instructions',
        actionLabel: isStandalone() ? null : 'View',
        onAction: isStandalone()
          ? null
          : () => {
              closeOverlay({ immediate: true });
              renderInstallGuidance();
            },
      }),
      settingsRow({
        iconName: 'bolt',
        title: 'Conductor Pocket',
        subtitle: `relay ${connection.relayVersion || 'unknown'} · client ${CLIENT_VERSION}`,
      }),
    );
    content.append(appSection.root);
  } catch (error) {
    handleRuntimeError(error);
  }
}

async function lockPocketNow() {
  try {
    const result = await request('/api/auth/lock', {
      method: 'POST',
      body: { explicit: true },
      csrf: true,
    });
    if (result.locked) {
      closeOverlay({ immediate: true });
      renderLock();
    }
  } catch (error) {
    handleRuntimeError(error);
  }
}

function settingsSection(title) {
  const card = node('div', { className: 'settings-card' });
  return {
    root: node('section', { className: 'settings-section' }, [
      node('h3', { className: 'section-heading', text: title }),
      card,
    ]),
    card,
  };
}

function settingsRow({
  iconName,
  title,
  subtitle,
  actionLabel,
  destructive = false,
  onAction,
}) {
  return node('div', { className: 'settings-row' }, [
    icon(iconName),
    node('div', { className: 'settings-row-copy' }, [
      node('span', { className: 'settings-row-title', text: title }),
      subtitle
        ? node('span', { className: 'settings-row-subtitle', text: subtitle })
        : null,
    ]),
    actionLabel
      ? node('button', {
          className: `settings-row-action${destructive ? ' destructive' : ''}`,
          type: 'button',
          text: actionLabel,
          on: { click: onAction },
        })
      : null,
  ]);
}

function confirmClearCache() {
  openSheet(
    'Clear cached transcripts?',
    node('div', {}, [
      node('p', {
        className: 'gate-lede',
        text: 'Removes transcript copies stored on this phone. Your Mac keeps everything.',
      }),
      node('button', {
        className: 'destructive-button',
        type: 'button',
        text: 'Clear',
        on: {
          click: async () => {
            try {
              await clearTranscriptCache();
              resetSessionMessageState();
              await closeOverlay();
              await startApplication();
            } catch (error) {
              if (isLocalPurgeFailure(error)) {
                closeOverlay({ immediate: true });
                renderLocalPurgeFailure(() => confirmClearCache());
              } else {
                handleRuntimeError(error);
              }
            }
          },
        },
      }),
      node('button', {
        className: 'secondary-button',
        type: 'button',
        text: 'Cancel',
        on: { click: () => closeOverlay() },
      }),
    ]),
  );
}

function confirmRevoke(device) {
  openSheet(
    device.id === state.auth?.device?.id ? 'Sign out this phone?' : `Revoke “${device.name}”?`,
    node('div', {}, [
      node('p', {
        className: 'gate-lede',
        text:
          device.id === state.auth?.device?.id
            ? 'This phone will lose access immediately. Your Mac keeps everything.'
            : `“${device.name}” will be signed out immediately.`,
      }),
      node('button', {
        className: 'destructive-button',
        type: 'button',
        text: device.id === state.auth?.device?.id ? 'Sign out' : 'Revoke',
        on: {
          click: async () => {
            try {
              const currentDevice = device.id === state.auth?.device?.id;
              if (currentDevice) await purgeLocalData();
              const result = await request(
                `/api/devices/${encodeURIComponent(device.id)}/revoke`,
                {
                  method: 'POST',
                  body: currentDevice
                    ? {
                        clientVersion: CLIENT_VERSION,
                        localPurgeCompleted: true,
                      }
                    : {},
                  csrf: true,
                },
              );
              if (result.currentDevice) {
                // The gate only replaces the children of #app, and
                // #overlay-root is a sibling, so without this the confirmation
                // sheet stayed on top of the signed-out screen with its Sign
                // out button still live. Same order the lock path uses.
                closeOverlay({ immediate: true });
                renderSignedOut();
              } else {
                openSecurity();
              }
            } catch (error) {
              if (
                device.id === state.auth?.device?.id &&
                isLocalPurgeFailure(error)
              ) {
                closeOverlay({ immediate: true });
                renderLocalPurgeFailure(() => confirmRevoke(device));
              } else {
                handleRuntimeError(error);
              }
            }
          },
        },
      }),
      node('button', {
        className: 'secondary-button',
        type: 'button',
        text: 'Cancel',
        on: { click: () => closeOverlay() },
      }),
    ]),
  );
}

window.addEventListener('popstate', (event) => {
  if (event.state?.pocketRoute) {
    navigate(event.state.pocketRoute, false);
  }
});

PHONE_LAYOUT.addEventListener('change', syncPanelExposure);

function shieldApplication() {
  invalidateUnreadHeadEvidence({ render: false });
  const hiddenAt = Date.now();
  state.visibilityEpoch += 1;
  state.hiddenAt = hiddenAt;
  localStorage.setItem(HIDDEN_AT_KEY, String(hiddenAt));
  stopEvents();
  app.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('#privacy-shield')) {
    document.body.append(
      node('div', {
        id: 'privacy-shield',
        className: 'privacy-shield',
        'aria-hidden': 'true',
      }),
    );
  }
}

// A visible page must never stay shielded. revealApplication bails early on
// several legitimate races, and it awaits a network call before it reaches the
// removal, so any of them can leave the overlay in place with no further event
// coming to clear it. This is the backstop: if the document is visible and the
// shield is still there shortly after, it goes. Cheap, idempotent, and it can
// only ever remove an overlay that should not be showing.
const SHIELD_FAILSAFE_MS = 2_500;
let shieldFailsafeTimer = null;

function ensureNotShielded() {
  clearTimeout(shieldFailsafeTimer);
  shieldFailsafeTimer = setTimeout(() => {
    if (document.hidden) return;
    const shield = document.querySelector('#privacy-shield');
    if (!shield) return;
    shield.remove();
    app.removeAttribute('aria-hidden');
    // The stream is stopped while shielded, so a rescued page also needs its
    // live data back or it would sit there stale and look broken instead.
    startEvents();
    transcriptRefresh.schedule();
    metadataRefresh.schedule();
  }, SHIELD_FAILSAFE_MS);
}

async function revealApplication() {
  const revealEpoch = state.visibilityEpoch;
  const persistedHiddenAt = Number(localStorage.getItem(HIDDEN_AT_KEY) || 0);
  const hiddenAt = Math.max(state.hiddenAt || 0, persistedHiddenAt);
  const awayTooLong = hiddenAt > 0 && Date.now() - hiddenAt >= AWAY_LOCK_MS;
  localStorage.removeItem(HIDDEN_AT_KEY);
  state.hiddenAt = null;

  if (state.auth && state.shell) {
    const trustedSession =
      state.auth.reauthenticationMode === TAILSCALE_SESSION_MODE;
    if (awayTooLong && !trustedSession) {
      await request('/api/auth/lock', {
        method: 'POST',
        body: {},
        csrf: true,
        timeoutMs: RESUME_REQUEST_MS,
      }).catch(() => {});
      renderLock();
    } else {
      try {
        await request('/api/auth/touch', {
          method: 'POST',
          body: {},
          csrf: true,
          timeoutMs: RESUME_REQUEST_MS,
        });
        if (
          document.hidden ||
          revealEpoch !== state.visibilityEpoch
        ) {
          return;
        }
        startEvents();
        transcriptRefresh.schedule();
        metadataRefresh.schedule();
      } catch (error) {
        if (
          error.status === 401 ||
          error.status === 423 ||
          error.code === 'device_revoked'
        ) {
          handleRuntimeError(error);
        } else {
          state.connectionError = error;
          renderConnectionGate(error.code);
        }
      }
    }
  }

  if (
    document.hidden ||
    revealEpoch !== state.visibilityEpoch
  ) {
    return;
  }
  document.querySelector('#privacy-shield')?.remove();
  app.removeAttribute('aria-hidden');
  scheduleReadEvaluation();
}

function currentAppUpdateReloadIsSafe() {
  const composerValue = state.shell?.composer.field?.value || '';
  const persistedComposerValue = draftFor(state.route.sessionId);
  return appUpdateReloadIsSafe({
    originRetired,
    sensitiveOperations: appUpdateSensitiveOperations,
    pairing: new URLSearchParams(location.hash.slice(1)).has('pair'),
    overlayOpen: overlayRoot.childElementCount > 0,
    composerValue,
    persistedComposerValue,
    deliveries: state.optimistic,
    attachmentCount: unsafeAttachmentOperationCount(),
  });
}

function reloadForShellRevision(revision) {
  const target = new URL(location.href);
  target.pathname = '/';
  target.search = '';
  target.searchParams.set(
    'appRevision',
    typeof revision === 'string' && revision
      ? revision
      : `${CLIENT_SHELL_REVISION}-${Date.now()}`,
  );
  location.replace(`${target.pathname}${target.search}${target.hash}`);
}

// THE KEYBOARD SHIFT, which is what "randomly jumps" has been all along.
//
// index.html asks for interactive-widget=resizes-content, and WebKit does not
// implement that key. iOS therefore uses the default: the LAYOUT viewport keeps
// full screen height and only the VISUAL viewport shrinks for the keyboard.
// Every height in this shell is 100% of the unshrunk layout viewport, and the
// composer is position:absolute bottom:0 inside it, so bottom:0 stays pinned to
// the bottom of the whole screen, behind the keyboard. WebKit's only recourse
// is to translate the visual viewport to reveal the caret, which drags the
// entire app, header included, and does not reliably translate back.
//
// So the app is told how much of the screen the keyboard is covering and gives
// that space up itself. Then the caret is already visible, WebKit has no reason
// to translate anything, and nothing slides.
function syncKeyboardInset() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const covered = Math.max(
    0,
    Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
  );
  // Sub-pixel noise arrives constantly while scrolling; only real changes are
  // written, or this would thrash layout on every scroll event.
  const previous = Number(
    document.documentElement.style.getPropertyValue('--keyboard-inset').replace('px', ''),
  );
  if (Number.isFinite(previous) && Math.abs(previous - covered) < 2) return;
  document.documentElement.style.setProperty('--keyboard-inset', `${covered}px`);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncKeyboardInset);
  window.visualViewport.addEventListener('scroll', syncKeyboardInset);
  syncKeyboardInset();
}
// Belt for the case the shift already happened: dismissing the keyboard must
// always put the inset back, even if a resize event is missed.
window.addEventListener('focusout', () => {
  setTimeout(syncKeyboardInset, 50);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    shieldApplication();
    return;
  }
  rearmAmbiguousDeliveries();
  recheckAmbiguousDeliveries();
  // Reveal unconditionally. This used to be skipped whenever the update
  // coordinator said a reload was starting, on the theory that the page was
  // about to be replaced anyway. When that reload did not land, and on iOS
  // returning from the background it often does not, the privacy shield stayed
  // over the app and the only way out was force-quitting. A brief flash before
  // a reload is a far better failure than a blank app.
  appUpdateCoordinator?.foreground();
  revealApplication();
  ensureNotShielded();
  // Pending deliveries were only reconciled at boot, so a send whose response
  // was lost while the phone was pocketed stayed at "Delivering" until a full
  // restart. checkDelivery is a status probe, never a resend, so this is safe
  // to run on every return to the foreground.
  void recoverPendingDeliveries();
});

window.addEventListener('pagehide', shieldApplication);
window.addEventListener('online', () => {
  rearmAmbiguousDeliveries();
  applyAppConnectionAvailability('connecting');
});
window.addEventListener('offline', () => {
  applyAppConnectionAvailability('offline');
});
window.addEventListener('pageshow', () => {
  appUpdateCoordinator?.foreground();
  rearmAmbiguousDeliveries();
  recheckAmbiguousDeliveries();
  if (
    !document.hidden &&
    (state.hiddenAt || localStorage.getItem(HIDDEN_AT_KEY))
  ) {
    revealApplication();
  }
  // Covers the restore-from-bfcache case, where revealApplication's own guards
  // can bail before it reaches the shield removal.
  ensureNotShielded();
});

if ('serviceWorker' in navigator) {
  getServiceWorkerRegistration = createServiceWorkerRegistrationGetter({
    serviceWorker: navigator.serviceWorker,
  });
  appUpdateCoordinator = createAppUpdateCoordinator({
    serviceWorker: navigator.serviceWorker,
    getRegistration: getServiceWorkerRegistration,
    clientRevision: CLIENT_SHELL_REVISION,
    getServerRevision: async () => {
      const { response, payload } = await fetchJson('/api/health', {
        timeoutMs: LIVE_REFRESH_REQUEST_MS,
      });
      if (!response.ok || typeof payload.shellRevision !== 'string') {
        throw new Error('shell_revision_unavailable');
      }
      return payload.shellRevision;
    },
    canCheck: () => !originRetired,
    canReload: currentAppUpdateReloadIsSafe,
    reload: reloadForShellRevision,
    isHidden: () => document.hidden,
    checkIntervalMs: APP_UPDATE_CHECK_INTERVAL_MS,
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (
      event.data?.type !== 'shell-activated' ||
      typeof event.data.revision !== 'string'
    ) {
      return;
    }
    appUpdateCoordinator.serverRevision(event.data.revision);
  });
  appUpdateCoordinator.start();
  void appUpdateCoordinator.checkForUpdate({ force: true });
  window.setInterval(() => {
    if (!document.hidden) void appUpdateCoordinator.checkForUpdate();
  }, APP_UPDATE_CHECK_INTERVAL_MS);
}

const pairingCode = new URLSearchParams(location.hash.slice(1)).get('pair');
if (pairingCode) initializePairing(pairingCode);
else bootstrap();
