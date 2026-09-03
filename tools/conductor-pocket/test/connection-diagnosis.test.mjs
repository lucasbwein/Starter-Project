import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  CONNECTION_REACHED_KEY,
  diagnoseConnection,
  formatLastReached,
} from '../public/connection-diagnosis.js';

// The failure this suite exists to stop: one generic "Mac unreachable" for
// every cause, which left a sleeping Mac, a dead relay and a phone off the
// tailnet all reading the same and none of them actionable.

test('nothing answering at all reads as the Mac being off or asleep', () => {
  const timedOut = Object.assign(new Error('request_timeout'), {
    name: 'TimeoutError',
  });
  const verdict = diagnoseConnection({ error: timedOut, online: true });
  assert.equal(verdict.code, 'mac_unreachable');
  assert.match(verdict.title, /off or asleep/);
  assert.match(verdict.body, /Tailscale/);
});

test('a fetch that never reached a server reads the same way', () => {
  const networkError = new TypeError('Load failed');
  assert.equal(
    diagnoseConnection({ error: networkError, online: true }).code,
    'mac_unreachable',
  );
});

test('a proxy error page proves the Mac is awake and blames the relay', () => {
  // request() synthesises http_<status> only when the body carried no relay
  // error code, which is what the Tailscale proxy returns for a dead backend.
  const gateway = Object.assign(new Error('http_502'), {
    code: 'http_502',
    status: 502,
  });
  const verdict = diagnoseConnection({ error: gateway, online: true });
  assert.equal(verdict.code, 'relay_down');
  assert.match(verdict.title, /Mac is on/);
});

test('a 5xx the relay itself produced is not reported as the relay being down', () => {
  const relaySaid = Object.assign(new Error('send_unavailable'), {
    code: 'send_unavailable',
    status: 503,
  });
  assert.equal(
    diagnoseConnection({ error: relaySaid, online: true }).code,
    'unknown',
  );
});

test('a phone with no network never accuses the Mac', () => {
  const timedOut = Object.assign(new Error('request_timeout'), {
    name: 'TimeoutError',
  });
  const verdict = diagnoseConnection({ error: timedOut, online: false });
  assert.equal(verdict.code, 'phone_offline');
  assert.doesNotMatch(verdict.title, /Mac/);
});

test('identity and upgrade problems keep their own copy', () => {
  assert.equal(
    diagnoseConnection({ error: 'tailscale_identity_required' }).code,
    'identity',
  );
  const upgrade = diagnoseConnection({
    error: 'retirement_client_upgrade_required',
  });
  assert.equal(upgrade.code, 'client_upgrade_required');
  assert.equal(upgrade.retryLabel, 'Reload Pocket');
});

test('identity and upgrade outrank an offline phone', () => {
  // Order matters: a revoked identity is still the thing to fix once the phone
  // is back on a network, and reporting "you are offline" would hide it.
  assert.equal(
    diagnoseConnection({ error: 'device_identity_mismatch', online: false })
      .code,
    'identity',
  );
});

test('the last successful contact is stated when it is known', () => {
  const now = 1_700_000_000_000;
  const verdict = diagnoseConnection({
    error: Object.assign(new Error('request_timeout'), { name: 'TimeoutError' }),
    online: true,
    lastReachedAt: now - 14 * 60_000,
    now,
  });
  assert.match(verdict.body, /Last reached 14 minutes ago\./);
});

test('an unknown last contact adds no sentence', () => {
  const verdict = diagnoseConnection({
    error: Object.assign(new Error('request_timeout'), { name: 'TimeoutError' }),
    online: true,
    lastReachedAt: null,
  });
  assert.doesNotMatch(verdict.body, /Last reached/);
});

test('relative contact times read as a person would say them', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatLastReached(now - 5_000, now), 'Last reached just now.');
  assert.equal(formatLastReached(now - 60_000, now), 'Last reached 1 minute ago.');
  assert.equal(formatLastReached(now - 90 * 60_000, now), 'Last reached 1 hour ago.');
  assert.equal(
    formatLastReached(now - 50 * 60 * 60_000, now),
    'Last reached 2 days ago.',
  );
  assert.equal(formatLastReached(null, now), '');
  assert.equal(formatLastReached(now + 60_000, now), '');
});

test('no diagnosis writes a long dash into user copy', () => {
  // Repo rule: no long dash, and no hyphen standing in for one.
  const longDash = new RegExp('[\\u2013\\u2014]');
  const cases = [
    { error: 'retirement_client_upgrade_required' },
    { error: 'tailscale_identity_required' },
    { error: new TypeError('Load failed'), online: false },
    { error: new TypeError('Load failed'), online: true },
    {
      error: Object.assign(new Error('http_502'), { code: 'http_502', status: 502 }),
    },
    {
      error: Object.assign(new Error('http_418'), { code: 'http_418', status: 418 }),
      lastReachedAt: Date.now() - 3 * 60_000,
    },
  ];
  for (const input of cases) {
    const verdict = diagnoseConnection(input);
    for (const copy of [verdict.title, verdict.body, verdict.retryLabel]) {
      assert.doesNotMatch(copy, longDash);
      assert.doesNotMatch(copy, / - /);
    }
  }
});

test('the app records reachability under a stable key', () => {
  assert.equal(CONNECTION_REACHED_KEY, 'cp:connection-reached:v1');
});
