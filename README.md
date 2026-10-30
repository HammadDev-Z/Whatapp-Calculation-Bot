# WhatsApp Calculator Accounting Bot

A Node.js bot for WhatsApp groups. In every group the bot is in, a message that is only an
arithmetic expression (`10+20-5`) or a signed adjustment (`+50`, `-12.5`) is added to that group's
running balance in PostgreSQL, and the bot replies with a receipt. A designated report group can ask
for every group's balance with `/calculate`. An admin website (see [Website](#website)) controls
which phone numbers the bot answers and what name each group's receipts carry.

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

Only group messages are processed; private chats are always ignored. Replies arrive instantly as quoted
replies.

### Calculations

The whole message must be the calculation. Operators are `+`, `-` and `*`; `*` is done first (`2+3*4` is `14`), and the result is
rounded to 2 decimals (halves round away from zero).

```text
10+20-5
4*6-8
10 + 20
-32*4
```

A single `+` or `-` directly before the first number is allowed; a `-` negates only that number:
`-32*4` records `-128.00`, `-5+3` records `-2.00` and `+5*2` records `10.00`.

Not calculations (ignored): a bare number (`5`),
division (`/`, `÷`, so `10/2` gets no reply), parentheses, `x` / `×`
(reserved for inventory shorthand like `830x5`), commas (`1,000+1`),
`=`, anything over 200 characters, and mixed chat such as `Bas 628 done kr do`.

Phone numbers are evaluated too: `0300-1234567` records `-1234267.00`. Dates like `12/05/2026`
contain `/`, so they are ignored.

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

The header is `MUSHFIK STORE` by default. When a name is saved for the group on the website, it
becomes `MUSHFIK X <NAME>` in capitals, e.g. `MUSHFIK X HAMMAD`.

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

The website's Groups page lists every group the bot has seen, with its id. Groups appear after
someone sends a calculation or `/calculate` in them. The bot also logs `WhatsApp command received`
with the `groupId` for `/calculate`.

## Website

The website is how you manage the bot day to day. Sign in, then:

- **Groups**: give each group a name. Receipts in that group start with `MUSHFIK X <NAME>`. Groups
  with no name keep `MUSHFIK STORE`. You can also add a group by its id (`...@g.us`).
- **Numbers**: add phone numbers (digits with the country code, e.g. `923001234567`) and switch
  each one **Active** or **Disabled**. **The bot only answers active numbers**, for calculations and
  for `/calculate`. Everyone else is ignored silently. A new install has no numbers, so add yours
  first. People who were ignored are listed under *Recently ignored* with an Add button, which is
  the easiest way to add someone.
- **Account**: change the password. Changing it signs every other device out.

Changes reach the bot within about 5 seconds. WhatsApp sometimes identifies a sender by an
internal id (ending `@lid`) instead of a phone number. The bot looks up the real number when it
can; when it cannot, *Recently ignored* shows the internal id, and adding that works the same way.

### Setting up the website on your domain (Docker)

1. In `.env` set `SITE_DOMAIN` (e.g. `codeguy.pp.ua`), `ADMIN_USERNAME` and `ADMIN_PASSWORD`
   (8+ characters). They only create the first admin; afterwards change the password on the
   Account page.
2. Point the domain at the server: create an **A record** for the domain (and `www` if you want it)
   with the server's public IP. If the domain is on "Parking NS" at the registrar, either switch it
   to the registrar's real DNS or change its nameservers to a DNS host (for example Cloudflare), and
   create the A record there. DNS can take from a few minutes to a few hours.
3. Open ports **80 and 443** on the server's firewall or cloud security group.
4. Start it and add HTTPS in front of it. Pick the one that matches your server:
   - **Ports 80 and 443 are free:** run `docker compose --profile caddy up --build -d`. Caddy
     requests and renews the HTTPS certificate by itself once the A record resolves. Check with
     `docker compose logs -f caddy`.
   - **nginx (or another web server) already uses them:** run `docker compose up --build -d`. The
     website then listens on `127.0.0.1:3100` (change it with `WEB_HOST_PORT`). Add an nginx site
     that forwards your domain to it:

     ```nginx
     server {
         listen 80;
         server_name codeguy.pp.ua;

         location / {
             proxy_pass http://127.0.0.1:3100;
             proxy_set_header Host $host;
             proxy_set_header X-Real-IP $remote_addr;
             proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
             proxy_set_header X-Forwarded-Proto $scheme;
         }
     }
     ```

     Save it as `/etc/nginx/sites-available/calculator-site`, link it into `sites-enabled`, run
     `nginx -t && systemctl reload nginx`, then `certbot --nginx -d codeguy.pp.ua` to get the
     HTTPS certificate. Keep the `X-Forwarded-Proto` line: the website uses it to mark its login
     cookie as secure.
5. Open `https://<your domain>` and sign in.

Without Docker, run `npm run web` (or `pm2 start ecosystem.config.js`, which starts the bot and the
website) and put a reverse proxy with HTTPS (nginx or Caddy) in front of port 3000. Set `PORT`,
`ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`.

If you forget the password, remove the admin so a new one is created from `.env` on the next start:
`docker compose exec postgres psql -U whatsapp_bot -d whatsapp_calculator -c "DELETE FROM admin_users;"`
then `docker compose restart web`.

## Security

- The website needs a login, uses HTTPS (through nginx or Caddy), hashes passwords with scrypt, rate-limits
  failed sign-ins and protects forms against CSRF.
- Does not use JavaScript `eval()`; expressions are parsed by a small hand-written evaluator.
- Ignores all private chats, and any group message from a number that is not active on the website.
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
