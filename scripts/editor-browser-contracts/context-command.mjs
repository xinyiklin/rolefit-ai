export async function contextCommand(h, key, label, changed) {
  h.page.contractPhase = `wrapped structure: ${label}`;
  h.page.contextTarget = key;
  await h.key('Escape', 27);
  const point = await h.evaluate(async key => {
    const target = () => [...document.querySelectorAll('[contenteditable=true] [data-tsdf]')]
      .find(span => span.getAttribute('data-tsdf') === key);
    const span = target();
    if (!span) throw new Error(`Missing context target ${key}`);
    let scrollVersion = 0;
    const onScroll = () => { scrollVersion++; };
    window.addEventListener('scroll', onScroll, true);
    try {
      span.scrollIntoView({ block: 'center', behavior: 'instant' });
      const deadline = performance.now() + 5_000;
      let previous, stableFrames = 0;
      // A menu opened before queued scroll events drain is dismissed by the editor.
      while (performance.now() < deadline) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const current = target();
        if (!current) throw new Error(`Missing context target ${key} after scrolling`);
        const rect = current.getBoundingClientRect();
        const geometry = JSON.stringify([rect.x, rect.y, rect.width, rect.height, scrollVersion]);
        stableFrames = geometry === previous ? stableFrames + 1 : 0;
        previous = geometry;
        if (stableFrames >= 2) {
          const x = rect.left + Math.min(3, rect.width / 2), y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y)?.closest('[data-tsdf]');
          if (hit?.getAttribute('data-tsdf') !== key) throw new Error(`Context target ${key} is obscured or outside the viewport`);
          return { x, y };
        }
      }
      throw new Error(`Context target ${key} did not settle before opening its menu`);
    } finally {
      window.removeEventListener('scroll', onScroll, true);
    }
  }, key);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await h.page.connection.send('Input.dispatchMouseEvent', { type, ...point, button: 'right', clickCount: 1 }, h.page.sessionId);
  }
  await h.waitFor(h.page, `(() => {
    const button = [...document.querySelectorAll('.ts-context-menu button')]
      .find(button => button.textContent.trim() === ${JSON.stringify(label)});
    return button && !button.disabled;
  })()`, `enabled wrapped structure command ${label} on ${key}`);
  await h.evaluate(label => {
    const button = [...document.querySelectorAll('.ts-context-menu button')]
      .find(button => button.textContent.trim() === label);
    if (!button || button.disabled) throw new Error(`Unavailable wrapped structure command ${label}`);
    button.click();
  }, label);
  await h.waitFor(h.page, `(${changed})(window.__rowContract.data)`, `${label} document mutation`);
  await h.settle();
}
