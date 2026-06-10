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
