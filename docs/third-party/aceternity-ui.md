# Aceternity UI attribution

This project adapts interaction and composition patterns from Aceternity UI:

- [Spotlight](https://ui.aceternity.com/components/spotlight) → pointer-aware ambient focus around the authoring canvas;
- [Background Beams](https://ui.aceternity.com/components/background-beams) → local SVG beam atmosphere;
- [Tracing Beam](https://ui.aceternity.com/components/tracing-beam) → the home writing-path progress line;
- [Moving Border](https://ui.aceternity.com/components/moving-border) / stateful feedback patterns → the idea-stage moving border and existing stateful actions.

The source project documents an Aceternity License for downloadable/pro components; this work does not copy or redistribute the original component source. It rewrites the visual ideas in native React/CSS using Xiaoyi's semantic tokens, and does not add Tailwind, Next.js, a remote stylesheet, or a runtime Aceternity dependency. The official license terms remain the source of truth: <https://ui.aceternity.com/licence>.

Adapted implementation:

- `src/client/components/AceternityAmbientLayer.tsx`
- `src/client/components/AceternityAmbientLayer.css`
- `src/client/styles/workbench-refresh.css`
