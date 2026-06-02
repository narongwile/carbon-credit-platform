# ONEOPS — Unified Operations Management Platform

A single multi-tenant frontend that consolidates several IoT sensor products into
one operation-management platform. A **superadmin** can onboard a new customer and
provision a platform for them by **sensor type**, instead of standing up a separate
app per product line.

This repository merges two previously separate frontends:

| Product line | Sensor type | Origin |
| --- | --- | --- |
| **Refrigeration Data Logger** (`carbonbox`) | Temperature & door (cold chain) | this repo (was *carbon-credit-platform*) |
| **ETERNITY Transformer Monitoring** (`eternity`) | Power-transformer DGA / thermal | [transformersmonitoring](https://gitlab.com/narongwile/transformersmonitoring) |
| **BloodBOX Cold Storage** (`bloodbox`) | Medical-grade temp & humidity | scaffolded |

## Stack

- **Next.js 14** (App Router, static export → `out/`)
- **TypeScript**, **Tailwind CSS**, dark "operations console" theme
- **zustand** for client state, **recharts** for charts, **three.js** for the transformer digital twin
- Mock auth + mock data (demo mode — no backend required)

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export to ./out
```

### Demo credentials

| Role | Username | Password | Lands on |
| --- | --- | --- | --- |
| Super Admin | `superadmin` | `admin123` | `/superadmin` |
| Admin | `admin` | `admin123` | `/admin` |
| Customer | `customer` | `customer123` | `/customer` |

## Multi-tenant model

```
Organization (tenant)
  └── PlatformAccess[]        ← which sensor platforms this customer is licensed for
        └── FeatureToggle[]   ← per-platform feature entitlements
```

Roles: `superadmin` (manages all tenants & platforms) → `admin` (manages one org's
fleet) → `customer` (read-only viewer for one org). Routing/role guards live in
`src/lib/auth.ts` and each route group's `layout.tsx`.

## Provisioning a platform for a new customer

The superadmin flow lives at **`/superadmin/platforms`** (Platform Catalog):

1. **Catalog** — every available sensor platform is rendered from the registry.
2. **Provision New Platform** opens a 4-step wizard:
   `Sensor Type → Customer (new/existing) → Feature Entitlements → Review`.

## Adding a new sensor platform (the important bit)

Everything is driven by one registry: **`src/lib/platforms.ts`**. To add a new
product line:

1. Append a `PlatformTemplate` to `PLATFORM_TEMPLATES` (id, name, sensor type,
   icon, accent color, headline metrics, default feature toggles, module route).
2. Build the module page under `src/app/admin/<your-module>/page.tsx` and point
   `moduleRoute` at it (leave empty to ship a "scaffold" placeholder first).

The catalog card, the provisioning wizard, and per-org entitlements all pick it up
automatically — no other wiring needed.

## Project structure

```
src/
  app/
    page.tsx                 # unified login (role tabs)
    superadmin/
      platforms/page.tsx     # ★ Platform Catalog + provisioning wizard
      organizations/         # tenant management + per-org platform/feature toggles
      ...
    admin/
      refrigeration/page.tsx # ★ Refrigeration Data Logger module (integrated)
      ...                     # ETERNITY transformer dashboard, map, trends, alarms
    customer/                # read-only tenant views
  components/refrigeration/  # ported cold-chain node grid / detail / charts
  lib/
    platforms.ts             # ★ platform registry (single source of truth)
    mockData.ts              # tenants, transformers, alarms
    mockRefrigerationData.ts # cold-chain mock telemetry
    auth.ts  store.ts  realtime.ts
  types/index.ts
```

★ = added/changed for the unified platform.
