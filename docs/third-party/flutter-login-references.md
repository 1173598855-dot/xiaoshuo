# Flutter login interaction references

The React/Electron authentication surface borrows interaction patterns from these Flutter references; Flutter itself is not added to the project:

- [`flutter_login`](https://pub.dev/packages/flutter_login): animated login/sign-up mode switching, configurable theming, loading and success states.
- [`animations`](https://pub.dev/packages/animations): Material Motion transition patterns for predictable state changes.

Adapted locally in `src/client/components/AuthGate.tsx` and `src/client/styles/app.css`:

- mode changes animate the form entry without losing focus management;
- rate-limit, validation, submitting and success states remain explicit and accessible;
- `prefers-reduced-motion` disables the decorative motion;
- no Flutter dependency or remote runtime resource is introduced.
