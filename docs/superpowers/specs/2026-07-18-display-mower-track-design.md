# Display Mower Track Design

## Goal

Add a checked-by-default **Display Mower Track** checkbox to the session panel.
When checked, the map displays the selected session's mower track. When
unchecked, the track is hidden while the heatmap remains visible.

The setting is temporary UI state. It resets to checked whenever the page is
loaded and is not persisted in browser storage.

## Interaction

The checkbox appears directly beneath the Session history selector so its
scope is clear. Changing it updates the map immediately without reloading
position data or changing the selected mower or session.

The mower track consists of the session's point markers, dashed connecting
line, and start/end endpoint markers. Unchecking the control removes all of
these items. Rechecking it restores them from the most recently loaded session
data.

The checkbox affects only the mower track layer. The following remain
unaffected:

- the coverage heatmap;
- the mower boundary overlay;
- warning and error location markers;
- the selected mower and session;
- session Start and End values;
- session Duration and Points values; and
- the session event log and other status information.

## Client State and Rendering

`public/map.html` owns the labeled, checked-by-default checkbox. `public/map.js`
owns its transient state and Leaflet integration.

The client retains the latest successfully loaded `recent` session positions
in memory. Track rendering is split from data loading:

1. a successful positions response replaces the cached session positions;
2. the normal map render draws the track only when the checkbox is checked;
3. unchecking removes the existing track layer without touching other layers;
4. rechecking renders the track from the cached positions without an API
   request; and
5. mower or session changes replace the cache and honor the current checkbox
   state.

Existing heatmap fitting and session-stat rendering continue independently.
The track preference does not alter API parameters or server behavior.

## Error and Edge Handling

- If no session positions are available, checking the control renders no track
  and does not produce an error.
- Failed refreshes retain the page's existing error behavior; the checkbox does
  not initiate requests or create a separate failure path.
- Repeated checking or unchecking is idempotent and cannot leave duplicate
  Leaflet layers on the map.
- The unchecked state remains in effect during automatic refreshes and mower or
  session changes until the page is reloaded.

## Testing

Automated browser-source tests will verify that:

- the session panel contains a checkbox labeled **Display Mower Track**;
- the checkbox is checked by default;
- successful position loads cache the latest session track;
- track rendering is conditional on the checkbox state;
- unchecking removes only the track layer;
- rechecking redraws the cached track without fetching positions again; and
- session-stat rendering remains unconditional and therefore Start, End,
  Duration, and Points are unaffected.

The focused tests run with Node's built-in test runner alongside the existing
tests under `public/`.
