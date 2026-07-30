-- Fix content drift between the live `questions` table and index.html (source
-- of truth per claude-code-spec.md's Architecture section).
--
-- Task 2 review found 11 of the 36 seed rows applied by
-- 20260730003929_seed_v1_questions.sql do not match what
-- `node scripts/gen-seed-migration.mjs` produces from the current
-- index.html: in every case, index.html has a typographic/curly quote
-- (U+2019 RIGHT SINGLE QUOTATION MARK, or U+201C/U+201D LEFT/RIGHT DOUBLE
-- QUOTATION MARK) where the previously-applied row instead has a straight
-- ASCII quote. Confirmed by re-running the unmodified generator script
-- against the unmodified index.html and diffing against both the committed
-- migration file and a live `select` from this table — same 11 ids, same
-- fields, in both comparisons.
--
-- This migration does NOT edit the already-applied
-- 20260730003929_seed_v1_questions.sql in place (that file was already
-- pushed to the remote project; retroactively editing an applied migration
-- desyncs local and remote migration history). Instead it corrects the 11
-- live rows via UPDATE, generated mechanically (not hand-transcribed) by a
-- comparison script run against a fresh read of index.html, so the fix
-- carries the same provenance guarantee as the original seed migration.
--
-- Rows touched: M02, M06, M07, I05, I07, I08, I09, B03, B06, C05, C06.
-- All other 25 v1 rows already matched and are untouched by this migration.

update questions set
  unit = 'FSA-bootcamp',
  topic = 'Accounting Mechanics',
  concept = 'Accrual basis',
  stem = 'A consulting firm completes a project in March and receives payment in April. Under accrual accounting, revenue is recognized in:',
  choices = '["April, when cash is received","March, when the service is performed","Either month, at management’s discretion"]'::jsonb,
  answer = 1,
  why = 'Accrual accounting recognizes revenue when the performance obligation is satisfied, not when cash moves. March gets the revenue; April merely converts a receivable to cash.'
where id = 'M02';

update questions set
  unit = 'FSA-bootcamp',
  topic = 'Accounting Mechanics',
  concept = 'Debits & credits',
  stem = 'Debits increase which pair of accounts?',
  choices = '["Assets and expenses","Liabilities and revenues","Equity and liabilities"]'::jsonb,
  answer = 0,
  why = 'Debits increase assets and expenses (and dividends); credits increase liabilities, equity, and revenues. If this isn’t reflexive yet, rebuild the mnemonic — everything in FSA sits on it.'
where id = 'M06';

update questions set
  unit = 'FSA-bootcamp',
  topic = 'Accounting Mechanics',
  concept = 'Accruals',
  stem = 'Employees earn $8,000 of wages in the last week of December, paid on January 5. In the December financial statements this appears as:',
  choices = '["No entry until cash is paid in January","Wage expense of $8,000 and a wages payable liability of $8,000","A $8,000 reduction of cash and wage expense"]'::jsonb,
  answer = 1,
  why = 'The expense belongs to the period the labor was consumed (December). Since cash hasn’t moved, the credit side is a liability — wages payable. January’s payment then clears the liability, touching no expense.'
where id = 'M07';

update questions set
  unit = 'FSA',
  topic = 'Income Statement',
  concept = 'Net income',
  stem = 'Revenue $800, COGS $450, SG&A $150, interest expense $40, tax rate 25%. Net income is closest to:',
  choices = '["$160","$120","$140"]'::jsonb,
  answer = 1,
  why = 'EBT = 800 − 450 − 150 − 40 = 160. Tax = 160 × 25% = 40. Net income = 120. The $160 distractor is pre-tax income; $140 forgets SG&A’s full effect... always run the waterfall in order.'
where id = 'I05';

update questions set
  unit = 'FSA',
  topic = 'Income Statement',
  concept = 'Gains vs revenue',
  stem = 'A delivery company sells an old van for more than its carrying value. The excess is reported as:',
  choices = '["Revenue","A gain, typically within other income","An extraordinary item"]'::jsonb,
  answer = 1,
  why = 'Revenue comes from ordinary activities (deliveries); disposing of equipment is peripheral, so the excess over carrying value is a gain. (“Extraordinary items” no longer exist under either GAAP or IFRS.)'
where id = 'I07';

update questions set
  unit = 'FSA',
  topic = 'Income Statement',
  concept = 'Expenses',
  stem = 'Which of the following is an expense on a retailer’s income statement?',
  choices = '["Repayment of loan principal","Dividends paid to shareholders","Store rent for the period"]'::jsonb,
  answer = 2,
  why = 'Rent consumes resources to generate revenue — an expense. Principal repayment reduces a liability (balance sheet), and dividends are distributions of earnings, not costs of earning them.'
where id = 'I08';

update questions set
  unit = 'FSA',
  topic = 'Income Statement',
  concept = 'Matching',
  stem = 'A firm pays a 2% sales commission when goods are sold. Commissions on December sales, paid in January, are expensed in:',
  choices = '["December, with the related revenue","January, when paid","Split between the two periods"]'::jsonb,
  answer = 0,
  why = 'Matching: the commission is caused by December’s sale, so it’s accrued as December expense with a payable. Cash timing is irrelevant to recognition.'
where id = 'I09';

update questions set
  unit = 'FSA',
  topic = 'Balance Sheet',
  concept = 'Liquidity ratios',
  stem = 'Cash $40,000, receivables $80,000, inventory $60,000, prepaid expenses $20,000, current liabilities $100,000. The quick ratio is closest to:',
  choices = '["2.0","1.2","1.8"]'::jsonb,
  answer = 1,
  why = 'Quick ratio = (cash + short-term investments + receivables)/CL = (40+80)/100 = 1.2. Inventory and prepaids are excluded — they’re the least reliably convertible to cash. 2.0 is the current ratio.'
where id = 'B03';

update questions set
  unit = 'FSA',
  topic = 'Balance Sheet',
  concept = 'Contra accounts',
  stem = 'Accumulated depreciation is best described as:',
  choices = '["An expense","A liability","A contra-asset that reduces the carrying value of PP&E"]'::jsonb,
  answer = 2,
  why = 'It’s not an obligation to anyone and it’s not the period’s expense — it’s the running total of all depreciation taken, presented against the asset’s cost. Depreciation expense (income statement) feeds it each period.'
where id = 'B06';

update questions set
  unit = 'FSA',
  topic = 'Cash Flow Statement',
  concept = 'Indirect method',
  stem = 'Under the indirect method, an increase in accounts receivable during the period is:',
  choices = '["Added to net income","Subtracted from net income","Ignored — receivables are not cash"]'::jsonb,
  answer = 1,
  why = 'Rising receivables mean some recognized revenue wasn’t collected in cash yet, so net income overstates cash — subtract the increase. The general rule: asset up → cash down.'
where id = 'C05';

update questions set
  unit = 'FSA',
  topic = 'Cash Flow Statement',
  concept = 'Indirect method',
  stem = 'Under the indirect method, an increase in accounts payable during the period is:',
  choices = '["Added to net income","Subtracted from net income","Reported as a financing inflow"]'::jsonb,
  answer = 0,
  why = 'Rising payables mean the firm consumed goods it hasn’t paid cash for — expenses overstate cash outflow, so add the increase back. Liability up → cash up. Trade payables are operating, not financing.'
where id = 'C06';
