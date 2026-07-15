-- ============================================================================
-- Renewal Dashboard performance index
-- ============================================================================
-- WHY: saiba_renewal_transaction_data has ~48 lakh (4.8M) rows. Every dashboard
-- query filters on a policy_exp_date range, but the only index containing
-- policy_exp_date has it as the 6TH key column
-- (NonClusteredIndex-20230728-194400: pdf_trn_id, control_no, product_id,
--  company_id, issue_date, policy_exp_date, ...), which SQL Server cannot use
-- for a date-range seek. So every dashboard request FULL-SCANS all 48 lakh rows.
--
-- This index turns that scan into a range SEEK that reads only the window
-- (typically ~45 days). INCLUDE covers every column the dashboard aggregations
-- and filters touch, so the base table is never visited at all for aggregates.
--
-- HOW TO RUN: off-peak hours. ONLINE = ON avoids blocking writers but needs
-- Enterprise edition — if you're on Standard, remove that option (the build
-- will lock the table for its duration; on ~48 lakh rows expect a few minutes).
-- ============================================================================

USE [probus_autoboat_live];
GO

CREATE NONCLUSTERED INDEX IX_srtd_policy_exp_date_dashboard
ON dbo.saiba_renewal_transaction_data (policy_exp_date)
INCLUDE (
    is_renewed, gross_premium, net_premium,
    company_name, rm_name, pos_name,
    platform, am_id, user_id,
    product_id, sub_product_id, vertical_name,
    payment_link, control_no, pdf_trn_id
)
WITH (ONLINE = ON);   -- Enterprise only; remove on Standard edition
GO

-- Verify it's being used (should show an Index Seek, not a Table/Clustered Scan):
-- SET STATISTICS IO ON;
-- SELECT COUNT(*), SUM(gross_premium)
-- FROM dbo.saiba_renewal_transaction_data WITH (NOLOCK)
-- WHERE policy_exp_date >= '2026-07-01' AND policy_exp_date <= '2026-08-15';
