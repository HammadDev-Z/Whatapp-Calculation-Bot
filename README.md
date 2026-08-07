# WhatsApp Calculator Accounting Bot

A production-ready Node.js bot for WhatsApp groups. Authorized users can send arithmetic calculations or balance adjustments, and each group keeps an independent PostgreSQL-backed balance and audit history.

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
AUTHORIZED_NUMBERS=923001234567,923331234567
```

Authorized numbers must be digits only with country code, without `+`.

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

Edit `.env` and set your WhatsApp number:

```env
AUTHORIZED_NUMBERS=923165057787
```

Build and start PostgreSQL, migrations, and the bot:

```bash
docker compose up --build
```

Watch the terminal output for the WhatsApp QR code. Scan it from WhatsApp, then add that WhatsApp account to your group.

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

- `groups`: one row per WhatsApp group, with independent totals.
- `transactions`: immutable audit records for calculations, resets, and undos.

## Start Locally

```bash
npm start
```

On first start, scan the QR code printed in the terminal. The session is stored in `.whatsapp-session/`, so PM2 restarts do not normally require scanning again.

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

Only authorized users in groups are processed. Unauthorized users and private chats are ignored.

### Calculations

```text
5*50.32
10*30
500/2
100+50
900-200
```

Messages must contain only the calculation itself. The bot ignores mixed chat such as `Bas 628 done kr do`.

### Direct Adjustments

```text
+500
-400
+1250.50
-75.25
```

### Commands

```text
total
history
history 20
reset
reset confirm
undo
setname AWAN STORE
```

`history` limits are controlled by `HISTORY_DEFAULT_LIMIT` and `HISTORY_MAX_LIMIT`.

## Security

- Does not use JavaScript `eval()`.
- Uses `mathjs` only for arithmetic expressions.
- Ignores unauthorized numbers silently.
- Stores message IDs to protect against duplicate processing after reconnects.
- Uses PostgreSQL transactions and row locking for balance updates.
- Never commit `.env`.

## Backup Recommendations

Back up PostgreSQL regularly:

```bash
pg_dump whatsapp_calculator > whatsapp_calculator_backup.sql
```

Automate daily backups on your server and store copies off-machine.

## Troubleshooting

- **QR appears every restart**: ensure `.whatsapp-session/` is not deleted and PM2 runs from this project directory.
- **Bot ignores messages**: confirm the chat is a group and `AUTHORIZED_NUMBERS` contains the sender number with country code.
- **Database errors**: verify `DATABASE_URL`, PostgreSQL service status, and run `npm run migrate`.
- **Duplicate messages ignored**: expected behavior if WhatsApp replays an already processed message.
- **No reply to chat**: messages must be only direct numeric calculations like `89-54`, `-7`, `78`, or `5*5`.

## Development

Run tests:

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
