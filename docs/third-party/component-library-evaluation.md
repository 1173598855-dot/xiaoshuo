# Component library evaluation

The workbench was evaluated against several component sources before the current full-surface pass:

| Source | Best fit | Decision |
| --- | --- | --- |
| [React Bits](https://github.com/DavidHDev/react-bits) | Pointer effects, spotlight cards, dock, lightweight visual motion | Adopted locally for `CursorGrid`, `SpotlightCard`, `Dock` patterns and direction-card focus. |
| [Uiverse](https://uiverse.io/) / [Galaxy](https://github.com/uiverse-io/galaxy) | Tactile buttons, toggle switches, status and form micro-feedback | Adapted into token-based quick actions, the motion preference switch and reasoning preset states; no remote runtime dependency. |
| [Aceternity UI](https://ui.aceternity.com/components) | Spotlight, Background Beams, Tracing Beam, Moving Border, stateful feedback | Adapted as local SVG/CSS ambient layers and progress relationships; no Tailwind/Next runtime or copied component source. See `docs/third-party/aceternity-ui.md`. |
| [Aceternity UI](https://ui.aceternity.com/components) | Animated hero/background and marketing-oriented effects | Evaluated; most candidates assume Tailwind/Next or high-decoration marketing surfaces, so not dropped into dense authoring panels. |
| [Magic UI](https://magicui.design/docs/components) | Shiny cards, beams, grid backgrounds, animated text | Evaluated; useful references, but many components assume Tailwind/Motion and would add visual noise to editor surfaces. |
| [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | Dialog, popover, select, tooltip, focus management | Evaluated as a future behavior layer; current dialogs already have local focus-trap and IPC-specific lifecycle rules, so no blind replacement was made. |
| [`flutter_login`](https://pub.dev/packages/flutter_login) + [`animations`](https://pub.dev/packages/animations) | Auth mode switching, form transitions, Material Motion | Adapted into the React AuthGate without adding Flutter runtime dependencies. |

## Surface decisions

- Home and direction surfaces use local React Bits-derived spotlight/cursor interactions.
- Production room uses the Dock pattern for high-frequency author actions.
- AuthGate uses Flutter login interaction ideas with local React/CSS implementation.
- Timeline, memory, candidate review, asset editing and data management keep semantic native forms because revision safety, focus management, long text editing and error recovery are more important than decorative animation.
- No component is loaded from a remote URL at runtime; copied/adapted source and attribution stay in the repository.
- Uiverse elements are used as interaction references, not as a drop-in stylesheet: the switch keeps native button semantics and `aria-pressed`, while colors, spacing, motion and reduced-motion behavior come from Xiaoyi tokens.
