# Street Use Permit (SU) PDF — extraction notes

Example: `SU-26-672264-45STSWWINDERMERERDSW.PDF`

## Identification rules (from user)
- The Street Use Permit attachment filename **starts with "SU"** (e.g. `SU-26-672264-...PDF`).
- There may be **more than one** SU permit per job → choose the **most current / latest date**.
  - Use the `Permit Valid From` date (and/or `Permit Initiate Date`) to pick the most recent.

## Key fields on page 1 (the schedule)
- **Permit Number**: e.g. `SU-26-672264`
- **Permit Initiate Date**: e.g. `2026-05-11`
- **Permit Valid From**: Date (yyyy/mm/dd) + Time (24 hrs) + Day Of Week
  - Example: `2026-05-16`, `09:00`, `Saturday`  ← this is the START time of the work
- **Permit Valid To**: Date + Time (24 hrs) + Day Of Week
  - Example: `2026-05-16`, `22:00`, `Saturday`  ← this is the END / pickup time
- **Number Of Days**, Length In Meters, Rate/Meter/Day
- Location, Applicant, Site Contact, Charges table

## Mapping to Day Summary boxes
The summary boxes needed (Feature 52 remaining):
1. **Before / At / After 9AM** → derived from `Permit Valid From` **Time**:
   - time < 09:00 → "before 9AM"
   - time == 09:00 → "at 9AM"
   - time > 09:00 → "after 9AM"
2. **Finished / Picked up** → the `Permit Valid To` Date == the selected day means pickup that day.
   - For "finished/picked up today" use Permit Valid To date == selected date.

## Extraction approach
- Backend: pick SU attachment(s) from `planFile`, choose latest by Permit Valid From / initiate date.
- Call `invokeLLM` with `file_url` (mime `application/pdf`) + JSON schema to extract:
  `{ permitNumber, validFromDate, validFromTime, validFromDay, validToDate, validToTime, validToDay }`
- Cache by (jobId + filename) to avoid re-analyzing the same PDF.

---

## Non-Calgary permits (e.g. Town of Cochrane)

Example: `SUP2026-15525RiverHeightsDriveEntranceRepairs.pdf`

These have a DIFFERENT layout from Calgary SU permits, but still contain the
schedule. The extractor must handle both. Key fields seen on the Cochrane
"Schedule D" Street Use Permit (page 1):

- Title: **STREET USE PERMIT** with **Permit #** (e.g. `2026-15`) and Year/Month/Day boxes.
- **PERMIT FROM:** Date (e.g. `June 12, 2026`) + Time (e.g. `7:00 AM`)  ← work START.
- **PERMIT TO:** Date (e.g. `June 19, 2026`) + Time (e.g. `6:00 PM`)   ← work END / pickup.
- Dates may be written in long form ("June 12, 2026") rather than ISO.
- Times may be 12h ("7:00 AM") rather than 24h.

The traffic-control plan pages may also carry a "SETUP INFORMATION" block
(e.g. "START: FRIDAY 07:00 JUNE 12 / FRIDAY 18:00 JUNE 19 / 24 HOURS SET UP").

### Filename rule (generalized)
- Calgary: starts with `SU` (e.g. `SU-26-...`).
- Cochrane / others: starts with `SUP` (e.g. `SUP2026-...`).
- General rule: treat any PDF whose filename starts with `SU` / `SUP` (optionally
  followed by digits/sep) as a permit candidate. Pick the most current by the
  PERMIT FROM date.

## Missing-info rule (updated — supersedes earlier Start/End-date fallback)
- ALWAYS try to read the permit (Calgary SU or non-Calgary SUP).
- If the project has **no permit attachment at all**, DO NOT infer the time from
  the project's Start/End Date. Instead surface an explicit **"permit info not
  available"** state so coordinators can verify. (Per user: "si no tiene ningún
  permiso el proyecto es mejor que diga que no está esa información".)

### LLM extraction (generalized prompt)
- Accept Calgary and non-Calgary permits. Ask for:
  `{ permitNumber, validFromDate (YYYY-MM-DD), validFromTime (HH:MM 24h),
     validFromDay, validToDate, validToTime, validToDay, numberOfDays }`
- Normalize long-form dates ("June 12, 2026" → 2026-06-12) and 12h times
  ("7:00 AM" → 07:00) inside the LLM (instruct it to output normalized values).
