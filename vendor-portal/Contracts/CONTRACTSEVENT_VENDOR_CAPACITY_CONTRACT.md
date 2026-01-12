📄 EVENT\_VENDOR\_CAPACITY\_CONTRACT.md

Title



Organizer Vendor Capacity Persistence Contract



Status



Drafted — not yet implemented



Version



v1.0



Purpose



Allow an event organizer to define vendor capacity targets, both:



Total vendor goal



Category-specific targets



These values shall be stored, retrieved, and updated through explicit backend fields.



This feature is advisory, not enforced.

It does NOT block vendor applications, auto-assign booths, or allocate slots automatically.



Scope (Included)



This contract introduces:



New database fields for capacity



New PATCH behavior



New GET behavior



JSON storage format for category targets



UI expectations



Scope (Explicitly Excluded)



This feature does not:



affect booth map slot limits



reject vendor applications



auto-assign booths



implement progress bars (yet)



notify vendors



add billing logic



control payment or approval flow



Those may be separate contracts later.



🏛 Data Model Changes

A. Add fields to events table



Two new nullable fields:



total\_vendor\_capacity (integer, nullable)



Meaning: total desired vendor count across all categories.



category\_vendor\_capacity (JSONB, nullable)



Meaning: list of category targets.



Stored JSON format example:



\[

&nbsp; { "category": "Food", "target": 10 },

&nbsp; { "category": "Art", "target": 12 },

&nbsp; { "category": "Retail", "target": 8 }

]





Rules:



Order does not matter



Category names are case-insensitive when matching



Server will lowercase internally for comparisons (optional for future enforcement)



🔄 Migration Rules



This contract requires one migration:



alembic revision -m "Add vendor capacity fields to events"





The migration will:



op.add\_column("events", sa.Column("total\_vendor\_capacity", sa.Integer(), nullable=True))

op.add\_column("events", sa.Column("category\_vendor\_capacity", postgresql.JSONB(astext\_type=sa.Text()), nullable=True))





No change to any other schema.



🔁 PATCH /organizer/events/{event\_id}

Accepted new fields:

Field	Type	Logic

total\_vendor\_capacity	integer or null	Omit if empty

category\_vendor\_capacity	list of objects	Omit if empty



PATCH payload example:



{

&nbsp; "total\_vendor\_capacity": 40,

&nbsp; "category\_vendor\_capacity": \[

&nbsp;   {"category": "Food", "target": 10},

&nbsp;   {"category": "Art", "target": 15},

&nbsp;   {"category": "Retail", "target": 5}

&nbsp; ]

}



Omission Rules



If field is omitted → do not alter DB value



If field is sent as null → set DB value = null



If empty array sent for category\_vendor\_capacity → set DB field = empty array \[]



Validation Rules



No negative integers



Category names must be non-empty strings



Targets must be integers ≥ 0



If sum exceeds total\_vendor\_capacity, allow it (advisory only)



📤 GET /organizer/events/{event\_id}



Must return:



{

&nbsp; ...

&nbsp; "total\_vendor\_capacity": 40,

&nbsp; "category\_vendor\_capacity": \[

&nbsp;   {"category": "Food", "target": 10},

&nbsp;   {"category": "Art", "target": 15}

&nbsp; ]

}





If not set:



{

&nbsp; "total\_vendor\_capacity": null,

&nbsp; "category\_vendor\_capacity": \[]

}





Backend guarantees never returns null arrays.



🖥 UI Contract

Organizer Event Edit Page



NEW Responsibilities:



Pull persisted values on first load



Populate UI from backend state



Provide Add/Remove category rows



Auto-track category totals visually



Allow setting target = 0



Save only when fields changed



Update PATCH payload accordingly



NOT responsible for:



Validation beyond simple non-negative checks



Persistence of unchecked UI fields



Recomputing slot limits



Vendor messaging



🔄 Backwards Compatibility



If an event predates this contract:



total\_vendor\_capacity defaults to null



category\_vendor\_capacity defaults to \[]



UI must still function gracefully



No breaking behavior permitted



🚫 Forbidden



This contract MUST NOT:



Write changes to vendor\_profiles



Modify booth map



Introduce foreign keys



Create new tables



Add category tables



Affect login flows



Change vendor application endpoints



Change diagram endpoints



📡 Future Contracts (Optional Sequels)



Can be layered later:



Capacity Progress Metrics



count approved vendors by category



display overcrowding warnings



Vendor Recruitment Suggestions



recommend categories that are short



Automated Booth Allocation



match vendors to category rows



Application Blocking



stop apps once full (NOT allowed now)



All must be separate contract documents.
