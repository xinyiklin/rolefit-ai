import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function captureFailure(pages, directory, report) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  // Persist the original failure even when a dead renderer cannot be inspected.
  await writeFile(join(directory, 'failure.json'), JSON.stringify(report, null, 2));
  await Promise.all([...pages].map(async (page, index) => {
    const details = { phase: page.contractPhase, target: page.contextTarget };
    try {
      const result = await page.connection.send('Runtime.evaluate', {
        expression: `(() => {
          const api = window.__rowContract ?? window.__editorContract;
          const selection = window.getSelection();
          const field = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest('[data-tsdf]')?.getAttribute('data-tsdf');
          return {
            url: location.href,
            menu: [...document.querySelectorAll('.ts-context-menu button')].map(button => ({ label: button.textContent.trim(), disabled: button.disabled })),
            entries: api?.data?.sections?.map(section => ({ id: section.id, entries: section.items?.map(entry => entry.id) })),
            selection: { anchor: field(selection?.anchorNode), anchorOffset: selection?.anchorOffset, focus: field(selection?.focusNode), focusOffset: selection?.focusOffset },
            scroll: { x: scrollX, y: scrollY, containers: [...document.querySelectorAll('*')].filter(element => element.scrollTop || element.scrollLeft).map(element => ({ tag: element.tagName, className: element.className, top: element.scrollTop, left: element.scrollLeft })) }
          };
        })()`, returnByValue: true,
      }, page.sessionId, 5_000);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      details.state = result.result?.value;
    } catch (error) {
      details.inspectionError = error.message;
    }
    try {
      const shot = await page.connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId, 5_000);
      await writeFile(join(directory, `page-${index}.png`), Buffer.from(shot.data, 'base64'));
    } catch (error) {
      details.screenshotError = error.message;
    }
    await writeFile(join(directory, `page-${index}.json`), JSON.stringify(details, null, 2));
  }));
}
