// A reopened saved answer lists the user's facts in a collapsed "Your facts"
// disclosure inside its question bubble. Static markup, not browser layout coverage.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { AnswerMessage } from "../tabs/answers/AnswerMessage.tsx";
      const noop = () => {};
      const controller = { save: noop, editAnswer: noop, saveBlocker: undefined, isGeneratingAnswers: false, conversation: { messages: [] } };
      const question = { id: "question-1", revision: 1, text: "Describe a time you handled an incident." };
      const response = { id: "answer-1", applicationId: "application-1", questionId: "question-1", questionRevision: 1, question: question.text,
        answer: "I led the postmortem.", constraints: [], counts: { words: 4, characters: 21, sentences: 1 }, compliant: true, status: "ready" };
      export function render(message) {
        return renderToStaticMarkup(<AnswerMessage message={{ id: "message-1", question, response, savedRevisionId: response.id, ...message }} index={0} controller={controller} onRefine={noop} onEditQuestion={noop} />);
      }
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "tsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const module = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { render } = module.exports;

const reopened = render({ facts: ["I led the postmortem after the March outage.", "The fix was <b>mine</b>.\nSecond line."] });
assert.match(reopened, /<div class="answers-message__question">[\s\S]*<h3>Describe a time you handled an incident\.<\/h3><details class="answers-message__facts">/, "the list sits inside the reopened question bubble");
assert.match(reopened, /<details class="answers-message__facts"><summary title="[^"]+">Your facts \(2\)<\/summary>/, "collapsed by default with the count in its summary");
assert.match(reopened, /<ul><li>I led the postmortem after the March outage\.<\/li><li>The fix was &lt;b&gt;mine&lt;\/b&gt;\.\nSecond line\.<\/li><\/ul>/, "facts render as escaped plain text in order");
assert.doesNotMatch(render({ facts: [] }), /answers-message__facts/, "a saved answer without facts shows no list");
assert.doesNotMatch(render({ facts: ["I led the postmortem."], instruction: "Shorter" }), /answers-message__facts/, "a refinement turn shows its own instruction, not the list");
const messageSource = await readFile(new URL("../tabs/answers/AnswerMessage.tsx", import.meta.url), "utf8");
assert.match(messageSource, /onRefine\(message\.id, "", "refinement"\);[^<]*>Refine this answer</, "the menu item opens Refine, so a typed instruction is never a fact");
console.log("Answer facts markup passed: collapsed Your facts list on a reopened answer only, escaped and in order; Refine this answer opens Refine");
