import {
  newBullet,
  newEntry,
  newSection,
  newSkillEntry,
  type ResumeData,
  type ResumeEntry,
  type ResumeSectionData
} from "./lib/resumeData.ts";

const bold = (value: string) => value ? `<b>${value}</b>` : value;
const italic = (value: string) => value ? `<i>${value}</i>` : value;

// Build a structured entry directly (skipping the text parser, whose spaced-dash
// → column heuristic would mangle date ranges like "Jun. 2025 – Aug. 2025").
function entry(
  titleLeft: string,
  subtitleLeft: string,
  titleRight: string,
  subtitleRight: string,
  bullets: string[]
): ResumeEntry {
  return {
    ...newEntry({
      titleLeft: bold(titleLeft),
      subtitleLeft: italic(subtitleLeft),
      titleRight,
      subtitleRight: italic(subtitleRight)
    }),
    bullets: bullets.map((text) => newBullet(text))
  };
}

function section(heading: string, type: ResumeSectionData["type"], items: ResumeEntry[]): ResumeSectionData {
  return { ...newSection(type, heading), items };
}

// The fill-in-the-blanks starter uses the app's generic single-column resume
// structure. It is both the first-run default and what "Load sample" restores,
// so a new user types over guidance instead of clearing a stranger's resume.
export function buildStarterResume(): ResumeData {
  return {
    name: "Your Name",
    contact: ["you@email.com", "linkedin.com/in/yourprofile", "github.com/yourusername", "City, State"],
    sections: [
      section("Education", "standard", [
        entry("University Name", "B.S. in Computer Science", "Aug. 2022 – May 2026", "City, State", [])
      ]),
      section("Experience", "standard", [
        entry("Company Name", "Software Engineering Intern", "Jun. 2025 – Aug. 2025", "City, State", [
          "Accomplishment with a metric — what you built, shipped, or improved and by how much.",
          "Second accomplishment. Keep each bullet to one tight sentence."
        ]),
        entry("Another Company", "Role Title", "Jan. 2025 – May 2025", "Remote", [
          "What you owned and what the outcome was."
        ])
      ]),
      section("Projects", "standard", [
        entry("Project Name", "React, Node.js, PostgreSQL", "", "", [
          "One-sentence description of what the project does and your role in building it.",
          "Technical detail or user impact worth calling out."
        ]),
        entry("Another Project", "Python, FastAPI", "", "", [
          "What it does and what you learned or shipped."
        ])
      ]),
      section("Technical Skills", "skills", [
        newSkillEntry(bold("Languages"), "Python, TypeScript, JavaScript, SQL, Java"),
        newSkillEntry(bold("Frameworks"), "React, Node.js, Express, FastAPI"),
        newSkillEntry(bold("Tools"), "Git, Docker, AWS, PostgreSQL, Redis")
      ])
    ]
  };
}
