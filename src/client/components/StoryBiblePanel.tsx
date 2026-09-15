import type { MemoryContextConfig } from "../../shared/memory";
import type { AutoNovelApi } from "../auto-novel-api";
import { MemoryPanel } from "./MemoryPanel";

interface StoryBiblePanelProps {
  bookId: string;
  chapterNumber: number;
  api: AutoNovelApi;
  memoryContextConfig: MemoryContextConfig;
  onMemoryContextConfigChange: (config: MemoryContextConfig) => void;
  onClose: () => void;
}

/** Story-facing view over the revision-safe memory ledger. */
export function StoryBiblePanel(props: StoryBiblePanelProps) {
  return <MemoryPanel {...props} mode="bible" />;
}
