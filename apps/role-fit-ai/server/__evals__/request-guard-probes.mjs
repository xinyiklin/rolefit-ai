// Deterministic Host/Origin guard probes for loopback and HOST-override binds.
import assert from "node:assert/strict";
import { hostname } from "node:os";

import { requestGuardError } from "../runtime.ts";

const FORBIDDEN = "Forbidden host.";
const CROSS = "Cross-origin request blocked.";
const port = 5181;

// Loopback bind: the three local spellings, nothing else, on the listening port.
for (const local of ["localhost:5181", "127.0.0.1:5181", "[::1]:5181", "LOCALHOST:5181"]) {
  assert.equal(requestGuardError("127.0.0.1", port, local, undefined), null, local);
}
assert.equal(requestGuardError("127.0.0.1", port, "localhost:5181", "http://127.0.0.1:5181"), null);
assert.equal(requestGuardError("127.0.0.1", port, "attacker.example", undefined), FORBIDDEN);
assert.equal(requestGuardError("127.0.0.1", port, "192.168.1.5:5181", undefined), FORBIDDEN, "a loopback bind never answers a LAN name");
assert.equal(requestGuardError("127.0.0.1", port, "localhost:5182", undefined), FORBIDDEN);
assert.equal(requestGuardError("127.0.0.1", port, undefined, undefined), FORBIDDEN);
assert.equal(requestGuardError("127.0.0.1", port, "127.0.0.1:5181", "https://attacker.example"), CROSS);
assert.equal(requestGuardError("127.0.0.1", port, "127.0.0.1:5181", "http://localhost:5555"), CROSS, "another localhost app is another origin");
assert.equal(requestGuardError("127.0.0.1", port, "127.0.0.1:5181", "null"), CROSS);

// HOST override: any address of this machine may reach it, but only the page it
// served may call it, and a rebound site name is refused even when same-origin.
for (const bind of ["0.0.0.0", "::"]) {
  assert.equal(requestGuardError(bind, port, "192.168.1.5:5181", undefined), null, `${bind}: LAN address`);
  assert.equal(requestGuardError(bind, port, "192.168.1.5:5181", "http://192.168.1.5:5181"), null, `${bind}: same-origin LAN page`);
  assert.equal(requestGuardError(bind, port, "[fe80::1]:5181", "http://[fe80::1]:5181"), null, `${bind}: IPv6 literal`);
  assert.equal(requestGuardError(bind, port, "localhost:5181", "http://localhost:5181"), null, `${bind}: local user`);
  assert.equal(requestGuardError(bind, port, `${hostname()}:5181`, undefined), null, `${bind}: machine name`);

  assert.equal(requestGuardError(bind, port, "192.168.1.5:5181", "https://attacker.example"), CROSS, `${bind}: cross-site request`);
  assert.equal(requestGuardError(bind, port, "192.168.1.5:5181", "http://192.168.1.6:5181"), CROSS, `${bind}: another LAN origin`);
  assert.equal(requestGuardError(bind, port, "192.168.1.5:5181", "http://localhost:5181"), CROSS, `${bind}: origin must equal this request's Host`);
  assert.equal(requestGuardError(bind, port, "192.168.1.5:5181", "null"), CROSS, `${bind}: opaque origin`);

  assert.equal(requestGuardError(bind, port, "attacker.example:5181", "http://attacker.example:5181"), FORBIDDEN, `${bind}: DNS rebinding`);
  assert.equal(requestGuardError(bind, port, "attacker.example:5181", undefined), FORBIDDEN, `${bind}: rebound navigation`);
  assert.equal(requestGuardError(bind, port, "192.168.1.5:5182", undefined), FORBIDDEN, `${bind}: wrong port`);
  assert.equal(requestGuardError(bind, port, "192.168.1.5", undefined), FORBIDDEN, `${bind}: default port is not the listener`);
  assert.equal(requestGuardError(bind, port, "user@192.168.1.5:5181", undefined), FORBIDDEN, `${bind}: userinfo`);
  assert.equal(requestGuardError(bind, port, "192.168.1.5:5181/x", undefined), FORBIDDEN, `${bind}: path`);
  assert.equal(requestGuardError(bind, port, "3232235781:5181", undefined), FORBIDDEN, `${bind}: non-canonical IPv4`);
  assert.equal(requestGuardError(bind, port, "", undefined), FORBIDDEN, `${bind}: empty Host`);
  assert.equal(requestGuardError(bind, port, undefined, "null"), FORBIDDEN, `${bind}: missing Host`);
}
assert.equal(requestGuardError("0.0.0.0", 80, "192.168.1.5", "http://192.168.1.5"), null, "port 80 omits the port in Host and Origin");
assert.equal(requestGuardError("rolefit-box.lan", port, "rolefit-box.lan:5181", "http://rolefit-box.lan:5181"), null, "an explicit HOST name is this machine's own");

console.log("request guard probes passed");
