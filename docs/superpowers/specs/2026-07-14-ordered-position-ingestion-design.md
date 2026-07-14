# Ordered Position Ingestion Design

## Goal

Preserve the Husqvarna WebSocket stream's arrival order from ingestion through route and heat-map rendering. Position timestamps are informational and must not determine route order because events without a source timestamp use their arrival time and several events can receive the same timestamp.

## Ingestion

WebSocket messages enter one process-wide FIFO Promise chain. Each message is fully handled before handling the next message. For a position message, the event row is inserted first and its position row is inserted second. Sequential insertion makes each table's generated identity `id` reflect WebSocket arrival order for that row type.

The existing concurrent persistence set, pending-task limit, and persistence-drop behavior are removed. No separate backpressure or database-outage subsystem is introduced.

If an event or position insert fails, the application logs the failure. That message's remaining persistence follows the existing behavior: a failed event insert does not prevent an otherwise valid position from being stored without an event link. The FIFO then continues with the next WebSocket message so one failed insert cannot permanently stop ingestion.

Live mower state and client notifications are handled inside the same FIFO operation. This favors a simple, ordered data flow over special responsiveness during database outages.

## Position Queries

The map works with one selected mower at a time. Position reads therefore require a mower ID and use this ordering:

```sql
WHERE mower_id = $1
ORDER BY id
```

When a session is selected, `session_id` is added to the filter while `id` remains the only ordering key. The positions query selects `id` so the ordering key is explicit in the returned database rows, although the HTTP payload does not need to expose it.

The positions endpoint does not query combined history for every mower. If no mower ID is supplied, it returns the existing empty positions payload shape: empty `heat` and `recent` arrays and a null session summary.

## Rendering Consequences

Interpolation consumes positions in insertion order. Both the original waypoint list used by the dashed route and the interpolated points used by the heat map therefore remain stable as later positions are appended.

Timestamps remain available for session dates, durations, freshness, and heat age weighting. They are not used to infer waypoint order.

## Tests

Automated coverage will verify:

- WebSocket messages are persisted one at a time in arrival order.
- Positions with equal timestamps are returned in insertion-ID order.
- Positions with timestamps that run backward are still returned in insertion-ID order.
- A failed insert is logged and does not prevent the next queued message from being attempted.
- A positions API request without a mower ID returns an empty payload without reading all mowers.

The obsolete concurrent-backpressure test is removed. Existing interpolation and positions-payload tests continue to verify that ordered database rows feed both route and heat-map output.

## Documentation

The README will state that WebSocket events are persisted sequentially, position identity IDs define route order, timestamps are informational rather than ordering keys, and an individual insert failure is logged before processing continues with the next event.
