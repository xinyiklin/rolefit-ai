// Shared fixtures and scoring for the PDF import evals: the offline corpus gate
// and the live AI-interpretation benchmark. Everything is synthetic and
// generated in memory; no PDF is committed. Lives under support/ so the
// offline runner does not execute it as an eval of its own.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DOC_STYLE_DEFAULTS, toDocumentStyle } from "@typeset/engine/lib/documentStyle.ts";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { newBullet, newEntry, newSection, newSkillEntry, newSummaryEntry } from "@typeset/engine/lib/resumeData.ts";
import { buildStarterResume } from "@typeset/engine/sampleResume.ts";
import { parseFieldKey } from "@typeset/engine/typeset/types.ts";
import { DOCUMENT_FONT_FAMILIES, sfntAssetFile } from "@typeset/engine/typeset/fontRegistry.ts";
import { layoutResume } from "@typeset/engine/typeset/layout.ts";
import { emitPdf } from "@typeset/engine/typeset/pdf/emit.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { isDateLike } from "../../rowDates.ts";

export const engineFonts = new Map();
for (const [family, config] of Object.entries(DOCUMENT_FONT_FAMILIES)) {
  for (const face of Object.keys(config.faces)) {
    const path = fileURLToPath(import.meta.resolve(`@typeset/engine/fonts/${sfntAssetFile(family, face)}`));
    engineFonts.set(`${family}:${face}`, new Uint8Array(readFileSync(path)));
  }
}

// ── Engine fixtures ─────────────────────────────────────────────────────────
const entry = (fields, bullets = []) => ({ ...newEntry(fields), bullets: bullets.map((text) => newBullet(text)) });
const section = (type, heading, items) => ({ ...newSection(type, heading), items });

function richResume() {
  return {
    header: { visible: true, name: "Avery Example", contact: ["avery@example.test", "+1 555 0100", "example.test/avery", "Portland, OR"] },
    sections: [
      section("summary", "Summary", [
        newSummaryEntry("Backend engineer with six years building payment systems. Led migrations that cut p99 latency by 40% across three regions while keeping availability above 99.95%.")
      ]),
      section("standard", "Experience", [
        entry({ titleLeft: "<b>Northwind Payments</b>", titleRight: "Mar. 2021 – Present", subtitleLeft: "<i>Staff Software Engineer</i>", subtitleRight: "<i>Remote</i>" }, [
          "Designed a ledger service handling 12k requests per second with exactly-once semantics, replacing a nightly batch job that failed under peak holiday load.",
          "Mentored <b>five</b> engineers through their first on-call rotations and wrote the incident review template the team still uses.",
          "Cut cloud spend by $310K a year by moving cold reconciliation data to tiered storage."
        ]),
        entry({ titleLeft: "<b>Contoso Retail</b>", titleRight: "Jun. 2018 – Feb. 2021", subtitleLeft: "<i>Software Engineer</i>", subtitleRight: "<i>Seattle, WA</i>" }, [
          "Built the checkout risk scorer in Go, blocking 1.8% of fraudulent orders before capture.",
          "Owned the PostgreSQL to Aurora migration for 2 TB of order history with zero downtime."
        ])
      ]),
      section("standard", "Education", [
        entry({ titleLeft: "<b>State University</b>", titleRight: "2014 – 2018", subtitleLeft: "<i>B.S. in Computer Science, minor in Statistics</i>", subtitleRight: "<i>Corvallis, OR</i>" })
      ]),
      section("standard", "Certifications", [
        entry({ titleLeft: "AWS Certified Solutions Architect – Associate", titleRight: "2022", subtitleLeft: "", subtitleRight: "" }),
        entry({ titleLeft: "Certified Kubernetes Administrator", titleRight: "2021", subtitleLeft: "", subtitleRight: "" })
      ]),
      section("skills", "Technical Skills", [
        newSkillEntry("Languages", "TypeScript, Go, Python, SQL, Rust, Kotlin, Java, C++, Bash, Terraform, GraphQL, Protocol Buffers, and others"),
        newSkillEntry("Platforms", "AWS, GCP, Kubernetes, Kafka, PostgreSQL, Redis")
      ])
    ]
  };
}

function longResume() {
  const data = richResume();
  const roles = ["Fabrikam", "Litware", "Adatum", "Proseware", "Wingtip Toys", "Tailspin"];
  data.sections[1].items.push(
    ...roles.map((company, index) =>
      entry(
        { titleLeft: `<b>${company}</b>`, titleRight: `${2010 + index} – ${2011 + index}`, subtitleLeft: "<i>Engineer</i>", subtitleRight: "" },
        [
          `Shipped ${index + 2} internal tools that reduced manual reconciliation work for the finance operations team by roughly ${10 + index * 5} hours a week.`,
          `Maintained the ${company} deployment pipeline and its integration test suite across ${index + 3} services.`
        ]
      )
    )
  );
  return data;
}

export const engineFixtures = [
  { name: "engine/starter-latin-modern", data: buildStarterResume(), style: {} },
  { name: "engine/rich-tinos-uppercase", data: richResume(), style: { fontFamily: "tinos", headingCase: "uppercase", headerAlign: "left", sectionRule: false } },
  { name: "engine/rich-carlito-normal-margins", data: richResume(), style: { fontFamily: "carlito", headingCase: "none", pageMarginLeftPt: 72, pageMarginRightPt: 72, pageMarginTopPt: 72, pageMarginBottomPt: 72 } },
  { name: "engine/rich-arimo-11pt", data: richResume(), style: { fontFamily: "arimo", baseFontSizePt: 11, headerAlign: "right", headingCase: "uppercase" } },
  { name: "engine/rich-source-serif", data: richResume(), style: { fontFamily: "source-serif", headingCase: "none", sectionRule: true } },
  { name: "engine/rich-source-sans-9pt", data: richResume(), style: { fontFamily: "source-sans", baseFontSizePt: 9, headingCase: "smallcaps" } },
  { name: "engine/long-two-pages", data: longResume(), style: { fontFamily: "latin-modern" } }
];

// ── Foreign fixtures (pdf-lib) ──────────────────────────────────────────────
// A deliberately simple typesetter: greedy wrapping, hanging bullets, fixed
// leading. "**x**" draws bold, and "|" inside a bullet forces a line break (the
// "|" itself is not drawn) so line-end hyphenation can be staged.
const PAGE = { width: 612, height: 792 };

export async function renderForeign(spec) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts[spec.fonts.regular]),
    bold: await doc.embedFont(StandardFonts[spec.fonts.bold]),
    italic: await doc.embedFont(StandardFonts[spec.fonts.italic]),
    zapf: await doc.embedFont(StandardFonts.ZapfDingbats)
  };
  const margin = spec.margin ?? 54;
  const size = spec.size ?? 10;
  const leading = size * 1.25;
  const pages = [];
  let page;
  let y;
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    y = PAGE.height - margin;
    if (spec.runningHeader && pages.length > 1) {
      page.drawText(spec.name, { x: margin, y: y - 8, size: 8, font: fonts.regular });
      y -= 24;
    }
  };
  newPage();
  const ensure = (height) => {
    if (y - height < margin) newPage();
  };
  const runs = (text) =>
    text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).flatMap((part) => {
      const bold = part.startsWith("**");
      return part.replace(/\*\*/g, "").split(/(\s+)/).filter(Boolean).map((word) => ({ word, bold }));
    });
  // Lays out words in [x0, x1]; returns lines of {word, bold, x}.
  const wrap = (text, x0, x1, fontFor) => {
    const lines = [[]];
    let x = x0;
    for (const forced of text.split("|")) {
      if (lines[lines.length - 1].length) {
        lines.push([]);
        x = x0;
      }
      for (const run of runs(forced)) {
        const font = fontFor(run.bold);
        if (/^\s+$/.test(run.word)) {
          if (lines[lines.length - 1].length) x += font.widthOfTextAtSize(" ", size);
          continue;
        }
        const width = font.widthOfTextAtSize(run.word, size);
        if (x + width > x1 && lines[lines.length - 1].length) {
          lines.push([]);
          x = x0;
        }
        lines[lines.length - 1].push({ ...run, x });
        x += width;
      }
    }
    return lines;
  };
  // Word and Docs exports usually paint a wrapped line as one text run.
  const drawLines = (lines, fontFor) => {
    for (const line of lines) {
      ensure(leading);
      if (spec.wholeLines) page.drawText(line.map((run) => run.word).join(" "), { x: line[0].x, y, size, font: fontFor(false) });
      else for (const run of line) page.drawText(run.word, { x: run.x, y, size, font: fontFor(run.bold) });
      y -= leading;
    }
  };
  const regularOrBold = (bold) => (bold ? fonts.bold : fonts.regular);

  const renderSection = (sectionSpec, x0, x1) => {
    const h = spec.heading;
    ensure(h.size * 3);
    y -= h.gap ?? 8;
    const headingText = h.caps ? sectionSpec.heading.toUpperCase() : sectionSpec.heading;
    page.drawText(headingText, { x: x0, y, size: h.size, font: fonts[h.font] });
    if (h.rule) page.drawLine({ start: { x: x0, y: y - 3 }, end: { x: x1, y: y - 3 }, thickness: 0.7, color: rgb(0, 0, 0) });
    y -= h.size * 1.6;
    const indent = spec.indent ?? 0;
    for (const item of sectionSpec.items) {
      if (item.kind === "entry") {
        for (const [row, style] of [[item.title, item.titleStyle ?? "bold"], [item.subtitle, item.subtitleStyle ?? "italic"]]) {
          if (!row) continue;
          ensure(leading * 2);
          const [left, right] = row;
          if (item.spaced && left && right) {
            // Right text pushed over with spaces inside the same run.
            const font = fonts[style];
            const room = x1 - (x0 + indent) - font.widthOfTextAtSize(left, size) - font.widthOfTextAtSize(right, size);
            const spaces = " ".repeat(Math.max(3, Math.floor(room / font.widthOfTextAtSize(" ", size))));
            page.drawText(`${left}${spaces}${right}`, { x: x0 + indent, y, size, font });
          } else {
            if (left) page.drawText(left, { x: x0 + indent, y, size, font: fonts[style] });
            if (right) page.drawText(right, { x: x1 - fonts.regular.widthOfTextAtSize(right, size), y, size, font: fonts.regular });
          }
          y -= leading;
        }
        for (const bullet of item.bullets ?? []) {
          const textX = x0 + indent + (spec.marker ? 14 : 0);
          const lines = wrap(bullet, textX, x1, regularOrBold);
          ensure(leading);
          if (spec.marker === "zapf") page.drawText("●", { x: x0 + indent + 3, y: y + 1, size: 6, font: fonts.zapf });
          if (spec.marker === "bullet") page.drawText("•", { x: x0 + indent + 3, y, size, font: fonts.regular });
          if (spec.marker === "hyphen") page.drawText("-", { x: x0 + indent + 3, y, size, font: fonts.regular });
          drawLines(lines, regularOrBold);
        }
        y -= 3;
      } else if (item.kind === "skills") {
        const label = `${item.label}:`;
        const labelWidth = fonts.bold.widthOfTextAtSize(`${label} `, size);
        ensure(leading);
        page.drawText(label, { x: x0 + indent, y, size, font: fonts.bold });
        const lines = wrap(item.list, x0 + indent + labelWidth, x1, () => fonts.regular);
        lines.slice(1).forEach((line) => {
          const shift = line[0].x - (x0 + indent);
          line.forEach((run) => (run.x -= shift));
        });
        drawLines(lines, () => fonts.regular);
      } else if (item.kind === "para") {
        drawLines(wrap(item.text, x0 + indent, x1, regularOrBold), regularOrBold);
      } else if (item.kind === "line") {
        ensure(leading);
        page.drawText(item.text, { x: x0 + indent, y, size, font: fonts.regular });
        y -= leading;
      }
    }
  };

  // Header.
  const nameWidth = fonts.bold.widthOfTextAtSize(spec.name, spec.nameSize);
  const nameX = spec.nameAlign === "center" ? (PAGE.width - nameWidth) / 2 : margin;
  y -= spec.nameSize * 0.8;
  page.drawText(spec.name, { x: nameX, y, size: spec.nameSize, font: fonts.bold });
  y -= spec.nameSize * 0.7 + 4;
  for (const items of spec.contactLines ?? (spec.contact?.length ? [spec.contact] : [])) {
    const line = items.join(spec.contactSeparator);
    const width = fonts.regular.widthOfTextAtSize(line, size);
    page.drawText(line, { x: spec.nameAlign === "center" ? (PAGE.width - width) / 2 : margin, y, size, font: fonts.regular });
    y -= leading;
  }
  if (spec.tagLine) {
    page.drawText(spec.tagLine, { x: margin, y, size, font: fonts.regular });
    y -= leading;
  }

  if (spec.columns) {
    const top = y;
    const split = margin + spec.columns.leftWidth;
    for (const sectionSpec of spec.columns.left) renderSection(sectionSpec, margin, split);
    y = top;
    for (const sectionSpec of spec.columns.right) renderSection(sectionSpec, split + spec.columns.gutter, PAGE.width - margin);
  } else {
    for (const sectionSpec of spec.sections) renderSection(sectionSpec, margin, PAGE.width - margin);
  }

  if (spec.pageNumbers) {
    pages.forEach((current, index) => {
      const label = `Page ${index + 1} of ${pages.length}`;
      current.drawText(label, { x: (PAGE.width - fonts.regular.widthOfTextAtSize(label, 8)) / 2, y: 28, size: 8, font: fonts.regular });
    });
  }
  return doc.save();
}

// The text the importer should produce: drawn words only, with tag-like words
// left out (they are listed as Not placed instead).
const plain = (text) =>
  text
    .replace(/\*\*/g, "")
    .replace(/-\|/g, "-")
    .replace(/\|/g, " ")
    .split(/\s+/)
    .filter((word) => !/<\/?[a-z]/i.test(word))
    .join(" ");

export function foreignTruth(spec) {
  const sections = [...(spec.columns ? [...spec.columns.left, ...spec.columns.right] : spec.sections)].filter((current) => !current.contact);
  const contactSections = (spec.columns ? spec.columns.left : []).filter((current) => current.contact);
  const contact = [...(spec.contactLines?.flat() ?? spec.contact ?? []), ...(spec.tagLine ? [spec.tagLine] : []), ...contactSections.flatMap((current) => current.items.map((item) => item.text))];
  return {
    header: { visible: true, name: spec.name, contact },
    sections: sections.map((current) => ({
      heading: spec.heading.caps ? current.heading.toUpperCase() : current.heading,
      type: current.type,
      items: current.items.map((item) => {
        if (item.kind === "skills") return { titleLeft: item.label, titleRight: "", subtitleLeft: item.list, subtitleRight: "", bullets: [] };
        if (item.kind === "para") return { titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ text: plain(item.text) }] };
        if (item.kind === "line") return { titleLeft: item.text, titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] };
        return {
          titleLeft: item.title?.[0] ?? "",
          titleRight: item.title?.[1] ?? "",
          subtitleLeft: item.subtitle?.[0] ?? "",
          subtitleRight: item.subtitle?.[1] ?? "",
          bullets: (item.bullets ?? []).map((text) => ({ text: plain(text) }))
        };
      })
    }))
  };
}

const HELVETICA = { regular: "Helvetica", bold: "HelveticaBold", italic: "HelveticaOblique" };
export const TIMES = { regular: "TimesRoman", bold: "TimesRomanBold", italic: "TimesRomanItalic" };
const COURIER = { regular: "Courier", bold: "CourierBold", italic: "CourierOblique" };

const experience = [
  {
    kind: "entry",
    title: ["Globex Logistics", "Boston, MA"],
    subtitle: ["Senior Data Engineer", "Jan 2020 – Present"],
    bullets: [
      "Rebuilt the shipment events pipeline on **Kafka** and Flink, raising daily throughput from 40M to 310M events without adding headcount.",
      "Introduced data contracts for 14 producer teams, cutting schema-related incidents by 70% in two quarters.",
      "Partnered with finance to automate carrier invoice audits, recovering $1.2M in overbilling."
    ]
  },
  {
    kind: "entry",
    title: ["Initech", "Austin, TX"],
    subtitle: ["Data Engineer", "Jul 2016 – Dec 2019"],
    bullets: [
      "Owned nightly ETL for 120 reports and moved it from cron to Airflow with alerting and retries.",
      "Wrote the internal SQL style guide adopted across analytics.",
      // A short line that breaks a word with a hyphen still continues.
      "Built golden-path templates for front-|end teams."
    ]
  }
];

export const foreignFixtures = [
  {
    name: "foreign/word-helvetica-centered",
    group: "single",
    spec: {
      fonts: HELVETICA,
      name: "Jordan Rivera",
      nameSize: 20,
      nameAlign: "center",
      contact: ["jordan.rivera@example.test", "(555) 010-4477", "linkedin.com/in/jordan-example"],
      contactSeparator: "  ·  ",
      heading: { size: 12, font: "bold", caps: true, rule: true },
      marker: "bullet",
      pageNumbers: true,
      sections: [
        { heading: "Summary", type: "summary", items: [{ kind: "para", text: "Data engineer who turns messy operational data into dependable pipelines. Eight years across logistics and fintech, most recently leading a platform team of four." }] },
        { heading: "Experience", type: "standard", items: experience },
        {
          heading: "Skills",
          type: "skills",
          items: [
            { kind: "skills", label: "Languages", list: "Python, SQL, Scala, Java, Bash" },
            { kind: "skills", label: "Data", list: "Kafka, Flink, Spark, Airflow, dbt, Snowflake, BigQuery, PostgreSQL, Redshift, Delta Lake, Iceberg, Great Expectations, Looker" }
          ]
        },
        { heading: "Education", type: "standard", items: [{ kind: "entry", title: ["University of Massachusetts", "Amherst, MA"], subtitle: ["B.S. Computer Science", "2012 – 2016"], bullets: [] }] }
      ]
    }
  },
  {
    name: "foreign/times-dingbats-unusual-headings",
    group: "hard",
    spec: {
      fonts: TIMES,
      name: "Sam Okafor",
      nameSize: 22,
      nameAlign: "left",
      contact: ["sam.okafor@example.test", "+44 20 7946 0958", "github.com/samexample"],
      contactSeparator: " | ",
      heading: { size: 13, font: "bold", caps: false, rule: false, gap: 10 },
      marker: "zapf",
      indent: 6,
      sections: [
        {
          heading: "Where I've Worked",
          type: "standard",
          items: [
            {
              kind: "entry",
              title: ["Umbrella Health", "London, UK"],
              subtitle: ["Platform Engineer", "Sep 2019 – Present"],
              bullets: ["Led the move of 30 services to a shared Kubernetes platform and wrote the golden-path templates for front-|end and backend teams.", "Cut median build time from 19 to 6 minutes with remote caching."]
            }
          ]
        },
        { heading: "Education", type: "standard", items: [{ kind: "entry", title: ["University of Leeds", "Leeds, UK"], subtitle: ["MEng Software Engineering", "2014 – 2018"], bullets: [] }] },
        { heading: "Toolbox", type: "skills", items: [{ kind: "skills", label: "Infrastructure", list: "Kubernetes, Terraform, Helm, Argo CD" }, { kind: "skills", label: "Languages", list: "Go, Python, TypeScript" }] }
      ]
    }
  },
  {
    name: "foreign/two-column-sidebar",
    group: "hard",
    spec: {
      fonts: HELVETICA,
      name: "Priya Natarajan",
      nameSize: 22,
      nameAlign: "center",
      heading: { size: 11, font: "bold", caps: true, rule: true },
      marker: "bullet",
      columns: {
        leftWidth: 150,
        gutter: 24,
        left: [
          { heading: "Contact", contact: true, items: [{ kind: "line", text: "priya@example.test" }, { kind: "line", text: "+1 555 0142" }, { kind: "line", text: "priya.example.test" }] },
          { heading: "Skills", type: "skills", items: [{ kind: "skills", label: "Design", list: "Figma, prototyping, research" }, { kind: "skills", label: "Code", list: "HTML, CSS, React" }] },
          { heading: "Education", type: "standard", items: [{ kind: "entry", title: ["RISD", ""], subtitle: ["BFA, 2015", ""], bullets: [] }] }
        ],
        right: [
          {
            heading: "Experience",
            type: "standard",
            items: [
              { kind: "entry", title: ["Hooli", "2019 – Now"], subtitle: ["Product Designer", ""], bullets: ["Redesigned the onboarding flow used by 2M people a month, raising activation by 9%.", "Ran 40 usability sessions and built the shared research repository."] },
              { kind: "entry", title: ["Pied Piper", "2015 – 2019"], subtitle: ["UX Designer", ""], bullets: ["Shipped the first mobile app and its design system."] }
            ]
          }
        ]
      }
    }
  },
  {
    name: "foreign/courier-two-page-running-header",
    group: "single",
    spec: {
      fonts: COURIER,
      name: "Morgan Lee",
      nameSize: 18,
      nameAlign: "left",
      contact: ["morgan@example.test", "555-0199"],
      contactSeparator: " • ",
      heading: { size: 11, font: "bold", caps: true, rule: true },
      marker: "bullet",
      runningHeader: true,
      pageNumbers: true,
      sections: [
        {
          heading: "Experience",
          type: "standard",
          items: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
            kind: "entry",
            title: [`Company ${String.fromCharCode(65 + index)}`, `${2008 + index * 2} – ${2010 + index * 2}`],
            subtitle: ["Systems Engineer", ""],
            bullets: [
              `Operated a fleet of ${100 + index * 20} servers and automated patching with configuration management across two data centers.`,
              `Reduced paging volume by ${20 + index}% by removing noisy alerts and adding runbooks.`,
              "Wrote <b>internal</b> docs for on-call."
            ]
          }))
        },
        { heading: "Certifications", type: "standard", items: [{ kind: "entry", title: ["Red Hat Certified Engineer", "2015"], bullets: [] }, { kind: "entry", title: ["CompTIA Security+", "2012"], bullets: [] }] }
      ]
    },
    // The "<b>" text is a literal string in the PDF; it must never become formatting.
    tagLike: "<b>internal</b>"
  },
  {
    name: "foreign/word-runs-spaced-dates-grouped-roles",
    group: "hard",
    spec: {
      fonts: HELVETICA,
      name: "Casey Morgan",
      nameSize: 16,
      nameAlign: "left",
      contactLines: [["casey.morgan@example.test", "555-0123"], ["Chicago, IL", "caseymorgan.example.test"]],
      contactSeparator: " | ",
      heading: { size: 11, font: "bold", caps: false, rule: true },
      marker: "hyphen",
      wholeLines: true,
      indent: 4,
      sections: [
        {
          heading: "Professional Experience:",
          type: "standard",
          items: [
            { kind: "entry", title: ["Acme Robotics", ""], subtitle: ["Senior Controls Engineer", "Apr 2021 – Present"], spaced: true, bullets: ["Led the redesign of the arm controller firmware, cutting cycle time by 18% on the main assembly line while keeping the safety certification intact.", "Hired and onboarded three engineers."] },
            { kind: "entry", title: ["Controls Engineer", "Jun 2017 – Mar 2021"], titleStyle: "italic", spaced: true, bullets: ["Wrote the PLC test harness that caught 40 regressions before release over four years."] }
          ]
        },
        { heading: "Education", type: "standard", items: [{ kind: "entry", title: ["Purdue University", "2013 – 2017"], subtitle: ["B.S. Electrical Engineering", ""], spaced: true, bullets: [] }] }
      ]
    }
  },
  {
    name: "foreign/markerless-bullets",
    group: "single",
    spec: {
      fonts: HELVETICA,
      name: "Alex Chen",
      nameSize: 18,
      nameAlign: "left",
      contact: ["alex@example.test", "555 0111"],
      contactSeparator: " | ",
      heading: { size: 12, font: "bold", caps: true, rule: false, gap: 10 },
      marker: null,
      indent: 0,
      sections: [
        {
          heading: "Experience",
          type: "standard",
          items: [
            { kind: "entry", title: ["Vandelay Industries", "2018 – 2024"], subtitle: ["Operations Analyst", ""], bullets: ["Built the weekly inventory forecast that reduced stockouts by a third across forty stores in the region.", "Trained six new analysts."] }
          ]
        }
      ]
    }
  }
];

// ── Scoring ─────────────────────────────────────────────────────────────────
const norm = (text) => stripInlineMarks(text ?? "").replace(/\s+/g, " ").trim();

function facts(data) {
  const out = [];
  if (data.header?.name) out.push(["name", "", norm(data.header.name)]);
  for (const item of data.header?.contact ?? []) out.push(["contact", "", norm(item)]);
  for (const current of data.sections) {
    const heading = norm(current.heading).toLowerCase();
    out.push(["heading", "", heading]);
    for (const item of current.items) {
      if (current.type === "skills") {
        out.push(["skills", heading, `${norm(item.titleLeft)}::${norm(item.subtitleLeft)}`]);
        continue;
      }
      if (current.type === "summary") {
        for (const bullet of item.bullets) out.push(["summary", heading, norm(bullet.text)]);
        continue;
      }
      const key = norm(item.titleLeft);
      for (const slot of ["titleLeft", "titleRight", "subtitleLeft", "subtitleRight"]) {
        const value = norm(item[slot]);
        if (value) out.push([isDateLike(value) ? "date" : "entry", `${heading}/${slot}`, value]);
      }
      for (const bullet of item.bullets) {
        const value = norm(bullet.text);
        if (value) out.push(["bullet", `${heading}/${key}`, value]);
      }
    }
  }
  return out;
}

function lcs(a, b) {
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = a[i - 1] === b[j - 1] ? previous + 1 : Math.max(row[j], row[j - 1]);
      previous = saved;
    }
  }
  return row[b.length];
}

export function score(truth, predicted) {
  const truthFacts = facts(truth);
  const predictedFacts = facts(predicted);
  const remaining = new Map();
  for (const fact of truthFacts) remaining.set(JSON.stringify(fact), (remaining.get(JSON.stringify(fact)) ?? 0) + 1);
  const perClass = {};
  const bump = (cls, key) => ((perClass[cls] ??= { tp: 0, predicted: 0, truth: 0 })[key] += 1);
  const misses = [];
  for (const fact of truthFacts) bump(fact[0], "truth");
  for (const fact of predictedFacts) {
    bump(fact[0], "predicted");
    const key = JSON.stringify(fact);
    if (remaining.get(key)) {
      remaining.set(key, remaining.get(key) - 1);
      bump(fact[0], "tp");
    } else {
      misses.push(`extra ${key}`);
    }
  }
  for (const [key, count] of remaining) if (count > 0) misses.push(`missing ${key}`);
  const order = lcs(truthFacts.map((fact) => fact[2]), predictedFacts.map((fact) => fact[2])) / Math.max(1, truthFacts.length);
  return { perClass, misses, order };
}

export const strip = (data) => JSON.parse(JSON.stringify(data, (key, value) => (key === "id" ? undefined : value)));

// A field key names session ids; its position in the document is what must be
// stable across runs. Returns null when the key names no field.
export function keyPosition(data, key) {
  if (key === null) return "document";
  const src = parseFieldKey(key);
  if (!src) return null;
  if (src.kind === "name") return data.header?.name ? "name" : null;
  if (src.kind === "contact") return data.header?.contact[src.index] !== undefined ? `contact/${src.index}` : null;
  const sectionIndex = data.sections.findIndex((current) => current.id === src.sectionId);
  if (sectionIndex < 0) return null;
  if (src.kind === "heading") return `heading/${sectionIndex}`;
  const items = data.sections[sectionIndex].items;
  const entryIndex = items.findIndex((item) => item.id === src.entryId);
  if (entryIndex < 0) return null;
  if (src.kind === "entry") return `entry/${sectionIndex}/${entryIndex}/${src.field}`;
  if (src.kind === "skillsRow") return `skills/${sectionIndex}/${entryIndex}`;
  const bulletIndex = items[entryIndex].bullets.findIndex((bullet) => bullet.id === src.bulletId);
  return bulletIndex < 0 ? null : `bullet/${sectionIndex}/${entryIndex}/${bulletIndex}`;
}
export const findingShape = (data, finding) => ({ ...strip(finding), fieldKey: finding.kind === "check" ? keyPosition(data, finding.fieldKey) : undefined });

// An engine fixture's PDF bytes and the exact style it was laid out with.
export async function renderEngineFixture(fixture) {
  const style = { ...toDocumentStyle(DOC_STYLE_DEFAULTS), ...fixture.style };
  const bytes = await emitPdf(layoutResume(toTypesetSchema(fixture.data), style), engineFonts, { title: fixture.name });
  return { bytes, style };
}
