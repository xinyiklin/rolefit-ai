import { newDocumentHeader, type ResumeData } from "@typeset/engine/lib/resumeData.ts";

// RoleFit always owns a real editor document. An empty name is intentional: it
// keeps the first field caret-bearing without painting sample content.
export function createBlankResumeData(): ResumeData {
  return {
    header: newDocumentHeader(),
    sections: []
  };
}
