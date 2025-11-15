# **Product Requirements Document (PRD)**

**Product name (working):** Relay

**Version:** v1.0

**Owner:** Avi

**Primary user:** VC or operator scanning their own Gmail newsletters for new consumer startups

**Release mode:** Private alpha (whitelisted Google OAuth test users)

**Platforms:** Web (desktop‑first)

**Stack:** SvelteKit (frontend), Convex (backend/data/queue), OpenAI (LLM), Google OAuth \+ Gmail API, Vercel (hosting)

---

## **0\. TL;DR / One‑liner**

Connect Gmail → scan Substack/Beehiiv/Buttondown newsletters from the last 90 days → LLM extracts **new consumer company** mentions with evidence → present a deduped, scored list you can review, save, ignore, and export.

---

## **1\. Goals & Non‑Goals**

### **Goals**

1. **Surface net‑new consumer startups** from users’ newsletter inboxes quickly and reliably.

2. **Be auditable:** every extraction must come with snippets and source email links.

3. **Be minimally invasive:** store only what’s necessary; purge raw evidence after 30 days.

4. **Keep it simple:** one flow, one screen, power‑friendly keyboard review, CSV export.

### **Non‑Goals (v1)**

* Automated daily/continuous ingestion (manual “Scan Now” only).

* Team features, sharing, comments.

* Third‑party data enrichment (Crunchbase/Clearbit).

* Notion/Airtable sync (CSV only).

* Non‑Gmail providers.

---

## **2\. Users, Personas, JTBD**

**Persona:** Solo investor / scout / operator who receives many newsletters and needs a systemized way to pull startup leads without reading everything.

**Jobs‑to‑be‑done:**

* *When I connect my Gmail*, I want to *scan relevant newsletters* so I can *see a clean list of potential consumer startups to investigate*.

* *When I review candidates*, I want to *skim a one‑liner and evidence* so I can *quickly decide to save or ignore*.

* *When I’m done*, I want to *export a CSV* for my own CRM.

---

## **3\. Scope & Requirements**

### **3.1 Functional Requirements**

**FR‑1 Onboarding & Auth**

* Google Sign‑In with OAuth.

* Request scopes: gmail.readonly, openid, email, profile.

* Show scope rationale and retention policy (30‑day snippet TTL).

**FR‑2 Scan Configuration**

* Defaults: sources Substack/Beehiiv/Buttondown; window **90 days**; latest message per thread; parse links.

* UI allows changing time window (7/30/90/custom). (Retain default for v1; extra options visible.)

**FR‑3 Gmail Ingestion**

* Query candidate messages using Gmail q with:

  * newer\_than:90d (or selected window)

  * has:link

  * Broad filters to reduce noise (e.g., \-is:chat)

* For each candidate: fetch **metadata** (From, Subject, List-Id, Date) first.

* Classify as newsletter from Substack/Beehiiv/Buttondown via:

  * List-Id contains substack, beehiiv, buttondown, OR

  * From domain contains those strings, OR

  * platform-specific footer patterns (Substack “View in browser”, etc.).

* Only then fetch **full body** for classified newsletters.

**FR‑4 Content Normalization**

* Decode MIME.

* Prefer text/html part; fallback to text/plain.

* Strip boilerplate, nav, footers; preserve paragraphs and anchor hrefs.

* Extract and keep all links present in the article body.

**FR‑5 Company Extraction (LLM)**

* Use OpenAI with JSON‑schema “tool calling” and temperature 0–0.2.

* Hard rule: **no invention**. Every company must have evidence **from the email text or a linked page we fetched**.

* Output fields (per company):

  * name (string)

  * homepage\_url (URL)

  * alt\_domains (string\[\])

  * one\_line\_summary (≤140 chars)

  * category (enum: Consumer AI, Fintech, Commerce, Health, Social, Creator Tools, Marketplaces, Productivity, Gaming, Hardware, Other)

  * stage (enum: pre-seed, seed, A, B, unknown)

  * location (string | null)

  * key\_signals (set: waitlist, launch, funding, traction, notable\_founder, partnership)

  * source\_email\_ids (string\[\])

  * source\_snippets (array of {quote: string, start?: int, end?: int})

  * confidence (0–1)

* Exclude: public companies, enterprise‑only, pure commentary, or **sponsored** placements.

* Attach 1–2 snippets per extraction.

**FR‑6 Link Fetcher / Lightweight Enrichment**

* For any link that appears to be a company homepage (heuristics: domain name not in blocklist of publishers; title/OG tags suggest product), do a single GET:

  * 2s timeout, 256KB max body.

  * Extract \<title\>, meta description/OG tags, canonical URL, and obvious social links.

* Provide this content to the LLM as secondary context for stronger summaries and validation.

**FR‑7 Deduplication & Upsert**

* Canonical key: normalized homepage\_url domain when available; fallback to normalized name.

* Fuzzy name match: Jaro‑Winkler ≥ 0.92 to merge.

* Merge rules: keep highest confidence, union key\_signals, append unique source\_email\_ids, keep most informative one\_line\_summary (pick longest ≤140 with strongest verbs).

**FR‑8 Scoring & Ranking**

* Compute a numeric score per candidate:

  * score \= 0.5\*confidence \+ 0.2\*signal\_score \+ 0.15\*recency\_score \+ 0.1\*novelty \- 0.15\*sponsor\_penalty

  * signal\_score: waitlist=0.3, launch=0.5, funding=0.6 (Seed=0.6, A=0.7, B=0.6), traction=0.4, notable\_founder=0.3 (cap at 1.0)

  * recency\_score: 1.0 if ≤7 days; 0.5 if ≤30; 0.2 otherwise.

  * novelty: 0.3 if company first seen in this run; else 0\.

  * sponsor\_penalty: 1.0 if suspected sponsor → effectively suppress.

* Default sort: score DESC, then email\_date DESC, then name.

**FR‑9 Review UI**

* List view: name, domain, one‑liner, chips for category/stage/signals, score badge.

* Evidence popover: 1–2 quotes with highlights; link to original email (deep link to Gmail by messageId).

* Actions: **Save**, **Ignore**, **Copy** (name \+ URL \+ summary), **Export CSV** (all saved/visible).

* Filters: Category, Stage, New vs Seen Before, Source platform.

* Keyboard shortcuts: j/k navigate, s save, x ignore, c copy.

**FR‑10 Export**

* CSV columns: name, homepage\_url, one\_line\_summary, category, stage, location, key\_signals (semicolon‑sep), score, first\_seen\_at, last\_seen\_at, sources (messageIds comma‑sep).

**FR‑11 Cost & Safety Controls**

* Per‑run soft cost cap: **$2.00**; when approaching cap:

  * Adaptive sampling: skip low‑signal emails (short/snippet‑only; or body \< 500 chars; or no links).

  * Early‑exit: stop extraction and show partial results with “cost cap reached”.

**FR‑12 Observability**

* Per‑run summary: emails scanned, newsletters classified, extractions found, saved/ignored counts, API tokens used, cost estimate.

* Basic error console for failed emails (reason codes).

---

### **3.2 Non‑Functional Requirements**

* **Performance:** 50 emails end‑to‑end under \~60 seconds on average with parallel I/O.

* **Reliability:** Partial results must render even if some messages fail.

* **Security & Privacy:**

  * Store **no full email bodies**; store only message IDs, minimal header metadata, and short snippets.

  * Snippet retention: 30 days auto‑purge; structured records retained until user deletes.

  * OAuth refresh tokens encrypted at rest (AES‑256‑GCM) using a server‑side key in environment secrets.

  * Role: single‑tenant per account; no cross‑user access.

* **Compliance posture:** Google OAuth in **testing** mode with whitelisted users (no public app verification in v1).

* **Accessibility:** Keyboard support; color‑contrast ≥ WCAG AA for chips/badges; focus states.

* **Internationalization:** Not required v1; assume English newsletters.

---

## **4\. Information Architecture & Data Model (Convex)**

### **4.1 Tables**

**users**

* id (pk)

* google\_user\_id (string, unique)

* email (string)

* created\_at (ts)

* settings (json: time\_window\_days default 90, retention\_days 30\)

**oauth\_tokens**

* user\_id (fk users)

* provider (enum: google)

* access\_token\_enc (string)

* refresh\_token\_enc (string)

* expiry (ts)

* scopes (string\[\])

**emails**

* id (gmail messageId, pk)

* user\_id (fk)

* thread\_id (string)

* from (string)

* subject (string)

* date (ts)

* list\_id (string | null)

* platform (enum: substack|beehiiv|buttondown|unknown)

* snippet (short string)

* has\_body\_cached (bool)

* ingest\_status (enum: classified|fetched|failed)

* failure\_reason (string | null)

* **Index:** (user\_id, date DESC), (user\_id, platform, date DESC)

**email\_bodies** *(ephemeral store; auto‑purged 30 days)*

* message\_id (fk emails.id, pk)

* html\_excerpt (string ≤ 16KB)

* text\_excerpt (string ≤ 16KB)

* links (string\[\])  // deduped hostnames \+ full URLs

**companies**

* id (pk, ulid)

* user\_id (fk)

* name (string)

* homepage\_url (string)

* domain (string normalized)

* one\_line\_summary (string ≤ 140\)

* category (enum)

* stage (enum)

* location (string | null)

* key\_signals (string\[\]) // set semantics

* score (float)

* first\_seen\_at (ts)

* last\_seen\_at (ts)

* sources (string\[\]) // gmail messageIds

* confidence (float)

* status (enum: saved|ignored|new)

* **Index:** (user\_id, score DESC), (user\_id, domain), (user\_id, name)

**runs**

* id (pk)

* user\_id (fk)

* started\_at, finished\_at

* time\_window\_days (int)

* emails\_examined (int)

* newsletters\_classified (int)

* candidates\_found (int)

* saved\_count (int)

* ignored\_count (int)

* openai\_tokens\_prompt (int)

* openai\_tokens\_completion (int)

* openai\_cost\_usd (float)

* status (enum: success|partial|failed)

* notes (string)

---

## **5\. Key Flows**

### **5.1 Onboarding**

1. Landing page → “Connect Google”.

2. OAuth: request gmail.readonly, openid, email, profile.

3. Post‑auth: show settings summary (window=90d, sources=Substack/Beehiiv/Buttondown).

4. CTA: “Scan Now”.

### **5.2 Scan Now (single run)**

1. Create runs row.

2. Gmail list call with q assembled for window; page through messages (ids only).

3. For each ID:

   * users.messages.get **metadata** only; classify as platform; skip non‑matches.

   * For matches, fetch **full** message (HTML/plain); normalize, extract links; persist to email\_bodies (excerpted).

4. Batch emails (e.g., 10–20 per LLM call) → run LLM extraction per email (one message/feed at a time is safer for auditability; v1 do 1:1).

5. For each returned company:

   * If homepage\_url present, fetch homepage (timeout/size caps) to enrich; pass to LLM as additional validation step (optional re‑ask only if low confidence).

   * Dedup/upsert into companies; recalc score; update first/last seen.

6. Update run metrics; show progress UI incrementally.

7. Render results screen.

### **5.3 Review & Export**

* Filters \+ keyboard review.

* Save/Ignore toggles update status and adjust score (optional \+0.05 for saved, ‑0.1 for ignored to de‑emphasize).

* Export CSV of **saved** (default) or **visible** rows.

---

## **6\. LLM Contract**

### **6.1 System Prompt (essence)**

* You are extracting **consumer startups** from newsletter text.

* Never invent entities. Only return companies explicitly mentioned in the text or linked pages we fetched.

* Exclude sponsors/ads/public companies.

* Return **valid JSON** matching the provided schema.

* For each company include 1–2 short quotes (evidence) from the newsletter; include the Gmail messageId we give you.

### **6.2 Tool / Schema (OpenAI function-calling)**

{

  "name": "extract\_companies",

  "description": "Extract consumer startups mentioned in the newsletter",

  "parameters": {

    "type": "object",

    "properties": {

      "companies": {

        "type": "array",

        "items": {

          "type": "object",

          "required": \["name", "one\_line\_summary", "source\_snippets", "source\_email\_ids", "confidence"\],

          "properties": {

            "name": { "type": "string" },

            "homepage\_url": { "type": "string" },

            "alt\_domains": { "type": "array", "items": { "type": "string" } },

            "one\_line\_summary": { "type": "string", "maxLength": 140 },

            "category": { "type": "string", "enum": \["Consumer AI","Fintech","Commerce","Health","Social","Creator Tools","Marketplaces","Productivity","Gaming","Hardware","Other"\] },

            "stage": { "type": "string", "enum": \["pre-seed","seed","A","B","unknown"\] },

            "location": { "type": "string" },

            "key\_signals": { "type": "array", "items": { "type": "string", "enum": \["waitlist","launch","funding","traction","notable\_founder","partnership"\] } },

            "source\_email\_ids": { "type": "array", "items": { "type": "string" } },

            "source\_snippets": { "type": "array", "items": { "type": "object", "required": \["quote"\], "properties": { "quote": { "type": "string" }, "start": { "type": "integer" }, "end": { "type": "integer" } } }, "minItems": 1, "maxItems": 2 },

            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }

          }

        }

      }

    },

    "required": \["companies"\]

  }

}

### **6.3 Guardrails**

* Temperature 0–0.2, max\_tokens capped prudently.

* If JSON invalid: one automatic repair attempt with constrained regex/jsonrepair.

* Reject/zero‑out entries without clear evidence.

---

## **7\. Gmail Integration Details**

* **Scopes:** gmail.readonly only.

* **Listing:** users.messages.list with q assembled from:

  * newer\_than:{N}d

  * has:link

  * \-is:chat

  * Optional: label:^smartlabel\_newsletter if available (best‑effort; not guaranteed).

* **Classification:** Look at List-Id, From, and known platform footers. Store platform enum.

* **Fetching bodies:** users.messages.get?format=full **only for classified newsletters** to minimize data handled.

* **Deep links:** Store messageId to construct Gmail UI links: https://mail.google.com/mail/u/0/\#all/{messageId} (works for most accounts).

---

## **8\. Heuristics & Filters**

**Newsletter platform detection (any true):**

* List-Id contains substack, beehiiv, buttondown.

* From domain includes those strings.

* Footer contains platform markers (e.g., “View in browser” → Substack canonical pattern, Beehiiv “beehive” tracking, Buttondown unsubscribe pattern).

**Sponsor detection (any true):**

* Text contains case‑insensitive tokens near top/bottom: sponsor, paid, partner, ad, brought to you by.

* Distinct styling (e.g., “— Sponsored —”) or section headings.

**Company URL detection:**

* Links whose host is not in a publisher list (substack.com, beehiiv.com, buttondown.email, medium.com, x.com, twitter.com, linkedin.com, youtube.com, google.com, not known blog hosts).

* Landing page \<title\> contains action/product nouns, not just article titles.

---

## **9\. UI/UX**

### **9.1 Screens**

**A. Connect**

* Title, scope rationale, “Connect Google.”

* After auth, show settings summary and “Scan Now.”

**B. Scan Progress**

* Progress bar: “Classified X newsletters … Extracted Y companies … Cost $Z (cap $2).”

* Cancel button (ends gracefully, returns partial results).

**C. Results**

* **Header:** Last run time, counts, filters (Category | Stage | New | Source).

* **List rows:**

  * Left: Name (link to homepage) \+ domain chip.

  * Middle: One‑liner, chips (category, stage, signals).

  * Right: Score, actions (Save, Ignore, Copy).

* **Evidence popover:** quotes with highlighted spans \+ “Open in Gmail” link.

**D. Settings**

* Time window control (7/30/90/custom).

* Data retention policy (read‑only at 30 days for v1).

* Disconnect Google, Delete all data.

**E. Empty states & errors**

* Empty results (no candidates): Suggest reducing filters or increasing window.

* Error panel with collapse/expand per message.

### **9.2 Keyboard**

* j/k move selection, s save, x ignore, c copy.

---

## **10\. API Surface (Convex functions)**

Names are illustrative; all run server‑side.

* auth.exchangeOAuthCode(code) → {ok}

* scan.start({timeWindowDays?: number}) → runId

* scan.progress({runId}) → {percent, stats} // polling

* scan.cancel({runId})

* companies.list({filters, sort, page}) → {items, nextCursor}

* companies.updateStatus({companyId, status})

* export.csv({filters}) → {url} // pre‑signed URL to CSV artifact

* account.disconnectGoogle()

* account.deleteAllData(confirmText)

---

## **11\. Performance Strategy**

* Parallelize Gmail metadata fetches (batch size tuned to quotas).

* Only fetch full bodies for classified newsletters.

* Early skip: bodies \< 500 chars or no links.

* LLM per‑email to ensure tight evidence mapping; concurrency limited to stay within cost cap.

* Homepage fetch in parallel with LLM where safe; second pass validation only if confidence \< 0.6 and cost headroom remains.

---

## **12\. Security, Privacy, Compliance**

* **Token storage:** AES‑256‑GCM with per‑env secret; rotate by redeploying new key and re‑encrypting on read‑write migration (vNext: KMS).

* **Data minimization:** No full bodies stored; excerpts only; links list; snippets auto‑purge after 30 days via Convex cron.

* **Access control:** Every query includes user\_id filter; no cross‑user reads.

* **User controls:** Disconnect Google; Delete all data (irrevocable).

* **OAuth:** Testing mode with whitelisted users to avoid restricted scope verification in v1.

---

## **13\. Cost Model (v1, approximate)**

* **LLM:** Average newsletter chunk 1–2k tokens prompt; completion small (JSON).

  * Adaptive skipping keeps average under budget.

* **HTTP:** Homepage fetch limited to 2s/256KB.

* **Storage:** Small—metadata \+ snippets \+ structured company rows.

Run enforces $2 soft cap with live tally (prompt+completion tokens × unit prices). When projected to exceed, switch to conservative sampling and, if still over, stop.

---

## **14\. Observability & QA**

**Metrics (per user and global):**

* Runs started/completed, avg duration.

* Emails examined → newsletters classified ratio.

* Extractions per 100 newsletters.

* Save vs ignore rate.

* Token usage & cost per run.

* False positive/negative feedback (implicit: high ignore on a source).

**Logs & tracing:**

* Ingestion errors (by step).

* LLM JSON parsing retries.

* Sponsor filter hits.

* Dedup merges (before/after).

**QA plan:**

* Golden corpus of \~50 real newsletters with hand‑labeled companies; snapshot tests for deterministic extraction at temperature=0.

* Fuzzy matching unit tests with adversarial names (“Relay”, “Nova”).

* HTML normalization tests across common templates.

* CSV export round‑trip test (import into Sheets validates UTF‑8/escaping).

---

## **15\. Acceptance Criteria (v1)**

* Connect → Scan → Results is fully functional for whitelisted users.

* On a test corpus of 50 newsletters:

  * ≥90% precision on “consumer startup” extractions (manual audit).

  * ≥70% recall on clearly announced launches/fundings.

  * Zero invented companies (0% hallucination).

* Evidence popover always shows at least one snippet.

* Export CSV works and opens in Excel/Sheets without corruption.

* Snippet records older than 30 days auto‑deleted by job.

* A 50‑email run completes under about a minute on typical network conditions with partial results shown progressively.

---

## **16\. Risks & Mitigations**

* **Gmail query under‑/over‑matching:** Use conservative query \+ in‑app classifier on headers/footers. Add manual source allowlist (vNext).

* **Sponsored content leakage:** Heuristic \+ penalty \+ UI evidence review. Users can ignore quickly.

* **LLM JSON invalid:** Single repair pass; else drop item and log.

* **Ambiguous names/domains:** Dedup by domain first; evidence required.

* **OAuth verification (public):** Stay in testing mode for v1; plan verification if going public (vNext).

* **Rate limits:** Batch and backoff; show partial results continuously.

---

## **17\. Roadmap (post‑v1)**

* Scheduled daily scans; “new since last run.”

* Notion/Airtable/GSheets sync.

* Team workspaces, comments, shareable links.

* Source discovery beyond Substack/Beehiiv/Buttondown.

* Lightweight funding detection with regex \+ secondary confirmation.

* Feedback‑trained reranker to personalize scoring.

* Custom keyword triggers (e.g., “AI voice,” “UGC video”).

* Basic CRM connector (Affinity/Attio) via CSV schema presets.

---

## **18\. Implementation Notes (concise)**

* **HTML → text:** Use a lightweight DOM parser (e.g., linkedom/cheerio) and a whitelist of content containers; remove \<script\>, \<style\>, nav/footers by id/class patterns; keep anchor tags to retain URLs.

* **Gmail metadata first:** format=metadata\&metadataHeaders=From\&metadataHeaders=Subject\&metadataHeaders=List-Id\&metadataHeaders=Date to classify cheaply.

* **Homepage fetcher:** Follow one redirect; block non‑HTTP(S); ignore binaries; set UA.

* **Fuzzy matching:** Jaro‑Winkler ≥ 0.92; normalize by lowercasing, strip punctuation, collapse whitespace; maintain alias list in alt\_domains.

* **Scoring:** Clamp to \[0,1\]; sort DESC; tie‑breakers by recency then lexicographic name.

* **CSV:** RFC 4180 compliant; UTF‑8 with BOM to avoid Excel mojibake.

---

## **19\. Example Outputs**

**Company row (stored):**

{

  "name": "Siply",

  "homepage\_url": "https://siply.app",

  "domain": "siply.app",

  "one\_line\_summary": "AI-powered meal planner that auto-builds grocery carts.",

  "category": "Commerce",

  "stage": "seed",

  "location": "Remote, US",

  "key\_signals": \["launch","waitlist"\],

  "sources": \["18c7f2a54b1a4a7f"\],

  "confidence": 0.83,

  "score": 0.78,

  "first\_seen\_at": "2025-11-06T10:08:00Z",

  "last\_seen\_at": "2025-11-06T10:08:00Z",

  "status": "new"

}

**CSV line:**

name,homepage\_url,one\_line\_summary,category,stage,location,key\_signals,score,first\_seen\_at,last\_seen\_at,sources

Siply,https://siply.app,"AI-powered meal planner that auto-builds grocery carts.",Commerce,seed,Remote,US,"launch;waitlist",0.78,2025-11-06T10:08:00Z,2025-11-06T10:08:00Z,18c7f2a54b1a4a7f

---

## **20\. Test Cases (representative)**

1. **Funding mention:** “Acme raised a Seed round led by …” → stage=seed, key\_signals includes funding, evidence quote captured.

2. **Waitlist only:** “Join the waitlist for Nova…” → key\_signals=waitlist, acceptable with homepage link.

3. **Sponsored block:** “— Sponsored — WidgetPro …” → must be excluded or scored to bottom with penalty.

4. **Ambiguous name / no link:** “We love Relay” with no context → ignored (no evidence).

5. **Duplicate across emails:** Same company in two newsletters → merged; sources has both messageIds; last\_seen\_at updated.

---

## **21\. Deliverables Checklist (v1)**

* OAuth & settings page

* Scan pipeline (list → classify → fetch → normalize → LLM → enrich → dedup → score)

* Results UI with filters, evidence popover, keyboard shortcuts

* Save/Ignore/Copy actions

* CSV export

* Cost cap with live meter

* 30‑day purge job for snippets

* Metrics dashboard (basic)

* Golden‑set tests & unit tests for parsing/dedup/scoring

---

This PRD is sufficient to start building. If you want, I can draft the minimal Convex function stubs and the SvelteKit page skeletons next, plus the exact OpenAI prompt templates and the Gmail q builder.

