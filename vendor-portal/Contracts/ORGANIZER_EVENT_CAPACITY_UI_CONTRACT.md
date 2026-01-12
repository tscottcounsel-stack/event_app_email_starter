1️⃣ CONTRACT: ORGANIZER\_EVENT\_CAPACITY\_UI\_CONTRACT.md



You can drop this next to your other contracts (e.g. in \_Manuals or contracts/).



\# ORGANIZER\_EVENT\_CAPACITY\_UI\_CONTRACT



\## Title

Organizer Event Capacity UI Contract



\## Status

Active



\## Related Contracts

\- EVENT\_VENDOR\_CAPACITY\_CONTRACT v1.0

&nbsp; (defines DB + API fields: `total\_vendor\_capacity`, `category\_vendor\_capacity`)



---



\## Purpose



Give organizers a simple way to set \*\*vendor capacity targets\*\* per event:



\- Total desired vendor count (`total\_vendor\_capacity`)

\- Category-specific targets (`category\_vendor\_capacity`)



These numbers are \*\*for planning only\*\* and do \*\*not\*\* block applications or auto-assign booths.



---



\## Scope (UI)



This contract applies to the \*\*Organizer Event Edit page\*\* at:



\- `/organizer/events/:eventId/edit`



and to the \*\*Organizer Events list\*\* at:



\- `/organizer/events`



---



\## Data Model (UI-facing)



UI works with these fields on the event object:



```ts

total\_vendor\_capacity?: number | null;

category\_vendor\_capacity?: { category: string; target: number }\[] | null;





From the API:



total\_vendor\_capacity MAY be null



category\_vendor\_capacity MUST be returned as an array; null must be normalized to \[] by the backend



Behavior: Event Edit Page

1\. Display



The Organizer Event Edit page must show a "Vendor capacity targets" section that includes:



A numeric field for Total vendor capacity



A dynamic list of Category rows, each with:



category (text input)



target (number input)



The section is planner-only and must not mention enforcement or blocking.



2\. Editing Rules



Organizer can:



Set or change total\_vendor\_capacity



Add new category rows



Edit existing category names and targets



Remove category rows



Category names are free-form text (no dropdown yet).



Targets must be integers >= 0.

Invalid values must not be sent to the server.



3\. PATCH Payload Rules



When the user clicks “Save changes”:



Core event fields must still follow the existing Organizer Event Edit contract.



Capacity fields must follow:



If total capacity input is blank → omit total\_vendor\_capacity (no change).



If total capacity has a number → send:



{ "total\_vendor\_capacity": 40 }





Build category\_vendor\_capacity from all rows where:



category.trim() is non-empty AND



target is a valid integer >= 0



Example payload:



{

&nbsp; "category\_vendor\_capacity": \[

&nbsp;   { "category": "Food", "target": 10 },

&nbsp;   { "category": "Art", "target": 12 }

&nbsp; ]

}





If there are no valid rows, the UI must omit category\_vendor\_capacity from the PATCH body (no change).

(A separate future contract may introduce explicit “clear capacity” controls.)



The UI must never send negative targets.



4\. Save Button Enablement



The Save button on the edit page must:



Be disabled until:



title is non-empty, AND



At least one of the tracked fields has changed vs. original event



Changes to capacity fields (total\_vendor\_capacity, category\_vendor\_capacity) must count as “changes” for this comparison.



Draft Persistence (Local Storage)



The event edit page uses local storage to protect in-progress edits.



Key format:



organizer\_event\_edit\_draft:{eventId}



Stored object may include capacity fields:



total\_vendor\_capacity



category\_vendor\_capacity



Draft must be updated whenever the user edits any field (including capacity).



"Clear draft" button:



Deletes the draft key for that event only.



Does not modify server state.



Behavior: Organizer Events List



On /organizer/events:



Existing layout and buttons (Applications / Diagram / Map editor / Edit event) must remain.



Add a “Organizer profile” button or link near the top that navigates to:



/organizer/profile



The list page does not need to display capacity numbers yet, but must not remove or regress any current event data.



Out of Scope



This contract does not:



Enforce capacities (no blocking of applications)



Change booth map behavior



Change application approval flows



Add progress bars, warnings, or analytics



Modify vendor-facing pages



Those must be defined in separate contracts.
