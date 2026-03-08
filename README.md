# SimWorld — AI Simulation Platform

Simulate major decisions before you make them. Multi-agent AI simulations for business ideas, startup plans, pricing strategies, and more.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| Backend | FastAPI (Python), deployed on **Fly.io** |
| Database / Auth | **Firebase** (Firestore + Firebase Auth) |
| AI Engine | Claude (Anthropic) for agent behavior & insights |

## Project Structure

```
sylor/
├── frontend/          # Next.js 14 app
│   └── src/
│       ├── app/       # App Router pages
│       ├── components/# UI + feature components
│       ├── lib/
│       │   ├── firebase/  # Firebase client, auth, Firestore helpers
│       │   └── utils.ts
│       └── types/     # TypeScript types
├── backend/           # FastAPI service
│   └── app/
│       ├── routers/   # API endpoints
│       ├── services/  # Simulation engine, AI insights, Firebase Admin
│       └── models/    # Pydantic models
└── firebase/
    ├── firestore.rules        # Firestore security rules
    ├── firestore.indexes.json # Composite indexes
    └── firebase.json          # Emulator config
```

## Quick Start

### 1. Firebase Setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore** (Native mode)
3. Enable **Authentication** → Sign-in methods → **Email/Password** + **Google**
4. Go to Project Settings → Your apps → Add a **Web app** → copy the SDK config
5. Deploy Firestore rules: `firebase deploy --only firestore` (from `firebase/`)

### 2. Frontend

```bash
cd frontend
cp .env.local.example .env.local
# Paste your Firebase web app config values
npm install
npm run dev
```

### 3. Backend

```bash
cd backend
cp .env.example .env
# Download serviceAccountKey.json from Firebase → Project Settings → Service accounts
# Set FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json and ANTHROPIC_API_KEY
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### 4. Deploy to Fly.io

```bash
cd backend
fly launch
# Inline the service account JSON as a secret:
fly secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(cat serviceAccountKey.json)" \
               FIREBASE_PROJECT_ID=your-project-id \
               ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

## Environment Variables

### Frontend (`frontend/.env.local`)
```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
NEXT_PUBLIC_API_URL=https://simworld-api.fly.dev
```

### Backend (`backend/.env`)
```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_ORIGINS=https://your-app.vercel.app
```

## Features

- **Multi-Agent Simulation**: Customers, competitors, investors, regulators all react dynamically
- **Monte Carlo Engine**: Run 100–10,000 scenarios to get statistical confidence
- **What-If Analysis**: Tweak any variable and rerun instantly
- **AI Insights**: Claude explains why scenarios succeed or fail
- **No-Code Builder**: Form-based simulation creation
- **Templates**: Pre-built scenarios for startups, pricing, market entry, and more
- **Interactive Dashboards**: Recharts visualizations with percentile bands, outcome trees
