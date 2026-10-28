# PostgreSQL and DBeaver setup

1. Install PostgreSQL 15+ and DBeaver.
2. Create a database: `CREATE DATABASE smart_water;`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/smart_water`.
4. Run `npm run db:migrate`; this applies the files in `database/migrations`.
5. In DBeaver create a PostgreSQL connection using host `localhost`, port `5432`, database `smart_water`, and your PostgreSQL username/password.
6. Refresh schemas and confirm `sensor_readings`, `manual_measurements`, `government_records`, and `import_jobs` exist.
7. Parameter master rows register themselves automatically when the first real
   measurement or government import arrives (no demo seed exists).
8. Start the API with `npm run server` and the web UI with `npm run dev`.

Every value shown in AquaSense originates from PostgreSQL. There is no demo mode,
and no fixture data ships with the application.
