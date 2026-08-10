import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { AccessibilityTransport } from '../src/accessibility.mjs';

// A dying relay must never orphan an osascript child mid-type: the child
// survives the parent, finishes the send, and nobody is left to record it.
// These locks pin every link of the chain that prevents that: the transport
// tracks and can kill its child, shutdown gates exit on both the server
// closing and the transport draining, the drain budget covers the automation
// worst case, and launchd is told to wait longer than the force deadline.

test('an idle transport drains immediately and has nothing to kill', async () => {
  const transport = new AccessibilityTransport();
  assert.equal(transport.busy, false);
  assert.equal(await transport.drain(1), true);
  assert.equal(transport.killCurrentAutomation(), false);
});

test('shutdown gates exit on both server close and transport drain, and kills the child on every forced path', async () => {
  const source = await fs.readFile(
    new URL('../src/cli.mjs', import.meta.url),
    'utf8',
  );
  const shutdownStart = source.indexOf('const shutdown = () => {');
  assert.ok(shutdownStart >= 0);
  const block = source.slice(shutdownStart, shutdownStart + 1400);
  // Both gates, checked in one place, so a phone that abandoned its
  // connection early cannot let the relay exit under a live automation.
  assert.match(block, /if \(!serverClosed \|\| !transportDrained\) return/);
  assert.match(block, /transport\s*\n?\s*\.drain\(SHUTDOWN_DRAIN_MS\)/);
  // The drain budget covers the 45s automation timeout plus confirmation,
  // and the force deadline sits above the drain, below launchd's SIGKILL.
  assert.match(source, /const SHUTDOWN_DRAIN_MS = 50_000/);
  assert.match(source, /const SHUTDOWN_FORCE_EXIT_MS = 55_000/);
  // Every path that gives up on the drain kills the child first.
  const forceExits = block.match(/killCurrentAutomation\(\)/g) || [];
  assert.ok(forceExits.length >= 3);
  assert.match(
    block,
    /setTimeout\(\(\) => \{\s*transport\.killCurrentAutomation\(\);\s*process\.exit\(1\);/,
  );
  // The old flat 5s force-exit, which died mid-send, must not come back.
  assert.doesNotMatch(block, /5_000/);
});

test('the LaunchAgent tells launchd to outlast the force deadline', async () => {
  const source = await fs.readFile(
    new URL('../scripts/install-relay.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /<key>ExitTimeOut<\/key>[\s\S]{0,400}<integer>60<\/integer>/,
  );
});

test('the transport records its child while a run is in flight', async () => {
  const source = await fs.readFile(
    new URL('../src/accessibility.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /this\.#currentChild = pending\.child/);
  assert.match(source, /const \{ stdout \} = await pending/);
  // The finally block clears both trackers so a settled run can never be
  // mistaken for an in-flight one by drain or the killer.
  assert.match(
    source,
    /finally \{\s*this\.#busy -= 1;\s*this\.#currentChild = null;\s*\}/,
  );
});
