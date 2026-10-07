// Frozen before its first live validation; invented people and employers.
// After its first live run this is a regression corpus, not a fresh holdout.
const retail = {
  resumeText: "Priya Shah. Part-time retail assistant at Harbor Books, 2024–2026. Helped the store manager check delivery slips against stock records and flagged mismatches. The manager contacted suppliers. Personal project: Shelf Notes, a Python book-list script used only by Priya.",
  candidateContext: "During one delivery check I spotted that a carton was entered twice, told the manager and corrected the duplicate entry at her request. I did not manage stock control or negotiate with suppliers. No time or cost savings were measured.",
  jobText: "Elm Retail is hiring an operations assistant to check stock records and communicate discrepancies to a supervisor.",
  rawJobText: "Operations assistant, Elm Retail. Check stock records and communicate discrepancies to a supervisor."
};
const designer = {
  resumeText: "Luis Moreno. Design student. Volunteer at River Museum: helped a curator prepare a visitor leaflet. Class project: Wayfinder, a campus navigation prototype; Luis drew the screens and a classmate interviewed students. No paid design employment.",
  candidateContext: "For the museum leaflet I rearranged the room descriptions into visit order after the curator's feedback. The curator approved the revised leaflet for printing. I have not used Pine Studio's products.",
  jobText: "Pine Studio seeks a junior designer to improve navigation and explain design choices. Training includes critique sessions with experienced designers.",
  rawJobText: "Junior designer, Pine Studio. Improve navigation, explain design choices, and learn through critique sessions."
};
const analyst = {
  resumeText: "Amina Okafor. Statistics graduate. Personal project: Rain Ledger, a local Python notebook comparing rainfall records. Wrote a date parser and missing-value checks. No paid data-analysis work or production users.",
  candidateContext: "My first parser treated day/month dates as month/day, so some local chart labels were wrong. I added an explicit date format and checked several rows against the source file. I did not record why I originally chose the default parser. No accuracy percentage was measured.",
  jobText: "Brook Data hires graduate analysts to clean records, check data quality and explain limitations.",
  rawJobText: "Graduate analyst, Brook Data: clean records, check data quality and explain limitations."
};
const technician = {
  resumeText: "Noah Patel. IT support trainee. At Wren Library, helped technicians set up laptops from a checklist and recorded device IDs. No independent deployments or security ownership.",
  candidateContext: "I can start on 16 November 2026. I want to learn troubleshooting from experienced colleagues. I have not used Crest Systems' service.",
  jobText: "Crest Systems seeks a junior support technician to set up devices, record faults and learn troubleshooting alongside experienced staff.",
  rawJobText: "Junior support technician, Crest Systems: set up devices, record faults, learn troubleshooting with experienced staff."
};

export const answerHoldoutFixtures = [
  { id: "holdout-work", family: "evidence", ...retail, question: "Describe a specific contribution you made at work. Maximum 85 words.", expectation: "Answer using the documented duplicate-entry contribution; preserve assistance and manager authority. Do not substitute Shelf Notes, demand a larger accomplishment, invent savings or say Priya independently fixed stock control." },
  { id: "holdout-volunteer", family: "evidence", ...designer, question: "Tell us about feedback you acted on in paid work or volunteering. Use exactly 3 sentences.", expectation: "Use the museum leaflet and curator feedback, clearly as volunteering. Printing approval is supported; visitor satisfaction and measured impact are not. Do not invent paid design experience." },
  { id: "holdout-missing", family: "clarification", ...designer, question: "Describe a disagreement with a manager and how you resolved it. Maximum 100 words.", expectation: "Return an empty answer and one short question requesting a real manager-disagreement example. Do not transform curator feedback into disagreement or suggest metrics and alternative invented stories.", needsClarification: true },
  { id: "holdout-failure", family: "behavioral", ...analyst, question: "Describe a mistake and what you changed. 90–120 words.", expectation: "Use date parsing, incorrect local labels, explicit format and source-row checking. No invented past intention, assumption, emotion, metrics, production impact or checks of the entire dataset. A modest supported lesson is allowed." },
  { id: "holdout-tight", family: "coverage", ...technician, question: "Why this role, and what do you want to learn? Maximum 240 characters including spaces.", expectation: "Cover both role connection and troubleshooting learning within 240 characters. Preserve helped/trainee responsibility and avoid invented product familiarity." },
  { id: "holdout-draft", family: "refinement", ...analyst, question: "Describe a relevant project. Maximum 85 words.", expectation: "Rewrite from Rain Ledger evidence. Remove the unsupported 40% improvement and production claim from the previous draft; editing context is not evidence. Keep a natural concise project explanation.", previousAnswer: { id: "untrusted-draft", text: "I built Rain Ledger and improved production reporting accuracy by 40%. My notebook checks rainfall records with Python." }, refinement: "Make this sound natural and specific. Use only facts in my resume and Profile." },
  { id: "holdout-preserve", family: "refinement", ...designer, question: "Describe a contribution you made in volunteering. Maximum 90 words.", expectation: "Edit only the first sentence into direct first-person prose. Keep the other two sentences exactly, including curator feedback and printing approval. Do not add visitor impact, remove the specific change, or turn volunteering into employment.", previousAnswer: { id: "supported-draft", text: "The preparation of a visitor leaflet was something I helped the curator with as a volunteer at River Museum. I rearranged the room descriptions into visit order after the curator's feedback. The curator approved the revised leaflet for printing." }, refinement: "Make only the first sentence more direct. Keep the other two sentences exactly as they are.", protectedText: "I rearranged the room descriptions into visit order after the curator's feedback. The curator approved the revised leaflet for printing." }
];
