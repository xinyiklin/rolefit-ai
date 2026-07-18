import assert from "node:assert/strict";

import { buildApplicationRoleEvidence } from "../applicationAnswerEvidence.ts";

const resume = {
  name: "Candidate",
  contact: [],
  sections: [
    {
      id: "experience",
      heading: "Professional Experience",
      type: "standard",
      items: [
        {
          id: "role-1",
          titleLeft: "<b>Software</b> Engineer",
          subtitleLeft: "Acme",
          titleRight: "2024 - Present",
          subtitleRight: "Remote",
          bullets: [
            { id: "bullet-1", text: "Built <b>accessible React</b> interfaces." },
            { id: "bullet-2", text: "" }
          ]
        }
      ]
    },
    {
      id: "projects",
      heading: "Projects",
      type: "standard",
      items: [
        {
          id: "project-1",
          titleLeft: "Side Project",
          titleRight: "",
          subtitleLeft: "",
          subtitleRight: "",
          bullets: [{ id: "bullet-3", text: "Built a demo." }]
        }
      ]
    }
  ]
};

assert.deepEqual(buildApplicationRoleEvidence(resume), [
  {
    label: "Software Engineer | Acme | 2024 - Present | Remote",
    bullets: ["Built accessible React interfaces."]
  }
]);
assert(
  !JSON.stringify(buildApplicationRoleEvidence(resume)).includes("<b>"),
  "inline editor marks never enter the role-evidence request"
);
assert.deepEqual(buildApplicationRoleEvidence(null), []);

console.log("application answer evidence evals passed");
