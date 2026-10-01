import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpConnection } from './cdp.mjs';

class Socket extends EventTarget {
  readyState = 1;
  sent = [];
  send(message) { this.sent.push(JSON.parse(message)); }
  reply(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

test('CDP correlates responses and protocol errors, ignores late replies, and delivers events', async () => {
  const socket = new Socket(), events = [];
  const connection = new CdpConnection(socket, { onEvent: event => events.push(event), timeoutMs: 50 });
  const first = connection.send('Runtime.evaluate', { expression: '1' }, 'page');
  const second = connection.send('Page.navigate');
  const rejected = assert.rejects(second, /Page.navigate: invalid URL/);
  assert.equal(socket.sent[0].sessionId, 'page');
  socket.reply({ id: 2, error: { message: 'invalid URL' } });
  socket.reply({ id: 1, result: { value: 1 } });
  socket.reply({ id: 1, result: { value: 2 } });
  socket.reply({ method: 'Runtime.exceptionThrown' });
  assert.deepEqual(await first, { value: 1 });
  await rejected;
  assert.deepEqual(events, [{ method: 'Runtime.exceptionThrown' }]);
  assert.equal(connection.pending.size, 0);
  connection.close();
});

test('a stalled CDP command rejects with its name and clears pending state', { timeout: 500 }, async () => {
  const connection = new CdpConnection(new Socket(), { timeoutMs: 10 });
  await assert.rejects(connection.send('Runtime.evaluate'), /Runtime.evaluate: CDP command timed out after 10ms/);
  assert.equal(connection.pending.size, 0);
  connection.close();
});

for (const event of ['close', 'error']) {
  test(`socket ${event} rejects every pending command and future sends`, async () => {
    const socket = new Socket(), connection = new CdpConnection(socket);
    const checks = ['Runtime.evaluate', 'Target.closeTarget'].map(method =>
      assert.rejects(connection.send(method), new RegExp(`${method}: CDP connection`)));
    socket.dispatchEvent(new Event(event));
    await Promise.all(checks);
    assert.equal(connection.pending.size, 0);
    await assert.rejects(connection.send('Page.navigate'), /Page.navigate: CDP connection is not open/);
  });
}

test('synchronous send failure and local close clear their pending commands', async () => {
  const socket = new Socket(), connection = new CdpConnection(socket);
  socket.send = () => { throw new Error('broken transport'); };
  await assert.rejects(connection.send('Input.insertText'), /Input.insertText: CDP send failed: broken transport/);
  assert.equal(connection.pending.size, 0);
  socket.send = () => {};
  const check = assert.rejects(connection.send('Runtime.evaluate'), /Runtime.evaluate: CDP connection closed/);
  connection.close();
  await check;
  assert.equal(connection.pending.size, 0);
});
