export type JobPostingRelationship = {
  matchedApplicationId: string;
  jobPostingGroupId?: string;
  confidence: "exact" | "high" | "possible";
  matchedNotApplyingRecordId?: string;
};

export type PreparationSession =
  | {
      mode: "new";
      applicationId: null;
      pendingRelationship: JobPostingRelationship | null;
    }
  | {
      mode: "draft";
      applicationId: string;
      pendingRelationship: JobPostingRelationship | null;
    }
  | {
      mode: "update";
      applicationId: string;
      pendingRelationship: null;
    };

export function newPreparationSession(
  pendingRelationship: JobPostingRelationship | null = null
): PreparationSession {
  return { mode: "new", applicationId: null, pendingRelationship };
}

export function preparationSessionForApplication(application: {
  id: string;
  status: string;
}): PreparationSession {
  return application.status === "interested"
    ? {
        mode: "draft",
        applicationId: application.id,
        pendingRelationship: null
      }
    : {
        mode: "update",
        applicationId: application.id,
        pendingRelationship: null
      };
}
