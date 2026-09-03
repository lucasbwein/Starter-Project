// What the phone can actually prove when it cannot reach the Mac, and the plain
// sentence that goes with it.
//
// Every failure used to render one line, "Mac unreachable". A Mac that was
// simply asleep therefore looked identical to a phone that had dropped off the
// tailnet, and to a relay that had died while the Mac stayed awake. Those three
// have different fixes, and the phone already holds enough evidence to separate
// most of them:
//
//   navigator.onLine is false   the phone has no network at all, so nothing
//                               about the Mac is knowable yet
//   an HTTP status came back    something answered at the Mac's tailnet
//                               address, so the Mac is awake and on Tailscale.
//                               A 5xx carrying no relay error code in its body
//                               is the Tailscale proxy reporting a dead
//                               backend, which is the relay being down
//   nothing answered at all     the address is unroutable
//
// It cannot separate "the Mac is off" from "this phone left the tailnet",
// because both are an unroutable 100.x address that hangs until the request
// times out. The copy for that case names both rather than picking one and
// being confidently wrong.

export const CONNECTION_REACHED_KEY = 'cp:connection-reached:v1';

const IDENTITY_CODES = new Set([
  'tailscale_identity_required',
  'tailscale_identity_denied',
  'tailscale_identity_unpaired',
  'device_identity_mismatch',
]);

const UPGRADE_CODE = 'retirement_client_upgrade_required';

// A response the relay itself produced always carries its own error code in the
// JSON body. The client only synthesises http_<status> when the body had none,
// which is exactly the shape of a proxy error page.
const GATEWAY_CODE = /^http_\d+$/;

function errorFacts(error) {
  if (typeof error === 'string') return { code: error, status: null };
  if (!error || typeof error !== 'object') return { code: null, status: null };
  return {
    code: typeof error.code === 'string' ? error.code : null,
    status: Number.isFinite(error.status) ? error.status : null,
  };
}

export function formatLastReached(lastReachedAt, now = Date.now()) {
  if (!Number.isFinite(lastReachedAt) || lastReachedAt <= 0) return '';
  const elapsed = now - lastReachedAt;
  if (elapsed < 0) return '';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Last reached just now.';
  if (minutes === 1) return 'Last reached 1 minute ago.';
  if (minutes < 60) return `Last reached ${minutes} minutes ago.`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'Last reached 1 hour ago.';
  if (hours < 24) return `Last reached ${hours} hours ago.`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Last reached 1 day ago.';
  return `Last reached ${days} days ago.`;
}

export function diagnoseConnection({
  error = null,
  online = true,
  lastReachedAt = null,
  now = Date.now(),
} = {}) {
  const { code, status } = errorFacts(error);

  if (code === UPGRADE_CODE) {
    return {
      code: 'client_upgrade_required',
      title: 'Pocket must refresh',
      body:
        'Fully close Pocket, reopen it while online, then sign out again. The old app cannot retire this phone.',
      retryLabel: 'Reload Pocket',
    };
  }

  if (code && IDENTITY_CODES.has(code)) {
    return {
      code: 'identity',
      title: 'Mac unreachable',
      body: 'Connect this phone with the paired Tailscale account, then try again.',
      retryLabel: 'Try again',
    };
  }

  const reached = formatLastReached(lastReachedAt, now);
  const withReached = (body) => (reached ? `${body} ${reached}` : body);

  if (online === false) {
    return {
      code: 'phone_offline',
      title: 'This phone is offline',
      body: withReached(
        'The phone has no network, so it cannot tell whether your Mac is up. Turn off Airplane Mode or rejoin Wi-Fi, then try again.',
      ),
      retryLabel: 'Try again',
    };
  }

  if (Number.isFinite(status) && status >= 500 && code && GATEWAY_CODE.test(code)) {
    return {
      code: 'relay_down',
      title: 'Your Mac is on, Pocket is not',
      body: withReached(
        'Tailscale answered from your Mac but the Pocket relay did not, so the Mac is awake and the relay has stopped. Start it again on your Mac.',
      ),
      retryLabel: 'Try again',
    };
  }

  if (!Number.isFinite(status)) {
    return {
      code: 'mac_unreachable',
      title: 'Your Mac is off or asleep',
      body: withReached(
        'Nothing answered at your Mac. Wake it up, or check that Tailscale is connected on both the Mac and this phone.',
      ),
      retryLabel: 'Try again',
    };
  }

  return {
    code: 'unknown',
    title: 'Mac unreachable',
    body: withReached('Conductor Pocket could not reach the relay on your Mac.'),
    retryLabel: 'Try again',
  };
}
