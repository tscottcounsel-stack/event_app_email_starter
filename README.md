@"
# Event Organizer–Vendor API
# Event App Email Starter

![CI](https://github.com/tscottcounsel-stack/event_app_email_starter/actions/workflows/ci.yml/badge.svg)
[![Open issues](https://img.shields.io/github/issues/tscottcounsel-stack/event_app_email_starter)](https://github.com/tscottcounsel-stack/event_app_email_starter/issues)
[![PRs](https://img.shields.io/github/issues-pr/tscottcounsel-stack/event_app_email_starter)](https://github.com/tscottcounsel-stack/event_app_email_starter/pulls)
[![Discussions](https://img.shields.io/badge/discussions-join-informational)](https://github.com/tscottcounsel-stack/event_app_email_starter/discussions)
[![License](https://img.shields.io/github/license/tscottcounsel-stack/event_app_email_starter)](LICENSE)
![Python](https://img.shields.io/badge/python-3.12+-blue)
![Code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)
![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen)
[![GitHub release](https://img.shields.io/github/v/release/tscottcounsel-stack/event_app_email_starter?display_name=tag)](https://github.com/tscottcounsel-stack/event_app_email_starter/releases)


![CI](https://github.com/tscottcounsel-stack/event_app_email_starter/actions/workflows/ci.yml/badge.svg)


FastAPI app for organizer/vendor flows. Defaults to in-memory storage (fast tests). Optional SQLite persistence behind a flag.

## Quickstart
```bash
pip install -r requirements.txt -r dev-requirements.txt
uvicorn main:app --reload

Small CI test change.
