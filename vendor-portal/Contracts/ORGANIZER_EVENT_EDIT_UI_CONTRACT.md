✅ CONTRACT: Organizer Event Edit UI (Load + Save UX)

Scope



This contract governs the frontend Organizer Event Edit page:



Route: /organizer/events/:eventId/edit



File: src/pages/OrganizerEventEditPage.tsx



Backend endpoint used for saving (LOCKED):

PATCH /organizer/events/{event\_id}



This contract does not change backend behavior and does not introduce new backend endpoints.



Confirmed Backend Reality (Read Constraints)



The following backend behaviors are treated as current truth and must not be worked around with backend changes under this contract:



GET /organizer/events/{id} returns 405 Method Not Allowed



GET /public/events and GET /public/events/{id} return 404 Not Found



GET /public/events/{id}/diagram returns 200 OK and is used only as a reachability / existence ping, not as a source of event metadata.



Therefore:



✅ The edit page does not rely on any backend “read event metadata” endpoint.

✅ The page uses local restoration to avoid blank form state after refresh.



Locked Save Contract (Frontend → Backend)



The edit UI must save using:



Method: PATCH



URL: /organizer/events/{event\_id}



Auth: Authorization: Bearer <organizer token>



Content-Type: application/json



Supported editable fields



The UI supports editing only these event fields:



title (required)



description (optional)



location (optional)



date (optional, sent as YYYY-MM-DD)



No other keys may be sent.



Payload Rules (Critical Invariants)



The UI MUST obey the following invariants when building PATCH payloads:



Never send null values



Example forbidden payload:



{ "title": "X", "description": null }





Do not send empty strings



If a field is blank, omit the key entirely.



Send only user-provided fields



The payload must contain only keys the user actually entered/changed (except title, which is required to save).



Title is required



Save must be blocked if title.trim() is empty.



No backend “fixes”



The backend PATCH behavior is already contracted and must not be altered to accommodate the UI.



Rationale: prior failures included 400 Bad Request and DB integrity errors caused by sending null fields.



Read/Refresh Behavior (Local Restore Contract)



Because event metadata cannot be fetched, the page must:



Persist last-saved form values in localStorage under:



organizer\_event\_edit\_draft:{event\_id}



Restore these values on page load (after the diagram ping succeeds).



Local-only disclaimer



The UI must display a note indicating:



event read endpoints are unavailable



refresh restores the last-saved values locally



“Clear local” behavior



The page provides a Clear local action that:



removes only the local cached draft



does not call backend



resets the form to blank



Non-goals / Explicitly Out of Scope



Under this contract, we will NOT:



Add new backend endpoints (e.g., GET /organizer/events/{id})



Change router inclusion rules



Alter DB schema



Alter ORM relationships



Infer event metadata from diagram response (not guaranteed present)



If we later want true server-backed load, that requires a new contract update.



Verification Checklist (Must Pass)

Save success



Navigate to /organizer/events/52/edit



Enter a title, click Save



Network shows:



PATCH /organizer/events/52 → 200



Request Payload contains no nulls



Payload contains only keys actually entered (at minimum title)



Confirm DB persistence via direct API call or DB check.



Refresh UX



After a successful save, refresh the page



Title remains populated (restored from localStorage)



No 404/405 loops for event metadata reads



Regression guard



If a future change causes:



payload to contain null



backend returns 400/IntegrityError again

then the contract is violated.



Implementation Notes (Locked)



OrganizerEventEditPage uses:



GET /public/events/{id}/diagram as a reachability ping



PATCH /organizer/events/{id} for persistence



localStorage for refresh restoration



UI styling improvements are allowed as long as invariants remain true.
