# M19 S4 manual browser regression checklist

Use this for layout verification; `docs/testing.md` reserves automated E2E for
critical journeys using Playwright. There is no layout-only E2E command.
Retained unit tests check link names, destinations, DOM order and active state.
They do not simulate real Tab navigation or calculate browser layout; no CSS
class or source-format assertion substitutes for the measurements below.

1. Run `npm run build` and `npm start`. Open `/programs` signed out in a real
   browser. Record the commit, browser/version, OS and URL with the results.
2. In responsive DevTools set the viewport height to 820 CSS pixels. Test every
   cell below. Keep page zoom at 100%; enlarge base text using the console:
   `document.documentElement.style.fontSize = '16px'` (100%), `'24px'` (150%),
   or `'32px'` (200%). This reproduces the original text-enlargement regression;
   it does not substitute for testing browser zoom or native text settings.

| Width | 100% text | 150% text | 200% text |
|---|---|---|---|
| 320px | pending | pending | pending |
| 375px | pending | pending | pending |
| 393px | pending | pending | pending |

For **each cell**, record the following and mark pass/fail with the measurements:

- Reload, reapply the font size, and focus the page from browser chrome without
  clicking a header link. Press actual Tab keys through the header (allow the
  skip link first). Record each focused destination; it must be
  `/ → /programs → /exercises → /login`. Shift+Tab must reverse that order.
  Do not use `.focus()` calls as a replacement for this keyboard walk.
- While each destination has keyboard focus, confirm its ring is visible and
  unclipped; inspect `:focus-visible` and computed box-shadow (3px ring).
- Compare the keyboard sequence to **measured** visual order. In Elements,
  inspect the visible mobile header links' bounding boxes using
  `$0.getBoundingClientRect()`. Record left/right/top/bottom, width and height
  for each link. Group centres within 4px into rows; read rows top to bottom,
  then links left to right. This order must equal the keyboard sequence and
  DOM order. In particular, Sign in must never appear above Exercises.
- Confirm full, readable Fit40 / Programs / Exercises / Sign in labels, no
  overlap, ellipsis or clipping. Compare each element's `scrollWidth` with
  `clientWidth` (allow 1px rounding); inspect wrapped text visually as well.
- Programs, Exercises and Sign in must each measure at least 44px in both
  dimensions. Record the wordmark separately: its historical 28px height at
  default text is a known limitation, not a passing 44px control.
- Record header `scrollWidth`/`clientWidth` and rightmost link edge; the header
  must not scroll horizontally or extend outside the viewport (1px rounding).
  Record document `scrollWidth`/`clientWidth` separately. Attribute any page
  overflow to its measured offending element; do not hide overflow to pass.
  Earlier evidence found program-card overflow at enlarged text (see S4 report
  §12.4); report it independently of navigation overflow.
- At 100% text, confirm a single 64px header row. At enlarged text, allow the
  header to grow; all links must stay readable and in the correct order.

Repeat signed in on `/dashboard`: four bottom tabs, correct active state, full
accessible names, readable labels, ≥44px targets, visible keyboard focus and no
bar-attributable overflow. Check the final content is above the bar. On an active
workout route only the finish bar should appear; completed sessions have no
finish bar. Retain the broader S4 checks at 768/1440px and on real safe-area
devices when available. Never label an untested cell as passing.

For the original regression, the pre-fix growing compact nav could display
`Fit40 → Programs → Sign in → Exercises` at 320px/200% while Tab still reached
Exercises first. Both real keyboard navigation and bounding-box measurements
are required to detect that mismatch; passing unit tests alone is insufficient.

Restore the font size after testing with
`document.documentElement.style.removeProperty('font-size')`. Keep the completed
matrix, focus sequences, geometry and screenshots with the review evidence.
