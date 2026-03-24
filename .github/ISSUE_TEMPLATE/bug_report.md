name: Bug report

description: Something isnâ€™t working as expected

labels: bug

title: "\[Bug]: "

body:

&nbsp; - type: textarea

&nbsp;   id: what-happened

&nbsp;   attributes:

&nbsp;     label: What happened?

&nbsp;     description: Tell us what you expected vs what happened.

&nbsp;     placeholder: Clear steps, errors, and context.

&nbsp;   validations:

&nbsp;     required: true

&nbsp; - type: textarea

&nbsp;   id: repro

&nbsp;   attributes:

&nbsp;     label: Steps to reproduce

&nbsp;     placeholder: |

&nbsp;       1. Go to â€¦

&nbsp;       2. Run â€¦

&nbsp;       3. See error â€¦

&nbsp; - type: textarea

&nbsp;   id: logs

&nbsp;   attributes:

&nbsp;     label: Logs / stack traces

&nbsp;     render: shell

&nbsp; - type: input

&nbsp;   id: env

&nbsp;   attributes:

&nbsp;     label: Environment

&nbsp;     placeholder: OS, Python version, DB driver, etc.

&nbsp; - type: checkboxes

&nbsp;   id: checks

&nbsp;   attributes:

&nbsp;     label: Checklist

&nbsp;     options:

&nbsp;       - label: I ran `pre-commit` locally

&nbsp;       - label: I ran `pytest -q` locally
