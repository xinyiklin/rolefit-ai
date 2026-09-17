import assert from 'node:assert/strict';
import { FONT_FAMILY_IDS } from '../../lib/fontFamilies.ts';
import { DOC_STYLE_DEFAULTS } from '../../lib/documentStyle.ts';
import { coverLetterResumeData } from '../../lib/coverLetter.ts';
import { buildHeaderVerticalStream } from '../blocks.ts';
import { layoutResume, layoutCoverLetter } from '../layout.ts';
import { inkExtent } from '../measure.ts';
import { toTypesetSchema } from '../schema.ts';

const samples = ['aceonmzx', 'aceonmzxhdjklpq', 'hdjklpq', 'ACEONMZX', 'ÉÅgjpq', ''];
const geometry = doc => doc.pages.map(page => page.lines.map(line => ({ baseline: line.baseline, rule: line.rule })));
let cases = 0;
for (const fontFamily of FONT_FAMILY_IDS) {
  for (const kind of ['resume', 'cover']) {
    for (const field of ['name', 'contact']) {
      for (const format of [text => text, text => `<size=40>${text}</size>`, text => `Fixed <font=arimo><size=32>${text}</size></font>`]) {
        let expected;
        for (const value of samples) {
          if (!value && format(value)) continue; // Empty inline marks do not retain a styled text run.
          const header = field === 'name'
            ? { visible: true, name: format(value), contact: ['contact@example.test'] }
            : { visible: true, name: null, contact: [format(value)] };
          const data = kind === 'cover' ? coverLetterResumeData(['Following paragraph.'], header) : {
            header, sections: [{ id: 's', type: 'standard', heading: 'Experience', items: [{
              id: 'e', titleLeft: 'Engineer', titleRight: '2026', subtitleLeft: 'Company', subtitleRight: 'Remote',
              bullets: [{ id: 'b', text: 'Following content.' }]
            }] }]
          };
          const schema = toTypesetSchema(data), style = { ...DOC_STYLE_DEFAULTS, fontFamily };
          const doc = (kind === 'cover' ? layoutCoverLetter : layoutResume)(schema, style);
          const current = {
            geometry: geometry(doc),
            header: buildHeaderVerticalStream(schema, style).map(({ height, depth, riseOverflow, dropOverflow, dist }) => ({ height, depth, riseOverflow, dropOverflow, dist }))
          };
          expected ??= current;
          assert.deepEqual(current, expected, `${kind}/${fontFamily}/${field}: glyph shapes must not move baselines, rules or page-fit boxes`);
          for (const page of doc.pages) for (const line of page.lines) for (const run of line.runs) {
            const ink = inkExtent(run.text, run.style);
            assert(line.baseline-ink.height >= doc.geometry.marginTop-1e-6, 'header ink clears the top margin');
            assert(line.baseline+ink.depth <= doc.geometry.lastBaselineMax+1e-6, 'header ink clears the bottom margin');
          }
          cases++;
        }
      }
    }
  }
}
const schema = size => ({ header: { name: `<size=${size}>aceonmzx</size>`, contact: ['contact'] }, sections: [] });
assert(layoutResume(schema(40), DOC_STYLE_DEFAULTS).pages[0].lines[0].baseline > layoutResume(schema(25), DOC_STYLE_DEFAULTS).pages[0].lines[0].baseline,
  'actual font-size changes still reserve additional vertical space');
console.log(`header baseline stability: ${cases} resume/cover name/contact cases across six fonts, glyph shapes, blank fields and inline styles passed`);
