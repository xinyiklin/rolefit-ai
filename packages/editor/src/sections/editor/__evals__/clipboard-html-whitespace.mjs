// Clipboard HTML import collapses source whitespace the way a browser lays it
// out: pretty-printed or Word markup must not paste its newlines and indentation
// as hard breaks or leading spaces, while preformatted text keeps them.
// Node has no DOMParser, so this installs a minimal one for well-formed fixtures.
import assert from "node:assert/strict";

class FakeText {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = value;
  }
}

class FakeComment {
  constructor(value) {
    this.nodeType = 8;
    this.nodeValue = value;
  }
}

const STYLE_PROPS = [
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "textDecorationLine",
  "fontFamily",
  "fontSize",
  "lineHeight",
  "marginTop",
  "marginBlockStart",
  "marginBottom",
  "marginBlockEnd",
  "whiteSpace",
  "whiteSpaceCollapse"
];

class FakeElement {
  constructor(tagName, attributes = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.childNodes = [];
    this.style = Object.fromEntries(STYLE_PROPS.map((prop) => [prop, ""]));
    for (const declaration of (attributes.style ?? "").split(";")) {
      const [name, ...rest] = declaration.split(":");
      if (!name?.trim() || !rest.length) continue;
      const prop = name.trim().toLowerCase().replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      this.style[prop] = rest.join(":").trim();
    }
    const style = this.style;
    style.getPropertyValue = (name) => style[name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? "";
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

const VOID_TAGS = new Set(["br", "meta", "img", "hr"]);
const decode = (value) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

function parse(html) {
  const body = new FakeElement("body");
  const stack = [body];
  const pattern = /<!--([\s\S]*?)-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>|([^<]+)/g;
  for (const match of html.matchAll(pattern)) {
    const [, comment, closing, opening, rawAttributes, text] = match;
    const parent = stack[stack.length - 1];
    if (comment !== undefined) parent.childNodes.push(new FakeComment(comment));
    else if (text !== undefined) parent.childNodes.push(new FakeText(decode(text)));
    else if (closing !== undefined) {
      const index = stack.findLastIndex((element) => element.tagName === closing.toUpperCase());
      if (index > 0) stack.length = index;
    } else {
      const attributes = {};
      for (const [, name, doubleQuoted, singleQuoted, unquoted] of rawAttributes.matchAll(
        /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
      )) {
        attributes[name.toLowerCase()] = decode(doubleQuoted ?? singleQuoted ?? unquoted ?? "");
      }
      const element = new FakeElement(opening, attributes);
      parent.childNodes.push(element);
      if (!VOID_TAGS.has(opening.toLowerCase())) stack.push(element);
    }
  }
  return body;
}

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, COMMENT_NODE: 8 };
globalThis.HTMLElement = FakeElement;
globalThis.DOMParser = class {
  parseFromString(html) {
    return { body: parse(html) };
  }
};

const { inlineFragmentFromHtml, paragraphFragmentsFromHtml } = await import("../clipboardHtmlImport.ts");

// Pretty-printed markup: indentation and newlines between and inside blocks.
assert.deepEqual(
  paragraphFragmentsFromHtml(`
    <div>
      <p>
        Led the migration
        to TypeScript.
      </p>
      <p>Shipped <b>three</b>   releases.</p>
    </div>
  `),
  ["Led the migration to TypeScript.", "Shipped <b>three</b> releases."],
  "source newlines and indentation collapse; whitespace between blocks is dropped"
);

// Word's HTML wraps long lines inside text and tags.
const wordHtml = `<html>\r\n<body lang=EN-US>\r\n<!--StartFragment-->\r\n<p class=MsoNormal><b><span\r\nstyle='font-size:12.0pt'>Label:\r\n</span></b><span style='font-size:12.0pt'>value\r\ntext<o:p></o:p></span></p>\r\n<p class=MsoNormal>Second\r\n  line</p>\r\n<!--EndFragment-->\r\n</body>\r\n</html>`;
assert.deepEqual(
  paragraphFragmentsFromHtml(wordHtml),
  ["<size=12><b>Label: </b></size><size=12>value text</size>", "Second line"],
  "Word line wrapping becomes single spaces, and the space inside a styled run survives"
);

assert.equal(
  inlineFragmentFromHtml("<span>\n  Acme\n  Corp\n</span>"),
  "Acme Corp",
  "an inline fragment trims its collapsed edges and never gains a hard break"
);

// Existing inline behavior: the space between two inline runs stays.
assert.deepEqual(
  paragraphFragmentsFromHtml('<p><strong>Rich</strong> <a href="https://example.com">link</a></p>'),
  ["<b>Rich</b> <link=https%3A%2F%2Fexample.com%2F>link</link>"],
  "a single space between inline runs is preserved"
);

assert.deepEqual(
  paragraphFragmentsFromHtml("<p>one <br>\n  two</p>"),
  ["one\ntwo"],
  "a <br> still breaks the line, trimming the collapsed space around it"
);

assert.deepEqual(
  paragraphFragmentsFromHtml("<p>a&nbsp;&nbsp;b</p>"),
  ["a  b"],
  "non-breaking spaces never collapse"
);

// Preformatted text keeps its whitespace.
assert.deepEqual(
  paragraphFragmentsFromHtml("<pre>line one\n  indented</pre>"),
  ["line one\n  indented"],
  "PRE preserves newlines and indentation"
);
assert.equal(
  inlineFragmentFromHtml('<span style="white-space: pre-wrap">a  b\nc</span>'),
  "a  b\nc",
  "white-space: pre-wrap (the editor's own HTML export) preserves spaces and newlines"
);
assert.equal(
  inlineFragmentFromHtml('<span style="white-space: pre-line">a   b \n  c</span>'),
  "a b\nc",
  "white-space: pre-line collapses spaces but keeps newlines"
);
assert.equal(
  inlineFragmentFromHtml('<span style="white-space-collapse: preserve">a  b</span>'),
  "a  b",
  "white-space-collapse: preserve keeps spaces"
);
assert.equal(
  inlineFragmentFromHtml('<span style="white-space: preserve nowrap">a  b</span>'),
  "a  b",
  "two-value white-space syntax keeps spaces"
);

// The editor's own external HTML round-trips unchanged.
assert.deepEqual(
  paragraphFragmentsFromHtml(
    '<p style="margin-top: 0pt; margin-bottom: 0pt"><span style="font-weight: 700; white-space: pre-wrap">Lead </span><span style="white-space: pre-wrap">engineer</span></p>'
  ),
  ["<b>Lead </b>engineer"],
  "pre-wrap runs from the editor's export keep their edge spaces"
);

// Clipboard text is literal: entity-escaped tag text never becomes marks.
assert.deepEqual(
  paragraphFragmentsFromHtml("<p>Use &lt;b&gt; and &lt;size=200&gt;big&lt;/size&gt; tags</p>"),
  ["Use <lt>b> and <lt>size=200>big<lt>/size> tags"],
  "tag-shaped clipboard text is escaped, not parsed"
);
assert.deepEqual(
  paragraphFragmentsFromHtml("<p><b>a &lt; b</b></p>"),
  ["<b>a <lt> b</b>"],
  "every pasted < is escaped; the editor keeps only the needed ones on insert"
);

// Inline text beside a nested block is its own paragraph (a browser's anonymous
// block box), never fused onto the block's first or last line.
assert.deepEqual(
  paragraphFragmentsFromHtml('<div dir="ltr">Line one<div>Line two</div></div>'),
  ["Line one", "Line two"],
  "Gmail-style text before a nested div stays its own paragraph"
);
assert.deepEqual(
  paragraphFragmentsFromHtml("<ul><li>Item<ul><li>Sub</li></ul></li></ul>"),
  ["Item", "Sub"],
  "a list item's text stays apart from its nested sub-item"
);
assert.deepEqual(
  paragraphFragmentsFromHtml("<div>Intro<p>Para</p>Tail</div><p>Next</p>"),
  ["Intro", "Para", "Tail", "Next"],
  "text before and after a child block is separate from it and from the next block"
);
assert.equal(
  inlineFragmentFromHtml('<div dir="ltr">Line one<div>Line two</div></div>'),
  "Line one\nLine two",
  "the inline form breaks the line between the text and the nested block"
);

// A <br> that ends its block paints no extra line; interior breaks still do.
assert.deepEqual(
  paragraphFragmentsFromHtml("<p><b>Built APIs<br></b></p>"),
  ["<b>Built APIs</b>"],
  "a trailing <br> adds no hard break"
);
assert.deepEqual(
  paragraphFragmentsFromHtml("<div>Line one</div><div><br></div><div>Line two</div>"),
  ["Line one", "", "Line two"],
  "an empty <div><br></div> spacer is one empty paragraph, not a hard break"
);
assert.equal(
  inlineFragmentFromHtml("<div>Line one</div><div><br></div><div>Line two</div>"),
  "Line one\n\nLine two",
  "the inline form of a spacer is one blank line"
);
assert.deepEqual(
  paragraphFragmentsFromHtml("<p>x<br><br></p>"),
  ["x\n"],
  "of two trailing breaks, only the last is dropped"
);
assert.equal(
  inlineFragmentFromHtml("<span>Line one</span><br>"),
  "Line one",
  "a trailing body-level <br> adds no hard break"
);

console.log("clipboard HTML whitespace probes: PASS");
