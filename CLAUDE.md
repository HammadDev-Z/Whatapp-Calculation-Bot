# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start            # run the bot (src/app.js); prints WhatsApp QR on first auth
npm test             # jest --runInBand (all suites)
npm run migrate      # apply database/schema.sql to DATABASE_URL
npx jest tests/calculator.test.js          # single file
npx jest -t "falls back to message.from"   # single test by name
```

- Tests need **no database or WhatsApp connection** — `tests/transaction.test.js` runs an in-memory
  fake `pool` (`createMockPool` / `queryState`) that pattern-matches SQL strings. If you change a
  query in `transactionService.js` or `groupService.js`, update that fake accordingly or the tests
  silently exercise the wrong path.
- `src/database/pool.js` throws `DATABASE_URL is required` on import unless `NODE_ENV === 'test'`.
  Anything that `require`s the real pool (i.e. `src/app.js`) must have `DATABASE_URL` set.
- No lint/format tooling is configured.

## Local run with Docker (recommended)

`docker compose up --build` starts Postgres, runs `migrate` once (`condition: service_completed_successfully`),
then starts `bot`. Set `AUTHORIZED_NUMBERS` in `.env` first (copy `.env.docker.example`). Watch logs for
the QR: `docker compose logs -f bot`. `docker compose down -v` wipes DB + WhatsApp session volumes.

## Architecture

WhatsApp group accounting bot. Each group has one running balance (`groups.current_total`) and an
append-only `transactions` ledger. `src/app.js` wires `whatsapp/client` → `whatsapp/messageHandler`.

### Message flow (`src/whatsapp/messageHandler.js`)

`createMessageHandler(pool)` returns the `message` event listener. Every inbound message passes these
gates in order, each a silent `return` on failure:

1. Not `fromMe`.
2. `getGroupContext` — must be a group (`message.from` ends with `@g.us`); private chats ignored.
   Falls back to `message.from` as both id and name if `getChat()` throws.
3. **Authorization** — `getSenderIdentity` collects *every* candidate id for the sender (raw
   `author`/`from`, normalized digits, `getContact()` number + `id._serialized` + `id.user`) because
   WhatsApp may deliver a `@lid` id instead of a phone number. `isAnyAuthorized` passes if *any*
   candidate matches `AUTHORIZED_NUMBERS`. Never narrow this back to a single-number check.
4. Non-empty body, and `isDuplicateMessage(pool, messageId)` — dedupe against replayed messages on
   reconnect (also enforced by the `transactions.message_id` UNIQUE constraint).

Then the body is dispatched by exact/prefix match (lowercased): `total`, `history [n]`, `setname …`,
`reset` / `reset confirm`, `undo`, else `looksLikeCalculation(text)` → `handleCalculation`, else
`return` (mixed chat like `Bas 628 done` is ignored). A `null` handler result means "no reply".

`reset` is a two-step confirm held in the in-memory `resetRequests` Map (5-min TTL, keyed by
group+sender) — this state is lost on restart by design.

### Calculator (`src/services/calculatorService.js`)

`VALID_EXPRESSION_PATTERN` is the single source of truth for what counts as a calculation: optional
leading `+`/`-`, numbers, and `+ - * /` only — **no parentheses, no functions, no `eval`**. Commas are
stripped. Evaluated with a `mathjs` instance configured for `BigNumber` precision 64, then coerced
through `decimal.js` and rounded to 2 dp. `transactionType` is `'adjustment'` for a bare signed number
(`+500`, `-400`) and `'calculation'` otherwise.

### Persistence (`src/services/transactionService.js`, `groupService.js`)

All balance mutations follow the same pattern: `pool.connect()` → `BEGIN` → `getOrCreateGroup` →
`lockGroup` (`SELECT … FOR UPDATE`) → re-check duplicate → insert transaction → `UPDATE groups.current_total`
→ `COMMIT`, with `ROLLBACK` + `error.code === '23505'` treated as a duplicate. Money math is always
`decimal.js` with `.toFixed(2)`; the DB columns are `NUMERIC(20,2)`.

- `recordTransaction` — calculations and adjustments; `amount` is the signed delta.
- `resetGroup` — inserts a `reset` row with `amount = -current_total`.
- `undoLatest` — finds the newest `calculation|adjustment|reset` not already referenced by some row's
  `undone_transaction_id`, inserts an `undo` row with the negated amount and `undone_transaction_id`
  set. Undo of an undo is not possible (undo rows aren't candidates).

`getHistory` queries newest-first with `LIMIT` then `.reverse()` so the caller renders oldest-first.

### Config (`src/config.js`)

All env-driven. `AUTHORIZED_NUMBERS` is comma-separated, digits only, no `+`. `historyMaxLimit` is
floored to `historyDefaultLimit`. `CHROME_EXECUTABLE_PATH` is set to `/usr/bin/chromium` in Docker
(Puppeteer's own download is skipped via `PUPPETEER_SKIP_DOWNLOAD`).

## Deployment

`ecosystem.config.js` for PM2 (`pm2 start ecosystem.config.js`), single instance, autorestart,
`max_memory_restart: 300M`. WhatsApp session persists in `.whatsapp-session/` (`LocalAuth`); deleting
it forces a re-scan. The Docker entrypoint clears stale Chromium `Singleton*` locks from the session
dir before start.
