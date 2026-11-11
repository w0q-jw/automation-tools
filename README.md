# TSM Automation Tools

A suite of ten browser userscripts that batch-automate student-records work in **TSM**, a university student information system (CAMS-based). Each tool takes a list of students, works through them one at a time the way a person would (search, open the record, edit, save, return), and finishes with a report card of what changed and what needs a human to look at.

Together they cover registration, enrolment changes, payment setup, year-on-year progression, personal-data checks, disability records, withdrawals and no-shows. Each one replaces a long, repetitive manual procedure.

All scripts are plain JavaScript and run in [Tampermonkey](https://www.tampermonkey.net/). There is no build step and nothing to install.

---

## The tools

| Script | Version | What it does |
|---|---|---|
| [`tsm-batch-registration`](scripts/tsm-batch-registration.user.js) | 7.2 | Opens Registration, expands the Summary Blocks, picks **Standard** on every single-section block, saves with Keep Changes, returns to search. |
| [`tsm-combined-enrolment`](scripts/tsm-combined-enrolment.user.js) | 9.0 | Removes requested course offerings, enrols requested sections, then every remaining single-section block. |
| [`tsm-swap-and-enrol`](scripts/tsm-swap-and-enrol.user.js) | 12.0 | Works through a paired remove → add list per student, then enrols the remaining required single-section blocks. |
| [`tsm-payment-registration`](scripts/tsm-payment-registration.user.js) | 4.1 | Sets the preferred payment method in Financial Accounts, enrols every required block and processes the registration. |
| [`tsm-progression-registration`](scripts/tsm-progression-registration.user.js) | 1.0 | Extends the payment script: confirms the previous year reads **Pass** and its Course Planning is **Complete** (fixing it if not), registers, then moves Core, Goal and Enrolment records up to the next year of study. |
| [`tsm-person-data-check`](scripts/tsm-person-data-check.user.js) | 7.0 | Compares pasted spreadsheet rows against the Person record (email, phone, term-time address, emergency contact, disability) and applies approved corrections. |
| [`tsm-disability-check`](scripts/tsm-disability-check.user.js) | 1.0 | Checks Accessibility Needs against the spreadsheet's disability column and sets or removes **No known disability**. Reads the full data-check spreadsheet. |
| [`tsm-disability-check-4-column`](scripts/tsm-disability-check-4-column.user.js) | 2.0 | Same check for a short sheet: Student ID, first name, last name, Yes/No. |
| [`tsm-withdrawal`](scripts/tsm-withdrawal.user.js) | 1.0 | Withdraws the current-year enrolment (dates, reason), updates the goal completion date, then withdraws every registered course with a comment. |
| [`tsm-noshow-withdraw`](scripts/tsm-noshow-withdraw.user.js) | 1.0 | For students who never completed enrolment: new students become **No Show**, returning students **Withdrawn**, with the goal, Enrolment Status and finance notes updated. |

---

## Shared design

Every tool is built on the same core, refined over many iterations against a live system:

- **Batch panel.** A floating control panel takes pasted student IDs or spreadsheet rows. It has Start, Stop and Hide (Ctrl + Shift + H) controls and a live status log.
- **Human-like interaction.** The system's controls are jQuery-delegated, so plain `.click()` often does nothing. The scripts send full pointer and mouse event sequences, then retry with escalating techniques (`clickUntil`) until the expected change actually shows.
- **Verify, don't assume.** After every dropdown choice, date or checkbox, the value is read back from the page. A mismatch is retried or reported, never silently accepted.
- **Select2 handling.** The search box is found globally, the value is typed, and the exact result is clicked (falling back to Down + Enter).
- **Survives page reloads.** Progress is saved per browser tab in sessionStorage, `window.name` and localStorage. A run that reloads mid-student, for example after a Save or an Override, resumes at the right step without repeating finished work (such as registering twice).
- **Processing delays.** Fixed waits follow the actions the server is slow to handle, such as 8 seconds after Save and 3 seconds after Override.
- **Report card.** Each run ends with per-student outcomes, totals, skipped students with reasons, and a **check manually** list for anything the script deliberately left alone.
- **Dry run.** Where it applies, a report-only mode shows what would change without touching the record.
- **Safe by default.** Anything ambiguous, like several possible goals, a field greyed out unexpectedly or data that disagrees with the record, stops for a decision or is flagged rather than guessed.

---

## Installing

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Open a script in `scripts/`, view it raw, and Tampermonkey offers to install it. You can also paste it into a new Tampermonkey script.
3. Turn on only the tool you are using. Each has its own panel and storage, but several running at once means several panels.

## Using

1. Log in to TSM and go to the Student Academic Record search page.
2. Paste the student IDs (or spreadsheet rows, for the data-check tools) into the panel.
3. Check the settings (year, dates, reason and so on), then press **START** and confirm.
4. Let it run. Press **STOP** at any time and it stops safely after the current step.
5. Read the report card at the end.

---

## Notes

- Written for one institution's TSM setup. Page structure, labels and menu paths may differ elsewhere.
- No credentials, student data or institution addresses are stored in the code. The scripts only act on pages the signed-in user can already reach.
- Built with JavaScript (ES2020) and the DOM APIs, with no external libraries. Tested with Node + jsdom against mock pages built from real page markup.
