# Launching with AI reading

This guide puts the app online on Cloudflare with:

- **AI reading** of PDFs and photos through your own Claude API key (users never see the key)
- **Sign-in** by email link or Google
- **1 free song** for every new account, then song credits (payments come next)

Everything except the AI itself runs on Cloudflare. Menu names on these websites change from time to time, so a button may be worded slightly differently from what's written here.

You'll set up four accounts: **Anthropic** (the AI), **Cloudflare** (hosting and database), **Resend** (sign-in emails) and **Google Cloud** (the "Continue with Google" button). Do them in this order.

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
2. Open **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"). Choose **External**, fill in the app name, support email and logo, and add the scopes `openid`, `email` and `profile`.
3. Open **Credentials → Create credentials → OAuth client ID**, type **Web application**.
4. Under **Authorized redirect URIs** add:
   `https://score-to-sound.yourname.workers.dev/api/auth/google/callback`
   (use your real address from step 2c, plus your own domain later if you add one).
5. Copy the **Client ID** and **Client secret** into Cloudflare as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (step 2d).
6. Back on the consent screen, set the publishing status to **In production**. While it says "Testing", only people you list as test users can sign in with Google.

## 5. Try it

1. Open your app's address, press **Sign in**, and sign in with email or Google.
2. The top bar should show **1 song**.
3. Press **Open score**, pick a PDF or some photos, and press **Read with AI**.
4. In the Anthropic console, check **Usage** to see what the reading cost.

---

## Settings you can change

All of these are in `wrangler.toml` under `[vars]`. Edit them on GitHub and commit; the app redeploys.

| Setting | Default | What it does |
|---|---|---|
| `TRIAL_SONGS` | 1 | Free songs for each new account |
| `PAGES_PER_SONG` | 6 | How many pages count as one song |
| `MODEL_PRIMARY` | claude-sonnet-5-5 | Model for the first reading of each page |
| `MODEL_RETRY` | claude-opus-5-5 | Model for the free retries (most careful) |
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

## Before you launch publicly

- **Privacy policy and terms:** say that page images are sent to Anthropic to be read, what you store (email, songs, the notes read from scores), and that scores are for personal practice of music the user has the right to use. Have a lawyer look them over.
- **Check Anthropic's commercial terms and usage policies** cover how you're using the API.
- **Keep the Anthropic spend limit** in place, and check usage weekly at first.

## Running everything on your own computer (optional, for developers)

```bash
npm install
cp dev.vars.example .dev.vars        # then put your Anthropic key in .dev.vars
npm run db:migrate:local
npm run dev:full                     # app + server at http://localhost:8787
```

With `DEV_MODE=1` in `.dev.vars`, sign-in links appear on screen instead of being emailed.

## The GitHub Pages copy

The GitHub Pages site keeps working, but it has no server, so it shows only the free route (MusicXML and Audiveris). Once Cloudflare is live, you can turn Pages off in the repository's **Settings → Pages**, or keep it as a free demo.
