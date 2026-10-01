# WhatsApp Calculator Accounting Bot

A Node.js bot for WhatsApp groups. In every group the bot is in, a message that is only an
arithmetic expression (`10+20-5`) or a signed adjustment (`+50`, `-12.5`) is added to that group's
running balance in PostgreSQL, and the bot replies with a receipt. A designated report group can ask
for every group's balance with `/calculate`.

## Requirements

- Node.js 18 or newer
- PostgreSQL 13 or newer
- A WhatsApp account for QR authentication
- PM2 for production process management

## Install Node.js

Download Node.js LTS from https://nodejs.org/ and verify:

```bash
node --version
npm --version
```

## Install PostgreSQL

Install PostgreSQL, then create a database:

```sql
CREATE DATABASE whatsapp_calculator;
```

Create a dedicated user if desired and grant access to the database.

## Configure Environment

Copy the example file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/whatsapp_calculator
CALCULATION_REPORT_GROUP_ID=120363000000000000@g.us
```

`CALCULATION_REPORT_GROUP_ID` is optional. It must end in `@g.us`, otherwise the bot refuses to start.
See [Finding a group id](#finding-a-group-id).

## Install Dependencies

```bash
npm install
```

## Run Locally With Docker

This is the easiest local test path because Docker starts PostgreSQL for you.

Copy the Docker env file:

```bash
cp .env.docker.example .env
```

Build and start PostgreSQL, migrations, and the bot:

```bash
docker compose up --build
```

Watch the terminal output for the WhatsApp QR code. Scan it from WhatsApp, then add that WhatsApp
account to your groups.

If the QR scrolls away, run:

```bash
docker compose logs -f bot
```

Stop the stack:

```bash
docker compose down
```

Reset all local Docker data, including database and WhatsApp session:

```bash
docker compose down -v
```

## Database Migration

Run:

```bash
npm run migrate
```

This creates:

- `calculation_balances`: one row per WhatsApp group with its running total and auto-detected name.
- `calculation_transactions`: an append-only record of every calculation, with the balance before and after.
- `calculate_access_groups`: extra groups (besides `CALCULATION_REPORT_GROUP_ID`) allowed to run `/calculate`.

The migration is safe to re-run. Tables from the previous version of the bot (`groups`,
`transactions`) are not used any more and are left untouched.

## Start Locally

```bash
npm start
```

On first start, scan the QR code printed in the terminal. The session is stored in
`.whatsapp-session/`, so PM2 restarts do not normally require scanning again.

## Start With PM2

Install PM2 globally:

```bash
npm install -g pm2
```

Start the bot:

```bash
pm2 start ecosystem.config.js
pm2 logs whatsapp-calculator-bot
```

Enable startup persistence:

```bash
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`.

## Supported WhatsApp Messages

Only group messages are processed; private chats are always ignored. Replies arrive as quoted
replies after a random 3–6 second delay.

### Calculations

The whole message must be the calculation. Operators are `+`, `-`, `*`, `/` and `÷`; standard
precedence applies and the result is rounded to 2 decimals (halves round away from zero).

```text
10+20-5
2+3*4-10/5
90.38÷5
10 + 20
-32*4
```

A single `-` directly before the first number is allowed and negates only that number: `-32*4`
records `-128.00` and `-5+3` records `-2.00`.

Not calculations (ignored): a bare number (`5`), a leading `+` on an expression (`+5*2`),
parentheses, `x` / `×` (reserved for inventory shorthand like `830x5`), commas (`1,000+1`),
`=`, division by zero, anything over 200 characters, and mixed chat such as `Bas 628 done kr do`.

Dates and phone numbers are evaluated too: `12/05/2026` records `0.00`, `0300-1234567` records
`-1234267.00`.

### Direct Adjustments

A single sign directly followed by a number (no space):

```text
+50
-12.5
+.5
```

### Reply

```text
MUSHFIK STORE

🤖 Start To Work
① 10+20=30.0
Cur Total: 30.0

All Total:30.0
```

`Cur Total` is this message's amount; `All Total` is the group's new running balance. Adjustments
show just the amount on the line after `🤖 Start To Work`. When the balance reaches exactly zero the
reply ends with `✅ Thanks! All clear.`

### `/calculate`

Works only in the group set as `CALCULATION_REPORT_GROUP_ID` or in a group with an active row in
`calculate_access_groups`; everywhere else it is silently ignored.

```text
📊 GROUP CALCULATION STATUS

Jerry Store: -900.0
Khan Group: 500.0

Grand Total: -400.0
```

Groups are labelled with their auto-detected WhatsApp name, or their id if the name could not be
read. To hide a group from the report, set `calculation_balances.active = FALSE` for it.

To let another group run `/calculate`:

```sql
INSERT INTO calculate_access_groups (group_id, group_name) VALUES ('120363000000000000@g.us', 'Office');
```

### Finding a group id

Send `/calculate` in the group. The bot logs `WhatsApp command received` with the `groupId`, even
when the group is not allowed to use the command.

## Security

- Does not use JavaScript `eval()`; expressions are parsed by a small hand-written evaluator.
- Ignores all private chats.
- Stores message IDs to protect against duplicate processing after reconnects.
- Uses PostgreSQL transactions and row locking for balance updates.
- Errors are logged, never sent to the group.
- Never commit `.env`.

## Backup Recommendations

Back up PostgreSQL regularly:

```bash
pg_dump whatsapp_calculator > whatsapp_calculator_backup.sql
```

Automate daily backups on your server and store copies off-machine.

## Troubleshooting

- **QR appears every restart**: ensure `.whatsapp-session/` is not deleted and PM2 runs from this project directory.
- **Bot does not reply to a calculation**: the message must be only the calculation (see the rules above), and it must be sent in a group. Check the logs for `Message processing failed`.
- **`/calculate` does not reply**: the group must be `CALCULATION_REPORT_GROUP_ID` or have an active `calculate_access_groups` row.
- **Group shows as an id in `/calculate`**: the bot could not read the group name from WhatsApp; it will pick it up on a later calculation in that group.
- **Database errors**: verify `DATABASE_URL`, PostgreSQL service status, and run `npm run migrate`.
- **Duplicate messages ignored**: expected behavior if WhatsApp replays an already processed message.

## Development

Run tests (Node's built-in `node:test`, no database needed):

```bash
npm test
```

Project structure:

```text
src/
  app.js
  config.js
  whatsapp/
  services/
  database/
  utils/
database/schema.sql
tests/
```
