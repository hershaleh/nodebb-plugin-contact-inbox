# NodeBB Contact Inbox

A standalone NodeBB 4.x plugin that receives public contact-form submissions and provides a private, permission-checked inbox for authorized staff.

## Planned capabilities

- Public submission API for the existing Custom Pages contact form.
- Private inbox UI with unread count, search, status filters and message details.
- Shared read state: the first authorized staff member to open a submission marks it read for everyone.
- Access defaults to the `administrators` group; additional groups are configurable.
- Per-staff email notification opt-in and individual destination address.
- Optional email replies, disabled until the forum mail transport and sender address are configured.
- Direct chat shortcut for submissions associated with an existing NodeBB user.
- Replies and internal activity history stored in NodeBB's database.
- Manual deletion by default; optional automatic retention period.
- Server-side authorization, CSRF protection, validation and submission throttling.

## Installation

Install from the Git repository after the server-side plugin installer accepts GitHub HTTPS URLs, or package/publish the plugin through npm.

Then run the NodeBB build and restart commands required by your deployment.

## Contact form API

The public form submits JSON to:

`POST /api/plugins/contact-inbox/submissions`

Fields: `name`, `email`, `subject`, `message`, and optional `username` (or a validated NodeBB user id).

## Important

Email replies are an optional feature. The plugin must not attempt outbound email until an administrator explicitly enables replies and configures the forum mail transport. Automatic deletion is disabled by default.

## Development

`npm test` runs the automated tests.
`npm run lint` checks JavaScript syntax.
