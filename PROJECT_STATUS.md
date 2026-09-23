# AquaSense Smart Water Purification & Quality Monitoring
## Project Handoff / Current State

- Workspace: `c:\Users\DELL\Downloads\SIH`
- Status date: 2026-09-02
- Written by: the previous coding agent (Cline), based on direct inspection of the code, a read-only row-count query against PostgreSQL (`node scripts/check-db.mjs`), and actual runs of `npx tsc -b`, `npm run build`, and `npm run server:build` on this machine.
- This document describes ONLY what actually exists in the repository. Where something is implemented but unverified (e.g. physical hardware), that is stated explicitly.

---

## 1. PROJECT OBJECTIVE

The objective actually implemented in this repo:

A **Smart Water Purification & Quality Monitoring dashboard** consisting of:

1. A React 19 + Vite frontend with 8 pages (Dashboard, Live Monitoring, History, Purification, AI Analysis, Alerts, Settings, Government Data).
2. An Express 5 REST API (`server/`) on port 3001 backed by PostgreSQL database `smart_water`.
3. ESP32 sensor ingestion (temperature + turbidity ONLY) via HTTP into PostgreSQL, plus an optional Firebase Realtime Database live path for the browser.
4. Manual entry of pH (chemical test) and TDS (external meter).
5. A provenance-preserving CSV/XLSX importer for real government datasets (CGWB laboratory measurements, JJM-WQMIS WQ6 affected-village summaries, WQ4 testing statistics, data.gov.in exports).
6. A water-quality assessment layer: deterministic rule-based scoring (monitoring thresholds, explicitly NOT drinking-water certification) plus an optional Gemini LLM path through a server-side proxy.
7. Purification control limited to a pump START/STOP command queue (operator-initiated; never AI-initiated).

Core project policy enforced throughout the code: **no invented data** - empty tables produce "No data available" states, unknown import parameters fail their row, affected-village counts are never treated as concentrations, and the software never claims potability certification.

## 2. CURRENT ARCHITECTURE

The architecture that ACTUALLY exists. It has **two data paths**, both real:

```
                 +---------------------------------------------------+
                 | FRONTEND (React 19 + Vite, src/)                  |
                 | 8 pages; live data via Firebase RTDB;             |
                 | government data + AI via Express API              |
                 +------------------+----------------+---------------+
         (live path)                 |                |  (reference path)
   Firebase Realtime DB              |                |  Express 5 REST API
   waterMonitoring/* nodes           |                |  (server/, port 3001)
   current|history|pump|alerts|ai    |                |
            |                        |                v
            v                        |     +----------------------+
   +------------------+              |     | POSTGRESQL           |
   | ESP32 (future)   |              |     | database: smart_water|
   | publishes temp + |              |     | 18 tables            |
   | turbidity to RTDB|              |     +----------+-----------+
   +------------------+              |                |
                                     |   +------------+-----------+
                                     |   v            v           v
                                     | Government    Manual      ESP32 ingest
                                     | data import   testing     POST /api/device/readings
                                     | (CSV/XLSX)    (pH, TDS)         |
                                     |                                   v
                                     |                     Water Quality Analysis
                                     |                     (rule-based scoring, frontend +
                                     |                      server; monitoring thresholds)
                                     |                                   |
                                     |                                   v
                                     |                     AI (server proxy /api/ai/analyze:
                                     |                      Gemini 2.0 Flash if GEMINI_API_KEY set,
                                     |                      else deterministic rule fallback)
                                     |                                   |
                                     |                                   v
                                     |                     Purification Control
                                     |                     (pump START/STOP: Firebase node from UI,
                                     |                      pump_commands queue via API; relay = firmware)
                                     +---------------------------------------------------+
```

Key architectural facts a new agent MUST know:

- The React app's live sensor/manual/pump/alerts/AI path reads and writes **Firebase RTDB** (`src/services/firebaseService.ts`), not the Express API. `GET /api/dashboard` exists and aggregates everything from PostgreSQL, but **the React app currently does not call it**.
- The Express API is used by the frontend only for: government data (datasets/records/summary/preview/import) and AI analysis (`/api/ai/analyze`).
- ESP32 to PostgreSQL ingest (`POST /api/device/readings`) and ESP32 to Firebase publishing are two separate integration options; **neither has a real device connected yet**.
- Firebase is currently **not configured** (no `VITE_FIREBASE_*` in `.env`), so on this machine the app runs in DEMO MODE or shows "Not Connected" states.

## 3. FRONTEND STATUS

All pages live in `src/App.tsx` (8 page components + root `App` with sidebar shell). Shared UI in `src/components/ui.tsx`. State comes from the `useDashboard()` hook, which wraps `useWaterData()` (`src/hooks/useWaterData.ts`).

| Page / component | What it does today | Data source |
| --- | --- | --- |
| `Dashboard` | Status/score/last-updated/alerts metric cards; WaterQualityScore with "Explain" modal; live sensor cards (temperature, turbidity, pH, TDS) with per-sensor source labels; CoverageRow (available vs missing parameters); Manual Testing panel; Government Reference summary panel; trends list; recent alerts; legal-disclaimer footer | Firebase (current/history/alerts) + Express (gov summary/datasets) |
| `LiveMonitoringPage` | Full-width live sensor cards + ESP32 connection state | Firebase `waterMonitoring/current` |
| `HistoryPage` | Four `LiveChart` panels (temperature, turbidity, pH, TDS) with 1h/6h/24h/7d window chips via `buildSeries()`; "No historical data" until 2+ readings | Firebase `waterMonitoring/history` |
| `PurificationPage` | PumpControl panel; current temperature/turbidity cards; safety notes (the UI only writes a command; the ESP32 relay does the switching) | Firebase `pump` + `current` |
| `AiAnalysisPage` | "Run AI Analysis" button -> `analyzeWater()` (backend proxy first, local rule engine fallback) -> renders status/risk/score/confidence/engine/issues/trends/limitations + plain-language explanation; mirrors result to Firebase | Express `/api/ai/analyze` + fallback; mirror to Firebase `ai` |
| `AlertsPage` | Lists stored alerts (type, message, timestamp, acknowledged) with per-alert acknowledge button | Firebase `waterMonitoring/alerts` |
| `SettingsPage` | REAL DATA / DEMO MODE switch (persisted in `localStorage['aquasense.mode.v1']`); 10 editable monitoring thresholds (persisted in `aquasense.thresholds.v1`); Firebase connection status + error display | localStorage; Firebase init state |
| `GovernmentDataPage` | Renders `GovernmentImport` (upload -> column mapping -> validation -> import) plus datasets/records tables with filters (parameter, organization, state, district, search) | Express `/api/government/*` |
| `GovernmentReferenceSection` (Dashboard panel) | Record/dataset/parameter/village counts + first 3 dataset names; "No government data yet" when `summary.records === 0` | Express `/api/government/summary` + `/datasets` |
| `ExplainModal` | Plain-language explanation of the current snapshot + trends | computed in-browser |
| `GovernmentImport.tsx` | Full importer UI: file picker (CSV/XLSX read in-browser via SheetJS), 13-field column mapping, record-type-driven required fields, per-row pre-import validation with spreadsheet row numbers, XHR upload with progress bar, result summary | Express `/api/government/preview` and `/import` |
| `ManualMeasurement.tsx` | pH and TDS numeric inputs; submits via `saveManualMeasurement()` | **Firebase** current+history (NOT the Express `/api/manual/*` endpoints) |
| `PumpControl.tsx` | START/STOP buttons; sends via `sendPumpCommand()`; shows RUNNING/IDLE only as reported by the pump node | **Firebase** `pump` node (NOT Express `/api/pump/command`) |
| `LiveChart.tsx` | Recharts line chart + `buildSeries()` time-window filtering | props |
| `ui.tsx` | Panel, SensorCard, StatusBadge, WaterQualityScore, CoverageRow, DemoBanner, EmptyState, ErrorState, Loading | props |

Type-checks clean: `npx tsc -b` -> 0 errors.

## 4. BACKEND STATUS

Express 5 app in `server/src/index.ts` (460 lines). Services: `governmentImport.ts`, `aiProxy.ts`, `validation.ts` (zod schemas), `database/pool.ts`, `database/migrate.ts`. CORS from `CORS_ORIGIN`, JSON limit 1 MB, multer memory storage 20 MB for uploads. Listens on port 3001 by default.

All 20 registered routes:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | DB connectivity check |
| GET | `/api/dashboard` | Full dashboard aggregate from PostgreSQL (government counts, latest sensor reading, latest manual, datasets, alerts, totals, devices online). Empty tables -> nulls, never fabricated |
| GET | `/api/water-sources` | Water sources with village join |
| GET | `/api/devices` | Devices with water-source join |
| GET | `/api/sensor/history` | Sensor history for a water source |
| GET | `/api/manual/measurements` | Manual measurement history |
| GET | `/api/locations` | State/district/block/GP/village/source hierarchy |
| GET | `/api/alerts` | Alerts from PostgreSQL |
| PATCH | `/api/alerts/:id/acknowledge` | Set acknowledged_at |
| GET | `/api/government/datasets` | Imported dataset registry |
| GET | `/api/government/records` | Records with filters (parameter, organization, state, district, search) |
| GET | `/api/government/summary` | Counts for the dashboard panel |
| POST | `/api/government/preview` | Validate an uploaded CSV/XLSX WITHOUT writing; returns headers, row count, per-row issues |
| POST | `/api/government/import` | Real import: dataset row, import_job, per-row validation, import_errors with original rows, duplicate detection |
| POST | `/api/device/readings` | ESP32 ingest (temperature + turbidity ONLY, strict zod) |
| POST | `/api/manual/ph` | Manual pH -> `manual_measurements` (source MANUAL_CHEMICAL_TEST) |
| POST | `/api/manual/tds` | Manual TDS -> `manual_measurements` (source EXTERNAL_TDS_METER) |
| GET | `/api/readings/latest` | Latest ESP32 snapshot + manual history per water source |
| POST | `/api/pump/command` | Queue pump START/STOP into `pump_commands` (409 if device offline). Operator-only; AI never activates pumps |
| POST | `/api/ai/analyze` | AI proxy: Gemini 2.0 Flash when `GEMINI_API_KEY` is set, else deterministic rule-based fallback |

## 5. DATABASE STATUS

- **Database name:** `smart_water` (PostgreSQL at `localhost:5432`, user `postgres`; connection string in `.env` as `DATABASE_URL`). The database was reached successfully during this audit via a **read-only** count script.
- **Migrations:** one file, `database/migrations/001_initial_schema.sql`, applied by `npm run db:migrate` (`server/src/database/migrate.ts`), which tracks applied files in a `schema_migrations` table and runs each file in a transaction. The schema IS applied on this machine (all tables exist and answer COUNT queries).
- **Enums:** `source_type` = ESP32, MANUAL_CHEMICAL_TEST, EXTERNAL_TDS_METER, GOVERNMENT_CGWB, GOVERNMENT_JJM, OTHER_GOVERNMENT, DEMO, AI. `government_record_type` = LABORATORY_MEASUREMENT, CONTAMINATION_SUMMARY, TESTING_STATISTIC.

**Tables (18 + schema_migrations):**

| Table | Purpose / key columns |
| --- | --- |
| `states`, `districts`, `blocks`, `gram_panchayats`, `villages` | Administrative hierarchy, each FK to its parent; villages have optional lat/lng |
| `water_sources` | FK village_id; name, source_type text, optional lat/lng |
| `devices` | device_code UNIQUE, FK water_source_id, last_seen_at, online boolean |
| `parameters` | code UNIQUE, display_name, default_unit (master data; auto-registered lazily from the curated import catalogue or first manual ph/tds use) |
| `water_quality_standards` | FK parameter_id; min/max/warning/critical, standard_kind CHECK (MONITORING_THRESHOLD or OFFICIAL_REFERENCE), reference_source — supports a future standards engine; **currently EMPTY and unseeded** |
| `sensor_readings` | FK device_id, water_source_id; temperature + turbidity NOT NULL, observed_at |
| `manual_measurements` | FK water_source_id, parameter_id; value, unit, source CHECK (MANUAL_CHEMICAL_TEST or EXTERNAL_TDS_METER), tested_at, operator_name, notes |
| `government_datasets` | source_organization, dataset_name, dataset_year, source_url, imported_at |
| `government_records` | FK dataset_id (CASCADE), record_type, FK parameter_id, value, unit, **affected_village_count** (separate column — never merged into value), state/district/block/GP/village/water_source names (verbatim text), sample_date, lat/lng, original_row_reference, notes; CHECK: LAB rows require value, summary/statistic rows require affected_village_count |
| `alerts` | severity, FK parameter_id, source, FK water_source_id, message, recommended_action, occurred_at, acknowledged_at |
| `ai_analyses` | FK water_source_id, request_data jsonb, response_data jsonb — **exists but nothing writes it yet** |
| `pump_commands` | FK device_id, command CHECK (START/STOP), status default PENDING, requested_at, acknowledged_at |
| `import_jobs` | FK dataset_id, status, total/valid/invalid/duplicate/imported row counters |
| `import_errors` | FK import_job_id (CASCADE), row_number, field_name, message, original_row jsonb |

**Relationships:** states -> districts -> blocks -> gram_panchayats -> villages -> water_sources -> (devices, sensor_readings, manual_measurements, alerts); parameters -> (standards, manual_measurements, government_records, alerts); government_datasets -> government_records; import_jobs -> import_errors. Note: `government_records` stores location names as TEXT (verbatim provenance) and does NOT FK into the normalized location tables.

**Current data counts (read-only query run 2026-09-02 via `node scripts/check-db.mjs`):**

```
government_datasets: 0     government_records: 0    sensor_readings: 0
manual_measurements: 0     parameters: 0            water_sources: 0
devices: 0                 villages: 0              alerts: 0
pump_commands: 0           ai_analyses: 0
```

**Every table is empty.** No INSERT/UPDATE/DELETE/seed was performed during this audit. Because no villages/devices/water sources exist, even the ESP32 and manual endpoints would reject writes until master data is created.

## 6. GOVERNMENT DATA STATUS

Implemented as a real, generic CSV/XLSX pipeline (no dataset-specific hardcoding, no bundled data files):

- **CSV support:** YES. Files are read in the browser with SheetJS (`xlsx`) for mapping/preview, re-uploaded as multipart/form-data, and parsed server-side with the same library. Multer memory storage, 20 MB limit.
- **XLSX support:** YES (same pipeline; `.xlsx` is accepted by both the client reader and the server parser).
- **Import endpoint:** `POST /api/government/import` (real import) and `POST /api/government/preview` (validate-only, writes nothing). Both exist and are wired to the service in `server/src/services/governmentImport.ts`.
- **Frontend importer:** `src/components/GovernmentImport.tsx` — file picker -> auto/_manual column mapping (13 mappable fields: recordType is chosen separately; mapping covers parameter, value, unit, affectedVillageCount, state, district, block, gramPanchayat, village, waterSource, sampleDate, latitude, longitude) -> client-side per-row validation with spreadsheet row numbers -> XHR upload with progress -> result summary. A `preview` flow via `src/providers/governmentProvider.ts` calls the validate-only endpoint.
- **Column mapping UI:** user maps spreadsheet headers to the 13 fields; the preview endpoint reports row-level problems before any write.
- **Validation:** server-side per row — required fields by record type (LABORATORY_MEASUREMENT requires numeric value; CONTAMINATION_SUMMARY / TESTING_STATISTIC require a whole affected-village count >= 0), parameter must resolve through the alias catalogue (unknown parameter FAILS THE ROW — nothing is invented), sample date must parse if present, latitude in [-90,90], longitude in [-180,180]. Invalid rows are recorded in `import_errors` with the original row JSON; the job summary reports total/valid/invalid/duplicate/imported counts.
- **CGWB laboratory measurements:** supported as `record_type = LABORATORY_MEASUREMENT` (source_organization e.g. "CGWB"); value + unit stored, provenance kept verbatim.
- **JJM-WQMIS WQ6 contamination summaries:** supported as `record_type = CONTAMINATION_SUMMARY`; the affected-village count goes into the dedicated `affected_village_count` integer column and is NEVER written into `value`/`unit`. DB CHECK constraint enforces this split.
- **Affected-village-count handling:** strictly separated from concentrations at every layer (UI field, zod schema, SQL column, CHECK constraint). This is a permanent project rule.
- **Parameter handling:** curated catalogue of 40 parameters (see section 7) with normalised alias matching (e.g. "E-coli." -> `e_coli`); canonical parameters auto-register into the `parameters` table on first use with their display name and default unit; unknown names reject the row.
- **Location handling:** state/district/block/GP/village/water-source are stored as verbatim TEXT columns on `government_records` (provenance first); they are NOT linked into the normalized location tables. Latitude/longitude are optional numeric columns.
- **Provenance:** every import creates a `government_datasets` row (source_organization, dataset_name, dataset_year, source_url, imported_at); every record carries `original_row_reference` (source spreadsheet row number) and the dataset FK; failures keep the full original row in `import_errors`.

**Has REAL government data actually been imported? NO.** `government_datasets` and `government_records` both contain 0 rows (verified read-only on 2026-09-02). No government dataset files exist in the repository either — the pipeline is built and untested against a real file. **The importer pipeline is REAL and COMPLETE as code, but has never run against actual government data.**

## 7. CURRENT GOVERNMENT PARAMETERS

The importer's curated catalogue (`server/src/services/governmentImport.ts`) supports 40 parameters, including all of the following. Parameter support below means "the importer/API/database accept and store this parameter from government/reference data" — **the ESP32 measures NONE of these except temperature and turbidity** (see section 8).

| Parameter | Catalogue code | Default unit | Measured by prototype hardware? |
| --- | --- | --- | --- |
| pH | `ph` | (dimensionless) | No — MANUAL chemical test |
| TDS | `tds` | ppm | No — MANUAL external meter |
| Turbidity | `turbidity` | NTU | Yes — ESP32 |
| Temperature | `temperature` | °C | Yes — ESP32 (DS18B20) |
| Fluoride | `fluoride` | mg/L | No — government/reference data only |
| Iron | `iron` | mg/L | No — government/reference data only |
| Nitrate | `nitrate` | mg/L | No — government/reference data only |
| Nitrite | `nitrite` | mg/L | No — government/reference data only |
| Conductivity | `conductivity` | µS/cm | No — government/reference data only |
| Arsenic | `arsenic` | mg/L | No — government/reference data only |
| E. coli | `e_coli` | MPN/100mL | No — government/reference data only |
| Total Coliform | `total_coliform` | MPN/100mL | No — government/reference data only |
| Faecal Coliform | `faecal_coliform` | MPN/100mL | No — government/reference data only |

Additional catalogue parameters: Chloride, Sulphate, Total Hardness, Calcium, Magnesium, Sodium, Potassium, Alkalinity, Bicarbonate, Dissolved Oxygen, BOD, COD, Salinity, Aluminium, Cadmium, Chromium, Lead, Copper, Manganese, Zinc, Nickel, Selenium, Cyanide, Ammonia, Phosphate, Boron, Uranium (µg/L). The dashboard's live sensor cards show only temperature, turbidity, pH, TDS; government parameters surface through the Government Data page tables and the importer — there is no dashboard widget yet that overlays government parameter values with live readings.

## 8. HARDWARE STATUS

**Current physical prototype boundary** (agreed project scope):

| Layer | Parameter | Physical status |
| --- | --- | --- |
| **ESP32** | Temperature | Software path complete (DB + Firebase schemas, API, UI). **NO physical device ever connected — zero real readings recorded** |
| **ESP32** | Turbidity | Same as above |
| **Manual** | pH | UI + DB path complete (`/api/manual/ph` + Firebase write). No physical kit integration — operator types the value from a manual chemical test |
| **Manual** | TDS | UI + DB path complete (`/api/manual/tds` + Firebase write). Operator types the value read from an external TDS meter |
| **Government** | Fluoride, Arsenic, Iron, Nitrate, Conductivity, E. coli, Total Coliform + ~27 more catalogue parameters | Software support only (import/storage/display). **These are NOT measured by any hardware in this project** and must come from government/reference data |

**SOFTWARE SUPPORT vs ACTUAL PHYSICAL HARDWARE CONNECTION — the distinction that matters:**

- SOFTWARE SUPPORT (complete): ESP32 HTTP ingestion endpoint + zod validation; Firebase RTDB node schema for live current/history/pump/alerts/ai; manual pH/TDS submission UI; DB storage for all of it; dashboard display incl. per-sensor source labels ("ESP32 -> Firebase", "Manual Chemical Test", "External TDS Meter"); CoverageRow that visibly marks pH/TDS/ESP32 coverage.
- ACTUAL PHYSICAL HARDWARE (nothing): no ESP32 has ever posted a reading (0 rows in `sensor_readings`, no `devices` row); no relay/pump wiring exists; the pump path stops at a queued DB command / a Firebase node write. Nothing in the repo has been validated against real hardware, and this document deliberately makes no such claim.

## 9. FIREBASE STATUS

**Implemented** (`src/lib/firebase.ts`, `src/services/firebaseService.ts`, `src/hooks/useWaterData.ts`):

- Optional-at-runtime client for Firebase Realtime Database; config read from `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`.
- Node paths (`PATHS`): `waterMonitoring/current`, `waterMonitoring/history`, `waterMonitoring/pump`, `waterMonitoring/alerts`, `waterMonitoring/ai`.
- Live subscriptions (`onValue`) for current readings, history (limited window), pump state, alerts; graceful "Not Connected" degradation on every page; last init error surfaced on the Settings page.
- Writes implemented: manual measurement save (current + history push), pump command write (command + cycle bookkeeping), alert acknowledge, AI result mirror.
- Mode handling: `localStorage['aquasense.mode.v1']` switches between REAL DATA and DEMO MODE; `demoService.ts` supplies clearly-labelled simulated values only in DEMO MODE.
- Auth: none (no sign-in implemented); RTDB security depends on the project's own database rules once credentials are provided.

**NOT implemented / NOT done:** Firebase has **never been configured on this machine** — `.env` contains no `VITE_FIREBASE_*` values (only DB/AI/server settings), so `initializeFirebase()` fails with "Firebase is not configured" and every Firebase-backed page shows its not-connected state. No Firebase project exists as far as this repo shows; no real RTDB has ever been written to or read from by this app. The ESP32-to-Firebase publishing firmware is also not part of this repo.

## 10. ESP32 STATUS

- **Endpoint:** `POST /api/device/readings` (Express, port 3001). Strict zod payload: `deviceCode` (string), `temperature` (number), `turbidity` (number), optional `observedAt` (ISO). Nothing else accepted — temperature and turbidity ONLY, by design.
- **Payload:** JSON, e.g. `{"deviceCode":"ESP32-001","temperature":27.4,"turbidity":3.2,"observedAt":"2026-09-02T10:00:00Z"}`. The device must already exist in the `devices` table (by `device_code`) and be linked to a water source; unknown device -> 404, offline device -> 409.
- **Storage:** rows inserted into `sensor_readings` (temperature, turbidity, observed_at) and the device's `last_seen_at`/`online` are updated in PostgreSQL. A separate optional path expects the device firmware itself to publish the same values to Firebase `waterMonitoring/current` + `history` for the browser live view.
- **Dashboard integration:** complete in code — `LiveMonitoringPage` and the Dashboard sensor cards subscribe to the Firebase nodes; `GET /api/readings/latest` and `GET /api/sensor/history` expose the PostgreSQL side; `HistoryPage` charts both ESP32 parameters.
- **Has actual physical ESP32 communication been tested? NO.** `sensor_readings` = 0 rows, `devices` = 0 rows, no firmware code exists in this repo (no `.ino`/PlatformIO project), and no device has ever hit the endpoint. The API is ready but entirely unexercised. Do not assume connectivity.

## 11. MANUAL pH/TDS STATUS

- **UI:** `ManualMeasurement.tsx` panel on the Dashboard (Manual Testing) — numeric pH and TDS inputs with source labels ("Manual Chemical Test" / "External TDS Meter"); writes through `saveManualMeasurement()` in `firebaseService.ts` to Firebase `current` + `history` with timestamp; values appear immediately in sensor cards, CoverageRow, quality scoring, and charts.
- **API:** `POST /api/manual/ph` and `POST /api/manual/tds` (zod-validated; TDS requires value > 0) insert into `manual_measurements` with source `MANUAL_CHEMICAL_TEST` / `EXTERNAL_TDS_METER`, unit, tested_at, optional operator_name/notes. `GET /api/manual/measurements` and `GET /api/readings/latest` expose the stored history. `ensureManualParameter` lazily registers the `ph`/`tds` parameter rows on first use.
- **Database:** `manual_measurements` table (see section 5); currently 0 rows; requires an existing water_source_id, and no water sources exist yet.
- **Dashboard behaviour:** pH/TDS cards show "No data" until an entry exists; CoverageRow lists them as available once present; the rule engine includes them in scoring; History charts pH/TDS from the same data.
- **KNOWN ARCHITECTURAL GAP:** the frontend manual entry currently writes to **Firebase only** — it does NOT call the `/api/manual/*` PostgreSQL endpoints. PostgreSQL is the declared source of truth, so a follow-up task should route (or mirror) manual submissions into `manual_measurements`. Until then, manual values entered in the UI exist only in Firebase (or in DEMO MODE, nowhere persistent at all).

## 12. AI STATUS

There are TWO engines, and the difference matters:

1. **Rule-based quality engine (deterministic, NOT an AI model):** implemented twice, consistently — frontend `src/utils/quality.ts` + `src/utils/trends.ts` (`ruleBasedAnalysis`, `computeQuality`, `detectTrends`, `explainReading`) and server-side `server/src/services/aiProxy.ts` (`buildResult`). It threshold-checks turbidity/pH/TDS, derives a 0–100 score (penalty per warning/critical), status GOOD/MODERATE/POOR/CRITICAL, risk LOW/MEDIUM/HIGH, detects sudden changes vs a recent baseline, and always emits limitations stating the sensors do NOT certify drinking-water safety. Engine label: `RULE_BASED`.
2. **Actual AI (optional LLM):** `POST /api/ai/analyze` calls **Gemini 2.0 Flash** (`gemini-2.0-flash:generateContent`) ONLY when `GEMINI_API_KEY` is set in the server environment. Secrets stay server-side (the frontend never sees the key). The prompt forbids claiming the water is definitely safe and requires plain-language output; the JSON response is parsed and merged over the rule-based baseline (score clamped 0–100); on any error it silently falls back to `RULE_BASED`. Engine label: `GEMINI`.

- **AI API key status:** `GEMINI_API_KEY` is referenced by the server but **no real analysis has been run** — the key is not confirmed configured on this machine, and `ai_analyses` has 0 rows. Frontend `analyzeWater()` (`src/services/aiServe.ts`) tries the backend proxy first and falls back to the local rule engine if the API is unreachable.
- **Placeholder functionality:** none — the fallback path is real logic, not stubbed text. But the fallback is deterministic rule evaluation, and the UI labels the engine honestly (an `engine` field is shown on the AI Analysis page as RULE_BASED or GEMINI).
- **Stored analysis:** the `ai_analyses` table (request_data/response_data jsonb) exists for persistence but **nothing currently writes to it** — the frontend mirrors results to Firebase `waterMonitoring/ai` instead. Persisting server-side AI results to PostgreSQL is an open gap.
- **Summary for reviewers:** calling the current default behaviour "AI" is inaccurate — out of the box it is a **rule-based monitoring engine**; it becomes an LLM analysis only when the operator configures a Gemini key.

## 13. PURIFICATION STATUS

- **Purification page:** `PurificationPage` renders the PumpControl panel, current temperature/turbidity cards, and safety notes; live state via Firebase.
- **Recommendation logic:** the AI/rule-engine result includes a textual `recommendation` ("Continue normal filtration and re-test periodically." / recovery advice when issues exist) and `simpleExplanation` for non-technical users. There is **no filter-specific or stage-based purification recommendation engine** yet (no cartridge/UV/RO selection logic).
- **Pump control:** operator clicks START/STOP in `PumpControl.tsx` -> `sendPumpCommand()` writes the command (and bookkeeping) to Firebase `waterMonitoring/pump`; RUNNING/IDLE status shown is only what that node reports — the UI never assumes the pump state. The parallel backend route `POST /api/pump/command` queues START/STOP into the `pump_commands` table (status PENDING, 409 if the device is offline) — **the frontend currently does not call this route** (same Firebase-vs-PostgreSQL split as manual measurements).
- **Relay integration:** NOT implemented. There is no code, firmware, or hardware to consume the queued command — no firmware exists in this repo at all. Whatever consumes `pump_commands` or the Firebase pump node is entirely future work.
- **Physical hardware status:** none. No pump, no relay, no wiring has ever been connected or tested. The project rule stands: AI never activates pumps automatically; every command is an explicit operator action.
- **Safety framing:** the UI states the dashboard only writes a command and the ESP32 relay would do the switching, and that RUNNING/IDLE is reported by firmware, never assumed here.

## 14. REAL DATA / DEMO STATUS

Result of a full code search for `demo`, `DEMO MODE`, `sample`, `fake`, `hardcod`, `placeholder`, `mock`, and known demo numbers (e.g. `7.1`, `380`, `27 +`):

**Where simulated data REMAINS (all inside the clearly-labelled DEMO MODE path):**

1. `src/services/demoService.ts` — the ONLY simulated-data module. Contains: `demoCurrent()` (temperature `27 ± 1.2 °C` sine wave, turbidity `4 ± 2 NTU`, hardcoded `ph: 7.1`, `tds: 380`, `pumpStatus: true`, `esp32Online: true`); `demoHistory()` (300 generated points, same generators, `ph: 7.4`, `tds: 380`); `demoPump()` (`RUNNING`, cycleCount 4); `demoAlerts()` (empty); `tickDemo()` clock advance; `DEMO_LIVE = true`.
2. `src/hooks/useWaterData.ts` — the DEMO MODE branch (~lines 92–99): when mode === 'DEMO MODE' it populates the above demo data and advances it every 60 s via `demoAdvance`. REAL DATA mode subscribes to live Firebase instead. Mode persists in `localStorage['aquasense.mode.v1']` and **DEMO MODE is the default** when nothing is stored, so a fresh run on this machine shows simulated values.
3. `src/components/ui.tsx` — `DemoBanner`: persistent banner "DEMO MODE — showing generated sample values, not real sensor data. Switch to REAL DATA in Settings." rendered at the top of the shell whenever DEMO MODE is active.
4. `src/types.ts` — `DataMode = 'REAL DATA' | 'DEMO MODE'` (type definition only).
5. `database/migrations/001_initial_schema.sql` — `source_type` enum includes `'DEMO'` (schema capability only; **unused** — no row anywhere uses it).

**Non-data "demo-like" strings found (harmless):** input placeholders in `ManualMeasurement.tsx` ("e.g. 7.1", "e.g. 380" — typing hints, never submitted as data); `scripts/prooo-extracted.txt` (a PDF-text extraction artifact containing "TDS 380 ppm / External TDS Meter" example text — documentation debris, not app data); UI hint placeholders like "As printed in the publication" in the importer.

**What does NOT exist (confirmed by search):** no fake villages, no sample water sources, no hardcoded government values or contamination counts, no fake quality scores, no fixture/seed data files, no mock API responses. `src/providers/governmentProvider.ts` states and implements "no placeholder datasets are ever created" — the government tables read only real imported rows (currently zero). `docs/DATABASE_SETUP.md` documents the same policy ("There is no demo mode [in PostgreSQL], and no fixture data ships with the application" — i.e. the DEMO MODE simulation lives only in the browser's Firebase/live layer, never in PostgreSQL).

**Overall:** REAL DATA path is real but inert on this machine (Firebase unconfigured, DB empty, no hardware). DEMO MODE is the only place fabricated values exist, it is always banner-labelled, and it never writes to PostgreSQL.

## 15. BUILD STATUS

Actual results recorded on 2026-09-02 (re-run during this audit; no source files modified):

| Command | Result |
| --- | --- |
| `npx tsc -b` | **PASS — 0 errors** (empty output) |
| `npm run build` (tsc -b && vite build) | **PASS — built successfully** (~0.7 s on this machine; 615 modules in an earlier run). Non-blocking warnings only: chunks larger than 500 kB after minification, with rolldown code-splitting suggestions. No type or bundling errors. |
| `npm run server:build` (tsc -p server/tsconfig.json) | **PASS — 0 errors** (only the script banner in output) |

Scripts available (`package.json`): `dev` (vite), `build`, `server` (tsx server/src/index.ts), `server:build`, `db:migrate`, `lint` (oxlint), `preview`. `lint` is not part of `build`.


## 16. KNOWN LIMITATIONS

1. **No real data anywhere yet:** every data table in PostgreSQL is empty; no government file has ever been imported; no ESP32 reading has ever been recorded; Firebase has never been configured. The full pipeline is unexercised end-to-end.
2. **Firebase/PostgreSQL split:** the frontend live path (current/history/pump/alerts/AI/manual) talks to Firebase RTDB, while PostgreSQL is the declared source of truth with parallel API routes the frontend does not call (`/api/dashboard`, `/api/manual/*`, `/api/pump/command`, alerts, readings). Reconciling the two paths is the biggest architectural task ahead.
3. **`ai_analyses` is never written** — AI results persist only to Firebase `waterMonitoring/ai`, not PostgreSQL.
4. **No ESP32 firmware exists in the repo** — no `.ino`/PlatformIO project, no WiFi/relay/sensor code, and nothing publishes to Firebase from a device.
5. **No relay/pump hardware integration** — `pump_commands` rows are queued but nothing consumes them.
6. **`water_quality_standards` table is empty** — the schema supports official references (BIS/IS 10500) but no standards are seeded; the rule engine uses client-editable thresholds from localStorage instead.
7. **Government parameter overlay missing** — government records are importable and listable, but there is no dashboard view joining them with live/manual readings for one water source.
8. **DEMO MODE is the default** on first run (localStorage-persisted); simulated values appear banner-labelled until the operator switches to REAL DATA (which then shows not-connected states until Firebase is configured).
9. **No authentication/authorization** — neither the Express API nor Firebase has auth; API routes are unguarded on the local network.
10. **`GET /api/dashboard` does not power the UI** — the aggregate endpoint exists but the React app never calls it.
11. **Manual pH/TDS entry does not persist to PostgreSQL** (Firebase only) — see section 11.
12. **No tests** — no unit/integration/e2e test suite exists.
13. **Stray artifacts** in `scripts/` (`prooo-extracted.txt`, `cmap-debug.txt`, `extract-pdf.mjs`) — one-off PDF extraction debris, candidates for deletion.
14. **react-router-dom is installed but unused** — navigation is custom state-based; either adopt the router or drop the dependency.
15. **AI depends on one key** (`GEMINI_API_KEY`); without it everything is RULE_BASED; with a bad key it silently falls back.
16. **No CI, no lint gate in build** (`lint` script exists — oxlint — but is not run by `build`).

## 17. COMPLETED FEATURES

Only genuinely completed and verified items:

- PostgreSQL schema (18 tables + 2 enums + indexes) with migration tooling; applied and reachable; all-data-empty state verified.
- Express 5 API with 20 routes: dashboard aggregate, locations hierarchy, water sources, devices, sensor history, manual pH/TDS ingest + history, alerts + acknowledge, ESP32 device ingest (strict temperature/turbidity-only validation), government datasets/records/summary, validate-only preview, full import with per-row errors + duplicate detection, pump command queue (offline guard), AI proxy with rule fallback.
- Government CSV/XLSX import pipeline end-to-end as code: browser-side sheet reading, 13-field column mapping UI, record-type-aware validation (LAB value vs summary affected-village count), 40-parameter catalogue with alias matching, auto-registration of canonical parameters, verbatim location provenance, `import_jobs`/`import_errors` audit trail; WQ6 affected-village counts strictly isolated from concentrations at UI, zod, column, and CHECK-constraint level.
- React 19 frontend: 8 working pages (Dashboard, Live Monitoring, History with recharts time-windowed charts, Purification, AI Analysis, Alerts, Settings with REAL/DEMO switch + editable thresholds, Government Data with importer + filtered tables), sidebar shell, connection-status dot, DEMO banner, empty/error/loading states everywhere, no-data-never-means-safe disclaimers, explain modal.
- Manual pH/TDS entry UI writing to Firebase current+history with source labels.
- Rule-based water-quality engine (frontend + server versions): threshold scoring, status/risk, trend/sudden-change detection, plain-language explanation, mandatory potability caveats.
- AI assistant plumbing: server-side Gemini 2.0 Flash proxy (key never in the browser), JSON-parsed LLM result merged over the rule baseline, honest engine labelling (RULE_BASED vs GEMINI), frontend fallback when the API is down.
- Pump START/STOP UI (Firebase node write) + backend command queue with device-online guard; operator-only by design.
- Optional DEMO MODE, fully isolated from PostgreSQL and always banner-labelled.
- Builds verified on 2026-09-02: `tsc -b`, `vite build`, and server `tsc` all pass with 0 errors (section 15).

## 18. NEXT DEVELOPMENT PHASE

**Not implemented — recommended order only. Do not start these without re-reading sections 14, 16, and 19.**

- **Phase 1 — Real government data import/testing:** obtain real CGWB laboratory and JJM-WQMIS WQ6/WQ4 files; dry-run through `POST /api/government/preview`; fix mapping/validation gaps found; then import for real; verify counts, provenance, and that affected-village counts never land in `value`.
- **Phase 2 — ESP32 physical integration:** write device firmware (DS18B20 + turbidity, WiFi, HTTP POST to `/api/device/readings`, optional Firebase publish), register a real device row + water source, verify readings end-to-end in both PostgreSQL and the dashboard.
- **Phase 3 — Manual pH/TDS integration:** route (or at least mirror) UI submissions into `/api/manual/ph|tds` so `manual_measurements` becomes the persistent record; wire water-source/device master data first.
- **Phase 4 — Water-quality standards engine:** seed `water_quality_standards` with OFFICIAL_REFERENCE rows (e.g. IS 10500) from cited documents (no invented limits), keep MONITORING_THRESHOLD rows separate, evaluate against imported + measured parameters.
- **Phase 5 — AI Water Intelligence:** configure `GEMINI_API_KEY`, persist results to `ai_analyses`, extend prompts to include government parameter context, keep honest engine labelling.
- **Phase 6 — Purification recommendation:** map detected issues (incl. government parameters) to treatment guidance; still advisory text, no auto-actions.
- **Phase 7 — Pump/relay integration:** relay firmware consuming `pump_commands` (or the Firebase pump node), status reporting back, safety interlocks.
- **Phase 8 — Before/after purification analysis:** capture paired readings around purification cycles; quantify improvement; strictly compare same-parameter, same-source values.
- **Phase 9 — Historical analytics:** longer retention, aggregation, export; reconcile Firebase history window with PostgreSQL as the durable store.
- **Phase 10 — Final production testing:** end-to-end dry runs, lint/test gates, deployment hardening, documentation refresh (README currently still contains Vite-template boilerplate).

## 19. IMPORTANT PROJECT RULES

Permanent rules for every future contributor and agent:

- **PostgreSQL is the source of truth.** Firebase is a live-view/transport layer for the browser; authoritative history belongs in `smart_water`.
- **No invented data.** Empty tables render "No data available" states; never fabricate rows, defaults, or fallback numbers.
- **No fake government values.** Government data enters only through the import pipeline with provenance.
- **No fake sensor values.** Sensor panels show real device data or an explicit not-connected state.
- **No fake villages.** No sample/hardcoded village, district, or water-source names anywhere.
- **No fake contamination counts.** Counts come only from imported official summaries.
- **WQ6 affected-village counts must never be treated as contaminant concentrations.** They live in `affected_village_count` only — never in `value`/`unit`, never plotted on concentration charts.
- **ESP32 currently measures only temperature and turbidity.** Any other "sensor" claim is false until hardware is actually added.
- **pH and TDS are manual measurements** (`MANUAL_CHEMICAL_TEST`, `EXTERNAL_TDS_METER`).
- **Fluoride, arsenic, iron, nitrate, conductivity, E. coli, total coliform and other non-prototype parameters come from government/reference data unless hardware is actually added.**
- **Missing data must never be interpreted as safe.** Absence of a reading is not compliance; the UI must show gaps (CoverageRow) and caveats.
- **Every government result must preserve provenance** (dataset, organization, source URL, original row reference, verbatim location text).
- **Do not claim potable/safe water certification solely from this software.** Monitoring thresholds are not drinking-water standards; microbiological and additional chemical testing may be required. This caveat is embedded in the UI and the AI prompts and must stay.
- Supplementary: AI never activates pumps automatically — pump commands are operator-initiated only.

## 20. CONTINUE EXTENSION HANDOFF

Quick orientation for the next agent:

- Start commands: `npm run db:migrate` (already applied), `npm run server` (API on 3001), `npm run dev` (Vite). Env in `.env` (see `.env.example`); Firebase `VITE_FIREBASE_*` and `GEMINI_API_KEY` are the two likely-missing pieces.
- Docs in `docs/`: `DATABASE_SETUP.md`, `GOVERNMENT_DATA.md`, `ESP32_API.md`, `AI_ENGINE.md`.
- The two highest-value architectural fixes are the Firebase/PostgreSQL split (limitation 2) and Phase 1 real-data import.

**NEXT SESSION INSTRUCTION**

Read PROJECT_STATUS.md completely before modifying the project. Inspect the current code/database state yourself. Do not assume requested features are implemented. Continue only from the actual current state. Do not create fake data.

STOP — this document is the handoff. No further implementation was performed after it was written.

---

## 21. PHASE 1 DRY RUN — REAL JJM-WQMIS WQ6 FILE (2026-09-03)

Executed exactly as prescribed: preview-only (`POST /api/government/preview`), import endpoint never called, no source code modified, no data created.

**File used:** `C:\Users\DELL\Downloads\Format WQ6. Contaminant wise details of villages where in water samples were found contaminated(PWS Sources test from Lab).xls` (27,441 bytes, real government export; Sheet2 provenance inside the file: "Source: https://ejalshakti.gov.in", "Report Printed On 8/26/2026 8:46:42 PM" — no dataset year is stated in the file, so `datasetYear` was left unset).

**Config used:** sourceOrganization `JJM-WQMIS`, recordType `CONTAMINATION_SUMMARY`, sourceUrl `https://ejalshakti.gov.in` (taken from the file's own Sheet2).

**Actual file structure (wide format):** Sheet1 `A1:R39` — 3 merged header rows (row 1: "S.No." / "State" / "No. of villages wherein contamination found in samples"; row 2: "Chemical Contaminants" / "Bacteriological Contamination"; row 3: the 16 real contaminant column names), then a national `Total` row, then 35 state/UT rows. Each cell = COUNT of affected villages for that state × contaminant. The 16 contaminant columns: pH, TDS, Turbidity, Chloride, Total Alkalinity, Total Hardness, Sulphate, Iron, Total Arsenic, Fluoride, Nitrate, Residual Chlorine, Others (chemical), E. coli, Total Coliform, Others (bacteriological).

**Preview results:** totalRows 38 (2 header rows + 1 Total row + 35 state rows, because the importer assumes a single header row), validRows 0, invalid 38. RUN 1 (parameter unmapped): all 38 rows fail "Column mapping for parameter is required." RUN 2 (parameter best-effort mapped to the State column): 32 rows fail with the state name not in the catalogue + 4 rows with empty parameter. Both runs returned HTTP 200 — the endpoint itself works.

**Zero-write proof:** identical counts immediately before and after — all 11 production tables plus `import_jobs`, `import_errors`, `water_quality_standards`, `states`, `districts`, `blocks`, `gram_panchayats` = 0. `previewGovernmentFile()` confirmed by code inspection to never touch `pool`.

**Verdict: the current importer CANNOT ingest this file — code changes are REQUIRED (blocked, awaiting approval).** Root cause: the pipeline is long-format only (one `parameter` column + one `affectedVillageCount` column), while WQ6 is wide-format (one column per contaminant, counts in cells; parameter identity lives in spreadsheet row 3, unreachable by the mapper). No operator mapping can express this. Smallest required changes: (1) an unpivot/wide-mode in the import config (map the state column + contaminant-column→parameter-code pairs, emitting one record per state×contaminant cell); (2) a configurable header row (`sheet_to_json` range offset) so keys come from row 3 and header/Total rows are skipped; (3) two alias additions: "Total Alkalinity"→`alkalinity`, "Total Arsenic"→`arsenic`; (4) deliberate decisions on Residual Chlorine (new catalogue parameter or skip) and the two "Others" columns (skip). Of the 16 columns, 11 already resolve to the catalogue (pH, TDS, Turbidity, Chloride, Total Hardness, Sulphate, Iron, Fluoride, Nitrate, E. coli, Total Coliform).

**Status after dry run: STOPPED per operator instruction — no import performed, no fixes applied.**

### 21a. PHASE 1 EXECUTED — APPROVED CHANGES + REAL IMPORT (2026-09-04)

The operator approved the minimal change set AND the real import (preview-first gate). All of it was executed and verified:

**Code changes (server only; frontend untouched):**
1. `server/src/validation.ts` — `importSchema` extended with optional `headerRow` (0-based) and optional `wide` config `{ labelColumn, dataStartRow?, measures: [{ column, parameter }] }`. Long-format payloads validate exactly as before.
2. `server/src/services/governmentImport.ts` — new `readSheet()` helper (single code path for preview + import; legacy behaviour preserved when no `headerRow`/`wide`); wide-format branch in `previewGovernmentFile` and `importGovernmentFile` (one record per state×contaminant cell; aggregate rows labelled `Total`/`Grand Total` are skipped, never imported as locations); every column additionally addressable by stable positional key `__COL_<i>` (merged-header immunity); two alias additions (`totalalkalinity`→`alkalinity`, `totalarsenic`→`arsenic`); one deliberate catalogue extension: `residual_chlorine` ("Residual Chlorine", mg/L). The two "Others" columns are deliberately NOT imported (not parameters).
3. Duplicate detection extended with `state_name` for wide imports.

**Builds after changes:** `npm run server:build` PASS, `npx tsc -b` PASS (0 errors).

**Preview gate (before import):** HTTP 200 — totalRows 476 (= 34 states × 14 measures), validRows 476, invalid 0, skippedRows 2 (the file's two `Total` rows). Gate condition `validRows===476 && issues===0` held → import authorised.

**Real import (POST /api/government/import):** HTTP 201 — job `32876b2c-e564-4567-b883-06f5011a3538`, status COMPLETED, total_rows 36 (data rows: 34 states + 2 Totals), valid_rows 476, invalid_rows 0, duplicate_rows 0, imported_rows 476, errors [].

**Post-import verification (all read-only):**
- Per-parameter SUMs match the file's own national `Total` row exactly: pH 832, TDS 1297, Turbidity 2306, Chloride 480, Total Alkalinity 665, Total Hardness 3204, Sulphate 307, Iron 1971, Total Arsenic 282, Fluoride 2217, Nitrate 5701, Residual Chlorine 51, E. coli 4640, Total Coliform 7122. (The two "Others" columns, national totals 0, were skipped — nothing lost.)
- Integrity: 476 records, 34 distinct `state_name`s, **`value` is NULL on all 476** (village counts never stored as concentrations — the project rule held end-to-end), `affected_village_count` NULL on none.
- Spot check vs the file's own row: Andaman & Nicobar Islands — Turbidity 3, E. coli 2, Residual Chlorine 1, all others 0 ✓.
- Provenance stored: dataset row (source_organization `JJM-WQMIS`, dataset name as printed, source_url `https://ejalshakti.gov.in`); every record carries its source spreadsheet row in `original_row_reference`; `sample_date`/coordinates left NULL (the file contains none).

**Current PostgreSQL counts (2026-09-04, after import):** `government_datasets 1, government_records 476, parameters 14, import_jobs 1 (COMPLETED), import_errors 0`; all other tables still 0 (sensor_readings, manual_measurements, water_sources, devices, villages, alerts, pump_commands, ai_analyses).

**Known follow-up:** the React importer UI (`GovernmentImport.tsx`) does not yet expose wide-mode mapping — this import was driven through the API. UI support for wide files is a small follow-up task.

---

## 22. PHASE 2 — REAL PROTOTYPE DATA PIPELINE (2026-09-04)

**Audit conclusion first:** the storage layer for ESP32 temperature/turbidity and manual pH/TDS already existed and was correct (schema, zod validation, device-existence 404, provenance columns). The real gaps were: manual endpoints returned 500 (FK leak) for a nonexistent water source, no single database-backed GET for the dashboard, and the frontend's REAL DATA mode still read Firebase instead of PostgreSQL. Those are now fixed.

**Files changed:**
- `server/src/index.ts` — (1) `POST /api/manual/ph|tds` now verify water-source existence and return 404 (was FK-violation 500); (2) NEW `GET /api/readings/current?waterSourceId=` — one PostgreSQL-backed payload: water source (name/type/village/district/state), device (code/online/lastSeenAt), latest temperature + turbidity (ESP32, with device provenance), latest pH + TDS (manual, with source + operator), and merged 7-day history in the UI's shape. Missing data → nulls/empty, never 0/mock.
- `src/services/apiService.ts` (NEW) — typed API client for the REAL path (fetchWaterSources, fetchCurrentPayload, postManualReading).
- `src/hooks/useWaterData.ts` — REAL DATA mode now reads PostgreSQL through the API (30 s polling, water-source selection persisted in `localStorage['aquasense.source.v1']`, auto-selects the only source, exposes waterSource/waterSources/sourceId/setSourceId/refresh/apiOnline). Firebase removed from the REAL path (kept for the future ESP32-direct-publish option); DEMO MODE unchanged.
- `src/components/ManualMeasurement.tsx` — submits via `POST /api/manual/ph|tds` (was Firebase); requires a selected water source; refreshes the dashboard on save.
- `src/types.ts` — added `WaterSourceInfo`, `LatestValue`, `CurrentPayload`.
- `src/App.tsx` — header dot + Settings Connection panel now show API/PostgreSQL status (was Firebase); water-source selector added to Settings; Dashboard header shows the active water source.
- `scripts/register-source.mjs` (NEW) — operator tooling to register the REAL hierarchy (state→district→block→GP→village), water source, and device. Idempotent find-or-create; refuses empty/placeholder values; inserts nothing until run with real values (NOT run during Phase 2 — the operator must supply the real location identity).

**Builds after changes:** `npx tsc -b` PASS (0 errors), `npm run build` (vite) PASS, `npm run server:build` PASS.

**Validation tests (negative paths only — nothing inserted, server verified):** out-of-range temperature → 400; unknown device → 404; manual pH with unknown water source → 404; negative pH → 400; missing TDS value → 400; `/readings/current` with unknown source → 404; `/water-sources` → `{"sources":[]}`; `/readings/latest` for an empty source → `{sensor:null,manual:[]}`. All 8 PASSED.

**Data integrity:** government counts unchanged before/after (`government_datasets 1, government_records 476, parameters 14, import_jobs 1, import_errors 0`); spot totals still match the source file (nitrate 5701, E. coli 4640, Total Coliform 7122) and `value IS NOT NULL` count is still 0. `sensor_readings 0 → 0`, `manual_measurements 0 → 0` (no fake readings created). Server stopped after tests; port free.

**Remaining work (not started):** operator must run `scripts/register-source.mjs` with the REAL village/source/device identity before the pipeline can carry actual measurements; ESP32 firmware (Phase 2 hardware side); pump UI → `/api/pump/command` (Phase 7); stored alert generation (Phase 4); AI persistence to `ai_analyses` (Phase 5).

---

## 23. PHASE 3 — DETERMINISTIC WATER QUALITY ANALYSIS ENGINE (2026-09-04)

**Files changed:** `server/src/services/waterQualityEngine.ts` (NEW — pure `classifyParameter()` rule + `analyzeWaterQuality(pool, waterSourceId)` orchestration); `server/src/index.ts` (NEW `GET /api/water-quality/analysis?waterSourceId=`); `src/types.ts` (`Page` union + `WQParameterStatus`/`WQStandard`/`WQParameterAssessment`/`WaterQualityAnalysis`); `src/services/apiService.ts` (`fetchWaterQualityAnalysis`); `src/App.tsx` (NEW `WaterQualityPage` — CURRENT WATER QUALITY / MISSING–NOT MEASURED / EVIDENCE SUMMARY / OVERALL STATUS panels, "Water Quality" nav entry 🧪, "No data available" empty states).

**Analysis logic (fully deterministic — no AI, no randomness):**
- Reads ONLY real PostgreSQL measurements: latest `sensor_readings` row (ESP32 temperature + turbidity, device provenance) and latest manual pH/TDS per parameter from `manual_measurements` (source + operator provenance).
- Per measured parameter: `WITHIN_LIMIT` / `ABOVE_LIMIT` (with critical-threshold note when exceeded) / `BELOW_LIMIT` / `NO_STANDARD_AVAILABLE`; value 0 on chemical/microbial parameters is explicitly flagged `NOT_DETECTED` (distinct from `NOT_MEASURED`).
- Standards come ONLY from `water_quality_standards` (prefers `MONITORING_THRESHOLD`, then latest `effective_date`) — the table is currently EMPTY, so every measurement honestly reports `NO_STANDARD_AVAILABLE` and compliance is never graded. NO standards were invented or seeded.
- Parameters without a current measurement (fluoride, arsenic, iron, nitrate, chloride, sulphate, hardness, E. coli, total coliform, conductivity, residual chlorine, + registry) are listed as `NOT_MEASURED` — never SAFE. Checklist = prototype list ∪ `parameters` registry.
- Overall status ladder: `NO_DATA` → `EXCEEDS_STANDARD` → `PARTIAL_EVIDENCE` (measured but some standards missing) → `WITHIN_MEASURED_LIMITS` (measured-only, explicit non-certification caveat). Evidence sufficiency is reported separately (`NO_DATA` / `INSUFFICIENT_EVIDENCE` / `ACTION_EVIDENCE` / `ADEQUATE_FOR_MEASURED_PARAMETERS`).
- Government records are NOT combined with current measurements; WQ6 counts remain untouched in `affected_village_count`.

**Builds:** `npx tsc -b` PASS (0 errors), `npm run build` PASS, `npm run server:build` PASS.

**Tests:** 7/7 pure-classifier unit tests PASS (no standard, within, above limit, critical breach wording, below limit, warning-within-limit). API tests: bad UUID → 400, unknown water source → 404 (nothing inserted; the empty-measurement `NO_DATA` path was code-reviewed + the frontend renders "No data available" for it).

**Database:** unchanged — `government_datasets 1, government_records 476, parameters 14, import_jobs 1, import_errors 0`; `sensor_readings 0`, `manual_measurements 0`, `water_quality_standards 0` (standards seeding from official documents is Phase 4 operator work — none invented here). Server stopped after tests; port free.

**Remaining work:** seed `water_quality_standards` from official documents (operator, cited sources — Phase 4); real measurements require the Phase 2 master-data registration; frontend still polls — swap to a push mechanism later if needed.

---

## 24. PHASE 4 — OFFICIAL STANDARDS + AI DECISION ENGINE (2026-09-04)

### Part A — Official standards seeded (BIS IS 10500:2012)
- `database/migrations/002_official_standards_is10500.sql` (NEW): seeds `water_quality_standards` with `OFFICIAL_REFERENCE` rows for all 14 registry parameters from **BIS IS 10500:2012 (Second Revision), Drinking Water Specification, Bureau of Indian Standards** — the official Indian drinking-water standard. Mapping: `min_value`/`max_value` = acceptable range; `critical_value` = permissible limit in absence of alternate source (= max where the standard says "no relaxation"); `warning_value` unused (the standard defines none); `effective_date` NULL (no precise date fabricated); `reference_source` + `notes` carry full provenance. Idempotent (NOT EXISTS guard) — applied via `npm run db:migrate`, verified: **14 rows, 0 duplicates**, pH 6.5–8.5 (no relaxation), TDS 500/2000 mg/L, Turbidity 1/5 NTU, fluoride 1.0/1.5, arsenic 0.01/0.05, iron 0.3 (no relaxation), nitrate 45 (no relaxation), chloride 250/1000, sulphate 200/400, hardness 200/600 (as CaCO3), alkalinity 200/600, E. coli & total coliform 0 MPN/100mL ("shall not be detectable"), residual chlorine min 0.2 / max 1.0 mg/L. Temperature deliberately unseeded (IS 10500:2012 defines no health-based guideline; it is also not in the registry) → reports `NO_STANDARD_AVAILABLE`.
- Deterministic engine upgraded: new statuses `ABOVE_ACCEPTABLE` (exceeds acceptable, within permissible — "confirmation/treatment recommended") and `ABOVE_PERMISSIBLE` ("unsuitable without treatment" / "no relaxation"); overall ladder now `NO_DATA` → `EXCEEDS_STANDARD` (permissible/min breaches) → `ABOVE_ACCEPTABLE_LIMITS` → `PARTIAL_EVIDENCE` → `WITHIN_MEASURED_LIMITS`.

### Part B — AI Decision Engine
- `server/src/services/decisionEngine.ts` (NEW): Layer 1 deterministic `synthesizeDecision()` — every conclusion traceable to analysis evidence; produces the exact structured shape `{decision, confidence, currentCondition, detectedProblems, missingEvidence, recommendedAction, additionalTests, reasoning[], evidence[], engine, analysisTimestamp, caveat}` with decisions PURIFY / DO_NOT_PURIFY / RETEST / ADDITIONAL_TEST_REQUIRED / CHANGE_TREATMENT / INSUFFICIENT_EVIDENCE. Ladder: permissible/min breach → PURIFY (residual-chlorine below minimum → CHANGE_TREATMENT); acceptable-limit exceedance → RETEST; within limits + unmeasured parameters → ADDITIONAL_TEST_REQUIRED (the user's exact example scenario); everything measured+within → DO_NOT_PURIFY; no data → INSUFFICIENT_EVIDENCE. Layer 2: optional Gemini 2.0 Flash refinement (server-side key only) constrained to the decision set and never allowed to downgrade a hard-breach PURIFY/CHANGE_TREATMENT; any failure → deterministic result. Honest labelling: `RULE_BASED` without a key, `GEMINI` when refinement applies.
- `server/src/index.ts`: NEW `GET /api/water-quality/decision?waterSourceId=`; frontend: AI Decision panel in WaterQualityPage (decision + engine + confidence + detected problems + missing evidence + recommended action + additional tests + traceable reasoning + caveat).

**Builds:** server:build PASS, `tsc -b` PASS (0 errors), vite build PASS. **Tests:** 13/13 classifier tests (real IS 10500 values), 11/11 decision-ladder tests (incl. the user's within-limits-but-unmeasured example → ADDITIONAL_TEST_REQUIRED with E. coli/fluoride listed), API 400/404 PASS. **Database:** government data unchanged (1/476/14/1/0); sensor_readings 0, manual_measurements 0 (no fake data); new rows are ONLY the 14 official standards.

**Remaining work:** real measurements still require Phase 2 master-data registration + hardware; government-vs-current evidence comparison module (explicitly deferred); pump control (Phase 7).











