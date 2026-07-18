import assert from "node:assert/strict";

import { greenhouseJobAppUrl } from "../jobImport.ts";

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

console.log("PASS Greenhouse wrapper job resolution");
