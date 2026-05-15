# GPF Cloud

App web premium para GPF Stock, construida como proyecto separado para GitHub/Vercel.

## Stack

- Next.js + React + TypeScript
- Supabase Auth, Database y Storage existentes
- QR web con camara del navegador
- PDF de etiquetas desde navegador

## Variables de entorno

Crear `.env.local` para desarrollo local o configurar estas variables en Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=https://hgqblxxkbldyaqtmclkk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
```

No se modifica la estructura de Supabase. La app consume las tablas, vistas y RPCs existentes:

- `app_users`
- `categories`
- `units_of_measure`
- `locations`
- `customers`
- `gpf_items`
- `gpf_stock_movements`
- `gpf_replenishment`
- `gpf_create_item`
- `gpf_create_stock_entry`
- `gpf_create_stock_exit`
- `gpf_create_physical_adjustment`
- `gpf_admin_create_user`

## Desarrollo local

```powershell
npm install
npm run dev
```

Si `next dev` queda en el splash por el WebSocket/HMR de desarrollo, usar modo local estable:

```powershell
npm run local
```

Luego abrir:

- PC: `http://127.0.0.1:3000`
- Red local: `http://IP-DE-LA-PC:3000`

## Build

```powershell
npm run build
```

## Deploy Vercel

1. Subir `D:\GPF\App-Web` a GitHub.
2. Importar el repo en Vercel.
3. Configurar las variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy.

## Login

El usuario escribe el nombre corto, por ejemplo `admin` u `operador`. La app lo convierte internamente a `usuario@gpf.local`, igual que la app Flutter actual.
