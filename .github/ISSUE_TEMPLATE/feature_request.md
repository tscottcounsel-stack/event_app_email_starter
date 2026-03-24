name: Feature request

description: Propose an enhancement or new capability

labels: enhancement

title: "\[Feature]: "

body:

&nbsp; - type: textarea

&nbsp;   id: problem

&nbsp;   attributes:

&nbsp;     label: Problem / use case

&nbsp;     placeholder: What problem does this solve?

&nbsp;   validations:

&nbsp;     required: true

&nbsp; - type: textarea

&nbsp;   id: proposal

&nbsp;   attributes:

&nbsp;     label: Proposed solution

&nbsp;     placeholder: Describe the change, API shape, UX, etc.

&nbsp; - type: textarea

&nbsp;   id: alternatives

&nbsp;   attributes:

&nbsp;     label: Alternatives considered

&nbsp; - type: checkboxes

&nbsp;   id: checks

&nbsp;   attributes:

&nbsp;     label: Checklist

&nbsp;     options:

&nbsp;       - label: I checked existing issues/PRs

&nbsp;       - label: Iâ€™m willing to help implement this
