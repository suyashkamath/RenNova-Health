use [probus_autoboat_live]
-- SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
-- FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_NAME = 'saiba_renewal_transaction_data'
-- ORDER BY ORDINAL_POSITION;


-- SELECT TOP 10 *
-- FROM saiba_renewal_transaction_data WITH(NOLOCK)
-- WHERE policy_exp_date >= '2026-06-29'
--   AND policy_exp_date <  '2026-06-30' 
-- ORDER BY policy_exp_date;

-- Total policies expiring today, split into renewed vs pending (same
-- definitions the dashboard uses: due = COUNT(*), renewed = is_renewed = 1).
-- SELECT
--     COUNT(*)                                                   AS total_due,
--     SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END)            AS renewed,
--     COUNT(*) - SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END) AS pending
-- FROM saiba_renewal_transaction_data WITH(NOLOCK)
-- WHERE policy_exp_date >= '2026-07-12'
--   AND policy_exp_date <  '2026-07-13';

-- SELECT COUNT(*) AS orphan_rows
-- FROM saiba_renewal_transaction_data t WITH(NOLOCK)
-- WHERE t.policy_exp_date >= '2026-07-12'
--   AND t.policy_exp_date <  '2026-07-13'
--   AND NOT EXISTS (
--       SELECT 1 FROM probus_web_live.dbo.vw_master_user m
--       WHERE m.UserId = t.user_id
--   );


-- ============================================================================
-- DIAGNOSTIC 1: print EVERY row expiring on 12 Jul, and flag which ones have
-- no region/branch (the "orphans"). Scroll the region_status column: rows that
-- say ORPHAN are the ones that disappear the moment any region filter is on.
-- ============================================================================
-- SELECT
--     t.policy_no,
--     t.insured_name,
--     t.user_id,
--     t.am_id,
--     t.is_renewed,
--     t.product_id,
--     t.sub_product_id,
--     t.platform,
--     t.gross_premium,
--     CASE WHEN m.UserId IS NULL
--          THEN 'ORPHAN — no region/branch'
--          ELSE m.RegionName + ' / ' + m.BranchName
--     END AS region_status
-- FROM saiba_renewal_transaction_data t WITH(NOLOCK)
-- LEFT JOIN probus_web_live.dbo.vw_master_user m ON m.UserId = t.user_id
-- WHERE t.policy_exp_date >= '2026-07-12'
--   AND t.policy_exp_date <  '2026-07-13'
-- ORDER BY region_status, t.policy_no;

-- -- ============================================================================
-- -- DIAGNOSTIC 2: the SAME total, but split by every dimension the dashboard
-- -- can filter on. If the website shows 4889 instead of 4945, one of these
-- -- slices is the 56 rows being filtered out. Compare each block's total.
-- -- ============================================================================
-- -- by platform (ONLINE / OFFLINE / blank):
-- SELECT ISNULL(NULLIF(LTRIM(RTRIM(platform)), ''), '(blank)') AS platform,
--        COUNT(*) AS due,
--        SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END) AS renewed
-- FROM saiba_renewal_transaction_data WITH(NOLOCK)
-- WHERE policy_exp_date >= '2026-07-12' AND policy_exp_date < '2026-07-13'
-- GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(platform)), ''), '(blank)');

-- -- by channel (RM = has am_id, CUSTOMER = no am_id):
-- SELECT CASE WHEN am_id IS NOT NULL AND am_id <> 0 THEN 'RM' ELSE 'CUSTOMER' END AS channel,
--        COUNT(*) AS due,
--        SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END) AS renewed
-- FROM saiba_renewal_transaction_data WITH(NOLOCK)
-- WHERE policy_exp_date >= '2026-07-12' AND policy_exp_date < '2026-07-13'
-- GROUP BY CASE WHEN am_id IS NOT NULL AND am_id <> 0 THEN 'RM' ELSE 'CUSTOMER' END;

-- -- by product:
-- SELECT product_id,
--        COUNT(*) AS due,
--        SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END) AS renewed
-- FROM saiba_renewal_transaction_data WITH(NOLOCK)
-- WHERE policy_exp_date >= '2026-07-12' AND policy_exp_date < '2026-07-13'
-- GROUP BY product_id
-- ORDER BY due DESC;

SELECT
    COUNT(*)                                                   AS total_due,
    SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END)            AS renewed,
    COUNT(*) - SUM(CASE WHEN is_renewed = 1 THEN 1 ELSE 0 END) AS pending
FROM saiba_renewal_transaction_data WITH(NOLOCK)
WHERE policy_exp_date >= '2026-07-12'
  AND policy_exp_date <  '2026-07-13'
  AND product_id =2;
-- SELECT TOP 100 *
-- FROM saiba_renewal_transaction_data WITH(NOLOCK)
-- ORDER BY entry_on DESC;

-- select count(1),sum(gross_premium) from saiba_renewal_transaction_data WITH(NOLOCK) where cast(policy_exp_date  as date) ='2026-06-29' and product_id = 2  ---   vehicle_regi_no= REPLACE(replace('GJ-05-SJ-3566','-',''),' ','')



-- USE [probus_autoboat_live];
-- GO

-- SELECT DISTINCT product_id
-- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- ORDER BY product_id;

-- USE [probus_autoboat_live];
-- GO

-- SELECT DISTINCT sub_product_id
-- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- ORDER BY sub_product_id;

-- USE [probus_autoboat_live];
-- GO

-- SELECT DISTINCT
--     product_id,
--     sub_product_id
-- FROM saiba_renewal_transaction_data WITH (NOLOCK)
-- ORDER BY product_id, sub_product_id;

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

-- use [probus_autoboat_live]
-- select  top 10 * from saiba_renewal_transaction_data a 
-- INNEr JOIN [probus_web_live].[dbo].[vw_master_user] b ON a.user_id = b.UserId

-- use probus_web_live
-- select * from [dbo].[vw_region_divison_branch]