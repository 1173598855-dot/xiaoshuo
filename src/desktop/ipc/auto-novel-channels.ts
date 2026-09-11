export const AUTO_NOVEL_CHANNELS = {
  booksList: "auto-novel:books-list",
  booksCreate: "auto-novel:books-create",
  booksGet: "auto-novel:books-get",
  directionsSelect: "auto-novel:directions-select",
  productionStart: "auto-novel:production-start",
  productionGet: "auto-novel:production-get",
  productionPause: "auto-novel:production-pause",
  productionResume: "auto-novel:production-resume",
  productionCancel: "auto-novel:production-cancel",
  candidateAccept: "auto-novel:candidate-accept",
  candidateDiscard: "auto-novel:candidate-discard",
  booksExport: "auto-novel:books-export",
} as const;

export type AutoNovelDesktopChannel =
  (typeof AUTO_NOVEL_CHANNELS)[keyof typeof AUTO_NOVEL_CHANNELS];
