-- use [probus_autoboat_live]
-- SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
-- FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_NAME = 'pdf_read_details'
-- ORDER BY ORDINAL_POSITION;


-- SELECT TOP 100 *
-- FROM saiba_renewal_transaction_data WITH(NOLOCK)
-- WHERE policy_exp_date >= '2026-06-29'
--   AND policy_exp_date <  '2026-06-30' 
-- ORDER BY policy_exp_date;

-- SELECT TOP 100 *
-- FROM saiba_renewal_transaction_data WITH(NOLOCK)
-- ORDER BY entry_on DESC;

-- select count(1),sum(gross_premium) from saiba_renewal_transaction_data WITH(NOLOCK) where cast(policy_exp_date  as date) ='2026-06-29' and product_id = 2  ---   vehicle_regi_no= REPLACE(replace('GJ-05-SJ-3566','-',''),' ','')



-- USE [probus_autoboat_live];
-- GO

-- SELECT DISTINCT product_id
-- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- ORDER BY product_id;

-- -- USE [probus_autoboat_live];
-- -- GO

-- -- SELECT DISTINCT sub_product_id
-- -- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- -- ORDER BY sub_product_id;

-- USE [probus_autoboat_live];
-- GO

-- SELECT DISTINCT
--     product_id,
--     sub_product_id
-- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- ORDER BY product_id, sub_product_id;

-- -- Everything sitting under HEALTH (product_id = 1) in the live table:
-- -- every sub_product_id present, its official name (per the master sheet),
-- -- row count and premium — shows where "Other (0)" / GMC / GPA rows come from.
-- USE [probus_autoboat_live];
-- GO

-- SELECT
--     t.sub_product_id,
--     COALESCE(m.sub_product_name, 'Other (' + CAST(t.sub_product_id AS varchar(10)) + ')') AS sub_product_name,
--     COUNT(*)                                         AS nop,
--     SUM(CASE WHEN t.is_renewed = 1 THEN 1 ELSE 0 END) AS renewed,
--     SUM(CASE WHEN t.is_renewed = 0 THEN 1 ELSE 0 END) AS pending,
--     SUM(t.gross_premium)                             AS gross_premium,
--     MIN(CAST(t.policy_exp_date AS date))             AS first_expiry,
--     MAX(CAST(t.policy_exp_date AS date))             AS last_expiry
-- FROM saiba_renewal_transaction_data t WITH (NOLOCK)
-- LEFT JOIN (VALUES
--     (3,  'Individual'),
--     (4,  'Family'),
--     (5,  'Individual'),
--     (6,  'Family'),
--     (18, 'GMC'),
--     (19, 'GPA'),
--     (23, 'Multi Individual'),
--     (26, 'Personal Accident'),
--     (27, 'Hospital Cash')
-- ) AS m (sub_product_id, sub_product_name)
--     ON m.sub_product_id = t.sub_product_id
-- WHERE t.product_id = 1
-- GROUP BY t.sub_product_id, m.sub_product_name
-- ORDER BY t.sub_product_id;

-- Top 100 HEALTH rows (latest expiries first):
SELECT TOP (100) *
FROM saiba_renewal_transaction_data WITH (NOLOCK)
WHERE product_id = 1 and vertical_name='PERSONAL ACCIDENT'
ORDER BY policy_exp_date DESC;



-- Every vertical_name mapped to product_id = 1 (HEALTH), biggest first:
SELECT
    vertical_name,
    COUNT(*)           AS nop,
    SUM(gross_premium) AS gross_premium
FROM saiba_renewal_transaction_data WITH (NOLOCK)
WHERE product_id = 1
GROUP BY vertical_name
ORDER BY nop DESC;

-- vertical_name x sub_product_id cross-map under HEALTH:
SELECT
    vertical_name,
    sub_product_id,
    COUNT(*) AS nop
FROM saiba_renewal_transaction_data WITH (NOLOCK)
WHERE product_id = 1
GROUP BY vertical_name, sub_product_id
ORDER BY vertical_name, sub_product_id;

-- And a few sample rows of the unmapped "Other (0)" bucket, to see what those policies are:
-- SELECT TOP (20) *
-- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- WHERE product_id = 1
--   AND sub_product_id NOT IN (3, 4, 23, 26)
-- ORDER BY policy_exp_date DESC;

-- USE [probus_autoboat_live];
-- GO

-- SELECT TOP (1) *
-- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- WHERE product_id = -1
--   AND sub_product_id = 0;


-- USE probus_autoboat_live
-- GO
-- SELECT name
-- FROM sys.tables
-- ORDER BY name;
-- use probus_web_live
-- select * from [dbo].[vw_region_divison_branch]

-- select  top 10 * from saiba_renewal_transaction_data a 
-- INNEr JOIN [probus_web_live].[dbo].[vw_master_user] b ON a.user_id = b.UserId

-- SELECT
--     COUNT(*)                                        AS due,
--     SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END) AS renewed,
--     SUM(CASE WHEN is_renewed = 0 THEN 1 ELSE 0 END) AS pending
-- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- WHERE policy_exp_date >= '2026-07-08'
--   AND policy_exp_date <  '2026-07-09';

--    ls -la "/Users/suyash.kamath/Downloads/WhatsApp Audio 2026-07-09 at 2.55.59 PM (1).mpeg"; echo "---whisper---"; which whisper whisper-cpp 2>/dev/null; echo "---ffmpeg---"; which ffmpeg 2>/dev/null; echo "---python---"; which python3 2>/dev/null; echo "---brew---"; which brew 2>/dev/null