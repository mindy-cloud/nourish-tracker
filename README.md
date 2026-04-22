# NOURISH — Nutrition & Fitness Tracker

## Deploy to Vercel (free, ~5 minutes)

### Step 1 — Get your Anthropic API key
1. Go to console.anthropic.com
2. Sign in (or create a free account)
3. Click **API Keys** → **Create Key**
4. Copy the key — you'll need it in Step 4

### Step 2 — Install Node.js (if you don't have it)
Download from nodejs.org and install it. This is a one-time setup.

### Step 3 — Run locally to test (optional but recommended)
Open Terminal (Mac) or Command Prompt (Windows) in this folder, then:

```bash
npm install
cp .env.example .env
```

Edit `.env` and replace `your_anthropic_api_key_here` with your real key. Then:

```bash
npm run dev
```

Open http://localhost:5173 — microphone will work here.

### Step 4 — Deploy to Vercel
1. Go to vercel.com and sign up free (use GitHub login if you have it)
2. Click **Add New Project**
3. Drag this entire `nourish` folder into the Vercel dashboard
4. Before clicking Deploy, go to **Environment Variables** and add:
   - Name: `VITE_ANTHROPIC_API_KEY`
   - Value: your API key from Step 1
5. Click **Deploy**

Your app will be live at a URL like `nourish-abc123.vercel.app` in about 60 seconds.

### On mobile
Open the Vercel URL in Safari (iPhone) or Chrome (Android). When you tap
**🎙 Start Speaking**, your phone will ask permission to use the microphone — tap Allow.

---

## Project structure
```
nourish/
├── index.html          # Entry point
├── vite.config.js      # Vite config
├── package.json        # Dependencies
├── .env.example        # API key template
└── src/
    ├── main.jsx        # React mount
    └── App.jsx         # Full app
```

## Targets (edit in App.jsx → TARGETS object)
- Calories: 1500 kcal
- Protein: 150g
- Carbs: 145g
- Fat: 33g
- Fiber: 30g
- Water: 85 oz
