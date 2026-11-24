# Set up the Language Assessment on Railway (no IT needed)

Time: about 20 minutes. You need a GitHub account, a Railway account (you can sign in with GitHub), an Anthropic account and a company card.

Monthly cost: Railway Hobby is about $5 a month, which includes $5 of usage, plus Claude usage of a few cents per candidate.

---

## Step 1: Get your Anthropic API key (5 min)

1. Go to **console.anthropic.com** and sign in or create an account.
2. Open **Billing** and add a card or buy credits. $10–20 is plenty to start.
3. Open **API Keys** → **Create Key**. Name it `language-assessment`.
4. **Copy the key** (it starts with `sk-ant-`) and keep it somewhere safe. You only see it once.

## Step 2: Put the app on GitHub (5 min)

1. Unzip `language-assessment-app.zip` on your computer.
2. On github.com click **+** (top right) → **New repository**.
   - Name: `language-assessment`
   - Choose **Private**
   - Click **Create repository**
3. On the next page click the link **"uploading an existing file"**.
4. Open the unzipped `lang-assessment-app` folder. Select **everything inside it** (`server.js`, `package.json`, `Dockerfile`, `railway.json`, the `src` and `public` folders, and so on) and drag it onto the GitHub page.
   - Drag the *contents*, not the folder itself. `server.js` must end up at the top level of the repository.
   - Use Chrome or Edge so the folders upload too.
5. Click **Commit changes**.

## Step 3: Deploy on Railway (5 min)

1. Go to **railway.com** → **Login** → **Login with GitHub**.
2. Choose the **Hobby** plan under your account settings → **Plans**.
3. Click **New Project** → **Deploy from GitHub repo**.
   - If asked, click **Configure GitHub App** and give Railway access to the `language-assessment` repository.
4. Select `language-assessment`. Railway starts building automatically, which takes 2–4 minutes. The first build may fail because the settings aren't added yet. That's normal.

## Step 4: Add storage so results are kept (2 min)

1. In your project, right-click the empty canvas (or click **+ Create**) → **Volume**.
2. Attach it to the `language-assessment` service.
3. Set **Mount path** to: `/data`

Without this step, results are wiped every time the app restarts.

## Step 5: Add the settings (2 min)

Click the `language-assessment` service → **Variables** tab → **New Variable**, and add:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the `sk-ant-…` key from Step 1 |
| `RECRUITER_PASSWORD` | a long password recruiters will use to sign in |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` (or a newer Sonnet model listed at docs.claude.com/en/docs/about-claude/models) |

Click **Deploy** (or **Apply changes**) when Railway prompts you.

## Step 6: Get your link (1 min)

1. Open the service → **Settings** → **Networking** → **Generate Domain**.
2. You'll get an address like `language-assessment-production.up.railway.app`.
3. Open **`https://<your-address>/admin`** and sign in with your `RECRUITER_PASSWORD`.

Done. Go to **Invite candidates**, create links and send them out.

---

## Optional: use your own address (assessment.mediamint.com)

1. In Railway: **Settings** → **Networking** → **Custom Domain**. Enter `assessment.mediamint.com`.
2. Railway shows a **CNAME** record. Send it to whoever manages the mediamint.com domain and ask them to add it. It's a 5-minute task.
3. Once it shows as verified, add a variable `PUBLIC_URL` = `https://assessment.mediamint.com`, so invite links use the new address.

## Updating the app later

Upload changed files to the GitHub repository (**Add file** → **Upload files**). Railway redeploys automatically, and results on the volume are kept.

## If something goes wrong

- **Build or deploy failed:** open the service → **Deployments** → click the failed one → **View logs**. Most problems are a missing variable.
- **"We couldn't prepare your assessment":** check that `ANTHROPIC_API_KEY` is correct and that your Anthropic account has credit.
- **Results disappeared after a restart:** the volume isn't attached at `/data` (Step 4).
- **Try it without an API key first:** add the variable `MOCK_AI` = `1` to get placeholder questions. Remove it when you're ready.
