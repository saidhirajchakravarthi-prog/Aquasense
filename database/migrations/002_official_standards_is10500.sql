-- 002_official_standards_is10500.sql
-- PART A (Phase 4): official drinking-water standards for the parameter registry.
--
-- Sole source: BIS IS 10500:2012 (Second Revision), "Drinking Water Specification",
-- Bureau of Indian Standards — the official Indian drinking-water standard used by
-- JJM. Values are transcribed from the standard's "Acceptable limit" and
-- "Permissible limit in the absence of alternate source" columns.
-- Nothing is invented: parameters without a verifiable official limit
-- (e.g. temperature — IS 10500:2012 lists no health-based guideline) are
-- intentionally NOT seeded and will report NO_STANDARD_AVAILABLE.
--
-- Mapping into water_quality_standards:
--   min_value      = acceptable minimum (where the standard defines one)
--   max_value      = acceptable limit (preferred)
--   critical_value = permissible limit in absence of alternate source
--                    (equal to max_value where the standard permits "no relaxation";
--                     NULL + max-only means the registered maximum is the hard ceiling)
--   warning_value  = unused (IS 10500:2012 defines no warning tier)
-- Idempotent: a BIS IS 10500:2012 row is only inserted when the parameter has none yet.

INSERT INTO water_quality_standards(parameter_id, min_value, max_value, warning_value, critical_value, unit, standard_kind, reference_source, effective_date, notes)
SELECT p.id, v.min_value, v.max_value, v.warning_value, v.critical_value, v.unit, 'OFFICIAL_REFERENCE', v.reference_source, NULL, v.notes
FROM (VALUES
  ('ph',               6.5::numeric, 8.5::numeric, NULL::numeric, NULL::numeric, 'pH',        'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 6.5-8.5. Permissible: no relaxation (IS 10500:2012).'),
  ('tds',              NULL::numeric, 500::numeric, NULL::numeric, 2000::numeric, 'mg/L',     'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 500 mg/L; permissible 2000 mg/L in the absence of an alternate source. IS 10500:2012 specifies mg/L; ppm is numerically equivalent for dilute aqueous solutions.'),
  ('turbidity',        NULL::numeric, 1::numeric,   NULL::numeric, 5::numeric,    'NTU',      'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 1 NTU; permissible 5 NTU in the absence of an alternate source.'),
  ('fluoride',         NULL::numeric, 1.0::numeric, NULL::numeric, 1.5::numeric,  'mg/L',     'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 1.0 mg/L; permissible 1.5 mg/L.'),
  ('arsenic',          NULL::numeric, 0.01::numeric, NULL::numeric, 0.05::numeric, 'mg/L',    'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 0.01 mg/L; permissible 0.05 mg/L.'),
  ('iron',             NULL::numeric, 0.3::numeric, NULL::numeric, 0.3::numeric,  'mg/L',     'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 0.3 mg/L; permissible: no relaxation (IS 10500:2012).'),
  ('nitrate',          NULL::numeric, 45::numeric,  NULL::numeric, 45::numeric,   'mg/L',     'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 45 mg/L; permissible: no relaxation (IS 10500:2012).'),
  ('chloride',         NULL::numeric, 250::numeric, NULL::numeric, 1000::numeric, 'mg/L',     'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 250 mg/L; permissible 1000 mg/L.'),
  ('sulphate',         NULL::numeric, 200::numeric, NULL::numeric, 400::numeric,  'mg/L',     'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Acceptable 200 mg/L; permissible 400 mg/L.'),
  ('hardness',         NULL::numeric, 200::numeric, NULL::numeric, 600::numeric,  'mg/L',     'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Total hardness (as CaCO3). Acceptable 200 mg/L; permissible 600 mg/L.'),
  ('alkalinity',       NULL::numeric, 200::numeric, NULL::numeric, 600::numeric,  'mg/L',     'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Total alkalinity. Acceptable 200 mg/L; permissible 600 mg/L.'),
  ('e_coli',           NULL::numeric, 0::numeric,   NULL::numeric, 0::numeric,    'MPN/100mL','BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Shall not be detectable in any 100 mL sample (bacteriological quality; no relaxation).'),
  ('total_coliform',   NULL::numeric, 0::numeric,   NULL::numeric, 0::numeric,    'MPN/100mL','BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Shall not be detectable in any 100 mL sample (bacteriological quality; no relaxation).'),
  ('residual_chlorine',0.2::numeric, 1.0::numeric,  NULL::numeric, NULL::numeric, 'mg/L',    'BIS IS 10500:2012 (Second Revision) - Drinking Water Specification, Bureau of Indian Standards', 'Residual free chlorine: desirable minimum 0.2 mg/L; maximum 1 mg/L. A minimum standard - values below 0.2 mg/L indicate inadequate disinfection.')
) AS v(code, min_value, max_value, warning_value, critical_value, unit, reference_source, notes)
JOIN parameters p ON p.code = v.code
WHERE NOT EXISTS (
  SELECT 1 FROM water_quality_standards st
  WHERE st.parameter_id = p.id
    AND st.standard_kind = 'OFFICIAL_REFERENCE'
    AND st.reference_source LIKE 'BIS IS 10500:2012%'
);