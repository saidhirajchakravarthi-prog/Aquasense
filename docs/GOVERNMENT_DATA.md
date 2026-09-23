# Government data handling

| Source | Supported records | Interpretation |
| --- | --- | --- |
| CGWB | Historical laboratory measurements | Values are dated source records, never live ESP32 readings. |
| JJM-WQMIS WQ4 | Parameter-wise testing statistics | Stored as `TESTING_STATISTIC`; not individual sensor values. |
| JJM-WQMIS WQ6 | Affected-village contamination summaries | Stored as `CONTAMINATION_SUMMARY`; `affected_village_count` is never a concentration. |
| data.gov.in | Approved imported exports | Mapping and validation are mandatory. |

Official references: [CGWB Ground Water Quality](https://cgwb.gov.in/en/ground-water-quality) and [JJM WQMIS](https://ejalshakti.gov.in/WQMIS/Main/report).

Upload CSV/XLSX only through `POST /api/government/import`. Supply a source, dataset name/year, record type and mapping. Unknown parameters, invalid values, and duplicates are reported by the import job. Coordinates are saved only where they were included in the import.
