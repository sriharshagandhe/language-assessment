# Language Proficiency Assessment (self-hosted)

A web app that tests job candidates in **any language** and gives each skill a CEFR level (A1–C2). It runs on your own domain, e.g. `https://assessment.yourcompany.com`.

- **Grammar & vocabulary:** 12 questions, 2 at each level from A1 to C2
- **Reading:** 2 passages (B1, C1), 4 questions each
- **Listening:** 2 clips read aloud by the browser, 3 questions each, max 2 plays
- **Speaking:** 3 prompts (A2, B1–B2, C1). The browser turns the candidate's speech into text, and Claude grades it for fluency, grammar, vocabulary and coherence.

Claude writes a new test for every candidate. **The answer keys stay on the server**, and scoring happens there too, so candidates can't find the answers in their browser.

Recruiters sign in at `/admin` to:

- create one-time invite links (single or bulk)
- see results as candidates finish them
- open a candidate's detail page with speaking transcripts and feedback
- download all results as CSV
- let a candidate retake, or expire a link
- change settings: organisation name, time limit, whether candidates see their score, and an optional shared open link

---

> **No IT team?** Follow **[RAILWAY-SETUP.md](RAILWAY-SETUP.md)**. It's a click-by-click guide to hosting this yourself on Railway with your GitHub account, for about $5 a month.

## What IT needs to provide

| Item | Notes |
|---|---|
| A server or container host | Anything that runs Docker or Node.js 20+. About 256 MB RAM is enough. |
| A domain + HTTPS | e.g. `assessment.yourcompany.com`, behind your usual reverse proxy or load balancer. |
| An Anthropic API key | Create one at console.anthropic.com. You pay per use, and each assessment makes 3 Claude calls. Check current prices at https://www.anthropic.com/pricing. |
| Persistent storage | One SQLite file. Mount a volume at `/data` and back it up. |

## Quick start (Docker)

```bash
cp .env.example .env        # then fill in the values
openssl rand -hex 32        # paste the output into SESSION_SECRET
docker compose up -d --build
```

Open `http://<server>:3000/admin`, sign in with `RECRUITER_PASSWORD`, then put the app behind HTTPS on your domain and set `PUBLIC_URL` to that address.

## Quick start (without Docker)

```bash
npm ci --omit=dev
cp .env.example .env        # fill in the values
NODE_ENV=production node server.js
```

Use a process manager (systemd, pm2) to keep it running.

**Try it without an API key:** run `MOCK_AI=1 RECRUITER_PASSWORD=test SESSION_SECRET=$(openssl rand -hex 32) node server.js`. It serves placeholder questions, so you can click through the whole flow.

## Configuration (`.env`)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Server-side only. Never sent to browsers. |
| `RECRUITER_PASSWORD` | yes | Shared password for the recruiter dashboard. |
| `SESSION_SECRET` | no | 32+ random characters used to sign login cookies. If unset, one is generated and saved in `DATA_DIR`. |
| `PUBLIC_URL` | recommended | Base URL used in invite links, e.g. `https://assessment.yourcompany.com`. |
| `ANTHROPIC_MODEL` | recommended | Defaults to `claude-sonnet-4-5`. Set this to a current Sonnet model from the [models page](https://docs.claude.com/en/docs/about-claude/models). |
| `PORT` | no | Default `3000`. |
| `DATA_DIR` | no | Where `assessment.db` is stored. Default `./data` (`/data` in Docker). |
| `COOKIE_SECURE` | no | Defaults to `true` when `NODE_ENV=production`. The site must then be served over HTTPS. |
| `TRUST_PROXY` | no | Defaults to trusting one reverse proxy (needed for HTTPS detection and rate limiting). Set to `false` if the app is exposed directly. |

## How recruiters use it

1. Go to **/admin → Invite candidates**. Create a link for one candidate, or paste a list (`Name, email, role, language`, one per line).
2. Send each candidate their own link (`/t/…`). Each link can be used once. If a candidate refreshes the page, they continue where they left off and the timer keeps running.
3. Results appear under **Results**. Click a row to see transcripts and feedback, or use **Download CSV**.
4. Use **Allow retake** to issue a fresh link (earlier results are kept), or **Expire** to disable a link.

## Browser support for candidates

| Feature | Works in | Fallback |
|---|---|---|
| Speaking (speech-to-text) | Chrome, Edge (desktop and Android) | Candidate types their answers. Flagged as "speaking typed". |
| Listening (text-to-speech) | Any browser with a voice installed for that language | The clip text is shown instead. Flagged as "listening as text". |

**Tell candidates to use Chrome or Edge on a computer with a microphone.** The browser's speech recognition supports most major languages. Coverage for less common languages depends on the browser.

**Privacy note:** Chrome's built-in speech recognition sends audio to Google to be transcribed. If that isn't acceptable, replace the speaking capture in `public/js/candidate.js` with a server-side speech-to-text service of your choice.

## Scoring

- **Multiple-choice skills:** harder items are worth more (A1 = 1 point up to C2 = 6). The result is a score from 0 to 100, which maps to CEFR as follows: <15 Pre-A1, <30 A1, <45 A2, <60 B1, <75 B2, <90 C1, otherwise C2.
- **Speaking:** Claude grades the transcripts as a strict CEFR examiner. Pronunciation is **not** assessed, because only the transcript is graded.
- **Overall:** the average of the four skill scores.
- **Integrity flags** on each result: tab switches, time limit reached, typed speaking, listening shown as text.

This is a **screening tool**, not a certified exam. For hiring decisions at C1 and above, consider a short live conversation as well.

## Security notes

- Answer keys and the API key never reach the browser.
- Invite tokens are random (144-bit). Recruiter sessions use signed, HTTP-only cookies.
- Login, test generation and submission are rate-limited.
- Pages are served with a strict Content-Security-Policy and marked `noindex`.
- For single sign-on, put the `/admin` and `/api/admin` paths behind your identity proxy (Azure AD / Okta / Google IAP). Candidate links (`/t/…`, `/api/invite/…`) must stay public.

## Data

Everything is stored in `DATA_DIR/assessment.db` (SQLite). Back it up regularly, e.g. `sqlite3 assessment.db ".backup backup.db"`. To delete a candidate's data, use **Delete this result** on their detail page. Their invite row can then be removed from the database.

## Project layout

```
server.js            Express server, routes, scoring orchestration
src/ai.js            Claude API calls and prompts
src/scoring.js       Test validation, answer-key stripping, CEFR scoring
src/db.js            SQLite schema and settings
src/auth.js          Recruiter login, cookies, rate limiting
src/mock.js          Placeholder AI responses for MOCK_AI=1
public/candidate.html, public/js/candidate.js   Candidate test UI
public/admin.html,     public/js/admin.js       Recruiter dashboard
public/js/ui.js, public/style.css               Shared UI
```
