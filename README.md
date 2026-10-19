# Blue Box ERP

**Open-source ERP for inventory, sales, purchasing, and manufacturing.**

Blue Box ERP is a web-based, multi-tenant ERP application built with Next.js, TypeScript, and Supabase.

A project built out of frustration, released for everyone. Use it, fork it, improve it, and make it your own.

**Built out of frustration. Released for everyone.**
A friend needed an ERP. I asked questions, planned things out, and spent hours building one from scratch.
After all that work, I decided to open-source Blue Box ERP instead. At least now, someone else might get some use out of it.


If you find it useful, use it, fork it, break it, improve it. Just please tell me if you're already using another ERP *before* I build you one. 😂

## Features

- **Inventory management** — Manage items, categories, units, and stock levels.
- **Stock tracking** — Track stock movements and monitor reorder levels.
- **Purchasing** — Manage suppliers, inbound receipts, and Goods Received Notes (GRNs).
- **Sales** — Manage clients, quotations, and sales orders.
- **Dispatch** — Generate delivery challans and manage dispatch workflows.
- **Manufacturing** — Manage bills of materials (BOMs) and production workflows.
- **Multi-tenancy** — Organization-based data management.
- **Authentication** — Supabase authentication and session management.
- **Import templates** — Excel templates for supported item and BOM workflows.

## Tech Stack

- [Next.js](https://nextjs.org/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Supabase](https://supabase.com/)
- [PostgreSQL](https://www.postgresql.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [TanStack Query](https://tanstack.com/query/latest)

## Prerequisites

Before starting, install:

- [Node.js](https://nodejs.org/) and npm
- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for local Supabase
- A [Supabase account](https://supabase.com/) if using a hosted database

## Getting Started

If you simply want to use Blue Box ERP without setting it up yourself, email me at mitetoshi@gmail.com.

I'll provide you with access and send you a registration link. Once you've registered, you'll be able to log in and start using the ERP.

No complicated setup. Just register and get started.


### 1. Clone the repository

```bash
git clone https://github.com/miteoshi/blue-box-erp.git
cd blue-box-erp
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create your local environment file:

```bash
cp .env.example .env.local
```

Add your configuration to `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3001
SUPABASE_SERVICE_ROLE_KEY=
```

The Supabase URL and anon/publishable key are required for the application to connect to Supabase.

`SUPABASE_SERVICE_ROLE_KEY` is a server-side secret. Only configure it if required by the server-side code, and never expose it to client-side code or commit its value.

## Option A: Run Supabase Locally with Docker

Local Supabase runs PostgreSQL, authentication, and other Supabase services in Docker containers. This lets you develop without connecting the application to a hosted database.

### 1. Start Docker Desktop

Open Docker Desktop and wait until the Docker engine is running.

Verify Docker:

```bash
docker info
```

### 2. Start Supabase

From the project root, run:

```bash
npx supabase start
```

The first run downloads the required Docker images and may take a few minutes.

### 3. Get local Supabase credentials

Run:

```bash
npx supabase status
```

Use the displayed local API URL and publishable key (or legacy anon key) in `.env.local`.

The default local API URL is usually:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
```

Set the application URL:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

Use the local key reported by the CLI, not credentials from a production project.

### 4. Apply database migrations

Review the migration files in `supabase/migrations/` before applying them.

To rebuild your local database using the repository's migrations, run:

```bash
npx supabase db reset
```

**Warning:** This resets the local development database and deletes its existing data.

If the repository does not include a seed file, make sure `supabase/config.toml` does not reference a missing seed file before resetting the database.

### 5. Start the application

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

### Stop local Supabase

```bash
npx supabase stop
```

## Option B: Use Supabase Online

You can use a hosted Supabase project instead of running Supabase locally in Docker.

### 1. Create a Supabase project

1. Visit [Supabase](https://supabase.com/).
2. Create a new project.
3. Open the project's API or Connect settings.
4. Copy your project URL and publishable key (or legacy anon key).

Use a separate development project rather than an untested production database.

### 2. Configure environment variables

Update `.env.local` with your hosted project's values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3001
SUPABASE_SERVICE_ROLE_KEY=
```

Replace the placeholders with your own credentials.

### 3. Apply database migrations

Log in to the Supabase CLI:

```bash
npx supabase login
```

Link your repository to your own Supabase project:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

After reviewing the migration files and confirming that the linked project is your intended development database, apply the migrations:

```bash
npx supabase db push
```

Alternatively, use the Supabase SQL Editor to apply the required SQL in the correct order.

Back up any important database before applying schema changes.

### 4. Configure authentication

In Supabase Authentication settings, configure the site URL and allowed redirect URLs for your local application or deployed domain.

For local development, allow the appropriate localhost URLs. For production, configure your actual application domain.

### 5. Start the application

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

## Available Scripts

| Command              | Description                               |
| -------------------- | ----------------------------------------- |
| `npm run dev`        | Start the development server on port 3001 |
| `npm run build`      | Build the application                     |
| `npm run start`      | Start the production server               |
| `npm run lint`       | Run ESLint                                |
| `npm run type-check` | Run TypeScript checks                     |

## Project Structure

```text
blue-box-erp/
├── public/                 # Static assets and Excel templates
├── src/
│   ├── app/                # Next.js routes and pages
│   ├── components/         # UI components and providers
│   └── lib/                # Supabase clients, hooks, and utilities
├── supabase/
│   ├── migrations/         # Database migrations
│   └── functions/          # Supabase Edge Functions
├── .env.example
├── package.json
└── README.md
```

## Security

Before using Blue Box ERP with real business data:

- Verify Row Level Security (RLS) policies on exposed tables.
- Test that users cannot access another organization's records.
- Keep service-role keys and database credentials secret.
- Use a separate development database for testing migrations.
- Review authentication, authorization, database functions, and database grants before deploying.

A successful local setup does not automatically mean the application is production-ready.

## Contributing

Contributions, bug reports, feature requests, and documentation improvements are welcome.

1. Fork the repository.
2. Create a branch for your changes.
3. Make and test your changes.
4. Open a pull request describing what you changed.

## License

Blue Box ERP is licensed under the [MIT License](LICENSE).

You are free to use, copy, modify, distribute, and build upon this project under the terms of the license.
