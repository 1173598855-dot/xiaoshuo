# Uiverse attribution

This project adapts interaction ideas from [Uiverse.io](https://uiverse.io/) and its [Galaxy collection](https://github.com/uiverse-io/galaxy), especially tactile button feedback, toggle-switch affordances and compact state controls.

- Source: <https://uiverse.io/>
- Collection: <https://github.com/uiverse-io/galaxy>
- License: the Uiverse site and Galaxy repository publish the UI elements under the MIT License.
- Adaptation: `src/client/components/WorkbenchChrome.tsx` and `src/client/styles/workbench-refresh.css`

The implementation is rewritten around Xiaoyi's semantic tokens, native button behavior, visible keyboard focus, touch-safe sizing and `prefers-reduced-motion`. No Uiverse stylesheet or remote component is loaded at runtime.
