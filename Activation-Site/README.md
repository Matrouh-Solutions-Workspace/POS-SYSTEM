# SHIFT POS Activation Site

Simple website for issuing `license.dat` files from `activation_request.dat`.

It can run fully offline in local development. Supabase is optional and only needed when you want persistent hosted tracking on Vercel.

## Setup

1. Create a Vercel project from this folder.
2. Add these required Vercel environment variables:

```env
ADMIN_PASSWORD=SHIFTPOS@)@^
LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

3. Optional: create a Supabase project if you want hosted activation tracking.
4. Optional: run `supabase/schema.sql` in the Supabase SQL editor.
5. Optional: add these Vercel environment variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`LICENSE_PRIVATE_KEY` must match the public key compiled into the POS app.

## Local Development

```bash
npm install
npm run dev
```

`npm run dev` also serves the local API routes under `/api/*`, including:

```text
/api/health
/api/issue-license
/api/activations
```

If Supabase variables are missing, local activations are stored in:

```text
Activation-Site/.local-data/activation-site.json
```

To force offline/local storage even when Supabase variables exist, set:

```env
ACTIVATION_SITE_STORAGE_MODE=local-json
```

For a stricter Vercel simulation, you can still run:

```bash
npm i -g vercel
vercel dev
```

## What It Tracks

- Uploaded activation request metadata.
- Issued license ID.
- Customer/store names.
- Expiry date.
- Issuing IP/user agent.
- Website/API usage events.

The private signing key and Supabase service role key are only used in serverless API routes.
Without Supabase, Vercel can still issue licenses, but hosted activation history is not durable across serverless instances.

## Quick Production Check

Open:

```text
/api/health
```

It returns which required environment variables are visible to Vercel without exposing their values, plus the current storage mode.
