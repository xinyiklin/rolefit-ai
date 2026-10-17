// Substring search over hostile input. One String.includes call per needle
// costs O(needles × text), which lets a large fetched page stall the server;
// includesEach reads the text once. Kept dependency-free.

// Which `needles` occur in `text`: Aho-Corasick over UTF-16 code units, exact
// like String.includes. Memory is linear in the needles' total length; time is
// linear only for a small alphabet, since each step scans one node's children
// (pageShowsPosting's keys use 37 symbols). Thousands of distinct code units
// under one node would need a different child lookup.
export function includesEach(text: string, needles: readonly string[]): boolean[] {
  const unique = [...new Set(needles)];
  const capacity = unique.reduce((total, needle) => total + needle.length, 1);

  // Build the trie with first-child / next-sibling lists...
  const firstChild = new Int32Array(capacity).fill(-1);
  const nextSibling = new Int32Array(capacity).fill(-1);
  const label = new Uint16Array(capacity);
  let nodes = 1;
  const ends = unique.map((needle) => {
    let node = 0;
    for (let index = 0; index < needle.length; index += 1) {
      const unit = needle.charCodeAt(index);
      let next = firstChild[node];
      while (next >= 0 && label[next] !== unit) next = nextSibling[next];
      if (next < 0) {
        next = nodes++;
        label[next] = unit;
        nextSibling[next] = firstChild[node];
        firstChild[node] = next;
      }
      node = next;
    }
    return node;
  });

  // ...then renumber it breadth-first, so every node's children form one
  // contiguous run (scattered lists made large tries cache-bound): node i's
  // children are i's range [childStart[i], childStart[i + 1]). Failure links
  // (each node's longest proper suffix in the trie) only point shallower, at
  // nodes whose runs are already complete.
  const builtNodeAt = new Int32Array(nodes);
  const renumbered = new Int32Array(nodes);
  const childStart = new Int32Array(nodes + 1);
  const unitAt = new Uint16Array(nodes);
  const fail = new Int32Array(nodes);
  const child = (node: number, unit: number): number => {
    for (let index = childStart[node]; index < childStart[node + 1]; index += 1) {
      if (unitAt[index] === unit) return index;
    }
    return -1;
  };
  let queued = 1;
  for (let head = 0; head < nodes; head += 1) {
    childStart[head] = queued;
    for (let next = firstChild[builtNodeAt[head]]; next >= 0; next = nextSibling[next]) {
      let target = -1;
      for (let suffix = fail[head]; head !== 0; suffix = fail[suffix]) {
        target = child(suffix, label[next]);
        if (target >= 0 || suffix === 0) break;
      }
      builtNodeAt[queued] = next;
      renumbered[next] = queued;
      unitAt[queued] = label[next];
      fail[queued] = Math.max(target, 0);
      queued += 1;
    }
  }
  childStart[nodes] = nodes;

  const reached = new Uint8Array(nodes);
  reached[0] = 1;
  let state = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    let next = child(state, unit);
    while (next < 0 && state !== 0) {
      state = fail[state];
      next = child(state, unit);
    }
    state = Math.max(next, 0);
    reached[state] = 1;
  }
  // A needle occurs where it is a suffix of some reached node; deepest first,
  // so marks travel the whole failure chain.
  for (let node = nodes - 1; node > 0; node -= 1) {
    if (reached[node]) reached[fail[node]] = 1;
  }

  const found = new Map(unique.map((needle, index) => [needle, reached[renumbered[ends[index]]] === 1]));
  return needles.map((needle) => found.get(needle) === true);
}
