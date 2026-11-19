// Loaded with --import in isolated fixtures when OMB_TEST_FAKE_BROWSER names a folder: the bots' browser is the driver's
// fake Chrome. Each start appends the profile's key and its egress gate's port to egress.txt there, and a preview capture
// (the final screen of a turn) writes capture.entered, waits for capture.gate, and writes capture.finished once answered.
// With OMB_TEST_FAKE_PAGE, a test's page answers instead: fill_login's reads and typing, and the tools that
// OMB_TEST_FAKE_PAGE_TOOLS names, go to that address (/engine, /api/command, /mcp), and each fake tab starts on
// OMB_TEST_FAKE_START_URL.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { userInfo } from 'node:os';
import { join } from 'node:path';

const gates = process.env.OMB_TEST_FAKE_BROWSER;
const dataDir = process.env.OMB_DATA_DIR;
if (!gates || !dataDir || !process.env.HOME || process.env.HOME === userInfo().homedir) throw new Error('The fake browser seam requires an isolated fixture with a home of its own');

const { FakeBackend, FakeChrome } = await import(new URL('../browser/testing/fake-chrome.ts', import.meta.url).href);
const startUrl = process.env.OMB_TEST_FAKE_START_URL;
class GatedChrome extends FakeChrome {
  constructor() {
    super(startUrl ? { startUrls: [startUrl] } : {});
  }

  send(message) {
    const { method, params = {} } = JSON.parse(message);
    if (method !== 'Page.captureScreenshot' || params.format !== 'jpeg' || params.quality !== 80) return super.send(message);
    writeFileSync(join(gates, 'capture.entered'), 'started');
    const timer = setInterval(() => {
      if (!existsSync(join(gates, 'capture.gate'))) return;
      clearInterval(timer);
      super.send(message);
      setTimeout(() => writeFileSync(join(gates, 'capture.finished'), 'finished'), 0);
    }, 10);
  }
}
class GatedBackend extends FakeBackend {
  constructor(options) {
    super(() => new GatedChrome());
    this.options = options;
  }

  async open(request) {
    appendFileSync(join(gates, 'egress.txt'), `${request.key} ${await this.options.egressPort(request.key)}\n`);
    return super.open(request);
  }
}
let backend = null;
globalThis.__ombTestBrowserBackend = (options) => (backend ??= new GatedBackend(options));

const page = process.env.OMB_TEST_FAKE_PAGE;
const pageTools = new Set((process.env.OMB_TEST_FAKE_PAGE_TOOLS ?? '').split(',').filter(Boolean));
const post = async (path, body) => (await fetch(page + path, { method: 'POST', body: JSON.stringify(body) })).json();
const command = async (body) => {
  const answer = await post('/api/command', body);
  if (!answer.success) throw new Error(answer.error ?? `the page refused ${body.action}`);
};
globalThis.__ombTestLoginDeps = () => (page ? {
  engine: async (args) => {
    const answer = await post('/engine', { args });
    if (!answer.success) throw new Error(answer.error ?? 'the page did not answer');
    return answer.data ?? null;
  },
  insertText: (text) => command({ action: 'keyboard', subaction: 'insertText', text }),
  press: (key) => command({ action: 'press', key }),
  click: (selector) => command({ action: 'click', selector }),
} : null);
globalThis.__ombTestPageTool = (method, params, beforeDispatch) => {
  if (!page || method !== 'tools/call' || !pageTools.has(params?.name)) return null;
  beforeDispatch?.();
  return post('/mcp', params);
};

const SEAMS = [
  ['backend: () => backend,', 'backend: () => globalThis.__ombTestBrowserBackend(options),'],
  ['return target ? this.service.loginDeps(target) : null;', 'return target ? (globalThis.__ombTestLoginDeps() ?? this.service.loginDeps(target)) : null;'],
  ['await this.#chrome.service.agentRpc(target, method, params, beforeDispatch);', 'await (globalThis.__ombTestPageTool(method, params, beforeDispatch) ?? this.#chrome.service.agentRpc(target, method, params, beforeDispatch));'],
];
const engines = new URL('../browser/engines.ts', import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== engines) return result;
    let source = String(result.source);
    for (const [anchor, replacement] of SEAMS) {
      if (!source.includes(anchor)) throw new Error('Fake browser seam changed');
      source = source.replace(anchor, replacement);
    }
    return { ...result, source };
  },
});
