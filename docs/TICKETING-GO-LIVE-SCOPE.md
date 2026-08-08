# Ticketing — what it would take to go live

Scope note written before building anything, so the size of the feature is
visible before it is started. **Nothing in this document is implemented yet.**

## What exists today, and why it is not ticketing

The platform already has the *detection* half of an incident workflow:

| Exists | Table | What it does |
|---|---|---|
| Alarm raise | `alarm_events` | Threshold/rate/offline detection stamps a row |
| Acknowledge | `alarm_events.acknowledged_at/_by` | One person marks it seen |
| Root cause | `event_problems` + `alarm_events.event_problem_id` | Admin-defined catalogue, picked at ack |
| Clear | `alarm_events.cleared_at` | Set when the condition goes away |
| Escalation flag | `alarm_events.escalated` | A column — written by the sweep, not a workflow |
| Notification | `notification_channels` | Routes to org-wide or the owning department |

What is missing is everything *after* "someone noticed": there is no owner, no
state beyond acknowledged/cleared, no due date, no history of who did what, and
no way to record the work performed. `alarm_events` cannot be stretched to
cover this — an alarm is a *condition that was true*, a ticket is *work a
person owes*, and they have different lifecycles (an alarm can clear itself
while its ticket is still open, and one ticket often covers several alarms).

---

## Required for go-live (MVP)

### 1. Schema — `tickets` + `ticket_events`
- `tickets`: id, org_id, node_id (nullable — not every ticket is device-bound),
  department_id (owning team), title, description, status, priority,
  assignee_user_id, created_by, created_at, updated_at, due_at, closed_at,
  closed_by, resolution_note.
- `ticket_events`: append-only audit of every transition and comment
  (ticket_id, actor_id, kind, from_value, to_value, note, created_at).
  Append-only because "who changed the assignee at 02:00" is exactly what gets
  disputed after an incident.
- `ticket_alarms`: join table — one ticket covers many alarms, and the same
  alarm must not spawn duplicate tickets.
- Lives in the **org database** (like `alarm_events`, `node_departments`),
  denormalised `org_id` for the same single-indexed-read reason.

### 2. Lifecycle
Minimum viable states: `open → in_progress → resolved → closed`, plus
`cancelled`. Transitions must be validated server-side (you cannot close
something never opened), and every transition writes a `ticket_events` row.

### 3. Creation paths
- **Manual** — an admin/engineer raises one from a device page.
- **From an alarm** — one click on an alarm, pre-filled with the device,
  owning department and severity→priority mapping.
- **Automatic (optional, flagged off by default)** — a CRITICAL alarm that
  stays unacknowledged for N minutes opens a ticket. Must be opt-in per org:
  turning this on for a noisy fleet creates hundreds of tickets in an hour.

### 4. Assignment and access
- Assign to a **user** or leave at **department** level (unassigned queue).
- Must respect every existing visibility rule already enforced elsewhere:
  `deptVisible` (node_departments), `siteVisible`, `product_access` levels and
  the new `node_user_visibility` — a ticket for a device you cannot see must
  not be listable, and enforced in `guard()`, not only filtered in the list.
  **This is the single biggest correctness risk in the feature.**

### 5. Notification
Reuse `notification_channels` (org-level + per-department, already built) for:
ticket assigned, ticket overdue, ticket closed. Needs a per-event opt-in so a
customer is not mailed on every internal state change.

### 6. UI
- **Ticket list** — filter by status/priority/assignee/department/device, same
  time-range + filter vocabulary the Events page already uses.
- **Ticket detail** — timeline of `ticket_events`, comment box, state buttons.
- **Device page** — "open tickets" count and a create button.
- **Alarm row** — "create ticket" action.

### 7. Reporting
Ticket counts by status/department, mean time to resolve. Fits the existing
`report_schedules` mechanism once tickets exist.

---

## Deliberately out of MVP

Recording these so they are decisions, not oversights:

- **SLA policies and business-hours clocks.** "4 working hours, excluding Thai
  public holidays" is a calendar engine, not a due-date column.
- **Email-in / reply-by-email.** Needs an inbound mail path the platform does
  not have.
- **Attachments on tickets.** The `documents` / `node_photos` machinery could
  be reused, but it is per-node today.
- **Customer-facing ticket submission.** The viewer portal is read-only by
  design; opening a write path there needs its own access review.
- **Cross-org / vendor tickets.** Every table here is org-scoped; a shared
  vendor queue breaks that and needs a separate design.

---

## Rough sizing

| Piece | Notes |
|---|---|
| Schema + migration | 1 migration, 3 tables |
| Backend CRUD + transitions | ~6 endpoints, all needing the visibility checks in §4 |
| Access-control tests | The part that must not be rushed — mirrors the 16-check suite written for `node_user_visibility` |
| Notification wiring | Small; the routing already exists |
| UI (list, detail, create, device/alarm entry points) | The largest single piece |

**The dependency worth stating:** §4 is not optional polish. Every other
access surface in this platform has already had a real leak found in it during
this work (report download crossing tenants, device detail reachable by URL,
per-user visibility never enforced). A ticket carries a device id, a
department and free-text describing a fault — it must go through the same
`guard()` path as everything else from the first commit, not after.
