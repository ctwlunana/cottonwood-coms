# COMS — Database Relationship Diagram

Legend: tables marked **[S1]** are implemented in Stage 1; others are the
planned design for later stages (may be refined, never silently dropped).
All tables have `id uuid PK`, `created_at`, `updated_at` unless noted.

## 1. Identity, RBAC, organization [S1]

```mermaid
erDiagram
  departments ||--o{ users : "home department"
  users ||--o{ user_roles : has
  roles ||--o{ user_roles : granted
  roles ||--o{ role_permissions : defines
  permissions ||--o{ role_permissions : "in matrix (scope)"
  users ||--o{ sessions : "logs in"
  users ||--o{ password_reset_tokens : resets
  users ||--o{ location_assignments : "PIC / TL of"
  locations ||--o{ location_assignments : has
  locations ||--o{ properties : contains
  properties ||--o{ property_assignments : staffed
  users ||--o{ property_assignments : "keeper/inspector of"
  properties ||--o{ attachments : photos
  users ||--o{ audit_logs : actor
  users ||--o{ notifications : receives
  notifications ||--o{ notification_delivery_logs : delivered
  users ||--o{ notification_preferences : configures

  users {
    uuid id PK
    string employee_code UK
    string username UK
    string full_name
    string email
    string phone
    string password_hash
    bool is_active
    bool must_change_password
    uuid department_id FK
    timestamptz last_login_at
    timestamptz deleted_at
  }
  departments {
    uuid id PK
    string code UK
    string name
    bool is_active
  }
  roles {
    uuid id PK
    string slug UK
    string name
    string description
    bool is_system
  }
  permissions {
    string code PK
    string module
    string description
    bool scoped
  }
  role_permissions {
    uuid role_id FK
    string permission_code FK
    enum scope "own|assigned|department|all"
  }
  user_roles {
    uuid user_id FK
    uuid role_id FK
    uuid granted_by FK
    timestamptz granted_at
  }
  sessions {
    uuid id PK
    uuid user_id FK
    string token_hash UK
    inet ip
    string user_agent
    timestamptz expires_at
    timestamptz last_seen_at
    timestamptz revoked_at
  }
  password_reset_tokens {
    uuid id PK
    uuid user_id FK
    string token_hash UK
    uuid issued_by FK
    timestamptz expires_at
    timestamptz used_at
  }
  login_attempts {
    uuid id PK
    string username
    inet ip
    bool success
    timestamptz at
  }
  locations {
    uuid id PK
    string code UK
    string name
    string area
    bool is_active
  }
  location_assignments {
    uuid id PK
    uuid location_id FK
    uuid user_id FK
    enum kind "location_pic|hk_team_leader"
    timestamptz ended_at
  }
  properties {
    uuid id PK
    string code UK
    string name
    uuid location_id FK
    string address
    enum status "active|temporarily_unavailable|under_maintenance|inactive"
    int bedrooms
    int bathrooms
    uuid hk_team_id FK
    text notes
    timestamptz deleted_at
  }
  property_assignments {
    uuid id PK
    uuid property_id FK
    uuid user_id FK
    enum kind "villa_keeper|location_pic|inspector"
    timestamptz started_at
    timestamptz ended_at
  }
  attachments {
    uuid id PK
    string entity_type
    uuid entity_id
    string kind
    string storage_key
    string mime
    int size_bytes
    uuid uploaded_by FK
  }
  audit_logs {
    bigint id PK
    uuid user_id FK
    string action
    string entity_type
    string entity_id
    jsonb before
    jsonb after
    inet ip
    string user_agent
    timestamptz at
  }
  notifications {
    uuid id PK
    uuid user_id FK
    string type
    string title
    string body
    string link
    enum priority
    string dedupe_key
    timestamptz read_at
  }
  notification_delivery_logs {
    uuid id PK
    uuid notification_id FK
    enum channel "in_app|email|whatsapp"
    enum status "pending|sent|failed|skipped"
    int retry_count
    string error
    timestamptz sent_at
  }
  notification_preferences {
    uuid user_id FK
    string type
    bool email
    bool whatsapp
    bool in_app
  }
  system_settings {
    string key PK
    jsonb value
    uuid updated_by FK
  }
  id_counters {
    string key PK
    int value
  }
```

## 2. Property operations, engineering, housekeeping [S2]

```mermaid
erDiagram
  properties ||--o{ checklist_submissions : inspected
  checklist_templates ||--o{ checklist_template_items : has
  checklist_templates ||--o{ checklist_submissions : uses
  checklist_submissions ||--o{ checklist_answers : contains
  checklist_template_items ||--o{ checklist_answers : answers
  checklist_answers |o--o| maintenance_requests : "failed item raises"
  properties ||--o{ maintenance_requests : reported
  maintenance_requests ||--o| work_orders : "converted to"
  work_orders ||--o{ work_order_updates : timeline
  work_orders ||--o{ work_order_materials : uses
  equipment ||--o{ work_orders : concerns
  properties ||--o{ equipment : installed
  preventive_maintenance_schedules ||--o{ work_orders : generates
  equipment ||--o{ preventive_maintenance_schedules : scheduled
  suppliers ||--o{ work_orders : "external vendor"
  hk_teams ||--o{ hk_team_members : members
  hk_teams ||--o{ hk_assignments : assigned
  properties ||--o{ hk_assignments : cleaned
  hk_assignments ||--o{ hk_assignment_staff : "housekeepers"
  hk_assignments ||--o{ hk_inspections : inspected
  hk_assignments |o--o| hk_assignments : "re-clean of"

  work_orders {
    uuid id PK
    string code UK
    uuid property_id FK
    uuid request_id FK
    string category
    enum priority "critical|high|normal|low"
    enum status "new|under_review|assigned|in_progress|waiting_parts|waiting_approval|completed|verified|closed|cancelled"
    uuid assigned_to FK
    uuid supervisor_id FK
    uuid vendor_id FK
    timestamptz deadline
    numeric estimated_cost
    numeric actual_cost
    bool keeper_confirmation_required
    timestamptz verified_at
    timestamptz closed_at
  }
  hk_assignments {
    uuid id PK
    uuid property_id FK
    date checkout_date
    timestamptz expected_done_at
    uuid team_id FK
    enum priority
    enum status "pending|assigned|in_progress|cleaning_completed|inspection_required|inspection_failed|reclean_required|ready"
    text instructions
  }
  hk_inspections {
    uuid id PK
    uuid assignment_id FK
    uuid inspector_id FK
    enum result "pass|fail"
    text notes
  }
```

Villa readiness (`ready`) is set **only** by a passing `hk_inspections`
row — never by cleaning completion.

## 3. Customer service & Lost & Found [S3]

```mermaid
erDiagram
  guest_cases ||--o{ guest_case_tasks : "split into"
  guest_cases ||--o{ guest_communication_logs : "talked"
  guest_cases ||--o{ case_status_history : history
  guest_cases }o--o| properties : about
  guest_cases }o--|| users : "case owner"
  guest_case_tasks }o--|| users : "task owner"
  guest_case_tasks }o--o| work_orders : "linked WO"
  guest_case_tasks }o--o| approvals : "linked approval"
  guest_case_tasks }o--o| payments : "linked payment"
  shift_reports ||--o{ shift_report_cases : covers
  guest_cases ||--o{ shift_report_cases : included
  shift_reports ||--o{ shift_handover_notes : notes
  lost_found_items ||--o{ lost_found_handover_records : "chain of custody"
  lost_found_items ||--|| guest_cases : "CS case"
  properties ||--o{ lost_found_items : found_in

  guest_cases {
    uuid id PK
    string code UK
    string guest_name
    string guest_phone
    string guest_email
    string booking_channel
    string booking_ref
    date checkin_date
    date checkout_date
    enum category
    enum priority
    enum status "new|assigned|in_progress|waiting_approval|waiting_guest|waiting_other_dept|resolved|closed|cancelled"
    uuid case_owner_id FK
    uuid department_id FK
    timestamptz deadline
    timestamptz first_response_at
    text resolution_notes
  }
  lost_found_items {
    uuid id PK
    string code UK
    uuid property_id FK
    string item_description
    string category
    bool high_value
    uuid finder_id FK
    string storage_location
    enum status "stored|guest_contacted|awaiting_handover|handed_over|shipped|received|unclaimed|disposed"
    string tracking_number
  }
```

## 4. Inventory & purchasing [S4]

```mermaid
erDiagram
  inventory_items ||--o{ stock_movements : moves
  inventory_locations ||--o{ stock_movements : "source / destination"
  properties ||--|| inventory_locations : "villa store (1:1)"
  inventory_items ||--o{ stock_balances : balance
  inventory_locations ||--o{ stock_balances : holds
  properties ||--o{ par_stock : "par levels"
  inventory_items ||--o{ par_stock : "per villa"
  stock_requests ||--o{ stock_request_lines : lines
  stock_request_lines ||--o{ stock_movements : "fulfilled by"
  purchase_requests ||--o{ purchase_request_lines : lines
  purchase_requests ||--o{ quotations : quoted
  suppliers ||--o{ quotations : offers
  quotations |o--o| purchase_orders : "selected"
  purchase_orders ||--o{ purchase_order_lines : lines
  purchase_orders ||--o{ goods_receipts : received
  goods_receipts ||--o{ goods_receipt_lines : lines
  goods_receipt_lines ||--o{ stock_movements : "purchase receipt"
  purchase_orders ||--o{ supplier_invoices : billed
  suppliers ||--o{ supplier_bank_accounts : "verified accounts"

  stock_movements {
    uuid id PK
    string code UK
    uuid item_id FK
    numeric quantity
    enum type "purchase_receipt|transfer|issue_to_villa|return|damaged|lost|adjustment"
    uuid source_location_id FK
    uuid dest_location_id FK
    uuid requested_by FK
    uuid approved_by FK
    uuid executed_by FK
    uuid received_by FK
    string reference_type
    uuid reference_id
  }
  stock_balances {
    uuid item_id FK
    uuid location_id FK
    numeric quantity
  }
  supplier_bank_accounts {
    uuid id PK
    uuid supplier_id FK
    string bank
    string account_no
    enum status "pending_verification|verified|rejected"
    uuid entered_by FK
    uuid verified_by FK
  }
```

## 5. Finance, accounting, approvals [S5]

```mermaid
erDiagram
  approval_rules ||--o{ approvals : "decides route"
  approvals ||--o{ approval_decisions : history
  approvals }o--|| users : requester
  payments }o--o| supplier_invoices : pays
  payments }o--o| guest_cases : "refund/compensation"
  payments }o--o| work_orders : "maintenance"
  payments }o--o| petty_cash_accounts : replenishes
  expenses }o--o| payments : "recorded from"
  petty_cash_accounts ||--o{ petty_cash_transactions : ledger
  petty_cash_transactions ||--o| expenses : "expense claim"
  petty_cash_accounts ||--o{ petty_cash_reconciliations : reconciled

  approval_rules {
    uuid id PK
    enum request_type "pr|po|maintenance_expense|refund|compensation|petty_cash|stock_adjustment|exceptional_expense"
    numeric min_amount
    numeric max_amount
    uuid department_id FK
    uuid approver_role_id FK
    int level
  }
  approvals {
    uuid id PK
    string code UK
    enum request_type
    string entity_type
    uuid entity_id
    numeric amount
    uuid requested_by FK
    enum status "pending|approved|rejected|revision_requested|escalated|cancelled"
    int current_level
  }
  approval_decisions {
    uuid id PK
    uuid approval_id FK
    uuid decided_by FK
    enum decision
    jsonb before
    jsonb after
    text comment
  }
  payments {
    uuid id PK
    string code UK
    enum kind "vendor|refund|compensation|petty_cash_replenish|electricity_token|other"
    numeric amount
    string recipient
    string method
    uuid approval_id FK
    enum status "pending_approval|approved|scheduled|paid|failed|cancelled"
    uuid processed_by FK
    date paid_on
  }
  expenses {
    uuid id PK
    string code UK
    string category
    numeric amount
    uuid payment_id FK
    uuid recorded_by FK
    enum reconciliation "unreconciled|matched|discrepancy"
  }
  petty_cash_accounts {
    uuid id PK
    uuid custodian_id FK
    numeric float_amount
    numeric balance
  }
```

## Key constraints (enforced in DB and/or service layer)

* `CHECK (approved_by <> requested_by)` on approvals/stock movements/payments.
* Unique active assignment: one active `villa_keeper` per property
  (partial unique index `WHERE ended_at IS NULL`).
* `audit_logs` UPDATE/DELETE blocked by trigger.
* `stock_balances.quantity >= 0` unless an authorized exception movement.
