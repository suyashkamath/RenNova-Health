# Renewal Dashboard Project Guide

## 1. What Renewal Means

Renewal means continuing an existing insurance policy for the next policy period.

Example:

- Customer buys motor policy on `10 July 2025`.
- Policy is valid for one year.
- Policy expires on `09 July 2026`.
- Before expiry, the insurance company tries to get the customer to renew.

So renewal is not a new customer sale. It is the follow-up business from an existing policy.

## 2. Why Work Starts 45-60 Days Before Expiry

The company cannot wait until the expiry date to contact the customer. By then, the customer may have already purchased insurance from another company.

So the renewal process usually starts:

- 60 days before expiry, or
- 45 days before expiry.

Example:

- Policy expiry date: `15 August 2026`
- Renewal work starts around: `15 June 2026`

This is why the dashboard must support future due dates, upcoming renewal windows, and reminder status.

## 3. Full Renewal Data Flow

The renewal project is mainly a data engineering and business intelligence pipeline.

High-level flow:

```text
Customer buys policy
-> Policy data is stored in SAIBA/Cyber
-> 45-60 days before expiry, renewal candidates are identified
-> Insurance companies are contacted
-> Companies send renewal files and renewal notices
-> Neyaz Sir's team collects and uploads renewal notice PDFs
-> Binal Ma'am's stored procedure prepares mapped renewal data
-> Policy number is used to map RM, POSP, region, branch, product, and premium
-> Payment links are mapped where available
-> Customer and RM reminders are triggered
-> Night job detects whether policy is renewed
-> Dashboard shows live renewal status
```

Important point: the dashboard is the final reporting layer. It should not just show a static Excel table. It should summarize the whole renewal pipeline.

## 4. Source Excel File Provided

File shared:

```text
/Users/suyash.kamath/Downloads/Renewal data format.xlsx
```

Observed workbook structure:

- Sheet name: `Sheet1`
- Range: `A1:AN11`
- Data rows in sample: `10`
- Columns: `40`

The sample currently contains mostly `HEALTH` rows, but the same structure can be used for motor renewal rows when `vertical_name`, `product_id`, `sub_product_id`, and vehicle fields are populated properly.

## 5. Important Excel Columns

Use these columns as the first version of the dashboard data contract.

| Column | Meaning | Dashboard Use |
|---|---|---|
| `id` | Internal renewal row id | Unique row identity |
| `pdf_trn_id` | Renewal notice PDF transaction id | Notice/PDF tracking |
| `control_no` | Internal control number | Traceability |
| `company_name` | Insurance company name | Company-wise filter and ranking |
| `policy_type` | Policy/product type | Product and segment grouping |
| `policy_no` | Policy number | Main matching key |
| `issue_date` | Policy issue date | Historical reference |
| `policy_start_date` | Policy start date | Policy timeline |
| `policy_exp_date` | Policy expiry date | Renewal due date |
| `platform` | Online/offline platform | Source/platform filter |
| `insured_name` | Customer name | Customer-level report |
| `cust_email` | Customer email | Customer communication |
| `cust_mobile` | Customer mobile | Customer communication |
| `vehicle_regi_no` | Vehicle registration number | Auto renewal detection |
| `agent_id` | POSP/agent id | POSP mapping |
| `user_id` | User id | POSP/user mapping |
| `pos_name` | POSP name | POSP-wise performance |
| `pos_email` | POSP email | POSP communication |
| `pos_mobile` | POSP mobile | POSP communication |
| `rm_code` | RM code | RM mapping |
| `am_id` | Area manager id | Manager hierarchy |
| `rm_name` | Relationship manager name | RM-wise performance |
| `rm_email` | RM email | RM communication |
| `rm_mobile` | RM mobile | RM communication |
| `company_id` | Insurance company id | Company lookup |
| `entry_on` | Row creation/upload date | Data freshness |
| `is_file_removed_on_s3` | Whether notice file was removed | PDF availability check |
| `payment_link` | Payment URL/Bitly link | Payment button availability |
| `updated_on` | Last update timestamp | Audit and freshness |
| `is_renewed` | Renewal status flag | Renewed vs pending |
| `is_renewed_check` | Renewal check flag | Night job tracking |
| `vertical_name` | Business vertical | Motor/Health/etc. filter |
| `sum_insured` | Sum insured | Policy details |
| `net_premium` | Net premium | Expected/renewed premium |
| `gross_premium` | Gross premium | Premium KPI |
| `make` | Vehicle make | Motor detail filter |
| `chasis_no` | Vehicle chassis number | Motor identity |
| `engine_no` | Vehicle engine number | Motor identity |
| `product_id` | Product id | Product mapping |
| `sub_product_id` | Sub-product id | Segment mapping |

## 6. Date Handling

The Excel file stores dates as Excel serial numbers.

Examples found in the file:

| Excel Value | Converted Date |
|---|---|
| `46167` | `2026-05-25` |
| `46178` | `2026-06-05` |
| `46219` | `2026-07-16` |
| `46174.834050115744` | `2026-06-01 20:01:01` |

When importing this data into the dashboard, convert Excel serial dates into real dates before calculating due windows, daily trends, reminders, or calendar counts.

## 7. Core Dashboard Metrics

The dashboard should answer these questions first.

### Top KPIs

| KPI | Formula |
|---|---|
| Eligible/Due Renewals | Count of policies whose expiry date is inside selected period |
| Renewed | Count where `is_renewed = 1` |
| Pending | Due renewals minus renewed renewals |
| Renewal Percentage | `Renewed / Due * 100` |
| Expected Premium | Sum of `gross_premium` or `net_premium` for due policies |
| Collected Premium | Sum of premium for renewed policies |
| Payment Link Available | Count where `payment_link` is not null/empty |
| Renewal Notice Available | Count where `pdf_trn_id` exists and file is not removed |

### Important Groupings

The dashboard should support grouping by:

- Date or month
- Region
- Branch
- RM
- POSP
- Insurance company
- Vertical
- Product
- Sub-product
- Platform

Current sample file does not contain direct `region` or `branch` columns. Those must come from SAIBA/Cyber mapping, RM master, POSP master, or the stored procedure output.

## 8. Dashboard Pages To Build

### Page 1: Main Dashboard

Purpose: business-level summary.

Required sections:

- Renewals due
- Renewed
- Pending/lapsed
- Renewal percentage
- Expected premium
- Collected premium
- Daily/monthly trend chart
- Company-wise performance
- RM-wise performance
- POSP-wise performance
- Future renewal calendar

### Page 2: Renewal List

Purpose: policy-level drill-down.

Columns to show:

- Policy number
- Customer name
- Mobile number
- Vehicle number
- Company
- Policy type
- Expiry date
- RM name
- POSP name
- Net premium
- Gross premium
- Payment link status
- Renewal notice status
- Renewal status

Useful filters:

- Expiry date range
- Company
- RM
- POSP
- Vertical
- Product/sub-product
- Renewed/Pending
- Payment link available/missing
- Renewal notice available/missing

### Page 3: RM Performance

Purpose: show which RMs are converting renewals.

Metrics:

- Total due policies
- Renewed policies
- Pending policies
- Renewal percentage
- Expected premium
- Collected premium
- Payment link missing count
- Notice missing count

### Page 4: POSP Performance

Purpose: show agent/POSP contribution.

Metrics are same as RM, but grouped by:

- `agent_id`
- `user_id`
- `pos_name`
- `pos_mobile`

### Page 5: Company Performance

Purpose: compare insurers.

Group by:

- `company_id`
- `company_name`

Metrics:

- Due count
- Renewed count
- Pending count
- Renewal percentage
- Premium due
- Premium collected
- Notice availability
- Payment link availability

### Page 6: Reminder Readiness

Purpose: support the reminder process.

Buckets:

- Due in 45 days
- Due in 30 days
- Due in 15 days
- Due in 7 days
- Due in 3 days
- Due tomorrow
- Due today
- Expired

This helps the business know whom to contact next.

## 9. Current React Project Status

The current app is already a React/Vite dashboard.

Important files:

- `App.tsx`: main dashboard layout, filters, and page switching
- `constants.ts`: currently generates mock dashboard data
- `types.ts`: dashboard TypeScript types
- `components/TopCards.tsx`: KPI cards
- `components/TrendChart.tsx`: trend chart
- `components/PerformanceRanking.tsx`: RM/branch/company ranking card
- `components/CalendarWidget.tsx`: future due calendar/export
- `components/AdvancedAnalytics.tsx`: analytics page
- `components/DetailedReport.tsx`: drill-down report page

Right now, most dashboard numbers come from `generateDashboardData()` in `constants.ts`. That means the current UI is not yet connected to the real renewal Excel/database data.

## 10. What To Do Now

Follow this sequence.

### Step 1: Freeze The Data Contract

Confirm with Binal Ma'am whether the final stored procedure output will contain these fields:

- Policy number
- Expiry date
- Company
- Customer
- Vehicle number
- RM code/name/mobile/email
- POSP id/name/mobile/email
- Region
- Branch
- Vertical
- Product
- Sub-product
- Net premium
- Gross premium
- Payment link
- Renewal notice/PDF id
- Renewal flag
- Renewal check flag

If region and branch are not in the Excel, ask where they will come from.

### Step 2: Decide Status Rules

Define exact status logic:

```text
Due = policy_exp_date is inside selected date range
Renewed = is_renewed = 1
Pending = Due and is_renewed = 0
Expired = policy_exp_date < today and is_renewed = 0
Notice Available = pdf_trn_id > 0 and is_file_removed_on_s3 = 0
Payment Link Available = payment_link is not NULL and not empty
```

Confirm whether `is_renewed_check` means:

- night job already checked renewal status, or
- policy was found renewed by vehicle registration, or
- something else.

### Step 3: Build A Data Adapter

Create one clean adapter layer that converts raw Excel/API rows into dashboard rows.

Example normalized dashboard row:

```ts
export interface RenewalRecord {
  id: string;
  policyNo: string;
  companyName: string;
  policyType: string;
  expiryDate: string;
  customerName: string;
  customerMobile: string;
  vehicleNo: string;
  rmCode: string;
  rmName: string;
  posId: string;
  posName: string;
  vertical: string;
  productId: string;
  subProductId: string;
  netPremium: number;
  grossPremium: number;
  paymentLink: string | null;
  noticeAvailable: boolean;
  isRenewed: boolean;
}
```

This adapter should handle:

- Excel serial date conversion
- Empty values like `NULL`, `NA`, and blank cells
- Numeric fields
- Renewal boolean fields
- Payment link availability
- Notice availability

### Step 4: Replace Mock Dashboard Data

Replace `generateDashboardData()` with real aggregation logic.

Input:

```text
RenewalRecord[] + selected filters
```

Output:

```text
stats, chartData, branches, regions, managers, insurers.
```

The UI can remain mostly the same at first. The main change is replacing fake generated numbers with aggregations from real renewal rows.

### Step 5: Add Real Filters

Current filters are mostly mock values. They should be generated from data.

Examples:

- Company dropdown should come from unique `company_name`
- RM dropdown should come from unique `rm_name`
- POSP dropdown should come from unique `pos_name`
- Vertical dropdown should come from unique `vertical_name`
- Product/sub-product should come from `product_id` and `sub_product_id`
- Region/branch should come from mapped stored procedure output

### Step 6: Build Drill-Down

Every KPI and chart should allow drill-down to the exact policies behind the number.

Example:

- Click `Pending`
- Open policy list filtered to pending policies
- User can export that list

This is important because business users will ask, "Which policies are pending?"

### Step 7: Validate Against Excel

For the sample file:

- Total rows should be `10`
- Company-wise due count should match Excel rows
- Renewed count should match `is_renewed`
- Premium total should match sum of `gross_premium`
- Missing payment link count should match blank/`NULL` `payment_link`
- Missing vehicle number count should match `vehicle_regi_no = NA` or blank

After this works, test with a larger real renewal file.

## 11. Suggested First Dashboard Version

Do not try to build everything in one version.

Version 1 should include:

- Excel upload/read support
- Top KPIs
- Company-wise table
- RM-wise table
- POSP-wise table
- Expiry trend chart
- Policy-level table
- Filters for date, company, RM, POSP, vertical, renewed/pending

Version 2 should include:

- Region and branch mapping
- Reminder buckets
- Payment link readiness
- Renewal notice readiness
- Export filtered policy list
- Detailed RM/POSP/company drill-down

Version 3 should include:

- API/database integration
- Scheduled refresh
- Night job renewal detection status
- Historical trend comparison
- Role-based dashboard views
- Automated reminder monitoring

## 12. Questions To Ask Binal Ma'am

Ask these before final implementation:

1. What is the final stored procedure name?
2. What are the exact output columns of the stored procedure?
3. Will the dashboard read from Excel, database table, or API?
4. Does the stored procedure already include region and branch?
5. What is the exact meaning of `is_renewed`?
6. What is the exact meaning of `is_renewed_check`?
7. Should renewal be detected by `policy_no` or `vehicle_regi_no`?
8. Which premium should the dashboard use: `net_premium` or `gross_premium`?
9. Should cancelled, declined, or rejected policies be excluded?
10. How often should the dashboard refresh?
11. Who are the users: management, RM, POSP, operations, or all?
12. What exports are required by business users?

## 13. Recommended Technical Architecture

Use this structure:

```text
Raw source
  -> Excel / stored procedure / API
  -> Data adapter
  -> Normalized RenewalRecord[]
  -> Aggregation functions
  -> Dashboard components
```

Recommended files to add later:

```text
src/data/renewalAdapter.ts
src/data/renewalAggregations.ts
src/data/excelDate.ts
src/data/renewalFilters.ts
```

Because this project is currently flat, the same idea can also be added as:

```text
data/renewalAdapter.ts
data/renewalAggregations.ts
```

Then update:

```text
types.ts
constants.ts
App.tsx
components/DetailedReport.tsx
```

## 14. Final Mental Model

Think of the project like this:

```text
Renewal business process = insurance workflow
Renewal dashboard project = data pipeline + BI reporting
```

Your work is to make renewal data understandable:

- What is due?
- What is renewed?
- What is pending?
- Who is responsible?
- Which company/product/region is performing well?
- Where are payment links or notices missing?
- What should the business team act on today?

If the dashboard answers these questions clearly, the project is going in the right direction.


# Motor Insurance Renewal & Rollover Dashboard

| Document field | Value |
|---|---|
| Project name | InsureTrack – Motor Insurance Renewal & Rollover Dashboard |
| Application package | `insuretrack-dashboard` |
| Application version | 1.0.0 |
| Document version | 1.0 |
| Document date | 22 June 2026 |
| Application type | Frontend dashboard prototype |
| Technology | React, TypeScript, Vite, Tailwind CSS, Recharts |

## 1. Introduction

### 1.1 Purpose

The Motor Insurance Renewal & Rollover Dashboard provides a centralized visual view of motor-policy renewal performance. It allows users to monitor policies and premium amounts that are due, renewed, or lapsed; compare performance across regions, branches, relationship managers, and insurers; inspect trends; and download a month-level renewal dataset.

The current repository is a frontend prototype. It demonstrates the dashboard's intended interface and interactions using locally generated mock data. It does not currently connect to a backend API, production database, authentication service, or live policy system.

### 1.2 Scope

The implemented scope includes:

- Renewal and rollover dashboard views.
- Number of Policies (NOP) and premium-value views.
- Dashboard filtering by time, geography, product segment, policy type, insurer, and source.
- Renewal KPI cards and trend charts.
- A month-wise renewal calendar with Excel export.
- Branch, region, relationship manager, and insurer rankings.
- Configurable analytics charts.
- Entity-level detailed report screens.

### 1.3 Business objectives

- Monitor motor insurance renewal and rollover performance.
- Track due, renewed, and lapsed policies or premium.
- Measure completion and failure rates.
- Compare region and branch performance.
- Evaluate relationship manager performance.
- Compare insurer performance.
- Identify low-performing dates and entities.
- Enable operational teams to export renewal records for follow-up.

## 2. Target Users

The prototype does not implement authentication or user roles. The following are intended business users inferred from the dashboard's functions.

| User type | Expected responsibility |
|---|---|
| Business Head | Monitor overall renewal and rollover performance. |
| Regional Manager | Review regional and branch performance. |
| Branch Manager | Track branch targets, achieved renewals, and lapses. |
| Relationship Manager | Monitor an assigned renewal portfolio. |
| Operations Team | Review due policies and download monthly follow-up data. |
| Analyst | Explore trends and compare business dimensions. |
| Administrator | Future responsibility for users, access, and configuration; not implemented. |

## 3. Application Navigation

The sidebar exposes two primary pages:

1. **Dashboard** – operational KPIs, trends, calendar, and rankings.
2. **Analytics** – configurable analysis by region, segment, branch, or month.

A third internal page, **Detailed Analysis**, opens when a user selects an item in a performance ranking. Other page values exist in the TypeScript model (`Renewals`, `Agents`, and `Settings`) but no corresponding navigation or screen is currently implemented.

## 4. Dashboard Modules

### Module 1: Dashboard Filters

The global filter panel controls the generated dashboard data.

| Filter | Available values or behavior |
|---|---|
| Time Period | Yesterday, Weekly, Monthly, Quarterly, Custom |
| Custom Date Range | Start and end dates, limited from one year before today through two months after today |
| Region | All, North, South, East, West |
| Branch | Enabled after a region is selected; five configured branches per region |
| Product Line | All, Motor Insurance |
| Segment | All, Two Wheeler, Private Car, Goods Carrying, Passenger Vehicle, Misc D |
| Insurance Type | All, Third Party, Own Damage, Comprehensive |
| Insurer | All, ICICI Lombard, HDFC ERGO, Bajaj Allianz, New India Assurance, SBI General |
| Policy Source | All Sources, Renewal, Rollover |
| View By | NOP or Premium |

Changing Policy Source also changes the dashboard title:

- All Sources: Renewal & Rollover Dashboard
- Renewal: Renewal Dashboard
- Rollover: Rollover Dashboard

Current prototype behavior: most filters influence the mock-data seed or volume. Product Line and the values entered in Custom Date Range are stored in the interface but are not used in the data calculations.

### Module 2: KPI Overview

Four cards summarize the selected dashboard scope.

| KPI | Description | Calculation |
|---|---|---|
| Renewals Due / Premium Due | Total policies or premium due in the selected scope. | Generated base due value |
| Renewed / Premium Renewed | Successfully renewed policies or premium. | Generated renewed value |
| Lapsed / Premium Lapsed | Policies or premium not renewed. | `Due - Renewed` |
| Completion Rate | Percentage successfully renewed. | `(Renewed / Due) × 100` |
| Failure Rate | Percentage lapsed. | `(Lapsed / Due) × 100` |

The fourth card can switch between Completion Rate and Failure Rate. Trend labels such as “+12% vs last period” are currently static display text and are not calculated from historical records.

### Module 3: NOP and Premium Views

**NOP view** displays policy counts.

**Premium view** converts generated policy values into premium amounts using a fixed prototype multiplier of ₹12,500 per policy. Values are formatted in Indian lakh and crore units where appropriate.

This conversion is a prototype assumption, not an aggregation of policy-level premium records.

### Module 4: Renewal Trend

The Renewal Trend or Premium Trend chart displays:

- Due
- Renewed
- Lapsed

Features include:

- Area-chart and bar-chart display modes.
- Individual metric visibility controls.
- Tooltip values.
- Zoom in, zoom out, and reset controls.
- Mouse drag to pan through visible points.
- Double-click to reset.

Labels depend on the selected time period. Yesterday uses hourly labels, Weekly uses week labels, and other selections use month/year labels. The chart values are generated in the browser; some chart points use unseeded randomness and can change after regeneration.

### Module 5: Renewal Calendar

The Renewal Calendar provides day-level due and renewed information for a selected month.

Features include:

- Previous- and next-month navigation.
- Due count displayed in each date cell.
- Renewed count displayed for non-future dates.
- Today's date highlight.
- Hover tooltip with date, due count, and premium.
- Monthly Excel download.

Color rules implemented in the code:

| Color | Meaning |
|---|---|
| Green | Renewal percentage is at least 90%. |
| Red | Renewal percentage is below 90%. |
| Gray | Future date. |

There is no yellow 85–90% category in the current implementation.

The Excel export generates 50 mock policy rows for the selected month and saves a file named `Renewals_Due_<Month>_<Year>.xlsx`.

### Module 6: Branch and Region Performance

The performance ranking can switch between Branch and Region views.

Features include:

- Top 10 and Worst 10 modes.
- Ranking by achieved percentage.
- Achieved-versus-target progress bar.
- Renewal count or premium formatting based on View By.
- Click-through to Detailed Analysis.

Configured branches:

| Region | Branches |
|---|---|
| North | Delhi South, Jaipur Pink, Lucknow, Chandigarh, Noida Sector 18 |
| South | Bangalore Tech, Chennai North, Hyderabad, Kochi, Trivandrum |
| East | Kolkata Main, Patna, Bhubaneswar, Guwahati, Ranchi |
| West | Mumbai Central, Pune West, Ahmedabad, Surat, Nagpur |

### Module 7: Relationship Manager Performance

This ranking displays ten configured relationship managers, their achieved percentage, and target progress.

Features include:

- Top 10 and Worst 10 views.
- Achieved and target values.
- Assigned branch shown in a hover tooltip.
- Click-through to Detailed Analysis.

The manager names, branches, targets, and results are prototype data generated in the browser.

### Module 8: Insurance Company Performance

This module ranks the following insurers:

- ICICI Lombard
- HDFC ERGO
- Bajaj Allianz
- New India Assurance
- SBI General

Users can switch between top and worst performance and open a detailed report for an insurer.

## 5. Advanced Analytics Module

The Analytics page supports configurable visual analysis.

### 5.1 Data scope filters

- Region
- Branch
- Product line
- Segment

### 5.2 Time frame

- Yesterday
- Past 14 Days
- Past 30 Days
- Past Year
- Custom

The Custom option currently does not display start and end date controls.

### 5.3 Grouping options

- Region
- Segment
- Branch
- Month

### 5.4 Metrics

- Due
- Renewed
- Lapsed

At least one metric must remain selected.

### 5.5 Visualizations

- Bar chart
- Line chart

Although a completion-rate metric type is declared in the component, it is not exposed in the metric controls or chart. Pie charts are also not implemented.

## 6. Detailed Analysis Module

Selecting a branch, relationship manager, or insurer opens an entity report containing:

- Entity name and type.
- Region, when available.
- Report period label.
- Total Active Policies.
- Renewal Rate.
- Pending Approvals.
- Average Premium.
- Twelve-month performance chart.
- Recent activity list.

All KPI values, chart values, and activity records on this page are mock data. The “View All Logs” button is visual only and has no action.

## 7. Exported Renewal Data

The calendar export contains these columns:

1. Due Date
2. Status
3. Vehicle Number
4. Previous Company
5. Company
6. Segment
7. PoSP Name
8. User Id
9. Policy Holder Name
10. Mobile No
11. Email ID
12. Policy No
13. Policy Start Date
14. Policy End Date
15. Net Premium
16. GST
17. Final Premium
18. Region
19. Branch
20. Policy Issuance Date
21. RM Name

For the prototype, GST is calculated as 18% of net premium and Final Premium is `Net Premium + GST`. Status is randomly assigned as Renewed or Pending. The export contains synthetic personal and policy information and must not be treated as production data.

## 8. Main Use Cases

### UC-01: View renewal overview

**Actor:** Business Head

**Steps:**

1. Open the application.
2. Select Renewal, Rollover, or All Sources.
3. Review due, renewed, lapsed, and rate KPIs.
4. Review trends and entity rankings.

**Expected result:** The user receives a high-level view of renewal performance based on the selected filters.

### UC-02: Filter dashboard data

**Actor:** Regional Manager

**Steps:**

1. Select a time period.
2. Select a region.
3. Optionally select a branch.
4. Select product segment, policy type, insurer, and source.
5. Review the regenerated dashboard.

**Expected result:** Dashboard metrics and rankings update for the selected filter state.

### UC-03: Switch between policy and premium analysis

**Actor:** Business Head or Analyst

**Steps:**

1. Open the View By control.
2. Select NOP or Premium.
3. Review updated cards, charts, and rankings.

**Expected result:** Values are displayed either as policy counts or formatted premium amounts.

### UC-04: Monitor the renewal calendar

**Actor:** Operations Team

**Steps:**

1. Navigate to a month.
2. Review date colors and daily counts.
3. Hover over a date to view due policies and premium.

**Expected result:** The user identifies dates with renewal performance below 90%.

### UC-05: Download monthly renewal records

**Actor:** Operations Team

**Steps:**

1. Navigate to the required month.
2. Click the download icon.

**Expected result:** An Excel workbook containing 50 generated renewal rows is downloaded.

### UC-06: Compare entity performance

**Actor:** Regional Manager

**Steps:**

1. Choose Branch or Region.
2. Choose Top 10 or Worst 10.
3. Review percentages and progress bars.
4. Select an entity.

**Expected result:** The detailed analysis screen opens for the selected entity.

### UC-07: Perform advanced analysis

**Actor:** Analyst

**Steps:**

1. Open Analytics.
2. Select scope filters and time frame.
3. Select a grouping dimension.
4. Select due, renewed, or lapsed metrics.
5. Switch between bar and line charts.

**Expected result:** The chart updates to match the selected configuration.

## 9. Functional Requirements and Implementation Status

| ID | Requirement | Current status |
|---|---|---|
| FR-01 | Display due, renewed, and lapsed KPIs. | Implemented with mock data |
| FR-02 | Display completion and failure rates. | Implemented with mock data |
| FR-03 | Support time-period filtering. | Partially implemented; Custom dates do not affect calculations |
| FR-04 | Support region and branch filtering. | Implemented for mock data |
| FR-05 | Support product-line and segment filtering. | Partial; segment affects generated data, product line does not |
| FR-06 | Support insurer filtering. | Implemented for mock data |
| FR-07 | Support insurance-type filtering. | Implemented for mock data |
| FR-08 | Support Renewal and Rollover source filtering. | Implemented for mock data |
| FR-09 | Switch between NOP and Premium views. | Implemented using a fixed multiplier |
| FR-10 | Display renewal trends. | Implemented with area and bar charts |
| FR-11 | Provide chart metric, zoom, reset, and pan controls. | Implemented |
| FR-12 | Display a monthly renewal calendar. | Implemented with mock data |
| FR-13 | Export month-level renewal records to Excel. | Implemented with generated data |
| FR-14 | Rank branches and regions. | Implemented with mock data |
| FR-15 | Rank relationship managers. | Implemented with mock data |
| FR-16 | Rank insurers. | Implemented with mock data |
| FR-17 | Provide advanced grouped analytics. | Implemented with mock data |
| FR-18 | Provide entity drill-down reports. | Implemented with static/generated mock data |
| FR-19 | Authenticate users and enforce role access. | Not implemented |
| FR-20 | Retrieve live policy data from backend services. | Not implemented |
| FR-21 | Persist dashboard filters and user preferences. | Not implemented |

## 10. Data Flow

### 10.1 Current prototype flow

```text
User selects filters
        ↓
React filter state in App.tsx
        ↓
generateDashboardData() in constants.ts
        ↓
Browser-generated mock KPIs, trends, and rankings
        ↓
React dashboard components
        ↓
User views charts or triggers generated Excel export
```

### 10.2 Recommended production flow

```text
Policy Administration / CRM / Insurer Data
        ↓
Validated ingestion and transformation layer
        ↓
Renewal data store or analytics warehouse
        ↓
Renewal, lapse, rollover, and premium calculations
        ↓
Secured dashboard API with role-based authorization
        ↓
React Dashboard and Analytics UI
        ↓
Authorized business users and controlled exports
```

## 11. Technical Architecture

### 11.1 Frontend stack

| Technology | Purpose |
|---|---|
| React 18 | Component-based user interface |
| TypeScript 5 | Static typing |
| Vite 5 | Development server and production bundling |
| Tailwind CSS CDN | Utility-based styling |
| Recharts | Area, bar, line, and composed charts |
| date-fns | Calendar and date calculations |
| SheetJS (`xlsx`) | Excel workbook generation |
| Lucide React | Icons |

`jspdf` and `jspdf-autotable` are declared dependencies but are not used by the current source code.

### 11.2 Source structure

```text
Renewal-Dashboard-Motor--main/
├── App.tsx                         Main application state, filters, and routing
├── constants.ts                   Filter options and mock-data generators
├── types.ts                       TypeScript domain and UI types
├── index.tsx                      React application entry point
├── index.html                     HTML shell, Tailwind CDN, font, and import map
├── components/
│   ├── Sidebar.tsx                Primary navigation
│   ├── TopCards.tsx               KPI cards
│   ├── TrendChart.tsx             Interactive renewal/premium chart
│   ├── CalendarWidget.tsx         Calendar and monthly export action
│   ├── PerformanceRanking.tsx     Entity ranking lists
│   ├── AdvancedAnalytics.tsx      Configurable analytics page
│   ├── DetailedReport.tsx         Entity drill-down report
│   └── IndiaMapStats.tsx          Retained placeholder; renders nothing
├── package.json                   Dependencies and Vite scripts
├── tsconfig.json                  TypeScript configuration
├── vite.config.ts                 Vite React plugin configuration
├── metadata.json                  AI Studio application metadata
└── README.md                      Basic local-run instructions
```

### 11.3 State management

The application uses React component state (`useState`) and derived values (`useMemo`). There is no external state-management library. Navigation is also state-based; the project does not use URL routing, so refreshing the page always returns to the initial Dashboard state.

### 11.4 Data generation

`generateDashboardData()` produces KPIs, chart points, branch/region rankings, manager rankings, and insurer rankings. A string-based pseudo-random function makes many generated results repeatable for the same filter combination. Some chart and report values use `Math.random()` and are not repeatable.

`generateRawExportData()` creates 50 synthetic policy records for Excel export.

## 12. Local Setup and Operation

### Prerequisites

- Node.js with npm.
- Internet access at runtime for the Tailwind CDN and Google Fonts used in `index.html`.

### Commands

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

Production build:

```bash
npm run build
npm run preview
```

The README requests a `GEMINI_API_KEY`, but the reviewed source code does not read or use that variable. No Gemini API call is present in the application.

## 13. Non-Functional Requirements for Production

The following are recommended requirements for converting the prototype into a production application:

- **Security:** Authentication, role-based access, authorization checks, secure sessions, and audit logs.
- **Privacy:** Mask personal information, control exports, encrypt data in transit and at rest, and define retention rules.
- **Performance:** Paginated APIs, server-side aggregation, caching, and response-time targets for dashboard queries.
- **Reliability:** Error handling, loading states, retry behavior, monitoring, and defined availability targets.
- **Accuracy:** Agreed definitions for due, renewed, lapsed, rollover, premium, completion rate, and reporting cut-off times.
- **Accessibility:** Keyboard navigation, semantic labels, focus states, chart alternatives, and contrast review.
- **Testing:** Unit, integration, component, end-to-end, and data-reconciliation tests.
- **Maintainability:** Move Tailwind to the build pipeline, remove conflicting CDN import-map versions, and add linting/formatting checks.
- **Responsiveness:** Validate fixed-height chart and ranking layouts on small screens and with long entity names.

## 14. Current Limitations and Risks

1. All business data is mock or static; displayed values cannot be used for business reporting.
2. No backend, database, API client, authentication, authorization, or audit trail exists.
3. Exported rows are generated independently from the dashboard totals and will not reconcile with displayed KPIs.
4. The Custom dashboard date values are not included in the mock-data seed or calculations.
5. The custom Analytics time frame has no date inputs.
6. Premium view uses a fixed ₹12,500 multiplier rather than actual premium values.
7. Trend comparisons on KPI cards are hard-coded text.
8. Detailed report KPI and activity values are static; its chart is random.
9. Future calendar dates still show generated due counts and premium estimates.
10. The application has no empty, loading, API-error, or access-denied states.
11. State-based navigation does not provide shareable URLs or browser history support.
12. The package versions in `package.json` differ from versions in the HTML import map; this should be normalized.
13. Tailwind is loaded from a CDN, which is not the recommended production build setup.
14. The repository does not include automated tests or a lockfile.

## 15. Recommended Production Backlog

### Priority 1: Data and security foundation

- Define metric and policy-status business rules.
- Design backend API contracts and the renewal data model.
- Integrate trusted policy, premium, branch, RM, and insurer data sources.
- Implement authentication and role-based authorization.
- Add secure export permissions and audit logging.

### Priority 2: Functional completion

- Make all filters, including custom dates and product line, affect API queries.
- Replace mock data and fixed trend labels with server results.
- Implement reconciled policy-level drill-down and export.
- Implement missing page actions and remove unused page types.
- Add loading, empty, and error states.

### Priority 3: Quality and operations

- Add unit and end-to-end tests.
- Add linting, formatting, and continuous-integration checks.
- Add application monitoring and business-data reconciliation.
- Improve accessibility and mobile behavior.
- Pin dependencies with a lockfile and remove unused packages.

## 16. Success Metrics

Once production data and workflows are integrated, success can be measured through:

- Increase in motor policy renewal rate.
- Reduction in lapsed policies and premium leakage.
- Improvement in rollover conversion.
- Faster identification of low-performing branches and RMs.
- Reduction in manual reporting effort.
- Improved reconciliation between dashboard totals and source systems.
- Faster operational follow-up on policies approaching due dates.
- Adoption and regular usage by authorized business teams.

## 17. Glossary

| Term | Meaning |
|---|---|
| NOP | Number of Policies |
| RM | Relationship Manager |
| PoSP | Point of Sales Person |
| Renewal | Continuation of an existing policy for a new policy period |
| Rollover | Renewal of a policy by moving it from the previous insurer to another insurer or channel, according to the organization's business definition |
| Due | Policy or premium expected for renewal in the selected period |
| Renewed | Due policy successfully renewed |
| Lapsed | Due policy not renewed within the applicable business rule |
| Completion Rate | Renewed divided by Due, multiplied by 100 |
| Failure Rate | Lapsed divided by Due, multiplied by 100 |

---

**Document note:** This document describes the behavior found in the repository as reviewed on 22 June 2026. Items marked as mock, partial, or not implemented should not be presented as production capabilities.
