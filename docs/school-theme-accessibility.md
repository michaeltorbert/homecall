# School theme accessibility (issue #33)

Homecall uses the selected B · School night appearance for six curated schools and the neutral graphite appearance for every other school. This note records which colors may vary by school, which never do, and how contrast is kept for any school. It covers color contrast only. It is not a full WCAG conformance claim.

## What varies and what is fixed

- **Per school:** the B planes in `style.css` (`--school-canvas`, `--surface`, `--surface-hover`, `--line`, `--field-line`) and the accent roles in `src/school-theme.js` (primary fill, its text and edge, selected-tab ink and the range accent). Published brand colors are used only as primary fills. Every other school tone is a Homecall application tone chosen for contrast, not an official color.
- **Fixed for every school:** text and secondary text, links, focus ring, status (`--info`), warnings, errors, success, the recovery action inside warnings, text-field and select boundaries (`--field-edge`), placeholder text (`--placeholder`), the range track (`--range-track`) and the light ring around the range thumb (`--range-thumb-edge`).
- **Range sliders:** they stay native `<input type="range">` elements, so values, keyboard, focus and the 44px target are unchanged. Only the track and thumb are drawn in CSS, with separate rules for WebKit/Blink and Firefox. The track shows the slider's full extent, including at 0. The thumb's ring separates it from the track and the page, and its center keeps the school accent. The track has no filled segment, because the thumb position and the visible value (`80%`, `0.00 s`) already show the value. Warnings, errors and status also keep their wording, location and left-edge or dot shape, so their meaning never relies on hue alone.

## How contrast is guaranteed for any school

1. **Allowlist only.** A school gets a theme only through an own key in `schoolThemes` that has a matching `:root[data-school="…"]` block. Unknown, catalog-only, inherited or malformed keys clear every role and the marker, which leaves the tested graphite fallback. No remote or arbitrary colors are applied.
2. **Test gate.** `test/school-theme.test.js` reads each school's real planes from `style.css` and requires:
   - 4.5:1 for text, including on hover planes;
   - 3:1 for the range track and thumb ring (against each other and every plane), the focus ring and the field boundaries;
   - 4.5:1 for placeholders;
   - the same set of schools in the CSS blocks and the palette map.

   A new school is added only when it passes the same tests and a rendered audit; otherwise it stays neutral.
3. **Applicability.** The thresholds follow W3C Understanding 1.4.3, 1.4.11, 1.4.1 and 2.4.7:
   - **Required:** boundaries that identify text fields and selects, selected-state indicators and the focus ring.
   - **Not required:** borders of buttons that are identified by their text, and decorative container edges. These are measured but not held to 3:1.
   - **Exempt from the numbers:** disabled controls, though they must still look clearly different from enabled ones.

## Not covered here

- **Native paint:** the audio controls and select arrows are painted by the browser and are assessed separately in rendered pixels, as is the drawn range in each engine.
- **Platforms:** results are limited to desktop Chromium and WebKit with mobile-width viewports, not native devices.
