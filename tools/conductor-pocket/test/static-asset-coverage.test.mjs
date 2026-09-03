import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

// The server serves nothing it was not explicitly told to (staticFiles is an
// allowlist), and the service worker precaches an explicit shell list. A file
// that exists on disk and sits in the shell list but is missing from the
// server's allowlist 404s in production while every deploy check stays green,
// and because the app is an ES module graph, one missing module blanks the
// entire phone app. This lock forces the three lists (shell, modulepreload,
// server allowlist) to agree so that class of breakage dies at test time.

const [serverSource, swSource, indexSource] = await Promise.all([
  fs.readFile(new URL('../src/server.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
]);

function shellPaths() {
  const start = swSource.indexOf('const SHELL = [');
  const end = swSource.indexOf('];', start);
  const block = swSource.slice(start, end);
  return [...block.matchAll(/'(\/[^']*)'/g)]
    .map(([, raw]) => raw.split('?')[0])
    .filter((p) => p !== '/');
}

test('every service worker shell asset is in the server allowlist', () => {
  const paths = shellPaths();
  assert.ok(paths.length >= 10);
  for (const path of paths) {
    assert.ok(
      serverSource.includes(`'${path}'`),
      `service worker precaches ${path} but the server allowlist cannot serve it`,
    );
  }
});

test('every modulepreload in index.html is in the server allowlist and shell list', () => {
  const preloads = [
    ...indexSource.matchAll(/modulepreload" href="(\/[^"?]+)/g),
  ].map(([, p]) => p);
  assert.ok(preloads.length >= 8);
  for (const path of preloads) {
    assert.ok(
      serverSource.includes(`'${path}'`),
      `index.html preloads ${path} but the server allowlist cannot serve it`,
    );
    assert.ok(
      swSource.includes(`'${path}`),
      `index.html preloads ${path} but the service worker shell list misses it`,
    );
  }
});

test('every module app.js imports is in the server allowlist', async () => {
  const appSource = await fs.readFile(
    new URL('../public/app.js', import.meta.url),
    'utf8',
  );
  const imports = [
    ...appSource.matchAll(/from '\.(\/[^'?]+)(?:\?[^']*)?'/g),
  ].map(([, p]) => p);
  assert.ok(imports.length >= 8);
  for (const path of imports) {
    assert.ok(
      serverSource.includes(`'${path}'`),
      `app.js imports ${path} but the server allowlist cannot serve it, which blanks the whole app`,
    );
  }
});

test('usage state ships as a revisioned checked shell module', async () => {
  const revision = swSource.match(
    /const SHELL_REVISION = '([^']+)'/,
  )?.[1];
  assert.ok(revision);
  assert.ok(
    swSource.includes(`'/usage-state.js?v=${revision}'`),
    'service worker shell must cache the revisioned usage state module',
  );
  assert.ok(
    indexSource.includes(
      `rel="modulepreload" href="/usage-state.js?v=${revision}"`,
    ),
    'index must preload the matching usage state revision',
  );
  assert.ok(
    serverSource.includes("'/usage-state.js'"),
    'server allowlist must serve the usage state module',
  );
  const packageSource = await fs.readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  );
  assert.ok(
    packageSource.includes('node --check public/usage-state.js'),
    'package check must syntax-check the usage state module',
  );
});

test('connection diagnosis ships as a revisioned checked shell module', async () => {
  const revision = swSource.match(
    /const SHELL_REVISION = '([^']+)'/,
  )?.[1];
  assert.ok(revision);
  assert.ok(
    swSource.includes(`'/connection-diagnosis.js?v=${revision}'`),
    'service worker shell must cache the revisioned diagnosis module',
  );
  assert.ok(
    indexSource.includes(
      `rel="modulepreload" href="/connection-diagnosis.js?v=${revision}"`,
    ),
    'index must preload the matching diagnosis revision',
  );
  assert.ok(
    serverSource.includes("'/connection-diagnosis.js'"),
    'server allowlist must serve the diagnosis module',
  );
  const packageSource = await fs.readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  );
  assert.ok(
    packageSource.includes('node --check public/connection-diagnosis.js'),
    'package check must syntax-check the diagnosis module',
  );
});
