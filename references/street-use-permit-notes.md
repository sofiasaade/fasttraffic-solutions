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
