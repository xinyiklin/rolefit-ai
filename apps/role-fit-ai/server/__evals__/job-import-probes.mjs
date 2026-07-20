import assert from "node:assert/strict";

import {
  ashbyPostingApiTarget,
  ashbyPostingText,
  greenhouseJobAppUrl,
  workdayCxsUrl
} from "../jobImport.ts";

const handshakeAshbyUrl = new URL(
  "https://joinhandshake.com/careers/job/?ashby_jid=c91b7ebf-2c69-4d91-809d-a30ea0b9dc18&utm_source=4xDZ2XYAXn"
);
const handshakeAshbyTarget = ashbyPostingApiTarget(handshakeAshbyUrl);

assert.equal(
  handshakeAshbyTarget?.apiUrl.href,
  "https://api.ashbyhq.com/posting-api/job-board/handshake?includeCompensation=true",
  "Handshake's branded Ashby URL maps to the documented public board API"
);
assert.equal(
  handshakeAshbyTarget?.jobId,
  "c91b7ebf-2c69-4d91-809d-a30ea0b9dc18",
  "the exact Ashby posting id is preserved"
);
assert.equal(
  ashbyPostingApiTarget(new URL("https://unrelated.example/jobs?ashby_jid=c91b7ebf-2c69-4d91-809d-a30ea0b9dc18")),
  null,
  "an unknown wrapper cannot redirect RoleFit into an arbitrary Ashby board"
);

const ashbyText = ashbyPostingText({
  jobs: [{
    id: "c91b7ebf-2c69-4d91-809d-a30ea0b9dc18",
    title: "Forward Deployed Engineer",
    location: "San Francisco, CA",
    employmentType: "FullTime",
    workplaceType: "OnSite",
    department: "Engineering",
    team: "HAI Engineering",
    compensation: { compensationTierSummary: "$157K – $175K" },
    descriptionPlain: "Build full-stack products with customers. ".repeat(10)
  }]
}, handshakeAshbyTarget.jobId);

assert.match(ashbyText, /Role: Forward Deployed Engineer/);
assert.match(ashbyText, /Compensation: \$157K – \$175K/);
assert.match(ashbyText, /Build full-stack products with customers/);

const cadenceWorkdayUrl = new URL(
  "https://cadence.wd1.myworkdayjobs.com/External_Careers/job/AUSTIN-03/Software-Engineer-I_R53009-1?source=LinkedIn"
);

assert.equal(
  workdayCxsUrl(cadenceWorkdayUrl)?.href,
  "https://cadence.wd1.myworkdayjobs.com/wday/cxs/cadence/External_Careers/job/AUSTIN-03/Software-Engineer-I_R53009-1",
  "extension imports map a Workday posting to its full CXS job-description endpoint"
);

const datUrl = new URL("https://careers.dat.com/jobs/?gh_jid=6099144004");
const datWrapper = `
  <div class="greenhouse-form"></div>
  <script src="https://boards.greenhouse.io/embed/job_board/js?for=datsolutions"></script>
`;

assert.equal(
  greenhouseJobAppUrl(datUrl),
  null,
  "a branded wrapper with no board evidence is not guessed"
);
assert.equal(
  greenhouseJobAppUrl(datUrl, datWrapper)?.href,
  "https://job-boards.greenhouse.io/embed/job_app?for=datsolutions&token=6099144004",
  "DAT wrapper HTML supplies the validated Greenhouse board"
);
assert.equal(
  greenhouseJobAppUrl(
    new URL("https://careers.example.com/opening?gh_jid=123456"),
    '<script>fetch("https://boards-api.greenhouse.io/v1/boards/acme_labs/jobs?content=true")</script>'
  )?.href,
  "https://job-boards.greenhouse.io/embed/job_app?for=acme_labs&token=123456",
  "Greenhouse API URLs can identify a branded wrapper board"
);
assert.equal(
  greenhouseJobAppUrl(
    new URL("https://careers.example.com/opening?gh_jid=123456"),
    '<script src="https://boards.greenhouse.io/embed/job_board/js?for=bad%2Fboard"></script>'
  ),
  null,
  "encoded path-like board values are rejected"
);
assert.equal(
  greenhouseJobAppUrl(
    new URL("https://careers.example.com/opening"),
    '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>'
  ),
  null,
  "a wrapper board without a numeric job token cannot produce a job URL"
);
assert.equal(
  greenhouseJobAppUrl(new URL("https://boards.greenhouse.io/acme/jobs/987654"))?.href,
  "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=987654",
  "direct Greenhouse job links keep their existing resolution"
);

console.log("PASS known ATS job resolution");
