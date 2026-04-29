# QIB IT Service Portal Database Schema

## Core Tables

| Table | Purpose |
| --- | --- |
| `departments` | Bank departments used for ownership, routing, and reporting. |
| `users` | Employees and approvers with role-based access control. |
| `service_requests` | Main IT service requests with request number, type, status, priority, SLA, and JSON form payload. |
| `approval_steps` | Ordered workflow chain per request with role, approver, action, note, and timestamp. |
| `request_comments` | Internal or visible notes on requests. |
| `attachments` | Secure upload metadata linked to requests. |
| `notifications` | In-app notification queue, extendable to email and WhatsApp. |
| `audit_logs` | Immutable action trail for logins, approvals, edits, exports, and admin actions. |

## Request Types

- `email`
- `domain`
- `vpn_remote_access`
- `internet_access`
- `data_copy`
- `network_access`
- `computer_move_installation`
- `it_support_ticket`

## Roles

- `employee`
- `direct_manager`
- `it_staff`
- `it_manager`
- `information_security`
- `executive_management`
- `super_admin`

## Workflow Examples

VPN:
`Employee -> Direct Manager -> Information Security -> IT Manager -> Implementation -> Closed`

Data Copy:
`Employee -> Direct Manager -> Information Security -> IT Manager -> Executive Management -> Execution -> Closed`
