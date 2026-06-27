# SHIFT POS Activation Site

Simple Vercel + Supabase website for issuing `license.dat` files from `activation_request.dat`.

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Create a Vercel project from this folder.
4. Add these Vercel environment variables:

```env
ADMIN_PASSWORD=SHIFTPOS@)@^
LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
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

## Quick Production Check

Open:

```text
/api/health
```

It returns which required environment variables are visible to Vercel without exposing their values.
