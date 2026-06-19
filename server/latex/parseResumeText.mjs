// Parse a plain-text resume (the human-readable format the AI produces) into a
// canonical schema for LaTeX rendering.
//
// Schema:
//   {
//     name: string,
//     contact: string[],
//     sections: [
//       {
//         heading: string,
//         items: [
//           {
//             title: string,
//             subtitle: string,
//             meta: string,        // typically dates
//             location: string,
//             bullets: string[],
//             raw?: string         // if no heading-like structure (e.g., Skills)
//           }
//         ]
//       }
//     ]
//   }
//
// The parser is heuristic. It detects:
//   - the first line as the name
//   - subsequent lines (before the first section header) as contact lines,
//     split on | • · , and similar separators
//   - SECTION HEADERS as short ALL-CAPS lines
//   - bullet lines (-, *, •, ◦, 1., etc.) attach to the most recent item
//   - non-bullet lines inside a section are interpreted as item headings,
//     split on | (or " — ") for title / subtitle / dates / location

import { isSummaryHeading } from "./util.mjs";

// Kept in sync with src/lib/resumeData.ts (BULLET_RE, SECTION_RE,
// KNOWN_SECTION_TITLE_RE, isSectionHeader) and the scorer's bullet glyph set in
// src/resume/text.ts — the client editor and this server render path must segment
// the same pasted resume identically.
const BULLET_RE = /^\s*(?:[-*•◦▪▫■□●○‣⁃∙]|\d+[.)])\s+/;
const SECTION_RE = /^[A-Z0-9][A-Z0-9 &/\-]+$/;
// A recognized section-title phrase in ANY case, anchored to the whole line (with
// only an optional "& X" tail) so a Title-Case header parses but a job title that
// merely contains a section word ("Education Coordinator") does not.
const KNOWN_SECTION_TITLE_RE =
  /^(?:(?:work|professional|relevant|employment|career|academic|technical|core|key|other|additional|selected|personal)\s+)*(?:experience|education|skills|projects?|summary|objective|profile|highlights?|certifications?|licenses?|achievements?|accomplishments?|awards?|honou?rs?|background|history|publications?|patents?|involvement|activities|interests|languages?|volunteer(?:ing)?|leadership|coursework|competenc(?:e|ies)|qualifications?)(?:\s*(?:&|and|\/)\s*[a-z]+)?$/i;
const HEADING_SPLIT_RE = /\s*[|•·]\s+/;
const CONTACT_SPLIT_RE = /\s*[|•·]\s+/;

function isSectionHeader(line) {
  // Tolerate a trailing colon ("Experience:") which the char classes reject.
  const trimmed = line.trim().replace(/:$/, "");
  if (trimmed.length < 2 || trimmed.length > 50) return false;
  // Avoid catching a SHOUTING company name. Section headings are usually one or
  // two words; allow up to 4.
  if (trimmed.split(/\s+/).length > 4) return false;
  // ALL-CAPS short line OR a recognized section-title phrase in any case.
  return SECTION_RE.test(trimmed) || KNOWN_SECTION_TITLE_RE.test(trimmed);
}

function stripBullet(line) {
  return line.replace(BULLET_RE, "").trim();
}

function parseItemHeading(line) {
  const trimmed = line.trim();
  // Handle "Title — Subtitle — Dates — Location" with em-dash or hyphen too
  const sepNormalized = trimmed.replace(/\s+[—–]\s+/g, " | ");
  const parts = sepNormalized.split(HEADING_SPLIT_RE).map((piece) => piece.trim()).filter(Boolean);

  return {
    title: parts[0] || "",
    subtitle: parts[1] || "",
    meta: parts[2] || "",
    location: parts[3] || "",
    bullets: []
  };
}

function parseContactLines(lines) {
  if (!lines.length) return [];
  // Join all contact lines into one logical line, then split on separators.
  const joined = lines.join(" | ");
  return joined.split(CONTACT_SPLIT_RE).map((piece) => piece.trim()).filter(Boolean);
}

export function parseResumeText(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim());

  // Find first non-empty line as name
  let i = 0;
  while (i < lines.length && !lines[i]) i += 1;

  let name = "";
  if (i < lines.length && !isSectionHeader(lines[i])) {
    name = lines[i] || "";
    i += 1;
  }

  // Collect contact lines until first section header (or first bullet)
  const contactBuffer = [];
  while (i < lines.length && !isSectionHeader(lines[i])) {
    if (lines[i]) contactBuffer.push(lines[i]);
    i += 1;
  }
  const contact = parseContactLines(contactBuffer);

  // Sections
  const sections = [];
  let currentSection = null;
  let currentItem = null;

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (isSectionHeader(line)) {
      currentSection = { heading: line.trim().replace(/:$/, ""), items: [] };
      sections.push(currentSection);
      currentItem = null;
      continue;
    }

    if (!currentSection) {
      // Lines before any section — treat as additional contact entries
      contact.push(line);
      continue;
    }

    if (BULLET_RE.test(line)) {
      if (!currentItem) {
        currentItem = { title: "", subtitle: "", meta: "", location: "", bullets: [] };
        currentSection.items.push(currentItem);
      }
      currentItem.bullets.push(stripBullet(line));
      continue;
    }

    // Summary-style sections hold paragraphs, not item headings — never
    // pipe-split a paragraph into title/subtitle/meta slots.
    if (isSummaryHeading(currentSection.heading)) {
      if (!currentItem || currentItem.title) {
        currentItem = { title: "", subtitle: "", meta: "", location: "", bullets: [] };
        currentSection.items.push(currentItem);
      }
      currentItem.bullets.push(line);
      continue;
    }

    // Non-bullet, non-section-header line inside a section: new item heading
    currentItem = parseItemHeading(line);
    currentSection.items.push(currentItem);
  }

  return { name, contact, sections };
}

// Extract a plain-text resume from Jake's-style .tex sources so the AI and the
// structured editor can seed from the same section model. The reader is
// brace-aware because real Jake variants commonly nest \textbf{} / \emph{} in
// project headings and skills rows.
function stripLatexComments(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => {
      let escaped = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === "\\" && !escaped) {
          escaped = true;
          continue;
        }
        if (char === "%" && !escaped) return line.slice(0, i);
        escaped = false;
      }
      return line;
    })
    .join("\n");
}

function readBracedGroup(source, start) {
  if (source[start] !== "{") return null;

  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    const escaped = i > 0 && source[i - 1] === "\\";
    if (char === "{" && !escaped) {
      depth += 1;
      continue;
    }
    if (char === "}" && !escaped) {
      depth -= 1;
      if (depth === 0) {
        return { value: source.slice(start + 1, i), end: i + 1 };
      }
    }
  }

  return null;
}

function readCommandArgs(source, command, index, maxArgs = 8) {
  const prefix = `\\${command}`;
  if (!source.startsWith(prefix, index)) return null;

  const next = source[index + prefix.length] ?? "";
  if (/[A-Za-z]/.test(next)) return null;

  const args = [];
  let cursor = index + prefix.length;
  if (source[cursor] === "*") cursor += 1;
  while (args.length < maxArgs) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "{") break;
    const group = readBracedGroup(source, cursor);
    if (!group) break;
    args.push(group.value);
    cursor = group.end;
  }

  return { index, end: cursor, args };
}

function findCommandCalls(source, command, maxArgs = 8) {
  const calls = [];
  const prefix = `\\${command}`;
  let cursor = 0;

  while (cursor < source.length) {
    const index = source.indexOf(prefix, cursor);
    if (index < 0) break;
    const call = readCommandArgs(source, command, index, maxArgs);
    if (call) {
      calls.push(call);
      cursor = Math.max(call.end, index + prefix.length);
    } else {
      cursor = index + prefix.length;
    }
  }

  return calls;
}

function replaceCommandWithArg(source, command, argIndex = 0) {
  let result = "";
  let cursor = 0;
  // Read only the arg we need (argIndex + 1), not a forced 2. `Math.max(…, 2)`
  // greedily consumed a second brace group, so `\textbf{Languages}{: Python…}`
  // swallowed the skills payload. (Matches the client fix in src/lib/resumeData.ts;
  // \href at argIndex 1 still reads {url}{label} since argIndex + 1 === 2.)
  const calls = findCommandCalls(source, command, argIndex + 1);

  for (const call of calls) {
    if (call.args.length <= argIndex) continue;
    result += source.slice(cursor, call.index);
    result += call.args[argIndex];
    cursor = call.end;
  }

  return result + source.slice(cursor);
}

function replaceCommandWithFormattedArg(source, command, tag, argIndex = 0) {
  let result = "";
  let cursor = 0;
  const calls = findCommandCalls(source, command, argIndex + 1);

  for (const call of calls) {
    if (call.args.length <= argIndex) continue;
    result += source.slice(cursor, call.index);
    result += `<${tag}>${call.args[argIndex]}</${tag}>`;
    cursor = call.end;
  }

  return result + source.slice(cursor);
}

// Filesystem/LaTeX-safe URL text: drop braces, whitespace, and control chars
// (none are valid in a real link) and cap length.
function cleanUrlForText(url) {
  return String(url ?? "")
    .replace(/[\s{}\\]+/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 300);
}

// Does the visible label already encode the URL (so linkify can rebuild the link
// on serialize)? True for domain-style labels like "github.com/x"; false for a
// friendly label like "My Portfolio" whose URL would otherwise be lost.
function labelImpliesUrl(label, url) {
  const cleanLabel = String(label ?? "")
    .replace(/<\/?[a-z]+>/gi, "")
    .replace(/\\[a-zA-Z]+\b/g, "")
    .replace(/[{}\\]/g, "")
    .trim()
    .toLowerCase();
  const bare = String(url ?? "")
    .replace(/^\s*(?:https?:\/\/|mailto:)/i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .trim()
    .toLowerCase();
  // A "github.com/x" label still implies a "www.github.com/x" href (linkify adds
  // the www to the href only), so compare with a leading www. stripped from both.
  const bareLabel = cleanLabel.replace(/^www\./i, "");
  if (!bareLabel || !bare) return true;
  if (bareLabel === bare) return true;
  if (bare.startsWith(bareLabel) || bareLabel.startsWith(bare)) return true;
  const domain = bare.split("/")[0];
  return !/\s/.test(bareLabel) && bareLabel.includes(domain);
}

// Replace each \href{url}{label}. Keep just the label when it implies the URL
// (linkify rebuilds the link on serialize); otherwise append the URL as text —
// "label (url)" — so a friendly-labelled link's destination is never lost.
function replaceHrefPreservingUrl(source) {
  let result = "";
  let cursor = 0;
  for (const call of findCommandCalls(source, "href", 2)) {
    if (!call.args.length) continue;
    const url = cleanUrlForText(call.args[0] ?? "");
    const label = call.args.length >= 2 ? call.args[1] : "";
    result += source.slice(cursor, call.index);
    if (!label.trim()) result += url;
    else if (!url || labelImpliesUrl(label, url)) result += label;
    else result += `${label} (${url})`;
    cursor = call.end;
  }
  return result + source.slice(cursor);
}

function unwrapLatexInlineCommands(value) {
  let text = replaceHrefPreservingUrl(value);
  for (let i = 0; i < 6; i += 1) {
    const next = [
      ["underline", 0],
      ["textbf", 0],
      ["textit", 0],
      ["emph", 0],
      ["textsc", 0],
      ["texttt", 0],
      ["textrm", 0],
      ["textsf", 0],
      ["small", 0],
      ["footnotesize", 0]
    ].reduce((current, [command, argIndex]) => replaceCommandWithArg(current, command, argIndex), text);
    if (next === text) break;
    text = next;
  }
  return text;
}

// A link's underline is template chrome — Jake's template wraps every \href
// label in \underline — not user formatting. Strip the underline bound to an
// \href so parsed links don't render underlined and don't double-wrap
// (\underline{\underline{…}}) when re-serialized (the template re-adds it). A
// standalone \underline{…} not tied to a link is left intact and still becomes <u>.
function dropLinkUnderlines(value) {
  let text = value;
  for (let i = 0; i < 6; i += 1) {
    // \underline{\href{…}{…}} -> \href{…}{…}
    let next = "";
    let cursor = 0;
    for (const call of findCommandCalls(text, "underline", 1)) {
      const inner = call.args[0] ?? "";
      if (call.args.length >= 1 && /^\s*\\href\b/.test(inner)) {
        next += text.slice(cursor, call.index) + inner;
        cursor = call.end;
      }
    }
    next += text.slice(cursor);

    // \href{url}{\underline{label}} -> \href{url}{label} (whole label is one underline)
    let after = "";
    cursor = 0;
    for (const call of findCommandCalls(next, "href", 2)) {
      if (call.args.length < 2) continue;
      const label = call.args[1].trim();
      const u = findCommandCalls(label, "underline", 1);
      if (u.length === 1 && u[0].index === 0 && u[0].end === label.length && u[0].args.length >= 1) {
        after += next.slice(cursor, call.index) + `\\href{${call.args[0]}}{${u[0].args[0]}}`;
        cursor = call.end;
      }
    }
    after += next.slice(cursor);

    if (after === text) break;
    text = after;
  }
  return text;
}

function preserveLatexInlineCommands(value) {
  let text = dropLinkUnderlines(value);
  for (let i = 0; i < 6; i += 1) {
    let next = replaceHrefPreservingUrl(text);
    next = replaceCommandWithFormattedArg(next, "underline", "u");
    next = replaceCommandWithFormattedArg(next, "textbf", "b");
    next = replaceCommandWithFormattedArg(next, "textit", "i");
    next = replaceCommandWithFormattedArg(next, "emph", "i");
    next = [
      ["textsc", 0],
      ["texttt", 0],
      ["textrm", 0],
      ["textsf", 0],
      ["small", 0],
      ["footnotesize", 0]
    ].reduce((current, [command, argIndex]) => replaceCommandWithArg(current, command, argIndex), next);
    if (next === text) break;
    text = next;
  }
  return text;
}

function stripLatexInline(value) {
  return unwrapLatexInlineCommands(String(value ?? ""))
    .replace(/\\\\(?:\[[^\]]*\])?/g, "\n")
    .replace(/\\(?:begin|end)\{[^}]+\}/g, " ")
    .replace(/\\item\b/g, " ")
    .replace(/\\(?:Huge|huge|LARGE|Large|large|small|footnotesize|tiny|normalsize|scshape|bfseries|itshape)\b/g, " ")
    // Discard spacing/layout braced args (e.g. \needspace{4\baselineskip}) so the
    // dimension's literal digits don't leak into the parsed text.
    .replace(/\\(?:v?h?space|needspace|addvspace|vskip|hskip)\*?\s*\{[^}]*\}/g, " ")
    .replace(/\\(?:quad|qquad|hfill|vfill|noindent|par|newline|newpage|pagebreak|linebreak|bigskip|medskip|smallskip)\b/g, " ")
    .replace(/\$\\bullet\$/g, " | ")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\,|\\ /g, " ")
    .replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function formatLatexInline(value) {
  return preserveLatexInlineCommands(String(value ?? ""))
    .replace(/\\\\(?:\[[^\]]*\])?/g, "\n")
    .replace(/\\(?:begin|end)\{[^}]+\}/g, " ")
    .replace(/\\item\b/g, " ")
    .replace(/\\(?:Huge|huge|LARGE|Large|large|small|footnotesize|tiny|normalsize|scshape|bfseries|itshape)\b/g, " ")
    .replace(/\\(?:v?h?space|needspace|addvspace|vskip|hskip)\*?\s*\{[^}]*\}/g, " ")
    .replace(/\\(?:quad|qquad|hfill|vfill|noindent|par|newline|newpage|pagebreak|linebreak|bigskip|medskip|smallskip)\b/g, " ")
    .replace(/\$\\bullet\$/g, " | ")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\,|\\ /g, " ")
    .replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const URL_SCHEME_RE = /(?:https?|mailto|ftps?|tel|file|ssh|sftp)$/i;

// Tidy spacing around a label colon ("Label:skills" → "Label: skills") WITHOUT
// breaking URL schemes ("https://", "mailto:x") or digit ratios/times ("12:30").
function normalizeColon(match, offset, full) {
  const before = full[offset - 1] ?? "";
  const after = full[offset + match.length] ?? "";
  if (after === "/") return match; // "://"
  if (/\d/.test(before) && /\d/.test(after)) return match; // "12:30"
  if (URL_SCHEME_RE.test(full.slice(Math.max(0, offset - 7), offset))) return match; // "mailto:x"
  return ": ";
}

function splitLatexRows(value) {
  return String(value ?? "")
    .split(/\\\\(?:\[[^\]]*\])?|\r?\n/)
    .map((piece) => formatLatexInline(piece))
    .map((piece) => piece.replace(/\s*:\s*/g, normalizeColon).replace(/\s*\|\s*/g, " | ").trim())
    .filter(Boolean);
}

function extractHeaderName(headerSource) {
  // Capture allows escaped specials (\& \_ \% \# \$) so a name like
  // "OReilly \& Sons" isn't truncated at the backslash; it still stops at a
  // line break (\\) or a real command, and stripLatexInline un-escapes after.
  const match = headerSource.match(/\\textbf\{\s*\\(?:Huge|huge|LARGE|Large)\s*(?:\\(?:scshape|bfseries)\s*)*((?:[^{}\\\n]|\\[&_%#$])+)\}/) ||
    headerSource.match(/\\(?:Huge|huge|LARGE|Large)\s*(?:\\(?:scshape|bfseries)\s*)*((?:[^{}\\\n]|\\[&_%#$])+)/);
  return match ? stripLatexInline(match[1]) : "";
}

function extractHeaderContact(headerSource, name) {
  const text = stripLatexInline(headerSource)
    .replace(/\$\|\$/g, " | ")
    .replace(/\$\\bullet\$/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutName = name && text.startsWith(name) ? text.slice(name.length).trim() : text;
  return withoutName.replace(/^\|+|\|+$/g, "").trim();
}

function formatSubheading(args) {
  return [args[0], args[2], args[1], args[3]]
    .map((arg) => formatLatexInline(arg))
    .filter(Boolean)
    .join(" | ");
}

function formatProjectHeading(args) {
  if (args.length >= 3) {
    return [args[0], args[1], args[2]].map((arg) => formatLatexInline(arg)).filter(Boolean).join(" | ");
  }

  const titleParts = formatLatexInline(args[0] ?? "")
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const meta = formatLatexInline(args[1] ?? "");
  return [...titleParts, meta].filter(Boolean).join(" | ");
}

function pushItemRows(events, index, orderRef, raw) {
  for (const text of splitLatexRows(raw)) {
    events.push({ index, order: orderRef.value, kind: "item", text });
    orderRef.value += 1;
  }
}

// A real résumé .tex is a few KB. The brace readers are worst-case O(n²) on
// pathological unbalanced-brace input, so bound the length to keep a huge crafted
// .tex from freezing the event loop (self-DoS). Mirrors the client cap.
const MAX_LATEX_INPUT = 200_000;

export function extractPlainTextFromLatex(tex) {
  const raw = String(tex ?? "");
  if (raw.length > MAX_LATEX_INPUT) return "";
  const source = stripLatexComments(raw);
  const docStart = source.indexOf("\\begin{document}");
  const body = docStart >= 0 ? source.slice(docStart + "\\begin{document}".length) : source;
  const trimmedBody = body.replace(/\\end\{document\}[\s\S]*$/, "");

  const sectionStarts = [];
  for (const call of findCommandCalls(trimmedBody, "section", 1)) {
    if (!call.args[0]) continue;
    sectionStarts.push({ heading: stripLatexInline(call.args[0]), index: call.index, after: call.end });
  }

  const headerSource = sectionStarts.length ? trimmedBody.slice(0, sectionStarts[0].index) : trimmedBody;
  const lines = [];
  const name = extractHeaderName(headerSource);
  if (name) lines.push(name);
  const contact = extractHeaderContact(headerSource, name);
  if (contact) lines.push(contact);

  for (let s = 0; s < sectionStarts.length; s += 1) {
    const start = sectionStarts[s];
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1].index : trimmedBody.length;
    const segment = trimmedBody.slice(start.after, end);

    lines.push("");
    lines.push(start.heading.toUpperCase());

    const events = [];
    const orderRef = { value: 0 };

    for (const call of findCommandCalls(segment, "resumeSubheading", 4)) {
      if (call.args.length < 4) continue;
      events.push({ index: call.index, order: orderRef.value, kind: "sub", text: formatSubheading(call.args) });
      orderRef.value += 1;
    }

    for (const call of findCommandCalls(segment, "resumeSubSubheading", 2)) {
      if (call.args.length < 2) continue;
      events.push({
        index: call.index,
        order: orderRef.value,
        kind: "sub",
        text: [call.args[0], call.args[1]].map((arg) => formatLatexInline(arg)).filter(Boolean).join(" | ")
      });
      orderRef.value += 1;
    }

    for (const call of findCommandCalls(segment, "resumeProjectHeading", 3)) {
      if (call.args.length < 2) continue;
      events.push({ index: call.index, order: orderRef.value, kind: "sub", text: formatProjectHeading(call.args) });
      orderRef.value += 1;
    }

    for (const call of findCommandCalls(segment, "resumeItem", 1)) {
      if (!call.args[0]) continue;
      pushItemRows(events, call.index, orderRef, call.args[0]);
    }

    if (!events.length) {
      for (const call of findCommandCalls(segment, "item", 1)) {
        if (!call.args[0]) continue;
        pushItemRows(events, call.index, orderRef, call.args[0]);
      }
    }

    events.sort((a, b) => a.index - b.index || a.order - b.order);
    for (const event of events) {
      const text = event.text.replace(/\s+\|\s+(?=\|)/g, " | ").replace(/\|\s+$/, "").trim();
      if (!text) continue;
      lines.push(event.kind === "sub" ? text : `- ${text}`);
    }

    if (!events.length) {
      for (const piece of splitLatexRows(segment)) {
        if (piece && !lines.includes(piece)) lines.push(piece);
      }
    }
  }

  return lines.join("\n");
}
