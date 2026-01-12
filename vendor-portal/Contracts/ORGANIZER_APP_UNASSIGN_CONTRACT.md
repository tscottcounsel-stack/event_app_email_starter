\# ORGANIZER\_APP\_UNASSIGN\_CONTRACT.md



Status: PROPOSED → (set to ACTIVE once implemented + verified)



\## Purpose



Add \*\*Organizer Unassign\*\* support to the existing organizer application update endpoint, without introducing new endpoints or schema changes.



This contract extends the existing Organizer Applications update behavior to allow:



\- Unassigning an application from a booth/slot

\- Returning the booth to `available` status after unassign



This contract is written to preserve existing system invariants and to keep backend changes minimal and explicit.



---



\## Scope



\### In Scope

\- Organizer can \*\*unassign\*\* an application by clearing `assigned\_slot\_id`.

\- Unassign behavior updates both:

&nbsp; - `applications.assigned\_slot\_id`

&nbsp; - booth/slot status returned by the organizer diagram endpoint



\### Out of Scope

\- No new endpoints

\- No schema changes

\- No relationship/ORM refactors

\- No deletion of applications

\- No payment logic changes

\- No auto-approval or auto-rejection changes



---



\## Locked Endpoints



\### Existing Endpoint (extended by this contract)



`PATCH /organizer/events/{event\_id}/applications/{app\_id}`



Authorization:

\- Requires Organizer token

\- Organizer must be authorized to manage the event



Request JSON body (existing + extension):

\- Existing supported fields remain unchanged

\- This contract extends support for:

&nbsp; - `assigned\_slot\_id: null` (UNASSIGN)



---



\## Request Payload Rules



\### Assign / Reassign (existing)

\- `assigned\_slot\_id` may be a positive integer (`>= 1`)

\- Interpreted as assigning the app to that DB slot id



\### Unassign (new)

\- `assigned\_slot\_id` may be `null`

\- Interpreted as:

&nbsp; - clear any existing assignment for that application



Examples:



Assign:

```json

{ "assigned\_slot\_id": 326 }





{ "assigned\_slot\_id": null }
