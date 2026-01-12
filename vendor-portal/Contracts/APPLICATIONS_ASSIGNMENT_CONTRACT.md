\# APPLICATIONS\_ASSIGNMENT\_CONTRACT.md

🔒 CONTRACT — Applications \& Booth Assignment (Organizer ↔ Vendor)



This contract freezes the behavior for:

\- Organizer application review (list / approve / reject)

\- Organizer booth/slot assignment to approved applications

\- Vendor-side impact (highlighted assigned booth, re-apply rules)

\- Diagram/slot consistency rules



This contract exists to prevent regressions and to avoid backend “fixes” during UI work.



---



\## 1) Scope



\### In scope

\- Organizer: view applications for an event

\- Organizer: approve/reject applications

\- Organizer: assign an approved application to a diagram slot

\- Vendor: see application status + assigned booth highlight

\- Enforcement of “no duplicate assignment” rules



\### Out of scope

\- Any schema changes

\- Any ORM relationship refactors

\- Any new endpoints

\- Payment processing logic changes

\- Diagram refactors or source-of-truth changes



---



\## 2) Source of Truth



\### 2.1 Diagram Source of Truth

\- Diagram rendering and slots are sourced from the \*\*public diagram endpoint\*\*:

&nbsp; - `GET /public/events/{event\_id}/diagram`

\- Slot IDs used for assignment must match the slot IDs in the diagram data for that event.



\### 2.2 Application Source of Truth

\- Applications are sourced from organizer application listing endpoint(s) (see Implementation Mapping).

\- The application record contains:

&nbsp; - `status`

&nbsp; - `assigned\_slot\_id` (nullable)



---



\## 3) Required Fields \& Definitions



\### 3.1 Application Status Values

Contracted statuses (string):

\- `pending`

\- `approved`

\- `rejected`



> If your backend supports additional statuses, they are allowed only if they don’t break invariants below. This contract locks the behaviors for pending/approved/rejected.



\### 3.2 Assignment Fields

\- `assigned\_slot\_id`:

&nbsp; - null if not assigned

&nbsp; - set to a valid slot id when assigned

\- `event\_id`:

&nbsp; - must match the event being edited/reviewed by organizer



---



\## 4) Organizer Capabilities (Contracted Behaviors)



\### 4.1 List Applications for an Event

Organizer must be able to fetch applications for an event.



\*\*Expected behavior:\*\*

\- Returns:

&nbsp; - `event\_id`

&nbsp; - `items` array

&nbsp; - each item contains at least:

&nbsp;   - `id`

&nbsp;   - `event\_id`

&nbsp;   - `vendor\_profile\_id`

&nbsp;   - `status`

&nbsp;   - `assigned\_slot\_id`

&nbsp;   - `created\_at` / `updated\_at` (optional but common)



\*\*Contract requirement:\*\*

\- The response must be stable enough for the organizer UI to render a list and to identify which booth (if any) is assigned.



\### 4.2 Approve an Application

Organizer must be able to transition:

\- `pending → approved`



\*\*Rules:\*\*

\- Approving does NOT automatically assign a booth.

\- Approved applications remain assignable until assigned or rejected.



\### 4.3 Reject an Application

Organizer must be able to transition:

\- `pending → rejected`



\*\*Rules:\*\*

\- Rejected applications must not be assignable.



\### 4.4 Rejection of Approved Applications (Policy)

One of these must be true and implemented consistently:



\*\*Policy A (preferred for simplicity):\*\*

\- `approved → rejected` is allowed only if `assigned\_slot\_id IS NULL`

\- otherwise must return 4xx with a clear error



\*\*OR Policy B (more flexible):\*\*

\- `approved → rejected` is allowed, and the system clears `assigned\_slot\_id` as part of rejection



🔒 \*\*Pick one policy and lock it here once confirmed.\*\*

Current assumed policy: \*\*A\*\* (no backend change; safest).



---



\## 5) Booth / Slot Assignment Rules (Critical Invariants)



\### 5.1 Preconditions

Organizer can assign a slot ONLY when:

\- Application.status == `approved`

\- Application.event\_id == current event\_id

\- Slot belongs to the event’s diagram



\### 5.2 Slot Ownership

\- The assigned slot must exist in the diagram slot set for that event.

\- If the slot does not exist, the assignment must be rejected (4xx).



\### 5.3 Slot Uniqueness

\- A single slot cannot be assigned to more than one application for the same event.

\- Attempting a double-assignment must be rejected (4xx).



\### 5.4 Assignment Persistence

\- On success:

&nbsp; - Application.assigned\_slot\_id is updated and persists

&nbsp; - Organizer UI must reflect it after refresh/refetch

&nbsp; - Vendor UI must reflect it after refresh/refetch



---



\## 6) Vendor-Side Effects (Contracted Behaviors)



\### 6.1 Vendor Diagram Highlight

\- When a vendor has an approved application with assigned\_slot\_id:

&nbsp; - Vendor diagram view must highlight the assigned booth.



\### 6.2 Re-apply Blocking

\- Vendor must not be able to re-apply after approval (current verified behavior).

\- This contract freezes that behavior.



---



\## 7) Frontend UX Contract (Organizer)



Organizer UI must:

\- Display application list with:

&nbsp; - vendor identifier (profile id or snapshot name if present)

&nbsp; - status

&nbsp; - assigned slot id (or booth label if the UI resolves it)

\- Allow approve/reject actions

\- Allow assignment action:

&nbsp; - either from an applications page (dropdown slot picker)

&nbsp; - or within organizer diagram page (select app + click slot)

\- Surface API errors clearly (no silent failures)

\- Refresh state after actions:

&nbsp; - either refetch list

&nbsp; - or update in-place and keep consistent



\*\*Critical frontend invariant:\*\*

\- Never send `null` values unless the backend contract explicitly requires them.



---



\## 8) Error Handling Contract



The system must reject invalid actions with clear 4xx errors for:

\- assigning a slot when status != approved

\- assigning a slot that is already assigned

\- assigning a slot not in the event diagram

\- rejecting an approved application that is already assigned (if Policy A)



Organizer UI must display these errors.



---



\## 9) Verification Checklist (Must Pass)



\### 9.1 List

\- Organizer can fetch applications list for event 52 and see `status` + `assigned\_slot\_id`.



\### 9.2 Approve / Reject

\- pending → approved persists and reflects in organizer UI.

\- pending → rejected persists and reflects in organizer UI.



\### 9.3 Assign

\- approved application can be assigned to a valid diagram slot.

\- vendor diagram highlights assigned slot.

\- double-assigning the same slot is blocked.



\### 9.4 Refresh Stability

\- After refresh:

&nbsp; - assignment still appears

&nbsp; - vendor highlight still appears



---



\## 10) Implementation Mapping (Fill This In, Then Freeze)



Paste the exact METHOD + PATH + BODY shapes below once confirmed from OpenAPI / working calls.



\### 10.1 List Applications

\- METHOD + PATH:

&nbsp; - `GET \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_`

\- Query params:

&nbsp; - `limit`, `offset` (if supported)



\### 10.2 Approve/Reject Application

\- METHOD + PATH:

&nbsp; - `\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_`

\- Body:

&nbsp; - Example:

&nbsp;   ```json

&nbsp;   { "status": "approved" }

&nbsp;   ```



\### 10.3 Assign Slot to Application

\- METHOD + PATH:

&nbsp; - `\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_`

\- Body:

&nbsp; - Example:

&nbsp;   ```json

&nbsp;   { "assigned\_slot\_id": 123 }

&nbsp;   ```



🔒 Once these are filled with the actual routes used in your codebase, these become locked under this contract.

\# APPLICATIONS\_ASSIGNMENT\_CONTRACT.md

🔒 CONTRACT — Applications \& Booth Assignment (Organizer ↔ Vendor)



This contract freezes the behavior for:

\- Organizer application review (list / approve / reject)

\- Organizer booth/slot assignment to approved applications

\- Vendor-side impact (highlighted assigned booth, re-apply rules)

\- Diagram/slot consistency rules



This contract exists to prevent regressions and to avoid backend “fixes” during UI work.



---



\## 1) Scope



\### In scope

\- Organizer: view applications for an event

\- Organizer: approve/reject applications

\- Organizer: assign an approved application to a diagram slot

\- Vendor: see application status + assigned booth highlight

\- Enforcement of “no duplicate assignment” rules



\### Out of scope

\- Any schema changes

\- Any ORM relationship refactors

\- Any new endpoints

\- Payment processing logic changes

\- Diagram refactors or source-of-truth changes



---



\## 2) Source of Truth



\### 2.1 Diagram Source of Truth

\- Diagram rendering and slots are sourced from the \*\*public diagram endpoint\*\*:

&nbsp; - `GET /public/events/{event\_id}/diagram`

\- Slot IDs used for assignment must match the slot IDs in the diagram data for that event.



\### 2.2 Application Source of Truth

\- Applications are sourced from organizer application listing endpoint(s) (see Implementation Mapping).

\- The application record contains:

&nbsp; - `status`

&nbsp; - `assigned\_slot\_id` (nullable)



---



\## 3) Required Fields \& Definitions



\### 3.1 Application Status Values

Contracted statuses (string):

\- `pending`

\- `approved`

\- `rejected`



> If your backend supports additional statuses, they are allowed only if they don’t break invariants below. This contract locks the behaviors for pending/approved/rejected.



\### 3.2 Assignment Fields

\- `assigned\_slot\_id`:

&nbsp; - null if not assigned

&nbsp; - set to a valid slot id when assigned

\- `event\_id`:

&nbsp; - must match the event being edited/reviewed by organizer



---



\## 4) Organizer Capabilities (Contracted Behaviors)



\### 4.1 List Applications for an Event

Organizer must be able to fetch applications for an event.



\*\*Expected behavior:\*\*

\- Returns:

&nbsp; - `event\_id`

&nbsp; - `items` array

&nbsp; - each item contains at least:

&nbsp;   - `id`

&nbsp;   - `event\_id`

&nbsp;   - `vendor\_profile\_id`

&nbsp;   - `status`

&nbsp;   - `assigned\_slot\_id`

&nbsp;   - `created\_at` / `updated\_at` (optional but common)



\*\*Contract requirement:\*\*

\- The response must be stable enough for the organizer UI to render a list and to identify which booth (if any) is assigned.



\### 4.2 Approve an Application

Organizer must be able to transition:

\- `pending → approved`



\*\*Rules:\*\*

\- Approving does NOT automatically assign a booth.

\- Approved applications remain assignable until assigned or rejected.



\### 4.3 Reject an Application

Organizer must be able to transition:

\- `pending → rejected`



\*\*Rules:\*\*

\- Rejected applications must not be assignable.



\### 4.4 Rejection of Approved Applications (Policy)

One of these must be true and implemented consistently:



\*\*Policy A (preferred for simplicity):\*\*

\- `approved → rejected` is allowed only if `assigned\_slot\_id IS NULL`

\- otherwise must return 4xx with a clear error



\*\*OR Policy B (more flexible):\*\*

\- `approved → rejected` is allowed, and the system clears `assigned\_slot\_id` as part of rejection



🔒 \*\*Pick one policy and lock it here once confirmed.\*\*

Current assumed policy: \*\*A\*\* (no backend change; safest).



---



\## 5) Booth / Slot Assignment Rules (Critical Invariants)



\### 5.1 Preconditions

Organizer can assign a slot ONLY when:

\- Application.status == `approved`

\- Application.event\_id == current event\_id

\- Slot belongs to the event’s diagram

\- The chosen slot must have `db\_slot\_id != null` (slots without db\_slot\_id are not assignable).



\### 5.2 Slot Ownership

\- The assigned slot must exist in the diagram slot set for that event.

\- If the slot does not exist, the assignment must be rejected (4xx).

\### 5.2.1 Slot Identifier (Locked)

Assignments use the database slot id, not the diagram string id.



\- Diagram slot has:

&nbsp; - `id` (string like "B1") — UI label / diagram identity

&nbsp; - `db\_slot\_id` (integer or null) — \*\*DB identifier used for assignment\*\*

\- Application PATCH field:

&nbsp; - `assigned\_slot\_id` MUST be set to `db\_slot\_id`



\*\*Invariant:\*\* Organizer UI must never send `assigned\_slot\_id` using the string slot id.



\### 5.3 Slot Uniqueness

\- A single slot cannot be assigned to more than one application for the same event.

\- Attempting a double-assignment must be rejected (4xx).



\### 5.4 Assignment Persistence

\- On success:

&nbsp; - Application.assigned\_slot\_id is updated and persists

&nbsp; - Organizer UI must reflect it after refresh/refetch

&nbsp; - Vendor UI must reflect it after refresh/refetch



\### Slot Identifier (LOCKED)

Organizer assignments use the integer \*\*db\_slot\_id\*\* from the public diagram response.



\- Diagram slot:

&nbsp; - `id`: string label (e.g., "B1") — UI only

&nbsp; - `db\_slot\_id`: integer — \*\*used for persistence\*\*

\- Application update:

&nbsp; - `assigned\_slot\_id` MUST be set to the slot’s `db\_slot\_id`



✅ Verified: setting `assigned\_slot\_id = 326` persists successfully.



\### Assignable Slot Constraints (LOCKED)

A slot is assignable only if:

\- `db\_slot\_id` is not null

\- slot is not already assigned (based on application assignments and/or slot status)





---



\## 6) Vendor-Side Effects (Contracted Behaviors)



\### 6.1 Vendor Diagram Highlight

\- When a vendor has an approved application with assigned\_slot\_id:

&nbsp; - Vendor diagram view must highlight the assigned booth.



\### 6.2 Re-apply Blocking

\- Vendor must not be able to re-apply after approval (current verified behavior).

\- This contract freezes that behavior.



---



\## 7) Frontend UX Contract (Organizer)



Organizer UI must:

\- Display application list with:

&nbsp; - vendor identifier (profile id or snapshot name if present)

&nbsp; - status

&nbsp; - assigned slot id (or booth label if the UI resolves it)

\- Allow approve/reject actions

\- Allow assignment action:

&nbsp; - either from an applications page (dropdown slot picker)

&nbsp; - or within organizer diagram page (select app + click slot)

\- Surface API errors clearly (no silent failures)

\- Refresh state after actions:

&nbsp; - either refetch list

&nbsp; - or update in-place and keep consistent



\*\*Critical frontend invariant:\*\*

\- Never send `null` values unless the backend contract explicitly requires them.



---



\## 8) Error Handling Contract



The system must reject invalid actions with clear 4xx errors for:

\- assigning a slot when status != approved

\- assigning a slot that is already assigned

\- assigning a slot not in the event diagram

\- rejecting an approved application that is already assigned (if Policy A)



Organizer UI must display these errors.



---



\## 9) Verification Checklist (Must Pass)



\### 9.1 List

\- Organizer can fetch applications list for event 52 and see `status` + `assigned\_slot\_id`.



\### 9.2 Approve / Reject

\- pending → approved persists and reflects in organizer UI.

\- pending → rejected persists and reflects in organizer UI.



\### 9.3 Assign

\- approved application can be assigned to a valid diagram slot.

\- vendor diagram highlights assigned slot.

\- double-assigning the same slot is blocked.



\### 9.4 Refresh Stability

\- After refresh:

&nbsp; - assignment still appears

&nbsp; - vendor highlight still appears



---



\## 10) Implementation Mapping (Locked)



These are the exact OpenAPI routes that implement the contract.



\### 10.1 List Applications

\- METHOD + PATH:

&nbsp; - `GET /organizer/events/{event\_id}/applications`

\- Query params:

&nbsp; - `limit` (optional)

&nbsp; - `offset` (optional)



\### 10.2 Approve/Reject Application (and assign/clear slot)

\- METHOD + PATH:

&nbsp; - `PATCH /organizer/events/{event\_id}/applications/{app\_id}`



\- Allowed PATCH fields (contracted):

&nbsp; - `status`: `"pending" | "approved" | "rejected"`

&nbsp; - `assigned\_slot\_id`: integer slot id (optional)



\*\*Important payload rules (locked):\*\*

\- Do not send `null` values (omit keys instead).

\- Do not send unrelated fields.



\#### Example: Assign booth (must already be approved)

```json

{ "assigned\_slot\_id": 326 }

✅ Confirmed: the backend accepts `{ "status": "approved", "assigned\_slot\_id": <db\_slot\_id> }` in a single PATCH.



\## Organizer Diagram Assignment UX (LOCKED)



\### Purpose

Allow an organizer to assign or reassign an approved application to a booth directly from the diagram editor UI.



\### Supported mutation (single source of truth)

\- PATCH `/organizer/events/{event\_id}/applications/{app\_id}`

\- Body (JSON):

&nbsp; - `{ "assigned\_slot\_id": <db\_slot\_id> }`

\- Constraints:

&nbsp; - `assigned\_slot\_id` MUST be an integer >= 1 (backend validation enforced)

&nbsp; - `assigned\_slot\_id` MUST correspond to an existing DB slot for the event

&nbsp; - Diagram string booth IDs (e.g., "B1") are UI labels only and MUST NOT be sent to the backend



\### UI interaction contract

1\. Organizer selects an \*\*approved\*\* application in the right sidebar.

2\. Organizer clicks a booth on the diagram grid.

3\. If booth has `db\_slot\_id != null` and is not assigned to a different application, UI sends the PATCH request above.

4\. UI refreshes diagram + applications after success.



\### Reassign behavior (supported)

\- Reassign is implemented by sending the same PATCH request with a different `assigned\_slot\_id`.

\- Reassign is allowed only if the target booth is either:

&nbsp; - unassigned, or

&nbsp; - already assigned to the same application.



\### Unassign behavior (NOT supported)

\- Unassign is NOT supported in the locked contract.

\- UI MUST NOT attempt to unassign via:

&nbsp; - `assigned\_slot\_id: 0` (rejected by backend validation), or

&nbsp; - `assigned\_slot\_id: null` (not contracted)

\- If unassign is required in the future, it MUST be added as a new backend behavior + updated contract (e.g., allow null or add a dedicated endpoint).



🔒 Once these are filled with the actual routes used in your codebase, these become locked under this contract.
