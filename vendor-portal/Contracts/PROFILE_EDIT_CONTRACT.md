📄 PROFILE\_EDIT\_CONTRACT.md

\# PROFILE\_EDIT\_CONTRACT



\## Title

Organizer \& Vendor Profile Edit Contract



\## Status

Drafted — ready for implementation



\## Purpose



Give both \*\*organizers\*\* and \*\*vendors\*\* a clean, consistent way to manage their public-facing profile information, including:



\- Company / business name

\- Public contact email

\- Phone

\- Website

\- City / area

\- “About us” / story

\- Credibility checklist tags

\- Vendor categories (for vendors)



These details power:



\- Organizer public preview

\- Vendor public preview

\- Future vendor/organizer directories



---



\## Scope



This contract covers:



1\. \*\*Organizer profile\*\*:

&nbsp;  - Edit + read of organizer public profile

&nbsp;  - Fields that drive Organizer Public Preview



2\. \*\*Vendor profile\*\*:

&nbsp;  - Edit + read of vendor public profile

&nbsp;  - Fields that drive Vendor Public Preview



3\. \*\*API shape\*\* for profile GET/PATCH:

&nbsp;  - `GET /organizer/profile`

&nbsp;  - `PATCH /organizer/profile`

&nbsp;  - `GET /vendor/profile`

&nbsp;  - `PATCH /vendor/profile`



4\. \*\*Front-end pages\*\*:

&nbsp;  - Organizer profile page (internal, authenticated)

&nbsp;  - Vendor profile page (internal, authenticated)



\*\*Out of scope for this contract\*\*:



\- Authentication / login flows

\- Media uploads (photos, logos, videos)

\- Reviews

\- Messaging / chat

\- Search / directory indexes

\- Organizer event capacity (handled in a separate contract)



---



\## Data Model (Conceptual)



\### Organizer Profile



Server-side organizer profile entity (name TBD, e.g. `OrganizerProfile`) exposes:



\- `company\_name: string | null`

\- `public\_email: string | null`

\- `phone: string | null`

\- `website: string | null`

\- `city: string | null`

\- `organizer\_story: string | null`

&nbsp; \_Long-form “About us” content that powers organizer public preview.\_

\- `checklist\_tags: string\[] | null`

&nbsp; \_e.g. \["licensed", "bonded", "returning\_organizer", "nonprofit"]\_



Other internal fields (like IDs, user linkage) are left as-is and not modified by this contract.



\### Vendor Profile



Server-side vendor profile entity (e.g. `VendorProfile` or `Vendor`) exposes:



\- `business\_name: string | null`

\- `contact\_name: string | null`

\- `public\_email: string | null`

\- `phone: string | null`

\- `website: string | null`

\- `city: string | null`

\- `vendor\_story: string | null`

\- `checklist\_tags: string\[] | null`

&nbsp; \_e.g. \["insured", "licensed", "returning\_vendor"]\_

\- `vendor\_categories: string\[] | null`

&nbsp; \_e.g. \["Food", "Desserts", "Retail", "Art"]\_



Existing fields like `about` can remain but are considered \*\*legacy\*\*; the new `\*\_story` fields are the canonical “About us” for public previews.



---



\## API Contract



\### Organizer Profile



\#### GET `/organizer/profile`



\- Returns a JSON object representing the current organizer’s profile.

\- Response shape (minimum required):



```json

{

&nbsp; "id": 13,

&nbsp; "company\_name": "Sample Events LLC",

&nbsp; "public\_email": "hello@sampleevents.com",

&nbsp; "phone": "555-123-4567",

&nbsp; "website": "https://sampleevents.com",

&nbsp; "city": "Atlanta, GA",

&nbsp; "organizer\_story": "Long-form story...",

&nbsp; "checklist\_tags": \["licensed", "bonded", "returning\_organizer"]

}





Rules:



If checklist\_tags is not set in DB, API MUST return an empty array \[] not null.



Other string fields may be null or omitted if not set.



PATCH /organizer/profile



Accepts a partial update body with any subset of fields:



{

&nbsp; "company\_name": "New Name",

&nbsp; "public\_email": "new@email.com",

&nbsp; "phone": "555-222-3333",

&nbsp; "website": "https://newevents.com",

&nbsp; "city": "Marietta, GA",

&nbsp; "organizer\_story": "Updated about us...",

&nbsp; "checklist\_tags": \["licensed", "nonprofit"]

}





PATCH semantics:



Any field omitted from the body: no change.



Any field explicitly set to null: clears that value in DB (sets to NULL).



checklist\_tags:



If omitted: no change.



If \[]: clears to empty array.



If present as array: replaces entire tag list.



Validation:



company\_name, public\_email, phone, website, city, organizer\_story:



Must be strings if present.



May be empty strings but UI should discourage that.



checklist\_tags:



Must be an array of strings.



Strings are trimmed; empty strings are dropped.



Vendor Profile

GET /vendor/profile



Returns JSON for the current vendor’s profile.



Example:



{

&nbsp; "id": 5,

&nbsp; "business\_name": "Funnel Cakes \& Shakes Co.",

&nbsp; "contact\_name": "Troy Spark",

&nbsp; "public\_email": "hello@funnelcakes.com",

&nbsp; "phone": "555-987-6543",

&nbsp; "website": "https://funnelcakes.com",

&nbsp; "city": "Atlanta, GA",

&nbsp; "vendor\_story": "This is our story...",

&nbsp; "checklist\_tags": \["insured", "licensed"],

&nbsp; "vendor\_categories": \["Food", "Desserts", "Beverages"]

}





Rules:



checklist\_tags and vendor\_categories must be arrays in API response.



If DB has NULL, normalize to \[].



Other string fields may be null or omitted if not set.



PATCH /vendor/profile



Accepts partial update body with any subset of vendor profile fields:



{

&nbsp; "business\_name": "Funnel Cakes \& Shakes Co.",

&nbsp; "contact\_name": "Troy Spark",

&nbsp; "public\_email": "booking@funnelcakes.com",

&nbsp; "phone": "555-999-0000",

&nbsp; "website": "https://funnelcakes.com",

&nbsp; "city": "Atlanta, GA",

&nbsp; "vendor\_story": "Updated story...",

&nbsp; "checklist\_tags": \["insured", "licensed", "returning\_vendor"],

&nbsp; "vendor\_categories": \["Food", "Desserts"]

}





PATCH semantics:



Same pattern as organizer:



Omitted field → no change.



null → clear in DB.



checklist\_tags \& vendor\_categories:



Omitted → no change.



\[] → clear to empty array.



Array of strings → replace entire list.



Validation:



Name/email/phone/website/city/story: must be strings if present.



Tag lists: must be arrays of strings.



Strings trimmed; empty strings removed from tag arrays.



Front-end UI Contract

Organizer Profile Page (authenticated)



Route: /organizer/profile



UI requirements:



Display editable fields:



Company name (required for a “complete” profile)



Public email



Phone



Website



City



Organizer story (multi-line text area)



Checklist tags (simple token-style chips or comma-separated input)



Show a light “Profile completeness” hint (optional).



Include:



Save button (PATCH to /organizer/profile)



View public preview button (navigates to existing Organizer Public Preview)



Behavior:



On load:



GET /organizer/profile and populate the form.



On save:



Build PATCH body using only changed fields.



Respect null/empty vs omitted rules.



Do not show internal IDs or user IDs on this page.



Vendor Profile Page (authenticated)



Route: /vendor/profile



UI requirements:



Display editable fields:



Business name (required for “complete” profile)



Contact name



Public email



Phone



Website



City



Vendor story



Checklist tags (chips / comma-separated)



Vendor categories (chips / comma-separated)



Include:



Save button (PATCH /vendor/profile)



Preview public profile button (navigates to Vendor Public Preview page you just built)



Behavior:



On load:



GET /vendor/profile and populate.



On save:



PATCH only changed fields.



Do not expose internal auth details.



Non-Goals / Forbidden Changes



This contract must not:



Change login or session flows.



Change how events are created or edited.



Touch diagram/map logic.



Modify application assignment logic.



Implement uploads or media storage.



Introduce new tables or enums beyond what already exists for profiles.



Integration with Public Preview



Organizer Public Preview reads:



organizer\_story



checklist\_tags



Organizer’s company name, city, website (read-only).



Vendor Public Preview reads:



vendor\_story



checklist\_tags



vendor\_categories



Business name, city, website, contact email/phone (read-only).



Public preview pages remain view-only and do not allow editing or saving.
