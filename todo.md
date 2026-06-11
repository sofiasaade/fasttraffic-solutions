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
