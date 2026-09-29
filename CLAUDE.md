# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start            # run the bot (src/app.js); prints WhatsApp QR on first auth
npm test             # node --test (built-in node:test runner, all tests/*.test.js)
npm run migrate      # apply database/schema.sql to DATABASE_URL
node --test tests/calculator.test.js                       # single file
node --test --test-name-pattern="grand total"              # single test by name
```

- Tests need **no database or WhatsApp connection**. `tests/messageHandler.test.js` injects fake
  repositories plus stubbed `sleep`/`random`; `tests/calculationRepository.test.js` uses a fake pool
  that records SQL and answers by `sql.startsWith(...)`. If you change a query's leading keywords in a
  repository, update the matching fake.
- `npm test` is plain `node --test` (no path) so it works on Node 18–24; default discovery skips
  `node_modules`. Node 22+ rejects a directory argument.
- `src/database/pool.js` throws `DATABASE_URL is required` on import unless `NODE_ENV === 'test'`.
  Anything that `require`s the real pool (i.e. `src/app.js`) must have `DATABASE_URL` set.
- `src/config.js` throws at import if `CALCULATION_REPORT_GROUP_ID` is set but doesn't end in `@g.us`.
- No lint/format tooling is configured.

## Local run with Docker (recommended)

`docker compose up --build` starts Postgres, runs `migrate` once (`condition: service_completed_successfully`),
then starts `bot`. Copy `.env.docker.example` to `.env` first (`CALCULATION_REPORT_GROUP_ID`, `LOG_LEVEL`).
Watch logs for the QR: `docker compose logs -f bot`. `docker compose down -v` wipes DB + WhatsApp
session volumes. Postgres is **not** published to the host (reachable only as `postgres:5432` on the
compose network); add a `ports:` mapping with a free host port if you need to connect from outside.
The `migrate` and `bot` services have separate `environment:` blocks; bot-only settings live only in `bot`.

## Architecture

WhatsApp group running-balance calculator, built to an exact external spec — **reply text, parsing and
rounding are character-exact requirements; do not "improve" quirks** (e.g. dates/phone numbers being
evaluated). Each group has one balance (`calculation_balances.current_total`) and an append-only
`calculation_transactions` ledger. `src/app.js` builds the two repositories and passes them to
`createMessageHandler({ calculationRepository, calculateAccessRepository, reportGroupId })`.

### Message flow (`src/whatsapp/messageHandler.js`)

1. Ignore missing messages, `fromMe`, and anything whose `message.from` doesn't end in `@g.us`.
   There is **no per-group enable/verify and no sender check** — calculations run in every group.
2. `parseCalculation(body)` runs **first**; if it returns non-null, command parsing is skipped.
3. Calculation path: `serializeMessageId` (empty → ignore) → in-memory `inFlight` Set guard (removed
   in `finally`) → `sender = author || from` stored raw (may be `@lid`) → `resolveGroupName` (best
   effort, never throws; warns once per group per process when null) → `calculationRepository.record`
   (`duplicate` → silent) → **random 3–6 s sleep after the DB write** → `message.reply`.
4. Otherwise `parseCommand` — only `/calculate` (`^/calculate\s*$`i on the trimmed body). Allowed if
   `groupId === reportGroupId` or `calculateAccessRepository.isAllowed(groupId)`; else silent. Same
   random delay before replying.
5. Every error is caught and logged as `Message processing failed`; **nothing is ever sent to the
   group on error** (DB overflow on huge numbers = silence).

`sleep`, `random` and `logger` are injectable — tests stub them; keep new delays going through them.

### Parser (`src/services/calculatorService.js`)

- Trim; empty or `> 200` chars → `null`. `NUMBER = \d+(\.\d+)?|\.\d+` (ASCII digits only; no `5.`,
  `1e5`, commas).
- Adjustment checked first: `^[+-]NUMBER$` (no space after the sign) → `type: 'adjustment'`.
- Expression: `^NUMBER(\s*OP\s*NUMBER)+$` with OP `+ - * / ÷`. Must start with a number and contain
  an operator, so bare `5` and `-5+3` are `null`. **`x`/`X`/`×` are intentionally not operators.**
- Evaluated by a hand-written shunting-yard over a private `decimal.js` clone (precision 20,
  `ROUND_HALF_UP`); intermediates unrounded. Division by zero anywhere → `null`.
- `amount` is a 2dp **string** (`"30.00"`), never `-0.00`; `expression` is the trimmed text with
  internal whitespace/newlines kept verbatim (it is echoed in the reply).

### Formatting (`src/utils/formatter.js`) and reply text

`formatAmount`: 2dp, then a trailing `00` collapses to `0` (`30.00` → `30.0`, `12.50` stays), `-0` → `0.0`.
The receipt header is the hard-coded `MUSHFIK STORE` / blank / `🤖 Start To Work`; the expression line
is `① <expression>=<amount>` (adjustments: amount only). `Cur Total: ` has a space, `All Total:` has
none. A zero balance appends a blank line + `✅ Thanks! All clear.`. Tests assert the full strings.

### Persistence (`src/services/calculationRepository.js`, `calculateAccessRepository.js`)

`record` runs on one checked-out client: `BEGIN` → duplicate check on `message_id` → upsert the balance
row (`ON CONFLICT … RETURNING current_total` = balance before; locks the row) → `UPDATE … current_total
+ $2::numeric RETURNING` = balance after → insert ledger row → `COMMIT`; any error → `ROLLBACK` +
rethrow. The amount is always **added** (never a reset). `COALESCE(EXCLUDED.group_name, …)` means a
null auto-detected name never overwrites a stored one. `pg` returns `NUMERIC` as strings.

`listBalances` returns only `active = TRUE` rows ordered by `COALESCE(group_name, group_id)`.
`calculate_access_groups` and `calculation_balances.active` have no command or UI — they are managed in SQL.

`database/schema.sql` is re-applied in full on every migrate/`docker compose up`, so every statement must
be idempotent (`IF NOT EXISTS`). The legacy `groups` / `transactions` tables from the previous bot
version are not dropped and not read.

## Deployment

`ecosystem.config.js` for PM2 (`pm2 start ecosystem.config.js`), single instance, autorestart,
`max_memory_restart: 300M`. Single instance matters: the `inFlight` dedupe set and the
once-per-group warning are per-process. WhatsApp session persists in `.whatsapp-session/`
(`LocalAuth`); deleting it forces a re-scan. The Docker entrypoint clears stale Chromium `Singleton*`
locks from the session dir before start.
