# StudyGram Planner (Supabase + Vercel)

A clean HTML/CSS/JS planner app with optional cloud backend using Supabase.

## What this setup gives you
- Local mode still works without any backend.
- Cloud mode enables:
  - sign up / sign in
  - sync data across devices
  - personal account data isolation via Row Level Security
- Easy public hosting on Vercel.

## Files
- `index.html`: app UI shell
- `styles.css`: styling
- `app.js`: planner logic + Supabase auth/sync
- `config.js`: your Supabase URL + anon key (fill this)
- `supabase_schema.sql`: DB schema + RLS policies

## 1. Create Supabase project
1. Go to [https://supabase.com](https://supabase.com) and create a project.
2. Open SQL Editor and run `supabase_schema.sql`.
3. In Authentication settings:
- enable Email provider
- optionally disable email confirmation for easier testing
4. In Project Settings -> API, copy:
- Project URL
- anon public key

## 2. Configure app
Edit `config.js`:

```js
window.SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT.supabase.co",
  anonKey: "YOUR_ANON_PUBLIC_KEY"
};
```

## 3. Test locally
Open `index.html` in browser.
- Go to `Settings`
- Create account (Sign Up) and Sign In
- Add tasks/notes
- Refresh page and verify cloud sync

## 4. Deploy to Vercel
### Option A: GitHub + Vercel dashboard (recommended)
1. Push `school-planner-simple` to a GitHub repo.
2. Open [https://vercel.com/new](https://vercel.com/new).
3. Import the repo.
4. Framework preset: `Other`.
5. Build command: leave empty.
6. Output directory: leave empty.
7. Deploy.

### Option B: Drag and drop
1. Zip `school-planner-simple` contents.
2. Open Vercel dashboard and drag-drop deploy.

## 5. Share with friends
- Send your Vercel URL.
- Each friend signs up and gets private synced planner data.

## Notes
- This app stores one JSON state row per user in Supabase (`planner_state`).
- `anonKey` is safe to expose in browser apps when RLS is enabled correctly.
- If `config.js` is blank, app stays in local-only mode.
