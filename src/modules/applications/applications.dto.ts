// Owns individual application draft, submission, timeline, supplement lifecycle.
export type CurrentApplicationState = 'not_started' | string;

export type CurrentApplicationResponseDto = {
  application: unknown | null;
  state: CurrentApplicationState;
  schoolYear: string;
};

export type DraftAutosaveResponseDto = {
  applicationId: string;
  currentDraftVersion: number;
  savedAt: string;
};
