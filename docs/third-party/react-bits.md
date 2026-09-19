# React Bits attribution

This project includes adapted `CursorGrid`, `SpotlightCard`, `Dock`, and direction-card spotlight interactions based on the React Bits component library.

- Source: <https://github.com/DavidHDev/react-bits>
- Component references: `src/ts-default/Animations/CursorGrid/CursorGrid.tsx`, `src/ts-default/Components/SpotlightCard/SpotlightCard.tsx`, `src/ts-default/Components/TiltedCard/TiltedCard.tsx`, and `src/ts-default/Components/Dock/Dock.tsx`
- License: MIT + Commons Clause License Condition v1.0
- Copyright: © 2026 David Haz

The adapted component is used as part of the Xiaoyi Novel Workbench application. It is not distributed as a standalone component library.

## Surface mapping

- Home / idea entry: `CursorGrid` plus `SpotlightCard`-style paper focus; the black-hole backdrop is a separate local NASA asset.
- Direction picker: `SpotlightCard` interaction on each candidate direction so focus and Space preview remain visible.
- Production room: `Dock` pattern for high-frequency author actions; the existing top actions remain as the keyboard-readable source of truth.
- Authoring hub and story branches: native drawer structure with the same spotlight/color vocabulary; dense data comparison is intentionally not turned into a decorative card grid.
- Timeline, memory, candidate review, asset editor, authentication, and data-management dialogs: native semantic forms are retained because revision fields, text editing, focus traps, and error states are more important than animation. The Flutter login motion reference is documented separately.

## License text

```text
MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software as part of
an application, website, or product, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

Commons Clause Restriction

You may use this Software, including for any commercial purpose, so long as you
do not sell, sublicense, or redistribute the components themselves—whether
alone, in a bundle, or as a ported version.

No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
