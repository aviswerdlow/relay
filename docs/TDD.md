# **Technical Design Document (TDD)**

**Project:** Relay

**Scope:** v1 (Private alpha)

**Stack:** SvelteKit (web), Convex (backend/data/queue), OpenAI (LLM), Gmail API (OAuth), Vercel (hosting)

---

## **1\) High‑level Architecture**

┌────────────┐   OAuth   ┌──────────────┐

│  Browser   │──────────▶│ Google OAuth │

│ (SvelteKit)│◀──────────│   \+ Gmail    │

└────┬───────┘            └────┬────────┘

     │                         │ Gmail API

     │ (Convex client)         │ (list/get)

     ▼                         ▼

┌──────────────┐      ┌──────────────────┐

│   Convex     │◀────▶│  External: OpenAI│

│  (actions,   │ LLM  └──────────────────┘

│  queries,    │

│  mutations)  │      ┌──────────────────┐

│  \+ storage   │◀────▶│  Company sites   │

└────┬─────────┘ HTTP  └──────────────────┘

     │

     ▼

┌──────────────┐

│ Convex Tables│

│ \+ Files      │

└──────────────┘

**Execution model:**

* SvelteKit serves UI \+ OAuth redirect endpoints.

* Convex holds the persistent business logic: token exchange, scans, LLM calls, link fetching, dedup, scoring, CSV export, purge cron.

* Client displays progressive results via polling (or a lightweight event source if desired later).

---

## **2\) Module Decomposition**

**Web (SvelteKit)**

* src/routes/:

  * / (landing \+ “Connect Google”)

  * /auth/google (redirect to Google)

  * /auth/google/callback (exchange code → Convex action)

  * /scan (start scan \+ progress view)

  * /results (list \+ filters \+ keyboard review)

  * /settings (time window, disconnect, delete data)

* src/lib/:

  * convexClient.ts — Convex client setup

  * keyboard.ts — global hotkeys

  * ui/ components — CompanyRow, EvidencePopover, Filters, ProgressBar

**Convex**

* schema.ts — tables (users, oauth\_tokens, emails, email\_bodies, companies, runs)

* auth.ts — exchangeOAuthCode, disconnectGoogle, deleteAllData

* scan.ts — start, progress, cancel

* gmail.ts — Gmail client, query builder, classifier, body fetcher

* nlp.ts — normalize HTML/text, LLM extraction, JSON repair

* companies.ts — list, updateStatus, scoring, dedup

* export.ts — CSV exporter (stores artifact in Convex storage)

* crons.ts — daily purge of email\_bodies older than 30 days

* util.ts — token budget, retry/backoff, logging

**Shared types**

* types.ts — Company DTO, Run stats, Enums.

---

## **3\) Data Model (Convex)**

**convex/schema.ts**

import { defineSchema, defineTable } from "convex/schema";

import { v } from "convex/values";

export default defineSchema({

  users: defineTable({

    googleUserId: v.string(),

    email: v.string(),

    createdAt: v.number(), // Date.now()

    settings: v.object({

      timeWindowDays: v.number(), // default 90

      retentionDays: v.number(),  // default 30

    }),

  }).index("by\_googleUserId", \["googleUserId"\]),

  oauth\_tokens: defineTable({

    userId: v.id("users"),

    provider: v.string(), // "google"

    accessTokenEnc: v.string(),

    refreshTokenEnc: v.string(),

    expiry: v.number(), // ms epoch

    scopes: v.array(v.string()),

  }).index("by\_user", \["userId"\]),

  runs: defineTable({

    userId: v.id("users"),

    startedAt: v.number(),

    finishedAt: v.optional(v.number()),

    timeWindowDays: v.number(),

    emailsExamined: v.number(),

    newslettersClassified: v.number(),

    candidatesFound: v.number(),

    savedCount: v.number(),

    ignoredCount: v.number(),

    openaiPromptTokens: v.number(),

    openaiCompletionTokens: v.number(),

    openaiCostUsd: v.number(),

    status: v.string(), // "success" | "partial" | "failed" | "running" | "canceled"

    notes: v.optional(v.string()),

  }).index("by\_user\_time", \["userId", "startedAt"\]),

  emails: defineTable({

    id: v.string(), // gmail messageId (unique per user)

    userId: v.id("users"),

    threadId: v.string(),

    from: v.string(),

    subject: v.string(),

    date: v.number(),

    listId: v.optional(v.string()),

    platform: v.string(), // "substack" | "beehiiv" | "buttondown" | "unknown"

    snippet: v.string(),

    hasBodyCached: v.boolean(),

    ingestStatus: v.string(), // "classified" | "fetched" | "failed"

    failureReason: v.optional(v.string()),

  })

    .index("by\_user\_date", \["userId", "date"\])

    .index("by\_user\_platform", \["userId", "platform", "date"\]),

  email\_bodies: defineTable({

    messageId: v.string(), // FK to emails.id (not enforced)

    userId: v.id("users"),

    htmlExcerpt: v.optional(v.string()), // ≤16KB

    textExcerpt: v.optional(v.string()), // ≤16KB

    links: v.array(v.string()),

    createdAt: v.number(),

  }).index("by\_user\_created", \["userId", "createdAt"\]),

  companies: defineTable({

    userId: v.id("users"),

    name: v.string(),

    homepageUrl: v.optional(v.string()),

    domain: v.string(),

    oneLineSummary: v.string(),

    category: v.string(),

    stage: v.string(), // "pre-seed" | "seed" | "A" | "B" | "unknown"

    location: v.optional(v.string()),

    keySignals: v.array(v.string()),

    score: v.number(),

    firstSeenAt: v.number(),

    lastSeenAt: v.number(),

    sources: v.array(v.string()), // gmail messageIds

    confidence: v.number(),

    status: v.string(), // "new" | "saved" | "ignored"

  })

    .index("by\_user\_score", \["userId", "score"\])

    .index("by\_user\_domain", \["userId", "domain"\])

    .index("by\_user\_name", \["userId", "name"\]),

});

---

## **4\) OAuth & Gmail Integration**

### **4.1 OAuth**

* Scopes: openid email profile gmail.readonly

* Store encrypted refresh token and expiry in oauth\_tokens.

* Encryption: AES‑256‑GCM using an env‑provided key; nonce per record.

### **4.2 Gmail Query Strategy**

* Base constraints: newer\_than:{N}d has:link \-is:chat

* Newsletter heuristic platforms (metadata only):

  * List-Id or From domain contains "substack" | "beehiiv" | "buttondown"

* We **do not rely** on exact sender domains for correctness; we treat these as hints and confirm by footer patterns after fetching body (cheap heuristics).

* Fetch **full body** only after classification (cheap metadata first).

**convex/gmail.ts (query builder \+ classification)**

// \--- Query builder \---

export type SourceToggle \= { substack: boolean; beehiiv: boolean; buttondown: boolean };

export function buildGmailQuery(days: number, src: SourceToggle): string {

  const parts \= \[\`newer\_than:${Math.max(1, days)}d\`, \`has:link\`, \`-is:chat\`\];

  // Allow-wide: we don't hard-filter on platform at query time to avoid missing variants.

  // Leave platform restriction to header classifier for v1 robustness.

  return parts.join(" ");

}

// \--- Header-based classifier \---

export type HeaderMeta \= {

  listId?: string;

  from?: string;

  subject?: string;

};

export function classifyPlatform(h: HeaderMeta): "substack"|"beehiiv"|"buttondown"|"unknown" {

  const hay \= \`${h.listId ?? ""} ${h.from ?? ""}\`.toLowerCase();

  if (hay.includes("substack")) return "substack";

  if (hay.includes("beehiiv")) return "beehiiv";

  if (hay.includes("buttondown")) return "buttondown";

  return "unknown";

}

// \--- Body-based confirm (footer heuristics) \---

export function confirmPlatformFromBody(htmlOrText: string, initial: string) {

  const s \= htmlOrText.toLowerCase();

  if (s.includes("view in browser") && s.includes("substack")) return "substack";

  if (s.includes("unsubscribe") && s.includes("beehiiv")) return "beehiiv";

  if (s.includes("buttondown") && s.includes("unsubscribe")) return "buttondown";

  return initial;

}

---

## **5\) LLM: Prompts & Schema**

### **5.1 Function Schema (OpenAI)**

export const extractCompaniesSchema \= {

  name: "extract\_companies",

  description: "Extract consumer startups mentioned in the newsletter",

  parameters: {

    type: "object",

    properties: {

      companies: {

        type: "array",

        items: {

          type: "object",

          required: \["name","one\_line\_summary","source\_snippets","source\_email\_ids","confidence"\],

          properties: {

            name: { type: "string" },

            homepage\_url: { type: "string" },

            alt\_domains: { type: "array", items: { type: "string" } },

            one\_line\_summary: { type: "string", maxLength: 140 },

            category: { type: "string", enum: \["Consumer AI","Fintech","Commerce","Health","Social","Creator Tools","Marketplaces","Productivity","Gaming","Hardware","Other"\] },

            stage: { type: "string", enum: \["pre-seed","seed","A","B","unknown"\] },

            location: { type: "string" },

            key\_signals: { type: "array", items: { type: "string", enum: \["waitlist","launch","funding","traction","notable\_founder","partnership"\] } },

            source\_email\_ids: { type: "array", items: { type: "string" } },

            source\_snippets: { type: "array", items: { type: "object", required: \["quote"\], properties: {

              quote: { type: "string" }, start: { type: "integer" }, end: { type: "integer" } } },

              minItems: 1, maxItems: 2 },

            confidence: { type: "number", minimum: 0, maximum: 1 }

          }

        }

      }

    },

    required: \["companies"\]

  }

} as const;

### **5.2 System Prompt**

You extract mentions of NEW CONSUMER COMPANIES from newsletter text and (optionally) fetched landing pages.

Rules:

\- Do not invent companies. Only return companies explicitly in the text or the fetched links we provide.

\- Exclude sponsored content, ads, and public companies.

\- Prefer the company's homepage URL if available.

\- Always include 1–2 short evidence quotes from the newsletter.

\- If stage is unclear, use "unknown"; never guess.

\- Output must conform to the provided JSON schema via the function tool.

### **5.3 User Prompt Template**

NEWSLETTER\_EMAIL\_ID: {{messageId}}

NEWSLETTER\_TEXT (normalized): 

{{normalizedText}}

LINK SNAPSHOTS (optional; at most 1–2 pages used):

{{each linkSnapshot}}

URL: {{url}}

TITLE: {{title}}

META: {{metaDescription}}

BODY\_EXCERPT: {{excerpt}}

{{/each}}

Task: Extract relevant CONSUMER STARTUPS. Respect the rules above.

---

## **6\) Scoring, Dedup, Normalization**

**convex/companies.ts (core snippets)**

// Jaro-Winkler (lightweight implementation)

export function jaroWinkler(a: string, b: string): number {

  // ... (omitted for brevity; include a known-correct \~30-40 line implementation)

  // We’ll include a minimal, tested version in the repo.

  return score;

}

export function normalizeName(s: string) {

  return s.trim().toLowerCase().replace(/\[^a-z0-9 \]+/g, "").replace(/\\s+/g, " ");

}

export function domainFromUrl(url?: string | null): string {

  if (\!url) return "";

  try {

    const u \= new URL(url);

    return u.hostname.replace(/^www\\./, "").toLowerCase();

  } catch {

    return "";

  }

}

export function computeScore(

  confidence: number,

  signals: string\[\],

  recencyDays: number,

  isNew: boolean,

  sponsorPenalty: boolean

): number {

  const signalWeights: Record\<string, number\> \= {

    waitlist: 0.3, launch: 0.5, funding: 0.6, traction: 0.4, notable\_founder: 0.3, partnership: 0.2

  };

  const signalScore \= Math.min(

    1,

    signals.reduce((s, k) \=\> s \+ (signalWeights\[k\] ?? 0), 0\)

  );

  const recencyScore \= recencyDays \<= 7 ? 1 : recencyDays \<= 30 ? 0.5 : 0.2;

  const novelty \= isNew ? 0.3 : 0;

  const penalty \= sponsorPenalty ? 1.0 : 0;

  const raw \= 0.5\*confidence \+ 0.2\*signalScore \+ 0.15\*recencyScore \+ 0.1\*novelty \- 0.15\*penalty;

  return Math.max(0, Math.min(1, raw));

}

---

## **7\) Rate Limits, Concurrency, and Budget**

* **Gmail**: Target ≤ 5 QPS per user; exponential backoff on 429/5xx with jitter. Batch users.messages.list page fetches; fetch full bodies **only** for classified newsletters.

* **OpenAI**: Concurrency pool of 4–6 per user run, adaptive downshift when approaching budget.

* **Link fetcher**: Limit to 4 concurrent HTTP GETs; timeout 2000ms; max 256KB; follow ≤1 redirect.

* **Budget**: $2/run soft cap using token estimator (roughly chars/4) and server‑side accumulator. When projected cost \> cap, switch to high‑signal only; if still over, stop the run and return partial results.

---

## **8\) Security & Privacy**

* **Token storage**: Encrypted with AES‑256‑GCM; per‑record random nonce; key from GOOGLE\_TOKEN\_KEY.

* **Data minimization**: Store only excerpts/snippets and links in email\_bodies; purge after 30 days via cron.

* **Network egress**: Only to Google, OpenAI, and discovered homepages (HTTP/HTTPS).

* **Secret management**: Env vars with least privilege. No secrets in client bundle.

* **Access control**: Every Convex call checks userId from session context; no cross‑tenant access.

---

## **9\) SvelteKit: Page Skeletons & Components**

**src/lib/convexClient.ts**

import { ConvexClient } from "convex/browser";

export const convex \= new ConvexClient(import.meta.env.VITE\_CONVEX\_URL);

// Usage: await convex.mutation("scan:start", { timeWindowDays: 90 });

**src/routes/+layout.svelte**

\<script\>

  export let data;

\</script\>

\<nav class="nav"\>

  \<a href="/"\>Relay\</a\>

  \<div class="spacer" /\>

  \<a href="/scan"\>Scan\</a\>

  \<a href="/results"\>Results\</a\>

  \<a href="/settings"\>Settings\</a\>

\</nav\>

\<slot /\>

\<style\>

  .nav { display:flex; gap:1rem; padding:0.75rem; border-bottom:1px solid \#eee; }

  .spacer { flex:1; }

\</style\>

**src/routes/+page.svelte** (Landing)

\<script\>

  const connect \= () \=\> { window.location.href \= "/auth/google"; };

\</script\>

\<h1\>Relay\</h1\>

\<p\>Connect your Gmail and extract new consumer startups from newsletters.\</p\>

\<button on:click={connect}\>Connect Google\</button\>

**src/routes/auth/google/+server.ts**

import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler \= async ({ url }) \=\> {

  const redirectUri \= \`${url.origin}/auth/google/callback\`;

  const authUrl \= new URL("https://accounts.google.com/o/oauth2/v2/auth");

  authUrl.searchParams.set("client\_id", process.env.GOOGLE\_CLIENT\_ID\!);

  authUrl.searchParams.set("redirect\_uri", redirectUri);

  authUrl.searchParams.set("response\_type", "code");

  authUrl.searchParams.set("scope", "openid email profile https://www.googleapis.com/auth/gmail.readonly");

  authUrl.searchParams.set("access\_type", "offline");

  authUrl.searchParams.set("prompt", "consent"); // ensures refresh token for testing users

  return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });

};

**src/routes/auth/google/callback/+server.ts**

import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler \= async ({ url, fetch, cookies }) \=\> {

  const code \= url.searchParams.get("code");

  if (\!code) return new Response("Missing code", { status: 400 });

  // Exchange & store via Convex action

  const res \= await fetch(\`${process.env.CONVEX\_ACTION\_URL}/auth:exchangeOAuthCode\`, {

    method: "POST",

    headers: { "content-type": "application/json" },

    body: JSON.stringify({ code, redirectUri: \`${url.origin}/auth/google/callback\` }),

  });

  if (\!res.ok) return new Response("OAuth exchange failed", { status: 500 });

  // You may set a session cookie if your app uses one; for v1, Convex associates user via Google sub.

  return new Response(null, { status: 302, headers: { Location: "/scan" } });

};

**src/routes/scan/+page.svelte**

\<script lang="ts"\>

  import { convex } from "$lib/convexClient";

  let running \= false;

  let stats: any \= null;

  let runId: string | null \= null;

  async function startScan() {

    running \= true;

    runId \= await convex.mutation("scan:start", { timeWindowDays: 90 });

    poll();

  }

  async function poll() {

    if (\!runId) return;

    const p \= await convex.query("scan:progress", { runId });

    stats \= p;

    if (p.status \=== "running") setTimeout(poll, 1000);

    else running \= false;

  }

\</script\>

\<h2\>Scan Newsletters\</h2\>

\<button on:click={startScan} disabled={running}\>Scan Now\</button\>

{\#if stats}

  \<div class="panel"\>

    \<div\>Emails examined: {stats.emailsExamined}\</div\>

    \<div\>Newsletters: {stats.newslettersClassified}\</div\>

    \<div\>Companies found: {stats.candidatesFound}\</div\>

    \<div\>OpenAI cost: ${stats.openaiCostUsd?.toFixed(2)}\</div\>

    \<div\>Status: {stats.status}\</div\>

  \</div\>

{/if}

**src/routes/results/+page.svelte** (skeleton)

\<script lang="ts"\>

  import { convex } from "$lib/convexClient";

  let items: any\[\] \= \[\];

  let nextCursor: string | null \= null;

  let filters \= { category: null, stage: null, newOnly: false, source: null };

  async function loadPage(cursor?: string | null) {

    const res \= await convex.query("companies:list", { filters, cursor });

    items \= cursor ? \[...items, ...res.items\] : res.items;

    nextCursor \= res.nextCursor ?? null;

  }

  loadPage(null);

\</script\>

\<h2\>Results\</h2\>

\<div\>

  {\#each items as c}

  \<div class="row"\>

    \<div\>

      \<a href={c.homepageUrl} target="\_blank" rel="noreferrer"\>{c.name}\</a\>

      \<span class="chip"\>{c.domain}\</span\>

      \<p\>{c.oneLineSummary}\</p\>

      \<div class="chips"\>

        \<span class="chip"\>{c.category}\</span\>

        \<span class="chip"\>{c.stage}\</span\>

        {\#each c.keySignals as s}\<span class="chip"\>{s}\</span\>{/each}

      \</div\>

    \</div\>

    \<div class="right"\>

      \<span\>{(c.score\*100).toFixed(0)}\</span\>

      \<button on:click={() \=\> convex.mutation("companies:updateStatus", { companyId: c.\_id, status: c.status==="saved"?"new":"saved" })}\>

        {c.status \=== "saved" ? "Unsave" : "Save"}

      \</button\>

    \</div\>

  \</div\>

  {/each}

\</div\>

{\#if nextCursor}\<button on:click={() \=\> loadPage(nextCursor)}\>Load more\</button\>{/if}

---

## **10\) Convex: Functions & Actions (skeletons)**

These compile with Convex’s server runtime (function bodies abbreviated; keep control flow & types). Replace TODO with real logic.

**convex/auth.ts**

import { action, mutation } from "./\_generated/server";

import { v } from "convex/values";

import crypto from "crypto";

function enc(plain: string): string {

  const key \= Buffer.from(process.env.GOOGLE\_TOKEN\_KEY\!, "base64");

  const iv \= crypto.randomBytes(12);

  const cipher \= crypto.createCipheriv("aes-256-gcm", key, iv);

  const ct \= Buffer.concat(\[cipher.update(plain, "utf8"), cipher.final()\]);

  const tag \= cipher.getAuthTag();

  return Buffer.concat(\[iv, tag, ct\]).toString("base64");

}

export const exchangeOAuthCode \= action({

  args: { code: v.string(), redirectUri: v.string() },

  handler: async (ctx, args) \=\> {

    const tokenRes \= await fetch("https://oauth2.googleapis.com/token", {

      method: "POST",

      headers: { "content-type": "application/x-www-form-urlencoded" },

      body: new URLSearchParams({

        code: args.code,

        client\_id: process.env.GOOGLE\_CLIENT\_ID\!,

        client\_secret: process.env.GOOGLE\_CLIENT\_SECRET\!,

        redirect\_uri: args.redirectUri,

        grant\_type: "authorization\_code",

      }),

    });

    if (\!tokenRes.ok) throw new Error("Token exchange failed");

    const t \= await tokenRes.json();

    const idTok \= t.id\_token as string;

    const sub \= JSON.parse(Buffer.from(idTok.split(".")\[1\], "base64").toString()).sub;

    const email \= JSON.parse(Buffer.from(idTok.split(".")\[1\], "base64").toString()).email;

    // Upsert user

    let user \= await ctx.db

      .query("users")

      .withIndex("by\_googleUserId", (q) \=\> q.eq("googleUserId", sub))

      .first();

    if (\!user) {

      const id \= await ctx.db.insert("users", {

        googleUserId: sub,

        email,

        createdAt: Date.now(),

        settings: { timeWindowDays: 90, retentionDays: 30 },

      });

      user \= await ctx.db.get(id);

    }

    // Store tokens

    await ctx.db.insert("oauth\_tokens", {

      userId: user\!.\_id,

      provider: "google",

      accessTokenEnc: enc(t.access\_token),

      refreshTokenEnc: enc(t.refresh\_token ?? ""),

      expiry: Date.now() \+ t.expires\_in \* 1000,

      scopes: \["gmail.readonly","openid","email","profile"\],

    });

    return { ok: true };

  },

});

export const disconnectGoogle \= mutation({

  args: {},

  handler: async (ctx) \=\> {

    const userId \= ctx.auth.getUserIdentity()?.tokenIdentifier;

    if (\!userId) throw new Error("Unauthenticated");

    const user \= await ctx.db.query("users").first(); // replace with proper lookup

    if (\!user) return;

    const tokens \= await ctx.db.query("oauth\_tokens").withIndex("by\_user", (q)=\>q.eq("userId", user.\_id)).collect();

    for (const t of tokens) await ctx.db.delete(t.\_id);

  }

});

**convex/scan.ts**

import { action, query, internalMutation } from "./\_generated/server";

import { v } from "convex/values";

import { buildGmailQuery, classifyPlatform, confirmPlatformFromBody } from "./gmail";

import { runExtractionForEmail } from "./nlp";

import { computeScore, domainFromUrl, normalizeName, jaroWinkler } from "./companies";

export const start \= action({

  args: { timeWindowDays: v.number() },

  handler: async (ctx, { timeWindowDays }) \=\> {

    const user \= await requireUser(ctx);

    const runId \= await ctx.db.insert("runs", {

      userId: user.\_id,

      startedAt: Date.now(),

      finishedAt: undefined,

      timeWindowDays,

      emailsExamined: 0,

      newslettersClassified: 0,

      candidatesFound: 0,

      savedCount: 0,

      ignoredCount: 0,

      openaiPromptTokens: 0,

      openaiCompletionTokens: 0,

      openaiCostUsd: 0,

      status: "running",

      notes: "",

    });

    // Kick off ingestion/extraction in background (Convex actions run to completion; v1: do in-process)

    await doScan(ctx, user.\_id, runId, timeWindowDays);

    return runId.id;

  },

});

export const progress \= query({

  args: { runId: v.id("runs") },

  handler: async (ctx, { runId }) \=\> {

    const run \= await ctx.db.get(runId);

    if (\!run) throw new Error("Run not found");

    return {

      status: run.status,

      emailsExamined: run.emailsExamined,

      newslettersClassified: run.newslettersClassified,

      candidatesFound: run.candidatesFound,

      openaiCostUsd: run.openaiCostUsd,

    };

  },

});

async function doScan(ctx: any, userId: any, runId: any, days: number) {

  try {

    const q \= buildGmailQuery(days, { substack: true, beehiiv: true, buttondown: true });

    // 1\) list messages (ids only), 2\) fetch metadata, 3\) classify, 4\) fetch body for matches

    const { ids } \= await gmailList(ctx, userId, q);

    let examined \= 0, classified \= 0, found \= 0, cost \= 0;

    for (const id of ids) {

      examined++;

      const meta \= await gmailGetMetadata(ctx, userId, id);

      const platform \= classifyPlatform(meta);

      if (platform \=== "unknown") continue;

      const full \= await gmailGetBody(ctx, userId, id);

      const confirmed \= confirmPlatformFromBody(full.html ?? full.text ?? "", platform);

      // Save email record

      await upsertEmail(ctx, userId, id, meta, confirmed, full);

      // Run LLM extraction

      const companies \= await runExtractionForEmail(ctx, userId, id, full);

      for (const c of companies) {

        const domain \= domainFromUrl(c.homepage\_url) || normalizeName(c.name).replace(/\\s+/g,"-");

        const isNew \= await upsertCompany(ctx, userId, c, domain);

        found \+= isNew ? 1 : 0;

      }

      classified++;

      // Update cost estimate incrementally

      cost \+= companies.\_\_cost ?? 0;

      await ctx.db.patch(runId, {

        emailsExamined: examined,

        newslettersClassified: classified,

        candidatesFound: found,

        openaiCostUsd: Number(cost.toFixed(4)),

      });

      if (cost \> 2.0) break; // cost cap

    }

    await ctx.db.patch(runId, { status: "success", finishedAt: Date.now() });

  } catch (e) {

    await ctx.db.patch(runId, { status: "partial", notes: String(e), finishedAt: Date.now() });

  }

}

**convex/nlp.ts (LLM call)**

import { action } from "./\_generated/server";

import { extractCompaniesSchema } from "../shared/schema";

import { normalizeHtmlToText } from "./normalize";

export async function runExtractionForEmail(ctx: any, userId: any, messageId: string, body: { html?: string, text?: string, links: string\[\] }) {

  const normalizedText \= normalizeHtmlToText(body.html ?? body.text ?? "");

  const linkSnapshots \= await fetchCandidateHomepages(body.links);

  const messages \= \[

    { role: "system", content: SYSTEM\_PROMPT },

    { role: "user", content: renderUserPrompt(messageId, normalizedText, linkSnapshots) },

  \];

  const tools \= \[{ type: "function", function: extractCompaniesSchema }\];

  const r \= await fetch("https://api.openai.com/v1/chat/completions", {

    method: "POST",

    headers: { "content-type": "application/json", "authorization": \`Bearer ${process.env.OPENAI\_API\_KEY}\` },

    body: JSON.stringify({

      model: process.env.OPENAI\_MODEL ?? "gpt-4o-mini-2024-07-18",

      messages, tools, tool\_choice: { type: "function", function: { name: "extract\_companies" } },

      temperature: 0.1,

    })

  });

  const json \= await r.json();

  const toolCall \= json.choices?.\[0\]?.message?.tool\_calls?.\[0\];

  let companies \= \[\];

  if (toolCall?.function?.arguments) {

    companies \= safeJson(toolCall.function.arguments)?.companies ?? \[\];

  }

  // attach cost if available (token usage):

  if (json.usage) (companies as any).\_\_cost \= estimateCost(json.usage);

  return companies;

}

const SYSTEM\_PROMPT \= \`You extract mentions ... (use the System Prompt above verbatim)\`;

function renderUserPrompt(messageId: string, text: string, links: any\[\]): string {

  // Build the user prompt as defined in section 5.3

  return \`NEWSLETTER\_EMAIL\_ID: ${messageId}\\nNEWSLETTER\_TEXT (normalized):\\n${text.slice(0, 12000)}\\n\\nLINK SNAPSHOTS:\\n${links.map(...).join("\\n")}\`;

}

function safeJson(s: string) { try { return JSON.parse(s); } catch { return {}; } }

function estimateCost(usage: any): number {

  // Plug in your actual model pricing, or keep a conservative estimate.

  const total \= (usage?.prompt\_tokens ?? 0\) \+ (usage?.completion\_tokens ?? 0);

  return (total / 1000\) \* 0.0005; // placeholder micro-cost; replace with real

}

async function fetchCandidateHomepages(links: string\[\]) {

  // apply heuristics to choose probable company landing pages, cap 2

  return \[\]; // return array of {url,title,metaDescription,excerpt}

}

**convex/export.ts**

import { action } from "./\_generated/server";

import { v } from "convex/values";

export const csv \= action({

  args: { filters: v.any() },

  handler: async (ctx, { filters }) \=\> {

    const user \= await requireUser(ctx);

    const items \= await queryCompanies(ctx.db, user.\_id, filters);

    const header \= \["name","homepage\_url","one\_line\_summary","category","stage","location","key\_signals","score","first\_seen\_at","last\_seen\_at","sources"\];

    const rows \= items.map(c \=\> \[

      c.name, c.homepageUrl ?? "", c.oneLineSummary, c.category, c.stage, c.location ?? "",

      c.keySignals.join(";"), c.score.toFixed(2), new Date(c.firstSeenAt).toISOString(),

      new Date(c.lastSeenAt).toISOString(), c.sources.join(",")

    \]);

    const csv \= \[header, ...rows\].map(r \=\> r.map(escapeCsv).join(",")).join("\\n");

    const blob \= new Blob(\[\`\\uFEFF${csv}\`\], { type: "text/csv;charset=utf-8" }); // UTF-8 BOM

    const fileId \= await ctx.storage.store(blob);

    const url \= await ctx.storage.getUrl(fileId);

    return { url };

  }

});

function escapeCsv(s: string) {

  const needs \= /\[,"\\n\]/.test(s);

  const esc \= s.replace(/"/g, '""');

  return needs ? \`"${esc}"\` : esc;

}

**convex/crons.ts**

import { cronJobs } from "convex/server";

const crons \= cronJobs();

crons.daily("purgeEmailBodies", { hourUTC: 3, minuteUTC: 0 }, async (ctx) \=\> {

  const users \= await ctx.db.query("users").collect();

  const now \= Date.now();

  for (const u of users) {

    const cutoff \= now \- u.settings.retentionDays \* 24 \* 3600 \* 1000;

    const toDelete \= await ctx.db.query("email\_bodies")

      .withIndex("by\_user\_created", q \=\> q.eq("userId", u.\_id))

      .filter(q \=\> q.lt(q.field("createdAt"), cutoff))

      .collect();

    for (const row of toDelete) await ctx.db.delete(row.\_id);

  }

});

export default crons;

---

## **11\) Environment & Configuration**

**Vercel env vars**

* VITE\_CONVEX\_URL — Convex deployment URL for client

* CONVEX\_ACTION\_URL — Convex HTTP action base (e.g., https://\<deployment\>.convex.cloud/api/run)

* GOOGLE\_CLIENT\_ID, GOOGLE\_CLIENT\_SECRET

* GOOGLE\_TOKEN\_KEY (base64 32‑byte key for AES‑256‑GCM)

* OPENAI\_API\_KEY

* OPENAI\_MODEL (default gpt-4o-mini-2024-07-18)

**Build targets**

* Node 20+

* TypeScript strict

* SvelteKit latest

---

## **12\) Sequence Diagrams**

**Onboarding**

User → Web: GET /auth/google

Web → Google: redirect to consent (scopes)

Google → Web: code

Web → Convex: exchangeOAuthCode(code)

Convex → Google: token exchange

Convex → DB: upsert user \+ tokens

Convex → Web: ok

Web → User: redirect /scan

**Scan**

Web → Convex: scan:start(90d)

Convex → Gmail: messages.list(q)

loop ids

  Convex → Gmail: messages.get(metadata)

  Convex: classifyPlatform()

  alt \[platform \!= unknown\]

    Convex → Gmail: messages.get(full)

    Convex: normalize \+ extract links

    Convex → OpenAI: extract\_companies()

    Convex: dedup \+ score \+ upsert

  end

  Convex → DB: patch run stats

end

Convex → Web: runId

Web: poll scan:progress(runId) until finished

---

## **13\) Testing Strategy (TDD‑style)**

### **13.1 Unit Tests (Vitest)**

* **gmail.queryBuilder.spec.ts**

  * buildGmailQuery(90) includes newer\_than:90d, has:link, excludes \-is:chat.

* **gmail.classifier.spec.ts**

  * Substack/Beehiiv/Buttondown classification with synthetic headers.

  * Body confirmation toggles correctly.

* **nlp.normalize.spec.ts**

  * HTML → text removes scripts/styles, retains links, preserves paragraphs.

* **companies.dedup.spec.ts**

  * Jaro‑Winkler thresholds; “Acme Co” vs “Acme” merges at ≥0.92.

* **companies.scoring.spec.ts**

  * Correct score composition across signals/recency/novelty/penalty.

* **export.csv.spec.ts**

  * CSV escaping for commas/quotes/newlines; UTF‑8 BOM present.

### **13.2 Integration Tests**

* **scan.pipeline.spec.ts** (mock Gmail \+ mock OpenAI)

  * Fixture: 20 mixed emails → expect only platform‑classified bodies fetched.

  * LLM returns JSON; companies stored; dedup merges sources; run stats accurate.

  * Enforce $2 cap triggers early stop and partial results.

* **oauth.exchange.spec.ts** (mock Google token)

  * Successful token storage (encrypted fields non‑plaintext).

### **13.3 Golden Set (Deterministic)**

* 50 real newsletters (stripped) with hand labels:

  * Deterministic run at temperature=0 using mocked LLM responses → ≥90% precision, ≥70% recall targets.

### **13.4 E2E (Playwright)**

* Happy path: connect → scan → results → export.

* Keyboard shortcuts (j/k/s/x/c) operate on focused row.

**CI gates**

* Lint \+ typecheck

* Unit \+ integration tests

* Golden set diff thresholds

* Bundle size budget (UI)

---

## **14\) Logging & Metrics**

**Per run**

* emailsExamined, newslettersClassified, candidatesFound

* Tokens prompt/completion; cost

* Duration (finishedAt \- startedAt)

* Error counts by stage (list/get/normalize/llm)

**Event logs**

* oauth.exchange.success|fail

* gmail.list.pageFetched, gmail.get.meta, gmail.get.body

* llm.extract.success|json\_repair|fail

* company.upsert.created|merged

**Dashboards**

* Runs per day

* Cost per run

* Precision proxy: ignore rate

---

## **15\) Operational Notes**

* **Secret rotation**: Deploy new GOOGLE\_TOKEN\_KEY; upon read of old tokens, re‑encrypt on patch.

* **Token invalidation**: If Google returns 401, refresh token; if refresh fails, prompt reconnect.

* **Data deletion**: One‑click delete removes user rows (cascade by queries), email\_bodies, companies, tokens.

---

## **16\) Risk Register (v1)**

* **Gmail sender diversity** → header classifier too coarse. Mitigation: confirm via body footer patterns; allow manual source overrides later.

* **LLM JSON quirks** → single repair attempt; drop offending items and log.

* **Cost spikes** → budget estimator \+ early stop enforced server‑side.

* **Latency bursts** → smaller concurrency \+ progressive UI with partials.

---

## **17\) Roadmap Hooks**

* Scheduler (daily scans), Notion/Airtable sync, CRM CSV presets, personal reranker, more sources.

---

# **Code Appendix**

Below are additional focused snippets you can paste in.

### **A) Gmail client helpers (convex/gmail.ts)**

export async function gmailList(ctx: any, userId: any, q: string): Promise\<{ ids: string\[\] }\> {

  const { accessToken } \= await ensureAccessToken(ctx, userId);

  const base \= "https://gmail.googleapis.com/gmail/v1/users/me/messages";

  let pageToken: string | undefined;

  const ids: string\[\] \= \[\];

  do {

    const url \= new URL(base);

    url.searchParams.set("q", q);

    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const r \= await fetch(url.toString(), { headers: { authorization: \`Bearer ${accessToken}\` }});

    if (r.status \=== 429\) { await backoff(); continue; }

    if (\!r.ok) throw new Error(\`Gmail list failed ${r.status}\`);

    const j \= await r.json();

    (j.messages ?? \[\]).forEach((m: any) \=\> ids.push(m.id));

    pageToken \= j.nextPageToken;

  } while (pageToken && ids.length \< 500); // hard cap per run

  return { ids };

}

export async function gmailGetMetadata(ctx: any, userId: any, id: string) {

  const { accessToken } \= await ensureAccessToken(ctx, userId);

  const url \= \`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata\&metadataHeaders=From\&metadataHeaders=Subject\&metadataHeaders=List-Id\&metadataHeaders=Date\`;

  const r \= await fetch(url, { headers: { authorization: \`Bearer ${accessToken}\` } });

  const j \= await r.json();

  const headers: Record\<string,string\> \= {};

  for (const h of j.payload.headers ?? \[\]) headers\[h.name.toLowerCase()\] \= h.value;

  return {

    listId: headers\["list-id"\],

    from: headers\["from"\],

    subject: headers\["subject"\],

    date: headers\["date"\],

    threadId: j.threadId,

    snippet: j.snippet,

  };

}

export async function gmailGetBody(ctx: any, userId: any, id: string) {

  const { accessToken } \= await ensureAccessToken(ctx, userId);

  const url \= \`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full\`;

  const r \= await fetch(url, { headers: { authorization: \`Bearer ${accessToken}\` } });

  const j \= await r.json();

  const { html, text } \= extractPartsFromPayload(j.payload);

  const links \= extractLinks(html || text || "");

  return { html, text, links };

}

function extractPartsFromPayload(payload: any): { html?: string; text?: string } {

  // decode MIME parts; accumulate first text/html, then text/plain. Omitted for brevity.

  return {};

}

function extractLinks(s: string): string\[\] {

  const set \= new Set\<string\>();

  for (const m of s.matchAll(/https?:\\/\\/\[^\\s)\>"'\]+/g)) set.add(m\[0\]);

  return \[...set\].slice(0, 20);

}

async function ensureAccessToken(ctx: any, userId: any) {

  // decrypt tokens, refresh when needed; store new expiry.

  return { accessToken: "..." };

}

async function backoff() { await new Promise(r \=\> setTimeout(r, 500 \+ Math.random()\*1000)); }

### **B) Normalizer (convex/normalize.ts)**

export function normalizeHtmlToText(htmlOrText: string): string {

  if (\!htmlOrText) return "";

  if (\!/\<\[a-z\]\[\\s\\S\]\*\>/i.test(htmlOrText)) return collapse(htmlOrText);

  const stripped \= htmlOrText

    .replace(/\<script\[\\s\\S\]\*?\<\\/script\>/gi, "")

    .replace(/\<style\[\\s\\S\]\*?\<\\/style\>/gi, "")

    .replace(/\<\[^\>\]+\>/g, "\\n");

  return collapse(stripped);

}

function collapse(s: string) {

  return s.replace(/\\r/g, "").replace(/\\n{3,}/g, "\\n\\n").trim();

}

### **C) Company upsert (convex/scan.ts)**

async function upsertCompany(ctx: any, userId: any, c: any, domain: string): Promise\<boolean\> {

  // Try by domain first

  const existingByDomain \= await ctx.db.query("companies")

    .withIndex("by\_user\_domain", q \=\> q.eq("userId", userId).eq("domain", domain))

    .first();

  const now \= Date.now();

  const recencyDays \= 0; // compute from email date (omitted)

  const score \= computeScore(c.confidence ?? 0.5, c.key\_signals ?? \[\], recencyDays, \!existingByDomain, false);

  if (existingByDomain) {

    await ctx.db.patch(existingByDomain.\_id, {

      oneLineSummary: bestSummary(existingByDomain.oneLineSummary, c.one\_line\_summary ?? ""),

      keySignals: Array.from(new Set(\[...existingByDomain.keySignals, ...(c.key\_signals ?? \[\])\])),

      lastSeenAt: now,

      sources: Array.from(new Set(\[...existingByDomain.sources, ...(c.source\_email\_ids ?? \[\])\])),

      score,

      confidence: Math.max(existingByDomain.confidence, c.confidence ?? 0),

    });

    return false;

  }

  // fallback by fuzzy name match

  const maybe \= await ctx.db.query("companies").withIndex("by\_user\_name", q \=\> q.eq("userId", userId)).collect();

  const nameNorm \= normalizeName(c.name ?? "");

  for (const m of maybe) {

    if (jaroWinkler(normalizeName(m.name), nameNorm) \>= 0.92) {

      await ctx.db.patch(m.\_id, {

        homepageUrl: m.homepageUrl ?? c.homepage\_url ?? null,

        domain: m.domain || domain,

        oneLineSummary: bestSummary(m.oneLineSummary, c.one\_line\_summary ?? ""),

        keySignals: Array.from(new Set(\[...m.keySignals, ...(c.key\_signals ?? \[\])\])),

        lastSeenAt: now,

        sources: Array.from(new Set(\[...m.sources, ...(c.source\_email\_ids ?? \[\])\])),

        score,

        confidence: Math.max(m.confidence, c.confidence ?? 0),

      });

      return false;

    }

  }

  await ctx.db.insert("companies", {

    userId, name: c.name, homepageUrl: c.homepage\_url ?? null, domain,

    oneLineSummary: (c.one\_line\_summary ?? "").slice(0, 140),

    category: c.category ?? "Other", stage: c.stage ?? "unknown",

    location: c.location ?? null, keySignals: c.key\_signals ?? \[\],

    score, firstSeenAt: now, lastSeenAt: now,

    sources: c.source\_email\_ids ?? \[\], confidence: c.confidence ?? 0.5,

    status: "new",

  });

  return true;

}

function bestSummary(a: string, b: string) {

  const trim \= (s: string) \=\> s.trim().slice(0, 140);

  if (\!a) return trim(b);

  if (\!b) return trim(a);

  return trim(a.length \>= b.length ? a : b);

}

---

## **18\) Acceptance Checklist Mapped to Tests**

* Connect → Scan → Results works for whitelisted users (**E2E: happy path**).

* Precision ≥90%, recall ≥70% on golden set (**integration \+ golden tests**).

* Evidence present for each extraction (**integration**).

* CSV export opens cleanly (**unit: csv spec**).

* Snippet purge runs daily (**cron test**).

* 50‑email run completes under \~60s with partial progress (**integration timing with mocks**).

---

## **19\) Build Order (for a single engineer)**

1. Convex schema \+ auth.exchangeOAuthCode \+ SvelteKit OAuth endpoints.

2. Gmail list/get metadata \+ classifier; dummy scan loop; persist emails.

3. HTML normalizer \+ link extractor; store excerpts.

4. LLM call stub (mock) → end‑to‑end flow to UI with fake results.

5. Real LLM call \+ upsert \+ scoring/dedup.

6. Results page UI, filters, status toggles; keyboard shortcuts.

7. CSV export; daily purge cron.

8. Tests (unit → integration → golden), instrumentation, small polish.

