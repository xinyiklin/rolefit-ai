import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function runHostAuditContracts({ makeWindow, waitFor, baseUrl, hosts = ['typeset', 'resume', 'cover'] }) {
  const source = JSON.parse(await readFile(new URL('../../apps/role-fit-ai/server/starter.resume', import.meta.url), 'utf8'));
  source.document.header = { visible: true, name: 'Synthetic name words '.repeat(12), contact: ['Synthetic contact words '.repeat(22), 'neighbor@example.test'] };
  const receipt = [];
  const evidence = process.env.ROLEFIT_EDITOR_WRAPPED_AUDIT_DIR;
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const host of hosts) {
    const page = await makeWindow();
    const call = (method, params) => page.connection.send(method, params, page.sessionId);
    const evaluate = (fn, ...args) => page.evaluate(`(${fn})(${args.map(x => JSON.stringify(x)).join(',')})`);
    const settle = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const key = async (key, code) => {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code });
      await settle();
    };
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.clear();
      localStorage.setItem('typeset-resume.autosave.v2', ${JSON.stringify(JSON.stringify(source))});
      localStorage.setItem('typeset-resume.documentTitle.v1', 'Synthetic wrapped resume');
      const originalFetch = window.fetch;
      window.__hostAuditRequests = [];
      window.fetch = (input, options) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url === '/api/workspace') {
          window.__hostAuditRequests.push(url);
          return Promise.resolve(new Response(JSON.stringify({ coverLetterOptions: [], coverLetterHistory: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (new URL(url, location.href).pathname.startsWith('/api/')) throw new Error('Unexpected host audit API request: ' + url);
        return originalFetch(input, options);
      };
    ` });
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.loadURL(`${baseUrl}#${host === 'typeset' ? 'typeset' : `host-audit-${host}`}`);
    await waitFor(page, `document.querySelector('[contenteditable=true] [data-tsdf="name"]')?.textContent.includes('Synthetic')`, `${host} real host long header`);
    await page.evaluate('document.fonts.ready');
    await settle();
    const widths = host === 'typeset' ? [1440, 1024, 720, 390] : host === 'resume' ? [1440, 720, 390] : [1440, 390];
    for (const width of widths) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await settle();
      for (const preference of ['light', 'dark']) {
        await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: preference }] });
        await settle();
        const result = await evaluate(() => {
          const editor = document.querySelector('[contenteditable=true]');
          const fields = [...(editor?.querySelectorAll('[data-tsdf]:not([data-tsdm])') ?? [])];
          const outside = fields.flatMap(span => {
            const page = editor.querySelector(`.tsd-page[data-tsd-page="${span.dataset.tsdPage}"]`) ?? span.closest('.tsd-page');
            if (!page) return [{ key: span.dataset.tsdf, missingPage: true }];
            const r = span.getBoundingClientRect(), p = page.getBoundingClientRect();
            return r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1 ? [{ key: span.dataset.tsdf, left: r.left-p.left, right: r.right-p.right, bottom: r.bottom-p.bottom }] : [];
          });
          return { width: innerWidth, editor: !!editor, notice: document.querySelector('.viewport-gate')?.textContent, outside, colorScheme: getComputedStyle(document.documentElement).colorScheme, pageCount: editor?.querySelectorAll('.tsd-page').length ?? 0, horizontalDocumentOverflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert.equal(result.width, width);
        assert.equal(result.colorScheme, 'light', `${host} supported light palette remains explicit under ${preference} OS preference`);
        if (host === 'resume' && width <= 720) {
          assert.equal(result.editor, false);
          assert.match(result.notice, /Resume authoring needs more room/);
        } else {
          assert.equal(result.editor, true, `${host}/${width} editor remains available`);
          assert.deepEqual(result.outside, [], `${host}/${width} text stays inside document pages`);
          assert(result.pageCount > 0);
        }
        assert(result.horizontalDocumentOverflow <= 1, `${host}/${width} shell does not overflow viewport: ${result.horizontalDocumentOverflow}px`);
        receipt.push({ host, preference, ...result });
        if (evidence) await writeFile(join(evidence, 'host-audit.json'), JSON.stringify(receipt, null, 2));
      }
      if (host !== 'resume') {
        await evaluate(() => document.querySelector('button[aria-label="Open"]').focus());
        await key('Enter', 13);
        try {
          await waitFor(page, `document.querySelector('[role=dialog][aria-label="Open options"]')`, `${host}/${width} keyboard Open menu`);
        } catch (error) {
          if (evidence) {
            const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            await writeFile(join(evidence, `host-${host}-${width}-menu-failure.png`), Buffer.from(shot.data, 'base64'));
          }
          throw new Error(`${error.message} ${JSON.stringify(await evaluate(() => ({ active: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') }, dialogs: [...document.querySelectorAll('[role=dialog]')].map(el => ({ label: el.getAttribute('aria-label'), text: el.textContent })), open: document.querySelector('button[aria-label="Open"]')?.outerHTML })))}`);
        }
        await evaluate(async () => {
          const dialog = document.querySelector('[role=dialog][aria-label="Open options"]');
          await Promise.all(dialog.getAnimations().map(animation => animation.finished));
        });
        const menu = await evaluate(() => {
          const dialog = document.querySelector('[role=dialog][aria-label="Open options"]');
          const r = dialog.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, focusInside: dialog.contains(document.activeElement) };
        });
        if (evidence) {
          const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          await writeFile(join(evidence, `host-${host}-${width}-open-menu.png`), Buffer.from(shot.data, 'base64'));
        }
        assert(menu.left >= -1 && menu.right <= width + 1 && menu.top >= -1 && menu.bottom <= 1001, `${host}/${width} menu stays within viewport: ${JSON.stringify(menu)}`);
        assert.equal(menu.focusInside, true, `${host} keyboard menu moves focus inside`);
        await key('Escape', 27);
        assert.equal(await evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Open', `${host} Escape restores trigger focus`);
      }
      if (evidence) {
        const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await writeFile(join(evidence, `host-${host}-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await settle();
    for (const [fileName, text] of [[`truncated.${host === 'cover' ? 'cover' : 'resume'}`, '{"format":'], [`wrong-kind.${host === 'cover' ? 'cover' : 'resume'}`, JSON.stringify({ ...source, format: host === 'cover' ? 'typeset-resume' : 'typeset-cover-letter' })]]) {
      if (host === 'typeset') {
        await evaluate(() => document.querySelector('button[aria-label="Spacing"]').click());
        await waitFor(page, `document.querySelector('[aria-label="Document spacing"] input[type=range]')`, 'Typeset spacing control');
        await evaluate(() => {
          const input = document.querySelector('[aria-label="Document spacing"] input[type=range]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(Number(input.value) + Number(input.step)));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await key('Escape', 27);
      } else {
        await evaluate(() => window.__hostAudit.changeStyle());
        await settle();
      }
      await evaluate(() => {
        const editor = document.querySelector('[contenteditable=true]');
        const span = editor.querySelector('[data-tsdf="name"]');
        editor.focus();
        const range = document.createRange();
        const node = document.createTreeWalker(span, NodeFilter.SHOW_TEXT).nextNode();
        range.setStart(node, 3); range.collapse(true);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await settle();
      await call('Input.insertText', { text: 'X' });
      await settle();
      const snapshot = () => evaluate(() => {
        const hostState = window.__hostAudit?.snapshot();
        if (hostState) { const { error, ...documentState } = hostState; return documentState; }
        const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
        return { title: document.querySelector('[aria-label="Document title"]')?.value, dirty: event.defaultPrevented,
          fields: [...document.querySelectorAll('[contenteditable=true] [data-tsdf]')].map(el => ({ key: el.dataset.tsdf, text: el.textContent, font: getComputedStyle(el).font, left: el.style.left, top: el.style.top })) };
      });
      const before = await snapshot();
      assert.equal(before.dirty, true, `${host} wrapped edit is dirty before malformed open`);
      const previousError = await evaluate(() => window.__hostAudit?.snapshot().error ?? document.querySelector('[role=alert]')?.textContent ?? '');
      await evaluate((fileName, text) => {
        const input = document.querySelector('input[type=file]');
        const transfer = new DataTransfer(); transfer.items.add(new File([text], fileName, { type: 'application/json' }));
        input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      }, fileName, text);
      await waitFor(page, `(() => { const error = window.__hostAudit?.snapshot().error ?? document.querySelector('[role=alert]')?.textContent ?? ''; return error && error !== ${JSON.stringify(previousError)}; })()`, `${host} rejects ${fileName}`);
      await settle();
      assert.deepEqual(await snapshot(), before, `${host} rejected ${fileName} preserves content, style, dirty state and identity`);
      assert.equal(await evaluate(() => document.querySelector('input[type=file]').value), '', `${host} file input resets after rejection`);
      if (host === 'typeset') await evaluate(() => document.querySelector('[aria-label="Dismiss message"]')?.click());
    }
    receipt.push({ host, rejectedFilesPreserved: true, requests: await evaluate(() => window.__hostAuditRequests) });
    await page.destroy();
  }
  if (evidence) await writeFile(join(evidence, 'host-audit.json'), JSON.stringify(receipt, null, 2));
  console.log(`Host audit (${hosts.join(', ')}): exact widths, light palette under both OS preferences, keyboard Open/focus, malformed/wrong-kind UI preservation passed`);
}
