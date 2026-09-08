# Receipts to Concur

Pull a month of receipt photos out of Google Photos, have them read automatically,
correct the handful that need it, then send them into SAP Concur. Built for a
Pixel user who photographs receipts as they go and reconciles a corporate card
statement once a month.

The monthly job is four presses:

1. **Pick receipts from Google Photos** — select the month's photos in Google's
   own picker.
2. **Read receipts** — merchant, date, currency, total and tax come off each
   image automatically.
3. Glance at the **Needs a look** tab and fix anything flagged.
4. **Email to Concur**, or download the spreadsheet and images.

A **Reconcile** tab takes the card statement and pairs every charge to a receipt,
so what is left in each column is exactly what needs chasing.

---

## Why it does not just search Google Photos

Google withdrew library-wide API access to Google Photos on 31 March 2025. No
application can list, search or scan someone's photo library any more, whatever
scopes it asks for. The only sanctioned route is the **Google Photos Picker
API**: the user selects photos inside Google's own picker, and the application
receives access to just those items.

That turns out to suit this job well. Google Photos' own search is the
unreliable part, and the picker gives the full library with Google's date
filters and albums to select from. Once photos are picked, everything after that
is automatic, and this app keeps its own searchable index of what it has already
read, so the unreliable search is only in the loop once.

There is no way around the picker step. Anything claiming to scan the library
without it is either using an old, now-revoked integration or asking for the
Google account password.

---

## What you need

| Thing | Why | Cost |
|---|---|---|
| Google Cloud project with the Photos Picker API enabled | To open the picker and download the picked photos | Free |
| Anthropic API key | To read merchant, date and total off each photo | About 1 to 2 US cents per receipt |
| SMTP account, optional | To email receipts straight into Concur | Free with an existing mailbox |
| Node.js 22.5 or newer | The server uses Node's built-in SQLite | Free |

---

## Setup

### 1. Install

```bash
npm run setup
cp .env.example server/.env
```

### 2. Google Cloud setup

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create
   a project, or pick an existing one.
2. Under **APIs and services, Library**, enable the **Photos Picker API**.
3. Under **APIs and services, OAuth consent screen**, choose **External**, fill
   in the app name and your own email, and add yourself under **Test users**.
   Leave it in Testing mode. A personal tool used by its own author never needs
   Google verification.
4. Add the scope `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
5. Under **Credentials**, create an **OAuth client ID** of type **Web
   application**, and add this authorised redirect URI exactly:

   ```
   http://localhost:8787/api/auth/google/callback
   ```

6. Copy the client ID and client secret into `server/.env`.

### 3. Anthropic API key

Create a key at [console.anthropic.com](https://console.anthropic.com/settings/keys)
and put it in `server/.env` as `ANTHROPIC_API_KEY`. Reading a receipt costs
roughly one to two US cents, so a busy month of fifty receipts is under a dollar.

### 4. Emailing receipts into Concur, optional but worth it

SAP Concur accepts receipts by email and ties them to the traveller **by the
sending address**, so that address must be verified on the Concur profile first.

1. In Concur, open **Profile, Profile Settings, Email Addresses**, add the
   address you will send from, and enter the verification code Concur emails you.
2. Put that same address in `server/.env` as `SMTP_FROM`, along with the SMTP
   host, user and password.
3. For Gmail, generate an [app password](https://myaccount.google.com/apppasswords)
   and use that as `SMTP_PASS`. A normal account password will not work.

Two destinations are available in the app:

- `receipts@concur.com` puts each image in **Available Receipts**, ready to
  attach to an expense line. This works on every Concur plan.
- `receipts@expenseit.com` reads the image and **creates the expense entry**
  itself, landing it in Available Expenses. This needs an ExpenseIt licence.

### 5. Run it

```bash
npm run dev
```

The app opens at http://localhost:3000 and the server runs on port 8787. Press
**Connect Google Photos** once; the authorisation is remembered after that.

---

## The monthly routine

**Import.** Press **Pick receipts from Google Photos**. Google's picker opens in
a new tab, or scan the code shown to pick on the Pixel instead. Select the
month's receipts and press Done. The app notices, downloads them and adds them to
the table. Photos already imported are skipped, both by Google's own item ID and
by image content, so re-picking a month is safe.

**Read.** Press **Read N new receipts**. Each image goes to Claude, which returns
the merchant, date, currency, total, tax, payment method, card last four, line
items and an expense category, along with a confidence rating and notes on
anything it found doubtful.

**Check.** The **Needs a look** tab shows only rows worth attention: nothing
read, low confidence, a poor-quality photo, a missing total, or a possible
duplicate photo of the same receipt. Every field is editable in place, and an
edit always wins over what was read. Photos that are not expenses at all can be
marked **Not an expense** so they stay out of the exports.

**Send.** Either email everything into Concur in one press, or download the
spreadsheet and the images. The spreadsheet uses the Concur Quick Expense import
columns and adds two more, **Needs Review** and **Review Notes**, so a glance
down the file shows what to check. The ZIP contains the same spreadsheet plus
every image renamed to `2025-03-04_Pret-A-Manger_4.50-GBP.jpg`.

**Reconcile.** Export the month's card transactions from Concur, or download them
from the card provider, and drop the CSV on the **Reconcile** tab. Column names
are detected rather than fixed, so a file from any issuer works. Each receipt is
paired to a charge on amount, date and merchant name, and the three lists that
come back are:

- **Charges with no receipt** — the ones to chase or write off.
- **Receipts with no charge** — personal spend, cash, or a duplicate photo.
- **Paired** — with a confidence figure and the reason, so a weak pairing is
  visible rather than assumed.

Matching allows five days between the purchase and the card settling, and 2% on
the amount to absorb tips and foreign-exchange rounding. Pairing is one-to-one,
so two identical coffees on the same day pair off against two separate charges
rather than both claiming one.

---

## How the receipts are read

Each image goes to Claude with a schema it must fill in, so the reply is always
structured data rather than prose to be parsed. The prompt covers the things
that go wrong on real receipts:

- A handwritten tip total beats the printed subtotal.
- Day-first and month-first dates are resolved from the country, and a spelled-out
  month always wins over a numeric guess.
- Currency is inferred from the symbol, the country and the tax wording, so VAT
  implies the UK or the EU and GST implies Australia, Canada, India or Singapore.
- A hotel folio's total is the balance settled, not the sum of the nightly lines.
- An illegible value comes back as null with a note, never as a confident guess.

Images are fetched from Google at 2048 pixels on the long edge. Google renders
the resize, which keeps small print legible, keeps emails small, and means no
image library is needed locally.

---

## Privacy

Everything runs on the machine you start it on. Photos, extracted fields and the
authorisation token live in `server/data`, which is not committed. Receipt images
go to Anthropic to be read and to Concur if you use the email lane. Nothing else
leaves the machine. Pressing **Disconnect** deletes the stored Google token.

---

## Layout

```
src/receipts/        The app: import, table, export and reconcile panels
src/BluesHarpApp.tsx The unrelated harmonica tool this repository started as
server/src/google/   OAuth and the Photos Picker API client
server/src/extract/  Claude extraction and the merge of edits over readings
server/src/concur/   Statement parsing, matching, CSV, ZIP and email
server/src/pipeline.ts  Import and the background reading queue
server/test/         Tests for matching, CSV parsing and the export pipeline
```

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | Install both halves |
| `npm run dev` | Run the app and its server together |
| `npm run server` | Server only |
| `npm run build` | Production build of the app |
| `npm run typecheck` | Typecheck both halves |
| `npm run server:test` | Run the server tests |

## Known limits

- The picker step is manual by Google's design, as explained above.
- Multi-currency receipts are recorded in the currency printed on them. Converting
  to the settlement currency is left to Concur, which applies the company's rates.
- The Anthropic extraction path is covered by the schema and typechecking but is
  not exercised by the test suite, which would need a live API key. The import,
  edit, export and reconcile paths are covered end to end.
