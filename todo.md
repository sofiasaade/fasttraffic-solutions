# Fast Traffic OS - Project TODO

## Foundation
- [x] Set up Airtable secrets (API key, base ID, table ID)
- [x] Create Airtable integration layer (server/airtable.ts) mapping exact field names
- [x] Define database schema: time_logs, hazard_assessments, change_history, notifications, technicians, settings
- [x] Push DB migrations
- [x] Global theme/design system for professional field-ops context
- [x] App layout & routing (coordinator desktop + technician mobile)

## Feature 1: Coordinator Dispatch Board
- [x] Pull jobs with status "Field" or "Permit Approved" from Airtable
- [x] Filter by date, zone, and status
- [x] Separate sections for unassigned jobs and active jobs

## Feature 2: Technician Assignment Panel
- [x] Assign technicians to Preparation, Setup, Pickup phases (backend + UI)
- [x] Map to Traffic Technician Preparation/Setup/Pickup Airtable fields
- [x] Conflict detection to prevent double-booking across overlapping jobs (backend + tests)

## Feature 3: Overtime Monitoring Dashboard
- [x] Track accumulated hours per technician within current pay period
- [x] Flag technicians approaching 44-hour Alberta threshold (default 44, configurable)

## Feature 4: Job Modification Controls
- [x] Extend or shorten job end date
- [x] Change job sub-status
- [x] Reassign technicians
- [x] Immutable, comprehensive change history log for every change

## Feature 5: Technician Mobile PWA
- [x] Responsive mobile interface
- [x] Show today's and upcoming week's assigned jobs
- [x] Each job shows address, company, start time, setup type
- [x] View plan file / open in maps

## Feature 6: Hazard Assessment (hard gate)
- [x] Digital hazard assessment form per job + technician
- [x] Check-in BLOCKED until hazard assessment submitted for that job+technician

## Feature 7: Time Tracking (Check-in/Check-out)
- [x] Check-in / check-out timestamps per technician per job
- [x] Timestamps feed into overtime calculation

## Feature 8: Field Photo Upload
- [x] Capture/upload photos categorized before/during/after
- [x] Link to Airtable Field Photos field for the job

## Feature 9: Field Notes and Annotations
- [x] Technician notes to Airtable Field Comments field
- [x] Coordinator separate internal notes
- [x] All entries timestamped (both roles)

## Feature 10: In-App Notifications
- [x] Technician alerts on new assignment
- [x] Alerts on assignment modified or cancelled
- [x] Notification bell with unread count + polling

## PWA Requirements
- [x] Installable manifest
- [x] App icons (192/512)
- [x] Service worker (offline shell + installability)
- [x] Mobile-optimized

## Testing
- [x] Vitest for Airtable connection
- [x] Vitest for conflict detection, overtime calc, pay periods (opsLogic)
- [x] Vitest for coordinator.assignTechnicians (phase field mapping + conflict block unless force) using mocked Airtable
- [x] Vitest for technician.checkIn hazard gate (blocked without assessment)
- [x] Vitest for change history immutability / append-only behavior

## Feature 11: Permit Approved Map View (coordinator)
- [x] Backend procedure returning Permit Approved jobs with Lat/Lon
- [x] Map page using existing Map.tsx component (Google Maps)
- [x] Markers per job with info window (company, address, dates, status)
- [x] Add nav entry in CoordinatorShell
- [x] Handle jobs missing coordinates (geocode fallback + list flag)

## Bug: Permit Map pins not visible
- [x] Pins not rendering even though all 8 Permit Approved jobs have valid Lat/Lon
- [x] Fix marker creation (use PinElement content; ensure markerLibrary loaded)
- [x] Recolocate markers when data arrives after map init (race condition)
- [x] Verify markers appear and map fits bounds in authenticated UI (code complete; final visual check is on the user's authenticated session)

## Feature 12: Multi-status Permit Map (color-coded)
- [x] Backend mapJobs returns jobs for Permit Approved, Field, Permit Request Submitted (exact Airtable status name)
- [x] Color-code markers: Permit Approved (orange), Field (green), Permit Request Submitted (blue)
- [x] Add legend + per-status toggle filters on the map page
- [x] Update + pass integration test for three statuses (23 tests passing)

## Feature 13: Dispatch Board as grouped tables
- [x] boardJobs endpoint returns all three statuses with full job shape
- [x] Table layout grouped into Permit Request Submitted / Permit Approved / Field
- [x] Columns: Company, Address, Start date (+ assignment status + actions)
- [x] Collapsible sections, sorted by start date; zone/date filters retained
- [x] Type-check + 23 tests passing

## Feature 14: Assignar-style drag-and-drop Scheduler
- [x] New Scheduler page: jobs as rows (company + address), horizontal day grid (1-week view)
- [x] Right-side panel listing available workers (technician roster)
- [x] Date range navigation (prev/today/next week) and week-of header
- [x] Drag a worker name and drop onto a job/day cell to assign
- [x] Choose phase (Prep/Setup/Pickup) on drop
- [x] Persist assignment to Airtable (existing assignTechnicians) + conflict detection
- [x] Show existing assignments as chips inside the timeline cells
- [x] Nav entry + route wired; type-check + 23 tests passing

## Feature 15: Day & time-specific scheduler assignments (LOCAL only)
- [x] Extend job_assignments with scheduledDate, startTime, endTime columns (local store, no Airtable write)
- [x] Backend: setScheduled / scheduledAssignments (week) / removeScheduled procedures
- [x] Drop flow saves day + time (start/end) locally only
- [x] Render chips only in the specific day cell from saved scheduler assignments
- [x] Time selection in drop dialog (start/end)
- [x] Worker availability: flag workers already booked that week in the panel
- [x] Remove an assignment from a cell (click chip -> remove)
- [x] Integration test for scheduler assignment persistence + conflict + removal (28 tests passing)

## Feature 17: Scheduler jobs grouped by status (like Dashboard)
- [x] Group scheduler job rows into Permit Request Submitted / Permit Approved / Field
- [x] Collapsible section headers with counts
- [x] Preserve week navigation, search, and drag-and-drop within grouped layout

## Feature 16: Airtable READ-ONLY (no writes back until user says otherwise)
- [x] Remove all updateJobFields / appendToTextField writes to Airtable across the codebase
- [x] assignTechnicians: persist assignment locally (assignments table), NOT to Airtable phase fields
- [x] Build local assignments model so phase assignment + scheduler day/time share one source
- [x] modifyJob (extend/shorten end date, sub-status): record locally as an override + change history, do NOT write Airtable
- [x] Technician field notes / photos: store locally only, do NOT write to Airtable Field Comments / Field Photos
- [x] Coordinator reads merge Airtable (base data) + local assignments/overrides for display
- [x] Update tests to assert NO Airtable write calls happen


## Read-Only Airtable Refactor (operations data stored locally)
- [x] Disable all Airtable write functions (updateJobFields, appendToTextField, appendAttachments throw 403)
- [x] Add local tables: job_assignments, job_photos, job_notes, job_overrides
- [x] Push DB migration for new tables
- [x] DB helpers: assignments CRUD, photos, notes, overrides (server/opsDb.ts)
- [x] Refactor coordinator.assignTechnicians to write assignments locally (no Airtable write)
- [x] Refactor coordinator.modifyJob to store end-date/sub-status as local overrides
- [x] Merge local assignments + overrides into boardJobs / dispatchJobs / jobDetail / mapJobs
- [x] Refactor technician.myJobs to read from local assignments + Airtable base data
- [x] Refactor technician.uploadPhoto to store in job_photos (S3 + local row), surfaced via myJobs.fieldPhotos
- [x] Refactor technician.addFieldNote to store in job_notes, surfaced via myJobs.fieldComments
- [x] Scheduler drag-and-drop wired to local assignTechnicians mutation
- [x] Invalidate boardJobs/jobDetail in AssignmentDialog and JobModifyDialog
- [x] Update integration tests to assert NO Airtable writes occur (25 tests passing)
- [x] Update landing copy (Airtable is a read-only source)


## Feature 18: Equipment tab in Scheduler (drag equipment to job/day)
- [x] equipment_catalog table (id, name, category, color, active) seeded with defaults
- [x] equipment_assignments table (jobId, equipmentName, scheduledDate, technicianName?, quantity, notes, createdBy)
- [x] opsDb helpers: listEquipmentCatalog, seedEquipmentCatalog, setEquipmentAssignment, listEquipmentAssignmentsForWeek, removeEquipmentAssignment
- [x] coordinator procedures: equipmentCatalog, equipmentAssignments(week), setEquipment, removeEquipment
- [x] Scheduler: Resources panel with Workers / Equipment tabs (like Assignar reference)
- [x] Drag equipment onto a job/day cell -> dialog (date, optional technician to install, quantity, notes)
- [x] Equipment chips render per day cell (distinct style, catalog color), click to remove
- [x] Integration test for equipment assignment persistence + removal (no Airtable write) (31 tests passing)

## Feature 19: Branding (orange + blue) and logo
- [x] Apply orange/blue brand palette across theme tokens (orange primary, navy sidebar)
- [x] Show FTS logo next to Fast Traffic name (coordinator sidebar, tech header, login)
- [x] Show company logo next to "Fast Traffic OS" in login and dashboard sidebar


## Feature 20: Scheduler job detail panel
- [x] Add expand chevron + clickable job label in each Scheduler row
- [x] Open a detail side panel (Sheet) with full job info (company, title, address, dates, setup, status/sub-status, municipality/zone, contact, techs by phase)
- [x] Show the job plan (planFile) with inline preview (image/PDF) and open/download links
- [x] Empty/loading states; close button

## Feature 21: Trucks resource tab
- [x] truck_catalog table (id, name, plate, color, active) seeded with default trucks
- [x] truck_assignments table (jobId, truckName, scheduledDate, driverName?, notes, createdBy)
- [x] opsDb helpers: listTruckCatalog, seedTruckCatalog, setTruckAssignment, listTruckAssignmentsForWeek, removeTruckAssignment
- [x] coordinator procedures: truckCatalog, truckAssignments(week), setTruck, removeTruck
- [x] Scheduler: third tab Trucks in Resources panel; drag truck to job/day cell -> dialog (date, optional driver, notes)
- [x] Truck chips render per day cell (distinct dashed style), click to remove
- [x] Integration test for truck assignment persistence + removal (no Airtable write) (35 tests passing)


## Feature 22: Cancelled section in Scheduler (after Field)
- [x] Include "Cancelled" + "Permit Declined" statuses in MAP_STATUSES so cancelled jobs are fetched (read-only)
- [x] Add "Cancelled" section after Field in Scheduler grouping
- [x] Classify a job as cancelled when subStatus/status contains "cancel"/"declin" (shared isCancelledJob, takes priority over status section)
- [x] Collapsible section header with count and red dot
- [x] Permit Map: cancelled/declined bucket (red, hidden by default) so they are not mis-colored as approved
- [x] Unit test for isCancelledJob (8 tests); full suite 43 passing


## Feature 23: Technician experience level (Junior / Senior)
- [x] Add experienceLevel column to technicians table (enum junior|senior, default junior)
- [x] opsDb: setTechnicianLevel helper
- [x] coordinator: setTechnicianLevel procedure; experienceLevel included in technicians query output
- [x] Workers panel: Junior/Senior badge on each worker + toggle button to change level (optimistic)
- [x] Integration test for setTechnicianLevel (no Airtable write) (44 tests passing)


## Feature 24: Inline job detail (accordion) — replace side panel
- [x] Add expand/collapse chevron per project row that toggles an inline detail row below it
- [x] Inline detail shows full job info (company, address, dates, setup, status/sub-status, area, requestor, site contact, request id, technicians by phase) + plan (planFile) preview/links
- [x] Remove the old Sheet side panel that rendered overlapped
- [x] Inline detail spans the full grid width and does not overlap sticky headers

## Feature 24: Inline Job Detail Accordion
- [x] Remove Sheet side panel; use expandedJobs Set + toggleJobExpanded
- [x] Create JobDetailInline component (status, company, address, dates, contact, technicians by phase, plan files)
- [x] TypeScript clean

## Feature 25: Real Truck Fleet Catalog
- [x] Extend truck_catalog schema with code, ref, description, vin fields
- [x] Push DB migration
- [x] Replace DEFAULT_TRUCKS seed with the 12 real Fast Traffic vehicles
- [x] Surface code/VIN/plate in Scheduler Trucks tab UI
- [x] Update integration test mock + assertions
- [x] All tests passing (44)

## Feature 26: Closure Type, Impact & Emoji (Airtable read-only)
- [x] Add closureType ("Closure Type"), impact ("Impact Category"), calendarInfo ("Calendar info") to AF + JobRecord
- [x] Map closureType (multi-select joined), impact, calendarInfo + extract emoji in mapRecordToJob
- [x] Add closureType/impact/calendarInfo/emoji to frontend DispatchJob type
- [x] Show emoji + closureType + impact in JobDetailInline accordion
- [x] Show emoji + impact badge (color by difficulty word) + closure type on Scheduler job rows
- [x] TypeScript clean + 50 tests passing (added airtable.mapping.test.ts)

## Feature 27: Day-cell alignment + Setup Duration category badge
- [x] Move duration bar into a fixed-height top band so it stays aligned when chips are added
- [x] Add setupDurationBadge() mapping Airtable colors (24h->purple, daily/daytime->amber, night->blue)
- [x] Show Setup Duration as a color-coded badge on Scheduler job rows
- [x] Show Setup Duration badge in JobDetailInline accordion
- [x] TypeScript clean + 50 tests passing

## Feature 28: Day-column readability + alignment
- [x] Align day header with body grid (both use grid-cols-[240px_repeat(7,minmax(180px,1fr))])
- [x] Widen day columns to minmax(180px,1fr) so chip names (e.g. "Alejandro Galindez") read fully
- [x] Chip text wraps as a fallback; min-w 1500px enables horizontal scroll instead of compressing
- [x] Verified live in browser (Alejandro chip = 167px, full name fits) + 50 tests passing

## Feature 29: Week/Day view toggle (single-day cards)
- [x] Add Week/Day view toggle control in the Scheduler header
- [x] Day picker (Mon..Sun of current week) when in Day view
- [x] Day view renders that day's jobs as cards grouped by status
- [x] Each card shows emoji, company, address, closure type, impact, setup duration + assigned resources
- [x] Preserve drag-and-drop (worker/equipment/truck) onto each day card
- [x] Click a resource chip to remove (same as grid)
- [x] TypeScript clean + 50 tests passing

## Feature 30: Color-code week-grid cell shading by Setup Duration
- [x] Add setupDurationCellShade() (24h->purple, daily/daytime->amber, night->blue, other->neutral)
- [x] Apply shade to covered day cells + duration bar in the week grid
- [x] Verified live: Marmot (24h) purple, ALSA (Daily) amber + 50 tests passing

## Feature 31: 5-day change detection (New/Cancelled/Postponed/Modified)
- [x] Read references/periodic-updates.md to choose scheduling approach (project-level Heartbeat)
- [x] Add job_snapshots table (date, requestId, status, startDate, key fields)
- [x] Add job_changes table (requestId, changeType, field, oldValue, newValue; detectedDate + createdAt timestamp instead of single detectedAt)
- [x] Server: snapshot today's 5-day-window jobs from Airtable + diff vs latest prior snapshot
- [x] Detect New / Cancelled(missing or status=Cancelled) / Postponed(startDate changed) / Modified(address, closureType, impact, setupDuration, technicians)
- [x] Endpoint /api/scheduled/detectJobChanges mounted (cron-auth, idempotent, JSON error) — ready for Heartbeat
- [ ] Register the daily Heartbeat cron (manus-heartbeat create) — BLOCKED until site is deployed (platform POSTs the production URL)
- [x] tRPC: recentChanges + changeBadges (per-job) + acknowledgeChanges + runChangeDetection
- [x] Change badge (New/Cancelled/Postponed/Modified, color-coded) on Scheduler rows (week + day)
- [x] Change badge on Dispatch Board rows
- [x] Changes/Alerts tray listing changes with before/after detail + acknowledge + manual run
- [x] TypeScript clean + 61 tests passing

## Feature 32: Highlight Alberta statutory holidays in Scheduler
- [x] Add Alberta statutory holidays list (computed per year, shared/albertaHolidays.ts incl. Easter/Good Friday algorithm)
- [x] Shade holiday day columns/cells with a distinct color (rose = costlier day) + tooltip with holiday name (week header, day cells, day-view selector + banner)
- [x] TypeScript clean + 71 tests passing (added 10 holiday tests)

## Feature 33: Grey out non-working days from Client message
- [x] Add clientMessage ("Client message") to AF map + JobRecord (read-only)
- [x] Interpret non-working days: deterministic "NO WORK:" parser (weekdays/dates/ranges, EN+ES) + LLM fallback endpoint (interpretNonWorkingDays)
- [x] Grey out those day cells in the job row (diagonal hatch + "No work" tag + tooltip reason) and show Client message + detected no-work days in inline detail
- [x] TypeScript clean + 87 tests passing (16 parser + clientMessage mapping test)

## Feature 34: Active works Map / List toggle on Dashboard
- [x] Build an "Active works" panel with a Map view (pins for active jobs) and a List view, toggled by buttons (like Assignar "Active Projects")
- [x] Map: plot active jobs by lat/lon (fallback geocode by address/municipality if missing), click pin -> popup with company/address/dates/status
- [x] List: compact table of active jobs (company, address, dates, status, zone) with click-through that focuses the pin on the map
- [x] Wire into Dashboard layout (new /dashboard page, set as coordinator home); preserve selected view in component state
- [x] TypeScript clean + tests passing

## Feature 35: Weather card on Dashboard
- [x] Server tRPC procedure to fetch current weather (Open-Meteo, no API key) for a default location (Calgary, AB) + optional lat/lon, cached 10 min
- [x] "Today" style card showing temp + condition + icon (Clouds/Clear/etc.) + wind
- [x] Handle loading/error states; cache briefly to avoid spamming the API
- [x] TypeScript clean + 8 weather tests passing

## Feature 36: Per-job "Novedades" (billing notes) in Scheduler
- [x] Add job_billing_notes table (airtableJobId, note, author, createdAt) in local DB (Airtable stays read-only)
- [x] tRPC: list notes per job + add note + delete note + counts per job
- [x] Scheduler job row: "Novedades" action button in inline detail opening a dialog to view/add billing notes
- [x] Badge/count indicator when a job has billing notes (on the job row)
- [x] TypeScript clean + 96 tests passing; verified create/list/author+date/delete in browser

## Feature 34b: Dashboard tweak — remove map, keep list + link to Permit Map
- [x] Remove the Map/List toggle and embedded Google map from the Dashboard "Active works" panel
- [x] Keep the active works as a List only; add a "View on map" link to the Permit Map page
- [x] Keep the weather card and stats

## Feature 37: Structured billing fields in Novedades (invoicing alignment)
- [x] Extend job_billing_notes with structured columns: extraSignage (text), weekendSurcharge (bool), holidaySurcharge (bool), planStamped (enum yes/no/unknown), chargeAmount (cents int, optional), chargeCategory (text, optional)
- [x] Push DB migration
- [x] Update opsDb createBillingNote + types to accept structured fields
- [x] Update tRPC addBillingNote input + listBillingNotes output to carry structured fields
- [x] Dialog: structured form (extra signage, weekend/holiday surcharge toggles, plan stamped, charge amount + category) alongside the free note; render badges on saved entries
- [x] Show a compact summary (signage/surcharge/amount chips) in the saved note card
- [x] TypeScript clean + tests passing (3 new integration tests, verified end-to-end in browser)

## Feature 38: Dashboard active works — count cards + collapsible sections [DONE]
- [x] Add three count cards (Field, Permit Request Submitted, Permit Approved) like the "In the field" stat
- [x] Make each status section collapsible (click card or header to expand/collapse) so no long scroll
- [x] TypeScript clean; verified in browser

## Feature 39: Employee (technician) profiles
- [x] Inspect how technicians are modeled today (Airtable workers vs local DB) to choose storage
- [x] Add employee_profiles table: experienceSummary (text), level (apprentice/junior/senior), updatedAt/by
- [x] Add employee_certificates table: name, issuer, issuedAt, expiresAt, fileKey/url (S3 upload), uploadedAt/by
- [x] Add employee_availability: per-day available/unavailable with reason (recurring weekday rules + specific date overrides)
- [x] tRPC: get profile + availability + certs for a technician; upsert profile; add/delete cert (with file upload); set availability
- [x] UI: clicking a technician opens a profile panel/page showing availability calendar, experience, level, and certificates
- [x] Upload safety-course certificate files (store in S3 via storagePut, save key/url in DB)
- [x] Level badge (Apprentice/Junior/Senior) shown on the technician and editable in profile
- [x] TypeScript clean + tests passing

## Feature 40: Worker week calendar (availability + assignments) — Assignar style
- [x] New "Workers" calendar view: rows = employees, columns = days of the selected week
- [x] Grey diagonal hatch on days the worker is NOT available (from employee_availability)
- [x] Colored bars on days the worker is assigned, showing role/project (past = where they were, future = where they will be)
- [x] Reuse existing phase assignments (workerWeek) as the assignment source per day
- [x] Week navigation (prev/next/today) + filter by worker name
- [x] Click a worker row/name to open the employee profile (Feature 39)
- [x] TypeScript clean + tests passing

## Feature 41: Assignar-style project windows (resource cards + detail)
- [ ] Day cards with compact resource header: workers assigned (e.g. "3/3") + equipment count + time window (e.g. 7:00 AM - 5:00 PM)
- [ ] Stacked worker avatars with "+N" overflow and equipment/truck icons on each day card
- [ ] "Show Details" opens the project window with full info: assigned employees (level + role), equipment/trucks, dates, address, billing novedades
- [ ] Side "Resources" panel (Workers / Equipment tabs) with search + crews to view/assign
- [ ] Consistent visual look (rounded cards, soft shadows, status accent) matching the reference
- [ ] TypeScript clean + tests passing

## Feature 42: Employee communication / portal (permitted info only) — LATER
- [ ] Worker view shows their weekly schedule (days + hours assigned)
- [ ] Per assigned project, show ONLY: plans/drawings, project address, day, time, and requesting company name
- [ ] Strictly hide billing, internal notes, client contact, margins, etc.
- [ ] (Phase 2) Notify worker on assignment/shift change (SMS/email + link)
- [ ] TypeScript clean + tests passing

## Feature 43: Per-day role slots (incl. Flagger) + separately-billable flagging hours (part of project-window redesign)
- [ ] Allow a job to have separate per-day role slots, not just a single technician list (e.g. Setup crew vs Flagger)
- [ ] Add a "Flagger" role slot to the job card so a job can be marked install-only (no flaggers) or with technicians staying as flaggers
- [ ] Each role slot shows its own assigned count (e.g. 0/3) + time window + assigned people
- [x] Track flagging hours SEPARATELY from setup/install hours (flagger hours billed separately, per person-hour) via flagging_hours table
- [x] Surface a billable flagging-hours summary/report per job (FlaggingHoursPanel) and per week (Workers calendar summary)
- [x] Confirm with user: flagging billed per person-hour vs per service block -> PER PERSON-HOUR
- [x] TypeScript clean + tests passing (Flagger role available as a phase + flagging_hours billing)

## Feature 44: Worker recommendation engine (impact-based, override-friendly)
- [x] Read job difficulty from Airtable `impact` field (High / Medium / Low) — already mapped
- [x] Matching rule: High impact -> Senior recommended; Medium -> Junior or Senior; Low -> any level (incl. Apprentice)
- [x] Consider availability (skip workers marked unavailable that day) and avoid same-day double-booking
- [x] "Recommended workers" panel sorted by match quality (best first), green check for full match, yellow warning for level mismatch
- [x] Suggestions only — coordinator can override (no hard block)
- [x] Pure helper for the matching logic in shared/ + unit tests
- [x] TypeScript clean + tests passing

## Bug fix: Workers calendar bars overflow cells
- [x] Assignment bars now use minmax(0,1fr) columns + min-w-0 cells + truncated 2-line bar (phase + project) so they stay inside each day cell

## UX: Freeze the "Job" column in Scheduler on horizontal scroll
- [x] Make the first "Job" column sticky (left:0) so it stays visible while scrolling to see more days of the week
- [x] Apply to both the header row and each job row; ensure background + border so content underneath doesn't show through
- [x] TypeScript clean + verified in browser

## Feature 45: Drag existing assignments between days (move, not recreate)
- [x] Make assigned worker chips draggable; dropping on another day cell of the same job MOVES the assignment (updates scheduledDate) instead of creating a duplicate
- [x] Same for equipment chips (move equipment assignment to another day)
- [x] Same for truck chips (move truck assignment to another day, keep driver)
- [x] Keep existing behavior: dragging from the Resources panel still CREATES a new assignment
- [x] Avoid duplicates: if target day already has that same worker/equipment/truck for the job, merge (no duplicate)
- [x] tRPC: moveScheduled / moveEquipment / moveTruck procedures
- [x] TypeScript clean + tests passing (114 green) + verified in browser via tRPC roundtrip

## Feature 46: Day Timeline view (hour-by-hour assignment per project)
- [x] Click a day (day-column header opens Day Timeline; also a Day Timeline nav entry) opens a Day Timeline for that date
- [x] Each project scheduled that day is a COLUMN; vertical axis = 24h in 1-hour blocks (auto-scroll to 6 AM)
- [x] Shade each project's working window (24h purple / daily yellow / night blue per setup duration) via duration badge
- [x] Drag a worker/equipment/truck from Resources onto a project x hour cell -> creates assignment with startTime (default 1h block)
- [x] Same person can have multiple blocks same day/project at different hours (verified: 9AM Setup, 3PM Pickup)
- [x] Drag an existing block to another hour/project to MOVE it (update startTime/endTime/job)
- [x] Day/Night range toggle that only changes the visible hour range, no data loss
- [x] Backend: persist startTime/endTime on assignments; tRPC to set time, move block, list day-by-project
- [x] TypeScript clean + 127 tests passing + verified in browser (end-to-end via tRPC + DOM)

## Feature 47: Pending jobs (no technician assigned) + coordinator alert
- [x] Backend: derive jobs in the active window with NO technician (scheduler_assignment) for their scheduled date(s)
- [x] Expose a `pendingJobs` tRPC query returning the unassigned jobs (emoji, dates, impact)
- [x] Scheduler: show a "Pending" badge on job rows with no technician assigned
- [x] Coordinator alert: badge/banner with count of pending jobs + a panel listing them
- [x] Dashboard: show pending jobs count
- [x] Tests passing + TypeScript clean

## Feature 48: Tentative vs Confirmed assignments (suppress technician alerts until confirmed)
- [x] Schema: add `status` (tentative|confirmed) + confirmedAt/confirmedBy to job_assignments; push migration
- [x] assignTechnicians/setScheduled create rows as TENTATIVE and send NO technician notifications
- [x] Add confirmAssignment / unconfirmAssignment (and confirmJob = confirm all of a job) procedures
- [x] Notification to the technician fires ONLY on confirm (one alert), not on assign/move
- [x] Scheduler/Workers: tentative chips one color (amber/dashed), confirmed chips another (green/solid)
- [x] Confirm button on chip + "Confirm all" per job; allow revert to tentative
- [x] Job status: no techs = Pending, has techs = Tentative, all confirmed = Confirmed
- [x] Tests passing + TypeScript clean

## Feature 47 — Completed
- [x] Schema: status/confirmedAt/confirmedByName on job_assignments (pushed)
- [x] Assigning/scheduling/moving = tentative, NO technician notification
- [x] Technician app only sees CONFIRMED assignments
- [x] No same-day double-booking block (techs work multiple jobs/day)
- [x] confirmAssignment / confirmJob (+ revert) send one alert per newly-confirmed tech
- [x] Re-touching a phase preserves confirmed technicians
- [x] pendingJobs query (no technician, excludes cancelled)
- [x] Scheduler: Pending/Tentative/Confirmed badge + "Confirm all" + per-chip confirm
- [x] WorkerChip: amber dashed = tentative, green = confirmed
- [x] WorkersCalendar: tentative vs confirmed bars + legend
- [x] Coordinator sidebar: "Pending Jobs" nav with red count badge
- [x] /pending page listing unassigned jobs with Assign action
- [x] Tests: assignmentState + assignmentWorkflow (opsDb) + fixed ops.integration mock — 139 pass

## Feature 49: Day-view category filter (Scheduler)
- [x] Add filter toggles in Scheduler day view for job status: Field, Permit Approved, Permit Request Submitted (and Cancelled)
- [x] Filtering hides non-matching status sections; multiple categories selectable; persists while switching days
- [x] TypeScript clean + tests pass

## Feature 50: Day Timeline category filter + status label
- [x] Add category filter chips (Field, Permit Approved, Permit Request Submitted, Cancelled) to Day Timeline header
- [x] Show each job's status/category on its column header
- [x] Filter hides non-matching project columns; empty state when none match
- [x] TypeScript clean + tests pass

## Feature 51: Color jobs by Airtable Sub-Status Field Operations (Day Timeline)
- [x] Map each Sub-Status option to its exact Airtable single-select color (hex)
- [x] Color each Day Timeline job (top bar + column tint) by its Sub-Status color
- [x] Legend showing sub-status -> color
- [x] TypeScript clean + tests pass

## Feature 52: Day summary boxes (5 totals) in Day Timeline
- [x] Arrowboards = Job Address contains tire emoji/word
- [x] Message boards = Job Address contains TV emoji
- [x] Render summary boxes row above the day timeline (5 boxes)
- [x] Jobs before 9AM / at 9AM / after 9AM from Street Use Permit PDF (match date, newest if multiple)
- [x] Jobs finished or picked up that day from Street Use Permit PDF
- [x] Render summary boxes above the day timeline
- [x] TypeScript clean + tests pass

## Feature 53: Update official technician roster
- [x] Replace TECHNICIANS with official 26 workers (18 FULL + 8 A FEW DAYS)
- [x] Seed technicians into the database
- [x] Remove stale technicians not in official list (kept Juanito/Adrian: have assignments)
- [x] TypeScript clean + tests pass

## Feature 54: Dashboard day view with date filter
- [x] Backend query: for a given date, group jobs into Starting today (Start Date == day), Ongoing daily (range covers day, excludes start/end day), Pick up today (End Date == day)
- [x] Dashboard: date picker (defaults to today) to choose the day to view
- [x] Three sections with job cards (emoji, company, address, dates)
- [x] Shared classifier + unit tests; TypeScript clean + tests pass
- [x] Dashboard: three sections (Starting today / Ongoing / Pick up today) with job cards (emoji, company, address, dates)
- [x] TypeScript clean + tests pass

## Feature 52 (cont.): Street Use Permit (SU) PDF extraction
- [x] Helper to pick SU attachment(s) from planFile (filename starts with "SU"), choose latest
- [x] Backend permit extraction via invokeLLM (PDF) -> validFrom/validTo date+time+day
- [x] Cache extracted permit result by jobId+filename to avoid re-analysis
- [x] dayTimeline returns permitSummary (before/at/after 9AM, finished/picked up)
- [x] Day Timeline summary boxes show before/at/after 9AM + finished/picked up counts
- [x] Unit tests for SU selection + 9AM classification helpers

## Feature 55: Dashboard Day view map
- [x] dashboardDay returns lat/lon (+ bucket) for jobs so the map can plot them (mergeJob keeps lat/lon)
- [x] Add a map to the Dashboard Day view plotting that day's jobs (starting/ongoing/pickup)
- [x] Color markers by bucket; info window with company/address/dates

## Feature 56: Starting-today sections by 9AM + single-day in both columns
- [x] dashboardDay returns each startingToday job's SU permit start time (validFromTime) + 9AM bucket
- [x] Single-day jobs (start == end) appear in BOTH startingToday and pickup (already in classifyJobForDay)
- [x] DashboardDay: split Starting today into before 9 AM / at 9 AM / after 9 AM sections
- [x] Tests for bucketing + single-day duplication (covered in permitSchedule.test + dashboardDay.test)

## Feature 56: Cancelled jobs in Day view
- [x] dashboardDay surfaces Cancelled/Declined jobs ONLY in Starting today (when start==day)
- [x] Cancelled jobs flagged (isCancelled) + styled (strikethrough, red badge) on cards
- [x] Cancelled jobs excluded from map markers and from ongoing/pickup
- [x] Tests for cancelled-in-startingToday behavior

## Feature 57: Prepared tag + crew ordered by phase (Day view)
- [x] Show "Prepared" tag on job card when a tech is assigned to Preparation phase
- [x] List assigned crew ordered Preparation -> Setup -> Pickup with phase labels

## Feature 58: Day-filtered Dashboard + Sign Count widget + multi-format permits
- [x] Map Airtable "Signs Count" field into JobRecord
- [x] Deterministic Signs Count parser (Option A: custom signs only) + tests
- [x] Generalize permit file detection to SU (Calgary) AND SUP (Cochrane/others)
- [x] Generalize LLM extraction prompt for non-Calgary permit layouts (long dates, 12h times)
- [x] Remove Start/End-date time fallback; show "permit info not available" when NO permit attached
- [x] Aggregate Custom Signs / Arrow Boards / Message Boards over Starting-today jobs in dashboardDay
- [x] Ensure entire Dashboard (widgets/weather) filters by the selected day
- [x] Add sign-count widget AFTER the weather widget
- [x] Tests pass + TypeScript clean

## Day map: same-day jobs
- [x] Split-color pin (starting + pickup) for jobs that begin and are picked up the same day
- [x] Filter-aware: pin shows only colors of active buckets; info window lists both labels
- [x] Legend hint for split pin; tests pass + TypeScript clean

## Scheduler: sticky section headers
- [x] Week-view section headers (Permit Approved/Field/etc.) stay pinned left during horizontal scroll

## Dashboard Day view: Ongoing 9AM sections
- [x] Backend: add nineAmBucket to ongoing jobs in dashboardDay
- [x] Frontend: split Ongoing (daily) column into before/at/after 9AM

## Scheduler: assignment time
- [x] Show assignment time next to worker name in Scheduler chips (created-at timestamp, local 12h)

## Day view pickup time
- [x] Pick up column shows pickup time (permit end time) on each card

## Scheduler worker phase label
- [x] Worker chip shows phase (Prep/Setup/Pick up) with color

## Day view crew per phase
- [x] Show assigned workers per phase (Prep/Setup/Pickup) per project, one row per phase

## Scheduler year range
- [x] Add range selector (1W/2W/Month/Quarter/Year) to Week view for horizontal scroll across a year
- [x] Dynamic grid columns + real dates with month/holiday markers
- [x] Keep Day view selector fixed to a 7-day week

## Scheduler filter colors
- [x] Recolor Scheduler filter/section dots with Airtable Field Operations sub-status colors (Option A)

- [x] Scheduler Week: always show all status sections/filters even when count is 0

- [x] Day View cards: show crew assigned for the SELECTED DAY (merge generic + day-pinned job_assignments) so Scheduler assignments reflect on Dashboard
