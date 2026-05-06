# Soft Garden UI Redesign Spec

## Context

The current Automower UI is a single-page Leaflet heatmap in `public/map.html`. It uses a dark, high-contrast top bar and sidebar, a technical rainbow heatmap, placeholder mower/session details, and a fixed dashboard-like layout.

The desired direction is a calm home/garden companion app. The UI should feel modern, inviting, and useful for a homeowner checking mower activity, not like a technical monitoring console. The existing structure is not a constraint; it can change where UX improves.

## Visual Thesis

Automower should feel like a quiet garden companion: warm daylight surfaces, muted botanical greens, soft status accents, and a map-first workspace that makes the lawn feel alive without becoming decorative.

## UX Goals

- Make current mower state understandable in one glance.
- Keep the map as the primary object, but make it feel like a garden surface rather than a telemetry canvas.
- Reduce visual harshness by replacing pure dark surfaces, pure white text, and saturated rainbow colors.
- Make session exploration obvious and comfortable without forcing users through dense controls.
- Use friendly, precise status language: `Mowing now`, `Docked`, `Charging`, `Paused`, `Needs attention`, `Last updated 30s ago`.
- Preserve utility: timestamps, battery, session duration, point count, and mower selection must remain easy to find.

## Recommended Product Shape

Use a map-led app layout with an integrated status rail rather than a hard dashboard shell.

The first screen should show:

- A calm top status strip with mower name, current activity, battery, and freshness.
- A large map/garden surface as the dominant workspace.
- A soft floating or docked session panel that can collapse on smaller screens.
- A compact session timeline/history control for switching between latest and previous sessions.

This is intentionally not tied to the current fixed dark sidebar. On desktop, a left or right inspector is acceptable if it feels like a secondary control surface. On mobile, the session panel should become a bottom sheet or stacked section below the map.

## Information Architecture

### Primary

- Mower identity: selected mower name and picker.
- Current state: activity, battery, charging/attention state, last update.
- Map: heat coverage plus recent path.

### Secondary

- Current session summary: start, end/current time, duration, point count.
- Session history: latest sessions in plain-language labels.
- Map controls: zoom, recenter, selected session, possibly heat/path visibility later.

### Tertiary

- Raw diagnostic details, event codes, and dense telemetry should not dominate the default view. They can appear later behind a details affordance if needed.

## Layout Direction

### Desktop

Prefer a full-window map with a soft app chrome layer:

- Top strip: 56-68px, warm surface, subtle shadow or border, compact status content.
- Main area: map fills the remaining viewport.
- Session panel: 300-360px wide, translucent warm surface or solid off-white, positioned as a side inspector or overlay depending on map readability.
- Controls should avoid boxed dashboard-card mosaics. Use sections, labels, dividers, and compact metrics instead.

### Mobile

Prefer map first:

- Top strip remains compact and wraps carefully.
- Map takes the first major viewport area.
- Session controls move to a bottom sheet or below-map panel.
- Avoid tiny sidebar patterns on narrow screens.

## Visual System

### Palette

Base colors should come from natural surfaces:

- Background: warm off-white or pale sage.
- Primary text: deep green-charcoal.
- Muted text: grey-green.
- Panel surface: soft ivory or lightly tinted green.
- Border/divider: low-contrast sage grey.
- Normal/mowing: muted green.
- Charging/attention: warm amber.
- Error/critical: restrained red, used rarely.

Avoid the current slate/black shell and highly saturated rainbow heatmap as the default look.

### Heatmap And Path

The heatmap should be legible but softer:

- Low intensity: transparent sage/leaf green.
- Mid intensity: richer green.
- High intensity: warm gold.
- Peak intensity: soft coral only where necessary.

The recent path should use a calm green or deep moss line instead of indigo. Start/end markers should become small designed markers, not emoji glyphs, to avoid an inconsistent visual tone.

### Typography

Use the system font stack unless a bundled font is added deliberately. Improve hierarchy through weight, size, spacing, and color:

- Mower name: clear but not oversized.
- Status badge: compact and readable.
- Session metrics: numeric emphasis with small muted labels.
- Avoid uppercase-heavy labels except for very small section labels.

## Interaction Design

- Mower picker: integrated into the top strip, readable as a selector without dominating.
- Session selector: use a list/timeline style if there are multiple sessions; a plain select is acceptable initially but should be visually softened.
- Map refresh: updates should not flicker. Preserve zoom/pan unless the user asks to recenter or changes session.
- Empty states: show useful messages such as `No session data yet` or `Waiting for mower position`.
- Loading states: use subtle skeleton/placeholder rows or muted text, not blocking spinners.
- Error states: surface API failures in the panel with a concise retry/status message.

## Motion

Motion should be restrained and functional:

- Status changes fade or slide gently.
- Session changes update panel content and map layers without harsh jumps.
- Recent mower position may have a subtle pulse if it does not distract from the heatmap.

Motion must be optional through `prefers-reduced-motion`.

## Accessibility

- Maintain sufficient contrast for all text and controls on light surfaces.
- Keep focus states visible and calm.
- Do not rely on color alone for mower status; pair color with text.
- Use real controls for selectors and buttons.
- Ensure map overlays and panels do not trap keyboard focus.

## Implementation Boundaries

This design spec covers UX and visual direction only. It does not require backend API changes by itself.

Initial implementation can remain in `public/map.html`, but the code should be organized enough that future status/session API work can plug in cleanly. If the UI grows beyond a single file, splitting CSS and JS into separate assets is acceptable.

## Acceptance Criteria

- The default view no longer looks like a high-contrast technical dashboard.
- Current mower state, battery, and freshness are visible at a glance.
- The map remains the dominant workspace.
- Session controls are easy to discover and do not visually overpower the map.
- The heatmap uses a softer garden-compatible palette.
- Desktop and mobile layouts both avoid cramped sidebars and text overflow.
- Empty, loading, and error states are designed, not left as silent failures.

## Open Decisions

- Whether the session panel should be docked to one side or float over the map on desktop.
- Whether session history should start as a styled select or a richer list/timeline.
- Whether to introduce a separate CSS/JS file now or keep the first redesign contained in `public/map.html`.
