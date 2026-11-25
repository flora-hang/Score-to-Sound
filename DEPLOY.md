# Launching with AI reading

This guide puts the app online on Cloudflare with:

- **AI reading** of PDFs and photos through your own Claude API key (users never see the key)
- **Sign-in** by email link or Google
- **5 free songs** for every new account, then **song packs and a monthly plan** paid through Stripe

Everything except the AI itself runs on Cloudflare. Menu names on these websites change from time to time, so a button may be worded slightly differently from what's written here.

You'll set up five accounts: **Anthropic** (the AI), **Cloudflare** (hosting and database), **Resend** (sign-in emails), **Google Cloud** (the "Continue with Google" button) and **Stripe** (payments). Do them in this order.

---

## 1. Anthropic: your Claude API key

1. Go to [platform.claude.com](https://platform.claude.com) and create an account (or sign in).
2. Add a payment method and buy some credit, e.g. $20. That's a few hundred pages of reading.
3. **Set a monthly spend limit** in the billing or limits settings. This caps what the app can ever cost you, even if something goes wrong.
4. Open **API keys**, create a key named `score-to-sound`, and copy it somewhere safe. It starts with `sk-ant-`. You'll paste it into Cloudflare in step 2.

## 2. Cloudflare: database and website

### 2a. Create the database
1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Open **Storage & databases → D1 SQL database → Create database**. Name it `score-to-sound` and create it.
3. Copy its **Database ID** (a long code like `3f2a…`).
4. On GitHub, open `wrangler.toml` in your repository, click the pencil icon, replace `REPLACE_WITH_YOUR_DATABASE_ID` with that ID, and commit.

### 2b. Create the tables
1. In Cloudflare, open your `score-to-sound` database and go to its **Console** tab.
2. On GitHub, open `migrations/0001_init.sql`, click **Copy raw file**, paste it into the Console and click **Execute**.
3. You should see the tables `users`, `sessions`, `jobs` and so on in the database's table list.

### 2c. Deploy the app from GitHub
1. In Cloudflare, open **Workers & Pages → Create → Import a repository** (connect your GitHub account when asked).
2. Choose **Score-to-Sound**. Set:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
3. Click **Deploy**. When it finishes you get an address like `https://score-to-sound.yourname.workers.dev`. Open it: the app should load, with a **Sign in** button in the top bar.

From now on, every change you commit on GitHub redeploys the app automatically.

### 2d. Add your secret keys
In Cloudflare, open your worker → **Settings → Variables and secrets → Add**. Choose type **Secret** for each:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the `sk-ant-…` key from step 1 |
| `RESEND_API_KEY` | from step 3 |
| `GOOGLE_CLIENT_ID` | from step 4 |
| `GOOGLE_CLIENT_SECRET` | from step 4 |

You can add the first one now and the others as you finish steps 3 and 4. Each feature switches on by itself once its key is there.

**Plan:** the free Workers plan is fine for trying things out. For launch, switch to **Workers Paid ($5/month)**: reading a busy page can take more processing than the free plan allows per request.

## 3. Resend: sign-in emails

1. Sign up at [resend.com](https://resend.com).
2. **Add your domain** (e.g. `scoretosound.com`) and add the DNS records it shows you. If your domain is on Cloudflare, Resend can add them for you. You need your own domain for emails to reach other people; before that, Resend's test sender only delivers to your own address.
3. Create an **API key** and add it to Cloudflare as `RESEND_API_KEY` (step 2d).
4. On GitHub, edit `wrangler.toml` and change `EMAIL_FROM` to an address on your domain, e.g. `"Score to Sound <signin@scoretosound.com>"`. Commit.

## 4. Google: "Continue with Google"

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project named `Score to Sound`.
2. Open **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"). Choose **External**, fill in the app name and support email, and add the scopes `openid`, `email` and `profile`. Under **Branding**, add your home page (`https://scoretosound.com`), privacy policy (`https://scoretosound.com/privacy`) and terms of service (`https://scoretosound.com/terms`). Leave the logo out at first: adding one makes Google review your branding, which takes days.
3. Open **Credentials → Create credentials → OAuth client ID**, type **Web application**.
4. Under **Authorized redirect URIs** add:
   `https://score-to-sound.yourname.workers.dev/api/auth/google/callback`
   (use your real address from step 2c, plus your own domain later if you add one).
5. Copy the **Client ID** and **Client secret** into Cloudflare as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (step 2d).
6. Back on the consent screen, set the publishing status to **In production**. While it says "Testing", only people you list as test users can sign in with Google.

## 5. Stripe: selling songs

Start in Stripe's **test mode**: everything works the same, but no real money moves. Switch to live mode only when you're ready to sell.

1. Sign up at [stripe.com](https://stripe.com). Make sure the **Test mode** switch (top right) is on.
2. **Product catalog → Add product**, twice:
   - **5 songs**: a **one-off** price, e.g. CA$4.99.
   - **Monthly plan**: a **recurring, monthly** price, e.g. CA$8.99.
   After saving each one, open its price and copy the **Price ID** (starts with `price_`).
3. **Developers → API keys**: copy the **Secret key** (starts with `sk_test_`).
4. **Developers → Webhooks → Add destination** (or "Add endpoint"):
   - **Endpoint URL:** `https://scoretosound.com/api/stripe/webhook`
   - **Events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Save, then copy the **Signing secret** (starts with `whsec_`).
5. **Settings → Billing → Customer portal**: turn it on. This is the page where people see receipts, change their card or cancel the plan.
6. In Cloudflare, add four more **Secrets** (step 2d):

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` from step 3 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 4 |
| `STRIPE_PRICE_PACK` | the 5-songs Price ID |
| `STRIPE_PRICE_MONTHLY` | the monthly Price ID |

7. In the database **Console**, run this once:

```sql
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at INTEGER NOT NULL);
```

8. **Test it:** open your account in the app, press **Buy**, and pay with card `4242 4242 4242 4242`, any future date and any 3 digits. You come back to the app and the songs appear within a few seconds. The app shows a yellow "Test mode" note while you use test keys.

How many songs each purchase gives is set in `wrangler.toml` (`PACK_SONGS`, `MONTHLY_SONGS`). Keep them matching what your Stripe products say. Monthly songs are refilled at each renewal and don't carry over; pack songs never expire.

**Going live:** in Stripe, finish **activating your account** (business details and a bank account for payouts). Then switch off test mode and repeat steps 2–4 in live mode (products, keys and the webhook are separate there). Replace the four Cloudflare secrets with the live values (`sk_live_…`, the new `whsec_…` and the live Price IDs).

## 6. Free note reading (optional, needs Workers Paid)

The free reader reads a PDF or photo without AI. Staff notation is read with [homr](https://github.com/liebharc/homr) (the notes, not the lyrics). 简谱 (numbered notation) is read with our own reader, `omr/jianpu.py` (the melody and the lyrics, using RapidOCR for the characters). Both run in one **Cloudflare Container** next to the app: `omr/` holds its Dockerfile and a small web server, and `wrangler.toml` sets its size (2 vCPU, 6 GB). A page takes about 22 seconds (staff) or 20 seconds (简谱).

1. **Switch to Workers Paid first** (Workers & Pages → Plans, $5/month). Containers aren't available on the free plan, and a deploy with a container fails without it.
2. Merge the change on GitHub. Cloudflare's build makes the container image (about 1 GB) and uploads it. The **first deploy takes several minutes**; later ones only upload what changed.
3. Check it: `https://scoretosound.com/api/config` should show `"omr":true`. In the app, open a PDF and choose **Read notes free** (or, for 简谱, **Read free**). The first page after a quiet spell takes longer while a reader starts.

Costs: with Workers Paid, roughly the first 500 pages a month are included; after that about 0.1¢ a page. Readers stop 3 minutes after the last page, and cost nothing while stopped.

Settings in `wrangler.toml`: `OMR_PAGES_PER_HOUR` (free pages per internet connection per hour, default 60) and `OMR_INSTANCES` (readers to share pages across, default 3; `max_instances` must be at least this). To switch free reading off without removing it, add `OMR_ENABLED = "0"` under `[vars]`.

## 7. Try it

1. Open your app's address, press **Sign in**, and sign in with email or Google.
2. The top bar should show **1 song**.
3. Press **Open score**, pick a PDF or some photos, and press **Read with AI**.
4. In the Anthropic console, check **Usage** to see what the reading cost.

---

## Settings you can change

All of these are in `wrangler.toml` under `[vars]`. Edit them on GitHub and commit; the app redeploys.

| Setting | Default | What it does |
|---|---|---|
| `TRIAL_SONGS` | 5 | Free songs for each new account |
| `PAGES_PER_SONG` | 6 | How many pages count as one song |
| `MODEL_PRIMARY` | claude-sonnet-5-5 | Model for the first reading of each page |
| `MODEL_RETRY` | claude-opus-5-5 | Model for the free retries (most careful) |
| `EFFORT` | medium | How hard the AI thinks before writing (low, medium, high). Higher can be more accurate but costs more |
| `MAX_OUTPUT_TOKENS` | 48000 | Most the AI may write per page, thinking included |
| `PAGES_PER_HOUR` | 60 | Most pages one person can read per hour |
| `TRIALS_PER_NETWORK_PER_DAY` | 20 | Free trials from one internet connection per day |
| `EMAILS_PER_HOUR` | 5 | Sign-in emails per address per hour |

## How credits work

- Every new account gets `TRIAL_SONGS` songs. The trial is **once per inbox**: `+tags` and Gmail dots don't create a new trial.
- Reading a score costs `ceil(pages ÷ PAGES_PER_SONG)` songs. The app shows the cost and asks before charging.
- **Reading the same file again is free.** Results are stored, so it doesn't call Claude again.
- **If nothing in a score can be read, the songs are refunded** automatically.
- Each page gets 2 free retries, using the stronger model. A busy AI service doesn't use up a retry.

**Giving someone songs by hand** (e.g. for a choir director): open the database **Console** in Cloudflare and run:

```sql
UPDATE users SET pack_songs = pack_songs + 5 WHERE email = 'person@example.com';
INSERT INTO credit_ledger (user_id, delta, bucket, reason, created_at)
  SELECT id, 5, 'pack', 'admin', unixepoch() * 1000 FROM users WHERE email = 'person@example.com';
```

**Useful numbers** (Console):

```sql
-- sign-ups, readings and AI usage
SELECT COUNT(*) AS users FROM users;
SELECT COUNT(*) AS readings, SUM(songs_charged) AS songs FROM jobs WHERE status = 'done';
SELECT model, COUNT(*) AS pages, SUM(input_tokens) AS input, SUM(output_tokens) AS output FROM job_pages GROUP BY model;
```

## Testing without spending money

- **Give yourself songs.** Run the "Giving someone songs by hand" SQL above with your own email. Each reading still costs a little on your Anthropic bill.
- **Payments:** keep Stripe in test mode (card `4242 4242 4242 4242`) until everything works.
- **The AI on its own:** in the Anthropic console, **Workbench** lets you try requests by hand, and **Usage** shows what each reading cost. Your API key is all the "developer access" you need.
- **The free reader on its own computer:** with Docker installed, `docker build -t omr omr/ && docker run -p 8080:8080 omr`, then send it a page: `curl --data-binary @page.png -H "content-type: image/png" localhost:8080/read` (staff notation, replies MusicXML) or `…/read-jianpu` (简谱, replies the app's text notation).
- **Everything on your own computer:** see "Running everything on your own computer" below. To test payments locally too, install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and run `stripe listen --forward-to localhost:8787/api/stripe/webhook`; put the `whsec_…` it prints into `.dev.vars`.

## Before you launch publicly

- **Privacy policy and terms:** say that page images are sent to Anthropic to be read, what you store (email, songs, the notes read from scores), and that scores are for personal practice of music the user has the right to use. Have a lawyer look them over.
- **Check Anthropic's commercial terms and usage policies** cover how you're using the API.
- **Keep the Anthropic spend limit** in place, and check usage weekly at first.

## Running everything on your own computer (optional, for developers)

```bash
npm install
cp dev.vars.example .dev.vars        # then put your Anthropic key in .dev.vars
npm run db:migrate:local             # creates the tables in a local test database
npm run dev:full                     # app + server at http://localhost:8787
```

With `DEV_MODE=1` in `.dev.vars`, sign-in links appear on screen instead of being emailed.

## The GitHub Pages copy

The GitHub Pages site keeps working, but it has no server, so it opens MusicXML files only. Once Cloudflare is live, you can turn Pages off in the repository's **Settings → Pages**, or keep it as a free demo.
