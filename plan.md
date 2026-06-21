# Sylor — Master Plan

> **North star:** Every consequential decision gets rehearsed in Sylor first. You describe the world in plain language, watch believable agents live it out, and walk away with a defensible answer — in under 90 seconds for a first-time visitor, with a concrete reason to come back every week.

Sylor = Monte Carlo engine × knowledge graphs × AI agent personas, on Next.js 14 (Vercel) + FastAPI (Fly.io) + Firestore + Claude.

---

## 1. Where Sylor is today (honest assessment, 2026-06-12)

**What genuinely works**

- Real Monte Carlo engine: 4 domains (business, finance/GBM, biology/binding-kinetics, trend), 11 rule-based agent classes, bootstrap 95% CI, quantile outcome distributions, p10/p90 timeline bands.
- Document → knowledge graph → agent personas → ReACT report → chat pipeline (LLM-driven ontology + entity extraction).
- AI simulation wizard (`/simulations/new`) with context analysis and prompt-to-config.
- Sensitivity sweep, multi-sim compare, AI insights, SSE plumbing, rate limiting, 184 passing backend tests.

**What was broken or fake (fixed in tonight's push — see §2)**

- 6 of 9 routers had **no authentication** (anyone could read/delete all users' projects, graphs, reports and burn Claude credits).
- Projects lived only in memory — **wiped on every deploy/restart** (Fly autoscales to zero, so effectively wiped constantly).
- Agent personas were **never fed into the simulation math** — the core "knowledge-graph-informed multi-agent" pitch was decorative.
- SSE streaming was fake on both ends; progress bars were setTimeout theater capped at 94%.
- Mock data shipped as UI: compare page 100% hardcoded, templates page ignored the API, wizard CSV "parsing" was `Math.random()`, settings showed a fake API key.
- The pipeline's middle was missing: no route exposed `orchestrator.run_simulation`.
- Rate limiter spoofable (keyed on unverified token prefix); Firestore rules casing mismatched what the backend writes; FormData uploads had a broken Content-Type; no CI; zero frontend tests.

**Structural seams still open**

- Two parallel LLM clients on the backend (`llm_client` vs raw client in `ai_insights`); two parallel frontend data paths (api.ts vs direct firestore.ts).
- Rule-based agents are formulas + Gaussian noise, not calibrated distributions or true ABM.
- Graph search is LLM-relevance over first 50 entities — no embeddings.
- Per-process in-memory rate limiter (wrong across 2 workers / N machines).

---

## 2. Tonight's push (executed in waves, each verified green before the next)

**Wave A — Foundations (security & integrity)** ✅ *(verified: 239 backend tests pass, build green)*
- [x] Auth on projects/graphs/reports/context/upload routers + per-user resource scoping (55 new tests)
- [x] Rate limiter: verified-uid keying (sha256 token cache, 300s TTL), `/run/stream` in expensive tier, XFF spoof resistance
- [x] Firestore rules/indexes reconciled to actual written field casing; `simulation_runs` ownership on create
- [x] `reports/generate` returns `report_id`; background tasks protected from GC
- [x] `fetchWithRetry`: FormData Content-Type fix; no retries on mutating methods
- [x] Mock compare page → real compare flow with `?ids=` preselect
- [x] Templates page wired to real `/api/templates` + "use template" prefills wizard
- [x] Real CSV parse in wizard via `/api/upload/parse`
- [x] Settings: real usage data, fake API key/webhook removed
- [x] Silent `catch {}` blocks → toast error surfacing
- [x] `asyncio==3.4.3` removed; bare excepts → logging

**Wave B — Make the pitch real (pipeline & streaming)** ✅ *(verified: 262 backend tests pass, build green)*
- [x] Projects persisted to Firestore (survive restarts), owner-scoped, hot-cached
- [x] `POST /api/projects/{id}/run-simulation` — the missing Phase 4 — personas flow into the engine
- [x] Agent personas actually modulate the math (sensitivity, risk tolerance, activity, influence weight, sentiment bias, decision style — divergence proven under fixed seed)
- [x] Deterministic seeding (`base_seed` recorded on results; reproducible runs) — pulled forward from Wave C
- [x] Confidence diagnostics (MCSE, convergence check, forecast confidence badge) — pulled forward from Wave C
- [x] Real SSE: engine progress streamed *during* the run (asyncio.Queue + heartbeats); sim detail page drives a real progress bar with polling fallback
- [x] Project page run step with live task progress + link to results; `/simulations/new` auth guard with `?next=` redirect

**Wave C — Wow features** ✅ *(verified: 287 backend tests pass, build + strict typecheck green)*
- [x] Deterministic seeding + reproducible runs (`base_seed` on results) — *landed in Wave B*
- [x] Tornado-chart sensitivity (`POST /simulations/{id}/tornado`) + "sensitivity" UI tab with horizontal tornado chart
- [x] Confidence diagnostics: Monte Carlo standard error, convergence check, confidence badge — *landed in Wave B*
- [x] Natural-language what-if (`POST /simulations/{id}/whatif`): parse "what if I raise prices 20%?" → overrides → paired same-seed re-run → parse chips + delta cards + AI verdict
- [x] Shareable results: `POST /simulations/{id}/share` → frozen snapshot → public `/s/[shareId]` page (no auth, no chrome) + revoke
- [x] Run history: every completed run persisted (all 3 paths); "vs previous run" delta chips + success-over-runs sparkline + run list
- [x] Interactive knowledge-graph visualization on `/graphs/[id]` (hand-rolled force-directed SVG, type-colored, degree-sized, pan/zoom, click-to-inspect, no new deps)
- [x] Real analytics page (per-user aggregates: totals, by-category, 30-day trend, recent) + dashboard empty-state question gallery (6 cards → prefilled wizard)
- [x] Command palette v2: fuzzy-search your simulations with status + success %, recents (localStorage), Enter-to-open
- [x] Public stats endpoint (`GET /api/public/stats`, anonymized, cached) — ready for the live landing hero

**Wave D — Engineering quality** ✅ *(verified: 308→312 backend tests, build green)*
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): backend pytest on Python 3.12 (the deploy interpreter) + frontend `npm run build` on every push/PR to main
- [x] Functional API tests for previously-untested routers — graphs (search/nodes/edges), context (analyze + fallbacks), upload (CSV/XLSX), reports (full generate→progress→sections→download happy path) — 21 new tests, all LLM mocked
- [x] README corrected (Sylor branding, `sylor-api.fly.dev`, real architecture + env vars + run commands, links plan.md)
- [x] Repo cruft: deleted typo `.env.local.exampl`; MiroFish-main/ + stale Vite root files flagged for deletion (see §8 — needs your confirm)

**Adversarial seam review + fixes** ✅ *(9-agent review of high-contention shared files; 3 confirmed findings, all fixed + tested)*
- [x] Project cache now treats Firestore as authoritative (cross-instance deletes/updates no longer shadowed by stale cache)
- [x] Expensive-tier rate limit no longer double-counted (was silently halving the 10/min limit to 5/min)
- [x] `decision_style` now modulates the engine (aggressive/conservative personas genuinely diverge); `behavior_rules` forwarded — no more dead persona fields

**Wave E/F — More wow + quality** ✅ *(verified: 329 backend tests pass, build + strict typecheck green)*
- [x] **Decision Memo Generator** (`POST /api/reports/memo`): fixed 6-section exec/technical memo (Recommendation, Evidence, Sensitivities, Risks, Dissent, Next Questions) from a sim's results; "generate memo" button → existing report page
- [x] **Scenario Tree (branching)**: sims carry `parent_id`/`root_id`/`branch_label`; `POST /{id}/branch` (paired-config child run), `GET /{id}/tree`; new `/simulations/[id]/tree` page with left-to-right SVG tree + "compare branches"; "save as branch" on the What-If tab
- [x] **Live landing hero**: fabricated "2.4M simulations / 12K users" stats replaced with real `GET /api/public/stats` (animated count-up, em-dash placeholders on load/fail, recent-runs ticker, respects reduced-motion)
- [x] **Global run tray + browser notifications**: persistent bottom-right tray with live per-run progress surviving navigation; browser Notification + title flash on completion; contextual permission ask
- [x] **LLM client unified**: `context.py` folded onto the `llm_client` singleton (dropped its bespoke JSON repair) — convention violation resolved; response shapes unchanged
- [x] Repo cruft removed: deleted `MiroFish-main/` (8.6M vendor dump) + stale Vite-era root files (`index.html`, `src/`, `supabase/`, root `package.json`); preserved `Sylor.png` into `frontend/public/`
- [x] Fixed a double-run bug: What-If rerun no longer starts two concurrent `/run/stream` runs (page owns the stream; tray observes via poll)

**Wave E/F seam review + fixes** ✅ *(15-agent review; context.py refactor clean; 3 confirmed findings fixed + tested)*
- [x] Run-tray poll loop now bounded (~10 min cap → "still running in background"; was an immortal poll on a stuck run since the provider never unmounts); `dismissRun` tears down timers
- [x] Tab-title flash serialized (concurrent completions no longer leave the title stuck on "✓ run complete")
- [x] `/tree` resilient to legacy sims with no `root_id` field (root was being excluded from its own tree by the equality query)

- [x] `/tree` resilient to legacy sims with no `root_id` field (root was being excluded from its own tree by the equality query)

**Wave G/H — The flagship features** ✅ *(verified: 359 backend tests pass, build + strict typecheck green)*
- [x] **Live Simulation Theater**: engine event-sink records per-tick agent actions on one deterministic replay path (path 0, byte-identical to the mass run; sink never touches the 1000-path Monte Carlo); `GET /{id}/replay`; "theater" tab animates agents on a stage with play/pause/scrub, an event ticker, and a live-building outcome chart (reduced-motion aware)
- [x] **Agent conversation transcripts**: `GET /{id}/transcript` — one batched LLM call narrates the replay log voiced by the agent personas; lazy-loaded panel under the theater stage; templated fallback on LLM failure
- [x] **Zero-signup demo**: public `/demo` page (no auth, no chrome) runs a real capped (≤500) simulation via `POST /api/demo/run`; localStorage holds it; `POST /api/demo/claim` adopts it as your first sim after signup; landing hero now has a "try it now →" CTA
- [x] **AI Copilot**: `POST /{id}/copilot` reads your results + variables + run history → 3-5 typed next-experiment suggestions (sweep/branch/whatif/compare) with one-click "run it"; heuristic fallback when the LLM is down
- [x] **PWA + mobile polish**: web manifest, theme color, apple-web-app metadata; responsive tweaks to the dashboard list + simulation detail tabs
- [x] **Keyboard layer + cheat sheet**: `c` new sim, `g d`/`g a`/`g t` chords, `?` cheat-sheet modal (ignores input focus, doesn't touch ⌘K)

**Wave G/H seam review + fixes** ✅ *(12-agent review; event-sink determinism + copilot mapping clean; 4 findings fixed + tested)*
- [x] Demo claim now validates `results` through the `SimulationResults` model (was persisting forged/arbitrary "completed" results verbatim) + drops unbounded `uploaded_data`/`company_context` (body-size abuse)
- [x] Demo claim idempotent on `(user_id, demo_id)` — a dropped-response retry no longer creates a duplicate simulation
- [x] Theater reduced-motion double-fetch fixed (`reduced` read from a ref, not a fetch dependency)

**Wave I/J — "Next"-tier features** ✅ *(verified: 390 backend tests pass, build + strict typecheck green)*
- [x] **Counterfactual diff engine** (`POST /{id}/diff`): direct-override paired-seed re-run → per-metric deltas + per-timeline-point revenue delta + risk-factor appeared/disappeared sets + LLM explanation; "diff vs baseline" view on the What-If tab
- [x] **Per-run explainer** (`GET /{id}/explain?percentile=p10|p50|p90`): finds the path nearest a percentile, replays it, extracts pivotal agent events, narrates "why it went that way"; "explain a run" control on results
- [x] **Narrative dashboard digest** (`POST /api/insights/digest`): "since you were away" strip — completed runs + stale-sim nudges + one AI headline (cheap aggregation, template fallback)
- [x] **Lexical graph search**: replaced the "LLM scores the first 50 entities" truncation with numpy TF-IDF cosine over **all** entities → top-30 → optional LLM re-rank (no new deps; Voyage-embeddings noted as the future upgrade)
- [x] **Activation checklist**: dismissible 5-step getting-started card on the dashboard with a progress ring (run/sweep/compare/share/⌘K), client-tracked

**Wave I/J seam review + fixes** ✅ *(11-agent review; lexical search + diff engine clean; 4 findings fixed/documented)*
- [x] `/explain` now reports the engine's `final_revenue` (the metric the percentile path was selected by) instead of the replay's last-tick revenue — fixes an incoherent "final revenue" for the trend (always) and biology (often) domains
- [x] Digest hardened against a non-numeric stored `success_probability` (was an unguarded `float()` that could 500 the strip; now mirrors analytics.py's guard)
- [x] Dashboard "dismiss digest" now persists (the dismissed-timestamp key was written but never read)
- [ ] *(documented, low)* `/explain` reflects the base no-override scenario even when the recorded run used runtime overrides — a fidelity caveat, common no-override path unaffected

**Wave K/L — Moonshots** ✅ *(verified: 433 backend tests pass, build + strict typecheck green)*
- [x] **Bayesian calibration from uploaded data** (`POST /{id}/calibrate` + `/calibrate/apply`): fit engine variables to a user's historical CSV via a conjugate-normal (precision-weighted) posterior — prior→posterior shift %, posterior uncertainty, a 0-100 calibration score, LLM summary; "calibrate" tab with column-mapping + apply. **Honest framing: lightweight moment-matching, not full MCMC.** Closes the original audit's "uploaded data never calibrates the simulation" gap.
- [x] **Upload parser now returns raw numeric series** (capped 2000/col) so calibration fits real distributions, not single-point means (cross-seam fix)
- [x] **Causal graph + do-operator** (`GET /graphs/{id}/causal` + `POST /intervene`): promotes the knowledge graph's typed edges (CAUSES/AMPLIFIES/DAMPENS/TRIGGERS/INFLUENCES/REGULATES/PRECEDES) to a directed DAG with cycle detection; `do(node, ±magnitude)` propagates a signed, decaying, tanh-bounded effect downstream; causal-view toggle on the graph page with an intervention panel + ranked downstream effects. **Honest framing: directional inference, not point estimates.**

**Wave K/L seam review + fixes** ✅ *(11-agent review; 6 findings fixed + tested)*
- [x] Calibration rejects non-finite (NaN/inf) observed values (was a 500 + NaN score)
- [x] Calibration mapping is now 1:1 (two columns can't silently claim the same variable + discard a fit)
- [x] Single-point/zero-variance series no longer collapses to "0 uncertainty" (likelihood-std floored relative to the prior)
- [x] Upload `values` cross-seam consistency noted (stats over full series, capped series sent — biased only on ordered >2000-row CSVs; documented)
- [x] Causal cycle-detection rewritten iteratively (a >1000-node causal chain no longer stack-overflows → 500)
- [x] Fuzzy column-mapping default tightened (containment heuristic)

**Wave M/N — XL moonshot: cross-domain composite simulations** ✅ *(verified: 466 backend tests pass, build + strict typecheck green)*
- [x] **Composite simulations** — chain sub-sims across domains into a DAG where one model's output drives another's inputs (e.g. biology binding-rate → business efficacy → finance runway). `POST /api/composites` (+ list/get/delete/run); new `/composites` section with a builder (assemble nodes + metric→variable links) and a DAG detail/run page.
- [x] **Genuine per-path uncertainty propagation** — per-path links (`final_revenue`/`final_market_share`/`success_rate`) feed upstream path *i* into downstream path *i* under a shared seed (a good biology path feeds the matching business path), not mean-passed; aggregate links (`success_probability`/`avg_revenue`/`avg_market_share`) inject the upstream aggregate. Proven coupled: factor 0 → 0% downstream vs factor 50 → ~95% under the same seed.
- [x] Engine refactor (non-breaking): `run_single_path()` + `aggregate_paths()` extracted so per-path-collected aggregation reproduces `run()` exactly; iterative Kahn topo sort (no recursion-limit risk); node cap 6, num_runs cap 5000.

**Wave M/N seam review + fixes** ✅ *(7-agent review; per-path alignment + seed independence + engine refactor confirmed correct; 4 findings fixed + tested)*
- [x] **Critical:** composite detail page crashed (`undefined.forEach`) — GET now lifts nodes/links/num_runs to the top level (+ defensive `?? []` guards) so the DAG/run page works
- [x] **High:** non-finite link factor (NaN/inf) no longer crashes the run with a 500 — rejected at create (422) + `apply_transform` coerces non-finite results to 0
- [x] Per-node outcome chart now plots `probability` (backend emits it) instead of always-zero `count`
- [x] Duplicate-target link last-wins precedence documented *(low, reporting only)*

**Wave O — Multi-objective Pareto optimizer** ✅ *(verified: 490 backend tests pass, build + strict typecheck green)*
- [x] **`POST /api/simulations/{id}/optimize`** — turns Sylor from "simulate what I tell you" into "find me the best plan." Latin-hypercube search (scipy.stats.qmc, no new deps) over the sim's variable ranges → low-N seeded run per candidate (shared base_seed for fair comparison) → direction-aware Pareto frontier + knee-point "best balanced" recommendation.
- [x] Objectives: maximize/minimize over success_probability / avg_revenue / avg_market_share / avg_breakeven_month (1-4 objectives). Budget 10-200 candidates, 20-500 runs each, expensive-tier.
- [x] "optimize" tab with an objective builder, a Recharts Pareto scatter (frontier highlighted, knee-point starred "recommended", dominated dimmed), a frontier table, and "apply to what-if" to load any candidate's config.

**Wave O seam review + fixes** ✅ *(review confirmed dominance/LHS/shared-seed math correct; 2 findings — same NaN root cause — fixed + tested)*
- [x] Engine no longer returns NaN `avg_breakeven_month` when no run survives a period (`np.mean([])` → finite 0.0 sentinel) — a pre-existing latent bug the optimizer surfaced; was poisoning Pareto dominance + knee-point + serializing as invalid-JSON `NaN`
- [x] Optimizer eval step sanitizes any non-finite metric to 0 (defense in depth); `knee_point` always returns a frontier member for a non-empty frontier

**Wave P — Agent network-effects / contagion** ✅ *(verified: 505 backend tests pass, build + strict typecheck green)*
- [x] **Agents now influence each other.** An influence matrix W (seeded from each persona's `influence_weight` + same-type affinity + weak global coupling) drives a per-step propagation pass: churn pressure spreads, competitive/market pressure cascades — producing emergent dynamics (tipping points, cascades) a single-agent model can't. Finally makes "multi-agent" mean something at the interaction level.
- [x] **Opt-in + byte-identical when off.** New `enable_contagion` (default false) + `contagion_strength` (0..1, default 0.3) on SimulationConfig; when off the engine draws zero extra RNG and mutates no state, so all 492 prior tests (incl. exact-seed assertions) stay byte-identical. New `contagion_enabled` / `avg_cascade_events` / `max_contagion_reach` result fields.
- [x] Wired into all four domains; nudge bounded (decay 0.7/hop, clamped) so extreme strength stays finite. Wizard toggle + strength slider ("experimental"); results show a network-effects card (cascade events + contagion reach) only when enabled.

**Wave Q — LLM-driven agents in the loop (hero runs)** ✅ *(verified: 521 backend tests pass, build + strict typecheck green)*
- [x] **`POST /api/simulations/{id}/hero-run`** — a single seeded "hero" path where, at a few KEY ticks, the most-influential agent makes an actual Claude decision grounded in its persona (instead of the formula), mapped to a bounded numeric nudge. The 1000-path Monte Carlo stays formula-based + fast; this is one illustrative LLM-in-the-loop path.
- [x] HARD budget cap (`max_decisions` 1-12, default 6) on total LLM calls; every LLM-derived value finite-guarded (no NaN/inf/500); graceful formula fallback on LLM failure; one wrap-up narration with template fallback. New `hero_run.py` service. "hero run" tab with a decision timeline (agent, market snapshot, Claude's choice + rationale, applied effect), revenue chart, outcome, and narrative.
- [x] Honest framing throughout: "one illustrative path, not a statistical result."

**Polish pass** ✅ *(48-finding audit → triaged fix wave; 521 tests pass, build + typecheck green, Pydantic deprecation eliminated)*
- [x] **Backend hygiene:** Pydantic V2 `SettingsConfigDict` (killed the suite's lone deprecation warning); background-task engine failures now log; `ai_insights` folded onto the `llm_client` singleton (last raw-Anthropic holdout); `context.py` uses a public `extract_json`; **22 duplicated ownership blocks in `simulations.py` collapsed into one `_load_owned_sim` helper**; dead imports/locals removed across ~10 modules; orchestrator re-import cleaned up.
- [x] **Frontend hygiene:** removed unused `framer-motion` + `zustand` deps; a shared `mapSimulation()` replaced 4 duplicated snake→camel blocks; dead imports/locals swept; `any`→real types (dashboard `ElementType`, settings firebase `User`); dropped a dead `?user_id=` param; settings export/delete routed through `api.ts`.
- [x] **Stale copy / docs:** "SimWorld"→"sylor" on the 3 auth pages; docs API reference corrected (real Firebase-token auth, real `sylor-api.fly.dev` host, dropped fake `sk-sylor-`/`100MB pro`/`user_id` claims) + pointer to live OpenAPI; changelog brought current (v0.5.0 → v3.0.0 with the shipped waves); README feature areas updated; dead `/privacy /terms /cookies` footer links removed.
- [x] **Accessibility:** global `prefers-reduced-motion` CSS; slider labels; `role="switch"` on the contagion toggle; `role="img"`/`aria-label` on status dots + theater agents; `aria-hidden` on decorative icons.
- [x] *(deferred → done in the accessibility wave below)* modal focus-trap/ARIA-dialog; causal-graph keyboard path; Recharts screen-reader table fallbacks; real legal pages.

**Accessibility + legal wave** ✅ *(verified: frontend typecheck + production build clean; 3 new static pages prerendered)*
- [x] **Reusable focus trap** (`src/hooks/useFocusTrap.ts`): traps Tab/Shift+Tab inside a dialog, moves focus in on open (prefers `[data-autofocus]`), restores focus to the prior element on close. Wired into the command palette and the keyboard cheat-sheet, both now `role="dialog"` + `aria-modal="true"` + a label (`aria-label`/`aria-labelledby`). The settings "export" controls were inline page buttons (no popup), so no trap was needed there.
- [x] **Causal-graph keyboard path**: SVG nodes are now `tabIndex={0}` + `role="button"` + `aria-label`/`aria-pressed`, operable with Enter/Space (Space scroll-suppressed), with an explicit violet focus ring (SVG default outlines are unreliable). The do-operator panel's controls were already native buttons/range. Mouse interaction + intervention math untouched.
- [x] **Recharts screen-reader tables** (`src/components/ui/chart-data-table.tsx`): a reusable `<ChartDataTable>` renders a visually-hidden (`sr-only`) `<table>` mirroring each chart's exact data array; every chart container got `role="img"` + a descriptive `aria-label`. Applied to **all 19 charts across 9 files** (charts == tables == role-img verified per file).
- [x] **Real legal pages**: `/privacy`, `/terms`, `/cookies` — honest, Sylor-specific content (Firebase Auth, Firestore, Anthropic/Claude, Vercel/Fly.io processors; results framed as illustrative, not advice) with a visible "not legal advice" disclaimer; footer "legal" column restored (links were removed earlier as dead).
- [ ] *(still deferred, low)* heading-case + breadcrumbs sweep on graphs/reports/projects.

**Hero-run + polish seam review + fixes** ✅ *(7-agent review; the `_load_owned_sim` refactor + LLM consolidation + `mapSimulation` dedup all came back clean; 2 hero-run findings fixed + tested)*
- [x] **Critical:** hero-run tab no longer crashes — `market_snapshot` (an object) was rendered as a raw React child; now formatted (+ types corrected)
- [x] `max_decisions` is now a hard cap on LLM *calls*, not just successful decisions (a failing LLM could previously exceed the budget); regression test added

*(Sixteen feature waves + a polish pass + thirteen seam reviews, all verified green. **184 → 522 backend tests.**)*

> **Realtime decision (recorded):** when multiplayer scenario rooms get built, use **Firestore realtime** (onSnapshot for presence/room-state/live results; throttled presence writes for cursors) — no new infra, survives Fly scale-to-zero. The WebSocket-on-Fly path was considered and rejected for the autoscale/cost tradeoff.

---

## 3. Roadmap — Now (the next 2–4 weeks)

> **Shipped from this section:** Live Simulation Theater, Agent transcripts, Try-it-now demo, AI Copilot, Tornado, Natural-Language What-If, Scenario Tree, Decision Memo, Shareable results, Global run tray + notifications, Empty-state gallery, Command palette v2, Live landing hero, keyboard layer. **Most of "now" is done** — remaining items below are smaller polish + the embeddings-search upgrade.

Ranked by wow-per-effort. Specs are concrete enough to hand to an implementer.

### 3.1 Live Simulation Theater (wow 10, L)
Watch the simulation happen: agents on a canvas making decisions tick by tick, outcome distribution building in real time. Turns a black-box Monte Carlo into a spectator sport.
**Spec:** engine emits structured per-tick events (agent_id, action, state_delta) onto an asyncio queue → real SSE events (`tick`, `agent_action`, `distribution_update` every N runs). Persist a compressed replay log (`simulations/{id}/replay`, chunked docs). Frontend: "Theater" tab on `/simulations/[id]` — Canvas2D agent avatars positioned by graph layout, event ticker, live histogram, play/pause/scrub replay. Throttle ~20 events/s client-side; sample displayed runs while computing all.

### 3.2 Natural-Language What-If — *shipped tonight, iterate* (wow 10, M)
"what if I raise prices 20% but churn goes up 5%?" → parse → fork → paired-seed re-run → side-by-side distributions + one-line verdict. Iterate: parse-confirmation chips, branch into scenario tree, multi-turn refinement.

### 3.3 Evidence-Wired Agent Personas (wow 9, L)
Every agent parameter shows evidence chips linking to the exact source passage in your documents. Provenance from document → graph → agent → outcome is the moat.
**Spec:** `agent_profile_generator` emits typed parameter blocks `{value, source_entity_uuid, source_doc_id, quote_span}`; engine agents accept them as distribution parameters (tonight's wiring is step 1); agent inspector drawer with chips that open the source quote and highlight the graph node.

### 3.4 Scenario Tree — branching timeline (wow 8, M)
Every what-if/duplicate/override becomes a node in a git-style tree of futures; diff any two branches.
**Spec:** add `parent_id`, `branch_label`, `root_id` to simulation docs (one query per tree). `GET /projects/{id}/scenario-tree`; `POST /simulations/{id}/branch`. Left-to-right DAG page (reactflow); node cards show label + P50 + sparkline; select two → existing compare page.

### 3.5 Decision Memo Generator (wow 8, M)
One click → one-page executive memo: Recommendation, Evidence, Sensitivities, Risks, Dissent, Next Questions. The artifact users forward to their boss.
**Spec:** `POST /reports/memo {simulation_ids[], audience}` — report_agent composes from results + sweep + tree context; print-styled page with inline mini-charts; "edit with AI" via existing report chat.

### 3.6 Correlated variable distributions (wow 8, L)
Variables move together (price↑ → churn↑) via Gaussian copula / Cholesky.
**Spec:** optional correlation matrix on config (AI proposes defaults per domain from variable semantics); sample correlated normals once per path (`L @ z`), map through inverse-CDF to each variable's range. UI: correlation editor grid with AI-suggested presets, locked to positive-semidefinite (nearest-PSD repair).

### 3.7 Regime-switching market model (wow 8, M)
Markov bull/bear/crisis regimes with per-regime drift/vol replace the flat "2% recession coin-flip". Produces volatility clustering and fat tails.
**Spec:** `RegimeModel` (transition matrix, per-regime params) sampled per path; all agents read the shared regime via `market_state`; regime occupancy stats in results; timeline bands colored by regime.

### 3.8 Try-it-now demo simulation, zero signup (wow 9, M)
The "aha" moment is the product — stop gating it.
**Spec:** `/demo` page: 3 preset scenarios + 3 sliders each. `POST /api/demo/run` unauthenticated, ≤500 iterations, IP rate-limited. Results stored in localStorage with `demoId`; on signup `POST /api/demo/claim` adopts it as your first simulation. Hero CTA: "run a simulation right now".

### 3.9 Global run tray + notifications (wow 8, M)
Persistent bottom-right tray with live SSE progress for every active run, surviving navigation. Browser notification on completion (contextual permission ask on first >30s run); `document.title` flash + favicon badge. Backbone for email notifications later.

### 3.10 Agent conversation transcripts (wow 9, L)
Replay one interesting path and get a narrative transcript of what the agents *did*, month by month, voiced by their personas — one batched LLM call over the event log, not per-event.
**Spec:** optional `event_sink` through `agent.react()`; `GET /simulations/{id}/transcript`; renders as a chat-theater log. Depends on seeding (shipped tonight) + Theater event log.

### 3.11 Smaller "now" items
- **Empty states that sell:** six provocative question cards ("Will my SaaS hit $1M ARR?") each one click from a pre-filled wizard. *(dashboard version shipped tonight)*
- **Keyboard layer:** `c` new sim, `g d` dashboard, `j/k` list nav, `?` cheat sheet.
- **Live landing hero:** replace fabricated stats with real aggregate counts (`GET /api/public/stats`, cached) + anonymized recent-run ticker.
- **Activation checklist:** 5 actions, pays out bonus iterations, instrument as a funnel.
- **Embeddings-based graph search:** replace LLM-relevance-over-50-entities with proper vector search (store embeddings per entity at build time; cosine top-k; LLM only for re-ranking).

---

## 4. Roadmap — Next (1–2 months)

| Feature | Wow | Effort | One-liner |
|---|---|---|---|
| Agent Debate Room (pre-mortem) | 10 | L | Your document-derived personas debate your assumptions before you run; accept their proposed prior changes with one click. SSE chat-theater in the wizard, ~8 turns capped. |
| Bayesian calibration from uploaded data | 10 | XL | Fit engine parameters (churn, growth, vol) to the user's actual historical CSV via likelihood fitting; show prior→posterior shift and a calibration score badge. |
| AI Copilot: next experiment | 9 | M | Reads your results and suggests the 3 highest-information next experiments (sweep CAC 20–80, test downside branch) with one-click run buttons. |
| Per-run counterfactual explainer | 9 | M | Click any trace in the fan chart → "why did this run go bad" — deterministic feature extraction first, Claude narrates from the structured summary. |
| Public gallery + remixable permalinks | 9 | M | Browse/remix public simulations; every share page has a "remix this" CTA into the wizard. |
| Counterfactual diff engine | 8 | M | Paired-seed re-runs make single-variable deltas pure signal (no MC noise); per-metric attribution + plain-English explanation. |
| Run history + delta badges | 8 | M | *(v1 shipped tonight)* Persist every run; ▲+9pts chips on dashboard rows; success-over-runs sparkline. |
| Narrative dashboard ("since you were away") | 8 | M | Diff current state vs last visit; one Claude headline; completed runs, deltas, stale sims. |
| Command palette v2.5 | 8 | M | *(v2 shipped tonight)* Multi-select compare, fuzzy actions with arguments, recents. |
| Calibration & backtest score | 8 | L | Score past forecasts against what actually happened; Brier-style accuracy badge per user/template. |
| Sobol + antithetic variance reduction | 6 | M | High-precision mode: 1000 runs as stable as 4000. Report the real measured variance-reduction factor. |
| Dark-mode-first identity system | 7 | M | One `domain-colors.ts` source of truth; phosphor pulse on running dots; scan-line shimmer on progress bars. |
| First-run guided tour on seeded data | 7 | M | Auto-create one completed example sim on signup; 5-step spotlight tour over real-looking results. |
| Weekly email digest | 7 | L | Monday email: best performer, biggest delta, one AI insight, one suggested experiment. Resend + scheduled Fly machine. |
| Mobile polish + PWA | 6 | M | Monitoring-first mobile: stacked cards, bottom tab nav, installable manifest. |
| Usage-based upgrade prompts | 6 | L | Meter iterations/sweeps; upgrade prompts at moments of success, never blocking existing results. Stripe Checkout. |

---

## 5. Roadmap — Later (the moonshots, 3–6 months)

- **Multiplayer scenario rooms (XL, wow 9):** live cursors, shared what-if sessions, vote on assumptions. Firestore realtime + presence.
- **Cross-domain composite simulations (XL, wow 9):** biology binding success feeds business efficacy feeds finance regime — sub-sims linked in a DAG with per-path uncertainty propagation (sampled, not mean-passed).
- **Causal graph + do-operator interventions (XL, wow 8):** promote graph edges (CAUSES/AMPLIFIES/DAMPENS) to a causal DAG; `do(node, value)` propagates directional effects with honest "directional inference" labeling.
- **Agent network effects / contagion (L, wow 8):** influence matrix from graph edges; churn cascades, tipping points, emergent dynamics; animated force-directed replay.
- **Multi-objective Pareto optimizer (L, wow 8):** "maximize success, minimize burn" → Latin Hypercube search → Pareto frontier with knee-point recommendation, clickable configs.
- **LLM-driven agent decisions in the loop (L, wow 9):** for low-N "hero runs", personas make actual LLM decisions at key ticks (batched, budget-capped); rule-based for the statistical mass. Hybrid keeps cost sane.
- **Scenario branching trees mid-simulation (XL, wow 9):** decision points inside a run ("at month 6, if revenue < X, pivot") — policy trees, not just input branching.
- **Knowledge graph time travel (L, wow 8):** temporal edges already have `valid_from/valid_to`; scrub the graph through time; re-run sims "as of" a date.
- **Template marketplace (L, wow 8):** publish/remix community templates with remix counts; moderation via completed-run requirement + report queue.
- **Forecast tournaments (M, wow 7):** public prediction leagues; calibration leaderboards.
- **Embeddable live result widgets (M, wow 7):** iframe/script embeds of live distribution charts for blogs/notion.
- **Scheduled re-runs + drift alerts (L, wow 7):** re-run weekly as new data lands; alert when success probability drifts >N points.

---

## 6. Engineering quality bar (non-negotiables as features ship)

1. **CI on every push** (tonight): backend pytest on Python 3.12 (the deploy interpreter, not just the 3.11 venv), frontend `next build`. Add `ruff` + `mypy --strict` backend, `eslint` + frontend component tests (vitest + testing-library) as fast follows.
2. **One LLM client.** Fold `ai_insights`'s raw Anthropic usage into `llm_client`; centralize the model id (currently hardcoded in two places).
3. **One frontend data path.** Everything through `api.ts`; retire the parallel direct-Firestore CRUD or scope it to auth only.
4. **Distributed rate limiting.** Move buckets to Firestore/Redis or accept Fly single-machine pinning; the per-process limiter multiplies limits today.
5. **Observability:** structured logging (request id, uid, latency) → Fly logs; Sentry on both ends; LLM token/cost metering per user (feeds the usage meter feature).
6. **Pagination everywhere** before lists grow: simulations, graphs nodes/edges, reports.
7. **Idempotency keys** on expensive POSTs (run, sweep, build-graph) so retries can be made safe again.
8. **Firestore rules tested** with the emulator (config exists in firebase.json, unused).
9. **Honest marketing surfaces:** no fabricated stats anywhere — live counters or nothing.

---

## 7. Monetization sketch

- **Free:** 25k iterations/mo, 1k/run cap, 3 sweeps, all four domains, public sharing.
- **Pro ($29/mo):** 10k-iteration runs, unlimited sweeps/compare, tornado + what-if + scenario tree, memo PDF export, priority compute, email digests.
- **Team ($99/mo):** scenario rooms, shared template library, role-based projects, audit log.
- Surfaces: post-great-result banner (>80% quota), "pro" tags on gated buttons, wizard slider soft-stop. Never block viewing existing results.

---

## 8. Open questions for the owner

1. **Brand:** README says "SimWorld", API says "Sylor API", landing says "sylor" — confirm Sylor everywhere? (Assumed yes tonight.)
2. **Templates:** keep public (current) or auth-gate? Kept public tonight.
3. **Landing demo (`/demo`)** runs unauthenticated compute — comfortable with the abuse surface (IP-capped, 500 iterations) for the conversion win?
4. **Stripe:** ready to wire billing, or keep everything free while features mature?
5. **MiroFish-main/** vendor directory is tracked in git (~large) — safe to delete?
