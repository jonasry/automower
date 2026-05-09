# Message Event Log Design

## Goal

Replace the single status text in the map sidebar with a five-row event log for
the selected mower. The log uses the full retained `events` table, not the
selected session, and shows the latest `message-event-v2` rows for that mower.

## Data Source

The backend will add a database helper that reads from `events`:

- `mower_id` matches the selected mower.
- `event_type = 'message-event-v2'`.
- `event_timestamp IS NOT NULL`.
- Results are ordered by `event_timestamp DESC`.
- The default limit is 5.

Each returned row includes timestamp, message code, severity, latitude, and
longitude. The HTTP status payload enriches each row with the message text from
`docs/swagger/messages.txt` using the existing `messageDescriptions` map.

This is a read limit only. No event retention, truncation, or deletion behavior
is introduced.

## API Shape

Each mower object in `/api/status` will include:

```json
{
  "messages": [
    {
      "code": 123,
      "severity": "WARNING",
      "timestamp": "2026-05-09T12:00:00.000Z",
      "description": "Message text",
      "lat": 55.7,
      "lon": 13.2
    }
  ]
}
```

The existing `lastMessage` field remains in the response for compatibility, but
the browser UI uses `messages` for the event log.

## UI Behavior

The sidebar replaces the current `Status` detail row with an event log section.
The log renders up to five rows for the selected mower. Each row shows:

- severity
- time
- code
- message text

`ERROR` and `WARNING` severities display an icon before the severity. Other
severities render without an icon. If no messages exist, the section shows
`No mower messages recorded`.

The selected session dropdown does not affect this log.

## Map Behavior

The map adds a separate Leaflet layer for message markers. On each data refresh,
markers are cleared and rebuilt from the selected mower's message list. If a
message has finite latitude and longitude and its severity is `ERROR` or
`WARNING`, the same severity icon used in the log is placed at that location.

These markers are independent of heatmap and recent-path rendering, but they are
cleared with the other transient map layers when data reloads.

## Testing

Add focused Node tests for the database latest-message helper. Verify that it:

- returns only `message-event-v2` rows for the requested mower
- orders rows newest first
- applies the requested limit
- includes coordinates

Run the existing test suite after implementation. Manual UI verification covers
sidebar rendering, empty state, and map icons because the project does not
currently have browser-level UI tests.
