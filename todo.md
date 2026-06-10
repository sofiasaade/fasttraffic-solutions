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
- [ ] Verify markers appear and map fits bounds in authenticated UI (pending user/owner login)

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
