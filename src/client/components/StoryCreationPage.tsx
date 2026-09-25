import { useEffect, useRef } from "react";
import { ArrowLeft, BookOpen, Settings2, Sparkles, Workflow } from "lucide-react";

import type { CreateBookInput } from "../../shared/auto-novel";
import { StoryIdeaComposer } from "./CreativeHome";
import { AceternityAmbientLayer } from "./AceternityAmbientLayer";
import { WorkbenchQuickActions } from "./WorkbenchChrome";
import "./StoryCreationPage.css";

interface StoryCreationPageProps {
  busy: boolean;
  error: string | null;
  assetDraft: { id: string; text: string } | null;
  onAssetDraftApplied?: () => void;
  openIdeaTools?: boolean;
  onIdeaToolsOpened?: () => void;
  onSubmit: (input: CreateBookInput, autoStart?: boolean) => void;
  onBack: () => void;
  onConfigureProvider: () => void;
  onConfigureWorkflow: () => void;
  onOpenNavigation?: () => void;
  onOpenCommandPalette?: () => void;
  onRetry?: () => void;
}

export function StoryCreationPage({
  busy,
  error,
  assetDraft,
  onAssetDraftApplied,
  openIdeaTools = false,
  onIdeaToolsOpened,
  onSubmit,
  onBack,
  onConfigureProvider,
  onConfigureWorkflow,
  onOpenNavigation,
  onOpenCommandPalette,
  onRetry,
}: StoryCreationPageProps) {
  const ideaToolsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!openIdeaTools || !ideaToolsRef.current) return;
    ideaToolsRef.current.open = true;
    onIdeaToolsOpened?.();
  }, [onIdeaToolsOpened, openIdeaTools]);

  return (
    <main className="story-creation-page">
      <AceternityAmbientLayer variant="home" />
      <header className="page-topbar story-creation-topbar">
        <button className="ghost-button story-creation-back" type="button" aria-label="返回故事起点" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>返回故事起点</span>
        </button>
        <div className="story-creation-context" aria-label="当前页面">
          <BookOpen size={16} aria-hidden="true" />
          <span>新建故事</span>
        </div>
        <WorkbenchQuickActions
          actions={[
            { id: "provider", label: "模型设置", icon: Settings2, onSelect: onConfigureProvider },
            { id: "workflow", label: "工作流", icon: Workflow, onSelect: onConfigureWorkflow },
          ]}
          onOpenNavigation={onOpenNavigation}
          onOpenCommandPalette={onOpenCommandPalette}
          ariaLabel="创作页快捷操作"
        />
      </header>

      <section className="story-creation-main" aria-labelledby="story-creation-title">
        <div className="story-creation-heading">
          <span className="story-creation-heading-icon" aria-hidden="true"><Sparkles size={19} /></span>
          <div>
            <span className="story-creation-kicker">留一个故事的起点</span>
            <h1 id="story-creation-title">写下你想讲的故事</h1>
            <p>可以是一句话、一个人物，或一幕挥之不去的画面。这里是你的专属创作页。</p>
          </div>
        </div>

        <div className="story-creation-layout">
          <section className="story-creation-editor" aria-label="故事构思编辑器">
            <StoryIdeaComposer
              busy={busy}
              error={error}
              assetDraft={assetDraft}
              onAssetDraftApplied={onAssetDraftApplied}
              onRetry={onRetry}
              onSubmit={onSubmit}
              ideaToolsRef={ideaToolsRef}
            />
          </section>

          <aside className="story-creation-guide" aria-label="构思提示">
            <span className="story-creation-guide-label">写作提示</span>
            <h2>先抓住一个问题</h2>
            <p>不用急着写完整梗概。先记下最有感觉的部分：</p>
            <ul>
              <li><strong>谁</strong><span>哪个人正要经历变化？</span></li>
              <li><strong>想要什么</strong><span>他最想得到或守住什么？</span></li>
              <li><strong>会失去什么</strong><span>失败会带来怎样的代价？</span></li>
            </ul>
            <p className="story-creation-guide-note">灵感还不够时，打开“更多构思工具”找一个落笔点。</p>
          </aside>
        </div>
      </section>
    </main>
  );
}
