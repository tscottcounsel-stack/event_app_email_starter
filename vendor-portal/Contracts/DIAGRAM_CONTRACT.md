\# DIAGRAM SYSTEM – CANONICAL CONTRACT

\## Contract Index (Locked)



\### Organizer Event Update (Backend)

\- PATCH /organizer/events/{event\_id} is locked and verified working.

\- Supported fields are frozen by contract.



\### Organizer Event Edit UI (Frontend)

\- Route: /organizer/events/:eventId/edit

\- Save uses PATCH /organizer/events/{event\_id} only.

\- UI must never send nulls; sends only user-provided fields.

\- No event metadata GET endpoint is assumed; UI restores last-saved values locally.



\*\*Project:\*\* Event Vendor Platform (FastAPI + React)

\*\*Status:\*\* ACTIVE



---



\## Purpose



This document defines the \*\*locked, canonical behavior\*\* of the Event Vendor Platform’s diagram system and associated organizer/vendor flows. Any change to behavior governed here must be reflected in code \*first\*, then updated in this contract.



This contract exists to prevent regression during iterative development.



---



\## SECTION A — DIAGRAM SYSTEM (ORIGINAL CONTRACT)



\### Source of Truth



\* The \*\*event\_diagram\*\* table is the canonical source of layout data

\* \*\*event\_diagram\_history\*\* stores immutable snapshots

\* Diagrams are versioned and recoverable



\### Diagram Endpoints (Locked)



\* `GET /public/events/{event\_id}/diagram`

\* `GET /organizer/events/{event\_id}/diagram`

\* `PUT /organizer/events/{event\_id}/diagram`



\### Diagram Guarantees



\* Slots are grid-based and versioned

\* Slot IDs are stable across versions

\* Assigned slots are reflected consistently for vendors



\### Vendor Diagram UX Guarantees



\* Vendor diagram is \*\*read-only\*\*

\* Assigned booth highlights correctly

\* Vendor may apply directly from diagram

\* Vendor cannot re-apply after approval



---



\## SECTION B — ORGANIZER APPLICATIONS (LOCKED)



\### Organizer Applications View



\* Route: `/organizer/events/{event\_id}/applications`

\* Organizer can view all vendor applications scoped to an event



\### Organizer Actions



\* Approve / Reject actions are supported

\* Status updates are persisted

\* Assigned booth logic remains intact



---



\## SECTION C — ORGANIZER EVENT UPDATE (ADDENDUM)



\*\*Checkpoint Date:\*\* 2025-12-16

\*\*Status:\*\* LOCKED



\### Scope



This section governs the \*\*Organizer’s ability to update core Event fields\*\* via backend API. UI wiring may evolve, but backend behavior is frozen by this contract.



---



\### Backend API (Source of Truth)



\#### PATCH /organizer/events/{event\_id}



\*\*Auth:\*\* Organizer or Admin token required

\*\*Header:\*\* `Authorization: Bearer <token>`



\*\*Partial updates allowed\*\* (PATCH semantics)



---



\### Guaranteed Supported Fields



The following fields are contractually safe to update:



\* `title: string`

\* `description: string | null`

\* `location: string`

\* `date: string | datetime-like`



\### Accepted Aliases (Backward Compatible)



\* `name` → `title`

\* `venue` → `location`

\* `start\_date` → `date`



---



\### Success Response



Returns the updated Event object with at least:



```json

{

&nbsp; "id": number,

&nbsp; "organizer\_id": number,

&nbsp; "title": string,

&nbsp; "description": string | null,

&nbsp; "location": string,

&nbsp; "date": string | datetime

}

```



---



\### ORM / Model Invariants (CRITICAL)



These rules are \*\*locked\*\*:



\* `Event` ORM must map \*\*only existing DB columns\*\*

\* The following fields are explicitly \*\*NOT mapped\*\*:



&nbsp; \* `diagram\_url`

&nbsp; \* `layout\_json`



\#### Relationship Stability Rule



\* `Application.event` uses `backref("applications")`

\* `Event` must \*\*not\*\* require an explicit `applications` relationship

\* ORM must initialize \*\*without mapper errors\*\*



---



\### Router Inclusion Rule



\* `organizer\_event\_update` router must be included \*\*deterministically\*\*

\* Router inclusion must not be conditional

\* Server must boot cleanly without SQLAlchemy mapper exceptions



---



\## SECTION D — EXPLICITLY OUT OF SCOPE



The following are \*\*not yet contracted\*\*:



\* Organizer Event Edit UI page (frontend form + save UX)

\* Editing additional Event fields:



&nbsp; \* `max\_vendor\_slots`

&nbsp; \* `kind`

&nbsp; \* `business\_only`

&nbsp; \* `badge\_required`

\* Any DB migrations or schema expansions

\* Diagram ↔ Event coupling beyond this document



---



\## SECTION E — NEXT CONTRACT TARGETS



Recommended order:



1\. Organizer Event Edit UI (load + save)

2\. Save/refresh UX confirmation

3\. \*\*Applications / Assignment Contract\*\*

4\. Expanded Event field editing (only after recontracting)



---



\## CONTRACT STATUS



🧱 \*\*ACTIVE – MERGED – LOCKED\*\*



Any regression requires:



1\. Fix code

2\. Update this contract

3\. Re-lock checkpoint



\# ✅ CONTRACT: Applications / Assignment (Organizer)



\## Scope

This contract governs the organizer-side workflow for:

\- Listing vendor applications for an event

\- Approving / rejecting applications

\- Assigning an approved application to a diagram slot (booth)

\- Ensuring assignments are consistent with the diagram system invariants



This contract is \*\*backend + frontend behavior\*\*, but it \*\*does not permit schema changes or new endpoints\*\*.



---



\## Verified Existing Endpoint (Locked)

The following endpoint is confirmed working and is treated as locked:



\### List Applications for an Event

\- GET /organizer/events/{event\_id}/applications?limit={n}\&offset={n}

\- Response shape includes:

&nbsp; - event\_id

&nbsp; - items\[] where each item includes (at minimum):

&nbsp;   - id

&nbsp;   - event\_id

&nbsp;   - vendor\_profile\_id

&nbsp;   - status (e.g. "pending", "approved", "rejected")

&nbsp;   - requested\_slots

&nbsp;   - assigned\_slot\_id (nullable)

&nbsp;   - payment\_status (optional)

&nbsp;   - created\_at, updated\_at



No contract changes to this endpoint are allowed without updating this contract.



---



\## Organizer Actions (Contracted Behaviors)



\### A) Approve / Reject an Application

Organizer must be able to change application status from:

\- pending → approved

\- pending → rejected

\- approved → rejected (optional; allowed only if unassigned OR assignment is cleared first)



\*\*Invariant:\*\* An application in status `rejected` must not be assignable.



\*\*Contract:\*\* The status update request must:

\- authenticate as organizer

\- update only allowed fields (status + optional notes)

\- never create or modify events/diagrams



> Note: Exact route name may vary in your codebase; the behavior is what is frozen.

> Use the OpenAPI path that currently implements this action.

> If the path differs from your implementation naming, add the exact path under “Implementation Mapping” below.



\### B) Assign a Booth/Slot to an Approved Application

Organizer must be able to assign an approved application to a diagram slot.



\*\*Preconditions\*\*

\- Application.status MUST be "approved"

\- assigned\_slot\_id is either null (first assignment) or reassignment is explicitly allowed



\*\*Assignment Rules\*\*

\- assigned\_slot\_id must refer to a slot that belongs to the same event diagram for that event

\- assigned\_slot\_id must not already be assigned to a different approved application for the same event



\*\*Postconditions\*\*

\- Application.assigned\_slot\_id is set

\- Slot becomes “assigned” from the organizer/vendor UI perspective

\- Vendor diagram view highlights assigned booth



---



\## Vendor-Side Implications (Locked)

The organizer assignment must preserve these behaviors (already verified working):



\- Vendor diagram renders booths correctly from public diagram endpoint

\- Assigned booth is visually highlighted for the vendor

\- Vendor cannot re-apply after approval (application uniqueness/locking behavior remains)



No backend refactors are allowed to “make this easier.” Fixes must respect existing schema and invariants.



---



\## Diagram / Slot Consistency Invariants

Because the diagram system is versioned and slots are rendered from the diagram source of truth:



1\. assigned\_slot\_id MUST reference a slot id that exists in the diagram’s slot set for that event.

2\. Assignments MUST be consistent across:

&nbsp;  - organizer applications list

&nbsp;  - organizer diagram view

&nbsp;  - vendor diagram view

3\. A single slot cannot be assigned to more than one application at a time.



If an assignment violates any constraint, the API must reject it with a clear error (4xx).



---



\## Frontend Contract (Organizer UI)

Organizer UI must support:

\- View applications list for an event

\- Approve/Reject actions

\- Assign slot action (either from:

&nbsp; - a panel in diagram editor, or

&nbsp; - a dedicated applications page)



Frontend must:

\- Send Authorization header

\- Not swallow errors silently

\- Refresh local UI state after actions (either refetch list or update in-place)



---



\## Error Handling Contract

When organizer attempts an invalid action, UI must surface a readable message for:

\- assigning while status != approved

\- assigning a slot already assigned

\- assigning a slot not in the event diagram

\- rejecting an already-assigned application (if disallowed)



---



\## Verification Checklist (Must Pass)

\### List

\- GET /organizer/events/{event\_id}/applications returns items and correct statuses.



\### Approve/Reject

\- Changing status updates color/label in organizer UI.

\- Approved status persists on refresh/refetch.



\### Assign

\- Approved application can be assigned to a slot.

\- Slot becomes “assigned” in organizer diagram UI.

\- Vendor diagram highlights assigned slot.

\- Double-assignment is blocked.



---



\## Implementation Mapping (Fill In Once, Then Lock)

Record the exact paths used in your backend for:

\- Update Application Status:

&nbsp; - METHOD + PATH: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

&nbsp; - BODY: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

\- Assign Application to Slot:

&nbsp; - METHOD + PATH: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

&nbsp; - BODY: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_



Once filled, these routes become part of the locked contract.


## Addendum: Organizer Map Editor v1 (Layout + Categories)

**Status:** AGREED / FROZEN
**Scope:** Organizer map editor page for a single event (Map Editor #event_id).

### A. Backend behavior

1. **GET /organizer/events/{event_id}/diagram**

   - Returns HTTP 200 with body:

     ```json
     {
       "event_id": <int>,
       "version": <int>,
       "grid_px": <int>,
       "slots": [
         {
           "id": <int>,          // event_slots.id
           "label": "<string>",  // e.g. "B5"
           "x": <int>,           // grid units, 0-based
           "y": <int>,
           "w": <int>,           // width in grid cells
           "h": <int>,           // height in grid cells
           "status": "<string>", // UI only for now (not yet persisted)
           "kind": "<string>",   // UI only for now (not yet persisted)
           "price_cents": <int>,
           "category_id": <int|null> // FK to vendor_categories.id
         },
         ...
       ],
       "meta": {
         "source": "<string>",      // "history" | "generated_from_slots" | etc.
         "max_per_row": <int|null>  // optional layout hint
       }
     }
     ```

   - If a saved diagram version exists, it is returned as-is.
   - If no version exists, a default layout is generated from `event_slots` and versioned as `v1`.

2. **PUT /organizer/events/{event_id}/diagram**

   - Request body matches the GET shape above (same slots payload).
   - Behavior:
     - Updates geometry (`x, y, w, h`) and `category_id` in `event_slots` for the given `event_id`.
     - `status` and `kind` are **accepted in the payload** but are **not yet persisted** in the database (UI-only in this version).
     - Creates a new diagram version in history and returns:

       ```json
       { "event_id": <int>, "version": <int> }
       ```

   - Organizer UI must treat this as the **single source of truth** for layout and `category_id`.

3. **GET /public/vendor-categories**

   - Returns HTTP 200 with body:

     ```json
     [
       { "id": <int>, "slug": "<string>", "name": "<string>" },
       ...
     ]
     ```

   - `slug` is a stable, API-level identifier derived from `name`.
   - This endpoint is read-only and unauthenticated.

### B. Frontend Map Editor behavior (Organizer)

1. On load, the Map Editor:

   - Calls `GET /public/vendor-categories` to populate the category dropdown.
   - Calls `GET /organizer/events/{event_id}/diagram` to load the current layout.

2. Booth rendering:

   - Each slot from `diagram.slots` is rendered at `(x, y)` with size `(w, h)` in grid units.
   - If `slot.category_id` is non-null, a **category ribbon** is shown on the booth using the matching category name from `/public/vendor-categories`.
   - Booth fill color is derived from `slot.status` (UI-only for now).

3. Booth inspector (right panel):

   - Shows fields: `label`, `status`, `kind`, `category`, `x`, `y`, `width`, `height`.
   - Editing any field updates the in-memory slot.
   - Changes apply live on the canvas, but **do not persist** until the organizer presses **“Save layout”**.

4. Save behavior:

   - When the organizer clicks **“Save layout”**, the frontend sends a `PUT /organizer/events/{event_id}/diagram` with the full diagram payload.
   - After a successful 200 response, a normal page refresh MUST reproduce:
     - Booth positions and sizes.
     - `category_id` ribbons.
   - In this version, `status` and `kind` are not guaranteed to survive refresh (they are not yet persisted in DB).

### C. Frozen assumptions

- Organizer UI **never invents** booth geometry or categories outside this contract.
- Any future changes to:
  - diagram JSON shape,
  - slot geometry semantics,
  - persistence of status/kind,
  - or category wiring

  MUST be reflected as a **new addendum** (e.g. “Map Editor v2”) and implemented in a separate branch.
