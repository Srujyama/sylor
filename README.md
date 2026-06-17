# Sylor — AI Simulation Platform

Simulate major decisions before you make them. Sylor runs multi-agent Monte Carlo
simulations for startups, pricing strategies, financial portfolios, policy changes,
and more — then uses Claude to build knowledge graphs from your documents and
explain why scenarios succeed or fail.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Recharts — deployed on **Vercel** |
| Backend | FastAPI (Python 3.12), deployed on **Fly.io** (`sylor-api`) |
| Database / Auth | **Firebase** — Firestore (Native mode) + Firebase Auth |
| AI Engine | **Claude** (Anthropic) for context analysis, knowledge graphs, and ReACT report generation |

The frontend talks to the FastAPI backend over HTTPS. The backend verifies Firebase
ID tokens on every protected route, runs the Monte Carlo engine, and calls Claude for
the AI-powered features. Both the frontend (Firestore client) and the backend (Firebase
Admin) read and write the same Firestore collections.

## Project Structure

```
sylor/
├── frontend/                  # Next.js 14 app (Vercel)
│   └── src/
│       ├── app/               # App Router pages
│       ├── components/        # UI + feature components
│       ├── lib/
│       │   ├── firebase/      # Firebase client (lazy proxy), auth, Firestore helpers
│       │   └── utils.ts       # API base URL + helpers
│       └── types/             # TypeScript types
├── backend/                   # FastAPI service (Fly.io)
│   └── app/
│       ├── main.py            # App + router registration
│       ├── config.py          # Settings (env-driven)
│       ├── routers/           # API endpoints (simulations, projects, graphs, reports, …)
│       ├── services/          # Simulation engine, knowledge graph, report agent, LLM client
│       ├── middleware/        # Auth (Firebase ID token) + rate limiting
│       └── models/            # Pydantic models
└── firebase/
    ├── firestore.rules        # Firestore security rules
    ├── firestore.indexes.json # Composite indexes
    └── firebase.json          # Emulator config
```

## Feature Areas

- **Multi-agent Monte Carlo engine** — customers, competitors, investors, regulators,
  traders, molecules, and data streams react dynamically across 100–10,000 scenario runs
  to produce statistical confidence intervals and percentile bands.
- **Projects pipeline with knowledge graphs** — upload documents, build a Claude-generated
  knowledge graph (GraphRAG-style ontology + entity/edge extraction), generate agent
  profiles, run the simulation, and produce a report — all orchestrated end to end.
- **Tornado / sensitivity analysis** — rank which variables move the outcome most.
- **What-if analysis** — describe a tweak in plain English; Claude parses it into variable
  overrides and runs a paired comparison against the baseline.
- **Sharing** — create frozen, anonymized public snapshots of a completed simulation.
- **Analytics** — per-user summary (totals, success trend, by-category breakdown) plus an
  anonymized public platform-stats endpoint.
- **AI context analysis** — turn a free-text prompt or structured company context into a
  full simulation configuration (variables, agents, assumptions) via Claude.
- **ReACT report generation** — Claude plans an outline, then writes each section using a
  tool-using ReACT loop over the knowledge graph and simulation results.

See [plan.md](plan.md) for the current roadmap and open questions.

## Quick Start

### 1. Firebase Setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore** (Native mode)
3. Enable **Authentication** → Sign-in methods → **Email/Password** + **Google**
4. Project Settings → Your apps → add a **Web app** → copy the SDK config (frontend env)
5. Project Settings → Service accounts → generate a private key (backend admin creds)
6. Deploy Firestore rules: `firebase deploy --only firestore` (from `firebase/`)

### 2. Backend

```bash
cd backend
cp .env.example .env
# Set FIREBASE_PROJECT_ID, point FIREBASE_SERVICE_ACCOUNT_PATH at your
# serviceAccountKey.json, and set ANTHROPIC_API_KEY.
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# API docs at http://localhost:8000/docs
```

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local
# Paste your Firebase web app config values and point NEXT_PUBLIC_API_URL at the backend.
npm install
npm run dev
# App at http://localhost:3000
```

## Running Tests

### Backend

```bash
cd backend
python -m pytest          # full suite
python -m pytest -q       # quiet
```

Tests mock Firebase and the Anthropic client, so they run fast and never make real
network calls. CI runs the suite on Python 3.12 to match the deploy interpreter.

### Frontend

```bash
cd frontend
npm run build             # type-checks and builds (what CI runs)
```

CI (`.github/workflows/ci.yml`) runs both on every push and pull request to `main`.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_PROJECT_ID` | yes | Firebase project ID. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | one of these two | Service account credentials as an inline JSON string (use this as a Fly.io secret). |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | one of these two | Path to a `serviceAccountKey.json` file (convenient for local dev). |
| `ANTHROPIC_API_KEY` | yes (for AI features) | Anthropic API key used by the LLM client and context analysis. |
| `ALLOWED_ORIGINS` | recommended | Comma-separated list of allowed CORS origins (e.g. your Vercel URL). Defaults to `http://localhost:3000`. |
| `ENVIRONMENT` | optional | `development` or `production`. Defaults to `development`. |

### Frontend (`frontend/.env.local`)

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
NEXT_PUBLIC_API_URL=https://sylor-api.fly.dev   # http://localhost:8000 in dev
```

## Deploy

### Backend → Fly.io

```bash
cd backend
fly deploy   # app: sylor-api  → https://sylor-api.fly.dev
# Configure secrets (inline the service account JSON):
fly secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(cat serviceAccountKey.json)" \
               FIREBASE_PROJECT_ID=your-project-id \
               ANTHROPIC_API_KEY=sk-ant-... \
               ALLOWED_ORIGINS=https://your-app.vercel.app
```

### Frontend → Vercel

Push to the connected repo (or `vercel deploy`). Set the `NEXT_PUBLIC_*` variables in
the Vercel project settings, with `NEXT_PUBLIC_API_URL=https://sylor-api.fly.dev`.
