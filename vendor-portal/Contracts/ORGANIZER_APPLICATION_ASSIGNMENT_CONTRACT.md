\# ORGANIZER\_APPLICATION\_ASSIGNMENT\_CONTRACT.md



Status: ACTIVE (as of 2025-12-17)



\## Purpose



Define and freeze the organizer-side behavior for assigning booths to vendor applications from the Organizer Diagram Editor UI.



This contract governs:



\- Assign

\- Reassign

\- Unassign



All behavior must remain stable unless this contract is explicitly updated.



---



\## Scope



\### In Scope

\- Organizer can assign an approved application to a booth (slot)

\- Organizer can reassign an approved application to a different booth (slot)

\- Organizer can unassign an approved application (clears booth assignment)

\- The diagram endpoints must reflect assignment state accurately (slot status + labeling)



\### Out of Scope

\- No new endpoints

\- No schema changes

\- No relationship/ORM refactors

\- No payment enforcement (payment gating is not part of this contract)

\- No auto-approval or auto-rejection

\- No vendor-side assignment actions

\- No “multi-slot per application” allocation (one assigned slot id per app)



---



\## Authoritative Data Model



\### Application assignment field

The single source of truth for assignment is:



\- `applications.assigned\_slot\_id` (nullable integer)



(Implementation note: in some code paths the backing table may be `vendor\_applications`, but the contract treats the field as the canonical assignment column returned by organizer applications endpoints.)



\### Slot identity

\- UI-visible booth id (e.g., `B1`) is a diagram label only

\- Assignments use `db\_slot\_id` (integer) as the reference



---



\## Locked Endpoints



\### Diagram (Organizer)

\- `GET /organizer/events/{event\_id}/diagram`

&nbsp; - Returns diagram slots including `db\_slot\_id` and derived `status`



\### Applications (Organizer)

\- `GET /organizer/events/{event\_id}/applications?limit=...\&offset=...`

&nbsp; - Returns applications including `id`, `status`, `assigned\_slot\_id`, and related fields



\### Application Update (Organizer)

\- `PATCH /organizer/events/{event\_id}/applications/{app\_id}`



Authorization:

\- Organizer token required

\- Organizer must be authorized for the event scope



---



\## Request Payload Contract



\### Assign / Reassign

To assign an application to a booth (or move it):



```json

{ "assigned\_slot\_id": 326 }



{ "assigned\_slot\_id": null }
