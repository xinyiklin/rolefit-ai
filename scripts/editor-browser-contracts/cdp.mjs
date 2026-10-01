export class CdpConnection {
  constructor(socket, { onEvent = () => {}, timeoutMs = 30_000 } = {}) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        request.finish(message.error
          ? new Error(`${request.method}: ${message.error.message}`)
          : null, message.result);
      } else {
        onEvent(message);
      }
    });
    socket.addEventListener('close', () => this.rejectPending('connection closed'));
    socket.addEventListener('error', () => this.rejectPending('connection error'));
  }

  static async connect(url, options) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        socket.removeEventListener('open', opened);
        socket.removeEventListener('error', failed);
        socket.removeEventListener('close', failed);
        if (error) { socket.close(); reject(error); } else resolve();
      };
      const opened = () => finish();
      const failed = () => finish(new Error('CDP connection failed before opening'));
      const timer = setTimeout(() => finish(new Error('CDP connection timed out after 15000ms')), 15_000);
      socket.addEventListener('open', opened, { once: true });
      socket.addEventListener('error', failed, { once: true });
      socket.addEventListener('close', failed, { once: true });
    });
    return new CdpConnection(socket, options);
  }

  send(method, params = {}, sessionId, timeoutMs = this.timeoutMs) {
    if (this.closed || this.socket.readyState !== 1) {
      return Promise.reject(new Error(`${method}: CDP connection is not open`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error(`${method}: CDP command timed out after ${timeoutMs}ms`)), timeoutMs);
      this.pending.set(id, { method, finish });
      try {
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (error) {
        finish(new Error(`${method}: CDP send failed: ${error.message}`, { cause: error }));
      }
    });
  }

  rejectPending(reason) {
    this.closed = true;
    for (const { method, finish } of this.pending.values()) {
      finish(new Error(`${method}: CDP ${reason}`));
    }
  }

  close() {
    this.rejectPending('connection closed');
    this.socket.close();
  }
}
