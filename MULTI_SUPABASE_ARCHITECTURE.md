# Arquitectura Multi-Supabase — Guía de Integración

> **Propósito**: Documentar cómo la SofLIA Extension conecta múltiples proyectos de Supabase desde un solo frontend. Portátil para replicar en Project Hub u otros proyectos.

---

## 1. Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Vite + React)                  │
│                    (Chrome Extension o Web App)                 │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ supabase │  │ sofiaSupa│  │contentGen│  │ irisSupa │       │
│  │  .ts     │  │  Client  │  │  Supa    │  │  Client  │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │             │
│       ▼              ▼              ▼              ▼             │
│  config.ts ──── Variables de Entorno (.env) ────────────────── │
└───────┬──────────────┬──────────────┬──────────────┬────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  LIA Supa    │ │  SOFIA Supa  │ │ ContentGen   │ │  IRIS Supa   │
│  (hoervba..) │ │  (mrqnnm..)  │ │ (emsjct..)   │ │  (tu-url)    │
│              │ │              │ │              │ │              │
│ • conversa-  │ │ • users      │ │ • cursos     │ │ • projects   │
│   tions      │ │ • orgs       │ │ • contenido  │ │ • issues     │
│ • messages   │ │ • teams      │ │   generado   │ │ • cycles     │
│ • folders    │ │ • memberships│ │              │ │ • teams      │
│ • user_ai_   │ │ • auth       │ │              │ │ • milestones │
│   settings   │ │   (login)    │ │              │ │ • labels     │
│ • meetings   │ │              │ │              │ │ • statuses   │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 2. Variables de Entorno (.env)

Cada proyecto Supabase necesita exactamente **2 variables**: `URL` y `ANON_KEY`.

```env
# ── LIA (datos locales: conversaciones, meetings) ──
VITE_SUPABASE_URL=https://hoervbaawahnsddrnmas.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# ── SOFIA (autenticación principal + organizaciones) ──
VITE_SOFIA_SUPABASE_URL=https://mrqnnmuckznvukjvfkly.supabase.co
VITE_SOFIA_SUPABASE_ANON_KEY=eyJ...

# ── Content Generator (contenido generado) ──
VITE_CONTENT_GEN_SUPABASE_URL=https://emsjctbdevufloxntjll.supabase.co
VITE_CONTENT_GEN_SUPABASE_ANON_KEY=eyJ...

# ── IRIS (gestión de proyectos, issues, equipos) ──
VITE_IRIS_SUPABASE_URL=https://tu-proyecto-iris.supabase.co
VITE_IRIS_SUPABASE_ANON_KEY=eyJ...
```

> **¿De dónde salen estas credenciales?**
> Supabase Dashboard → **Settings** → **API** → `Project URL` y `anon public` key.

---

## 3. Capa de Configuración (config.ts)

Centraliza todas las variables de entorno en un solo archivo. Cada bloque exporta un objeto con `URL` y `ANON_KEY`:

```typescript
// src/config.ts

export const SUPABASE = {
  URL: import.meta.env.VITE_SUPABASE_URL || "",
  ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
};

export const SOFIA_SUPABASE = {
  URL: import.meta.env.VITE_SOFIA_SUPABASE_URL || "",
  ANON_KEY: import.meta.env.VITE_SOFIA_SUPABASE_ANON_KEY || "",
};

export const CONTENT_GEN_SUPABASE = {
  URL: import.meta.env.VITE_CONTENT_GEN_SUPABASE_URL || "",
  ANON_KEY: import.meta.env.VITE_CONTENT_GEN_SUPABASE_ANON_KEY || "",
};

export const IRIS_SUPABASE = {
  URL: import.meta.env.VITE_IRIS_SUPABASE_URL || "",
  ANON_KEY: import.meta.env.VITE_IRIS_SUPABASE_ANON_KEY || "",
};
```

> **Convención de nombres**: `VITE_` es obligatorio para que Vite exponga la variable al frontend. El patrón es `VITE_{SERVICIO}_SUPABASE_{URL|ANON_KEY}`.

---

## 4. Capa de Clientes Supabase (lib/)

### Patrón de Conexión

Cada proyecto Supabase tiene su propio archivo en `src/lib/` que:

1. **Importa** la config correspondiente
2. **Valida** la URL (evita crash si está vacía)
3. **Crea** un `createClient` con storage adapter
4. **Exporta** el cliente y un helper `isConfigured()`
5. **Define** interfaces TypeScript para las tablas

### Storage Adapter (Chrome Extension)

En una extensión de Chrome, `localStorage` no está disponible. Se usa `chrome.storage.local` como adaptador:

```typescript
const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] || null);
        });
      } else {
        resolve(localStorage.getItem(key)); // Fallback para dev
      }
    });
  },
  setItem: async (key: string, value: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      } else {
        localStorage.setItem(key, value);
        resolve();
      }
    });
  },
  removeItem: async (key: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.remove([key], () => resolve());
      } else {
        localStorage.removeItem(key);
        resolve();
      }
    });
  },
};
```

> **Para una web app normal**: No necesitas este adapter. Solo omite la propiedad `auth.storage` y Supabase usará `localStorage` por defecto.

### Crear un Cliente

```typescript
// src/lib/iris-client.ts
import { createClient } from "@supabase/supabase-js";
import { IRIS_SUPABASE } from "../config";

const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const irisUrl = isValidUrl(IRIS_SUPABASE.URL) ? IRIS_SUPABASE.URL : "";
const irisKey = IRIS_SUPABASE.ANON_KEY || "";

export const irisSupa =
  irisUrl && irisKey
    ? createClient(irisUrl, irisKey, {
        auth: {
          storage: chromeStorageAdapter, // OMITIR en web apps normales
          storageKey: "iris-auth-token", // ⚠️ ÚNICO por cliente
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false, // false en extensions, true en web apps
        },
      })
    : null;

export const isIrisConfigured = () => {
  return (
    IRIS_SUPABASE.URL !== "" &&
    IRIS_SUPABASE.ANON_KEY !== "" &&
    isValidUrl(IRIS_SUPABASE.URL)
  );
};
```

> **`storageKey` DEBE ser único** por cada cliente. Si dos clientes usan el mismo key, sus sesiones se pisarán.

### Archivos Actuales

| Archivo               | Cliente          | storageKey               | Propósito                                     |
| --------------------- | ---------------- | ------------------------ | --------------------------------------------- |
| `lib/supabase.ts`     | `supabase`       | (default)                | Conversaciones, mensajes, folders, meetings   |
| `lib/sofia-client.ts` | `sofiaSupa`      | `sofia-auth-token`       | Auth principal, organizaciones, equipos SOFIA |
| `lib/sofia-client.ts` | `contentGenSupa` | `content-gen-auth-token` | Contenido generado (CourseGen)                |
| `lib/iris-client.ts`  | `irisSupa`       | `iris-auth-token`        | Proyectos, issues, ciclos, milestones IRIS    |

---

## 5. Capa de Servicios (services/)

Cada servicio encapsula **operaciones CRUD** contra un cliente Supabase:

```typescript
// src/services/iris-data.ts
import { irisSupa, isIrisConfigured } from "../lib/iris-client";

export async function getProjects(teamId?: string) {
  if (!irisSupa || !isIrisConfigured()) return [];

  let query = irisSupa
    .from("pm_projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (teamId) query = query.eq("team_id", teamId);

  const { data, error } = await query;
  if (error) {
    console.error("Error:", error);
    return [];
  }
  return data || [];
}
```

### Patrón Estándar para Funciones CRUD

```typescript
// CREAR
export async function createIssue(issue: Partial<IrisIssue>) {
  if (!irisSupa || !isIrisConfigured()) return null;
  const { data, error } = await irisSupa
    .from("task_issues")
    .insert(issue)
    .select()
    .single();
  if (error) {
    console.error("Error:", error);
    return null;
  }
  return data;
}

// LEER
export async function getIssueById(issueId: string) {
  if (!irisSupa || !isIrisConfigured()) return null;
  const { data, error } = await irisSupa
    .from("task_issues")
    .select("*, status:task_statuses(*), priority:task_priorities(*)") // JOINs
    .eq("issue_id", issueId)
    .single();
  if (error) return null;
  return data;
}

// ACTUALIZAR
export async function updateIssue(
  issueId: string,
  updates: Partial<IrisIssue>,
) {
  if (!irisSupa || !isIrisConfigured()) return null;
  const { data, error } = await irisSupa
    .from("task_issues")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("issue_id", issueId)
    .select()
    .single();
  if (error) return null;
  return data;
}

// ELIMINAR (soft delete)
export async function archiveIssue(issueId: string) {
  return updateIssue(issueId, { archived_at: new Date().toISOString() });
}
```

### Guard Pattern

**TODA función** empieza con:

```typescript
if (!irisSupa || !isIrisConfigured()) return null; // o [] para arrays
```

Esto evita crashes si las variables `.env` no están configuradas.

---

## 6. Sistema de Autenticación (SOFIA ↔ LIA)

### Flujo de Login

```
┌─────────────┐      ┌───────────────┐      ┌───────────────┐
│  Usuario     │      │  SOFIA Supa   │      │  LIA Supa     │
│  (Login UI)  │      │  (Auth DB)    │      │  (Data DB)    │
└──────┬───────┘      └───────┬───────┘      └───────┬───────┘
       │                      │                      │
       │  1. email + password │                      │
       ├─────────────────────►│                      │
       │                      │                      │
       │  2. Verificar hash   │                      │
       │     en account_users │                      │
       │◄─────────────────────┤                      │
       │  ✅ user + profile   │                      │
       │                      │                      │
       │  3. Sincronizar con LIA ─────────────────►│
       │     signInWithPassword                     │
       │     (o signUp si es nuevo)                 │
       │◄───────────────────────────────────────────┤
       │  ✅ session de LIA                         │
       │                      │                      │
       │  4. Guardar ambas    │                      │
       │     sesiones en      │                      │
       │     chrome.storage   │                      │
       └──────────────────────┴──────────────────────┘
```

### AuthContext.tsx — Cómo funciona

```typescript
// Determina qué sistema de auth usar
const usingSofia = isSofiaConfigured();

// Si SOFIA está configurado:
// 1. Login va a SOFIA primero (verifica credenciales contra account_users)
// 2. Si éxito, sincroniza sessión con LIA Supabase (para RLS en conversations)
// 3. Carga perfil completo: organizaciones, equipos, memberships

// Si SOFIA NO está configurado:
// 1. Login va directo a LIA Supabase auth
```

### Puntos Clave

- **SOFIA es el auth master**: Las credenciales se verifican contra `account_users` en SOFIA
- **LIA Session para RLS**: Las conversaciones en LIA Supabase usan Row Level Security, necesitan un `user_id` de Supabase Auth
- **Sincronización automática**: Al hacer login con SOFIA, se crea/actualiza el usuario en LIA Supabase automáticamente
- **IRIS usa anon_key directamente**: Las queries a IRIS usan el `anon_key` con RLS basado en el `user_id` del usuario autenticado

---

## 7. Flujo para Project Hub (Tu caso de uso)

### Visión: Project Hub como Web App

```
┌───────────────────────┐         ┌──────────────────────┐
│   Project Hub (Web)   │         │  LIA Extension       │
│   (Next.js / Vite)    │         │  (Chrome Extension)  │
│                       │         │                      │
│  Login con SOFIA ──────────┐    │  Login con SOFIA ────┐
│                       │    │    │                      │
│  Ver proyectos ←──────┐    │    │  Crear issues ───────┤
│  Gestionar issues ←───┤    │    │  Ver proyectos ←─────┤
│  Milestones ←─────────┤    │    │  Subir contexto ─────┤
│                       │    │    │                      │
└───────────────────────┘    │    └──────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   IRIS Supabase  │
                    │  (Base de datos  │
                    │   compartida)    │
                    └──────────────────┘
```

### Cómo implementarlo en Project Hub (Web App):

#### Paso 1: Variables de Entorno

```env
# .env.local del Project Hub
VITE_SOFIA_SUPABASE_URL=https://mrqnnmuckznvukjvfkly.supabase.co
VITE_SOFIA_SUPABASE_ANON_KEY=eyJ...

VITE_IRIS_SUPABASE_URL=https://tu-proyecto-iris.supabase.co
VITE_IRIS_SUPABASE_ANON_KEY=eyJ...
```

#### Paso 2: Crear clientes (sin chromeStorageAdapter)

```typescript
// lib/sofia-client.ts (versión web)
import { createClient } from "@supabase/supabase-js";

export const sofiaSupa = createClient(
  import.meta.env.VITE_SOFIA_SUPABASE_URL,
  import.meta.env.VITE_SOFIA_SUPABASE_ANON_KEY,
  {
    auth: {
      storageKey: "sofia-auth-token",
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true, // true en web apps (redirect flows)
    },
  },
);

// lib/iris-client.ts (versión web)
export const irisSupa = createClient(
  import.meta.env.VITE_IRIS_SUPABASE_URL,
  import.meta.env.VITE_IRIS_SUPABASE_ANON_KEY,
  {
    auth: {
      storageKey: "iris-auth-token",
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
);
```

#### Paso 3: Auth con SOFIA (login)

```typescript
// services/sofia-auth.ts (versión web)
async function signIn(email: string, password: string) {
  // 1. Verificar credenciales en SOFIA
  const { data: user } = await sofiaSupa
    .from("users")
    .select("*, organization_users(*)")
    .eq("email", email)
    .single();

  if (!user) throw new Error("Usuario no encontrado");

  // 2. Verificar password (bcrypt hash en backend/edge function)
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) throw new Error("Contraseña incorrecta");

  // 3. Guardar sesión
  saveSession(user);
  return user;
}
```

#### Paso 4: CRUD con IRIS (exactamente igual que en la extensión)

```typescript
// services/iris-data.ts — se reutiliza 100% del código
import { irisSupa } from "../lib/iris-client";

export async function getProjects() {
  const { data } = await irisSupa
    .from("pm_projects")
    .select("*")
    .order("updated_at", { ascending: false });
  return data || [];
}

export async function createIssue(issue) {
  const { data } = await irisSupa
    .from("task_issues")
    .insert(issue)
    .select()
    .single();
  return data;
}
```

---

## 8. Row Level Security (RLS)

### Qué es y por qué importa

Supabase usa RLS para que cada usuario solo vea sus propios datos. Las políticas se definen en SQL:

```sql
-- Ejemplo: Solo el creator o miembros del equipo ven los issues
CREATE POLICY "Users can view team issues" ON task_issues
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Ejemplo: Solo el creator puede editar
CREATE POLICY "Creator can update" ON task_issues
  FOR UPDATE USING (creator_id = auth.uid());
```

### Implicación para Multi-Supabase

- **SOFIA**: RLS verifica `user_id` contra `account_users`
- **LIA**: RLS verifica `user_id` de Supabase Auth
- **IRIS**: RLS verifica `user_id` — debe coincidir con el ID del usuario autenticado

> **Importante**: Si usas `anon_key` sin autenticación, el RLS bloqueará todo. Necesitas que el usuario esté autenticado (session activa) o configurar políticas públicas.

---

## 9. Edge Functions (Supabase Functions)

### Cuándo usarlas

- **Verificación de passwords**: No se debe hacer bcrypt compare en el frontend
- **Operaciones entre proyectos**: Cuando necesitas leer de SOFIA y escribir en IRIS en una sola transacción
- **Webhooks**: Cuando un cambio en IRIS debe notificar a la extensión

### Ejemplo: Edge Function para login

```typescript
// supabase/functions/verify-login/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt/mod.ts";

serve(async (req) => {
  const { email, password } = await req.json();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // service_role para bypass RLS
  );

  const { data: user } = await supabase
    .from("account_users")
    .select("user_id, email, password_hash, account_status")
    .eq("email", email)
    .eq("account_status", "active")
    .single();

  if (!user)
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 401,
    });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return new Response(JSON.stringify({ error: "invalid_password" }), {
      status: 401,
    });

  // Generar JWT o token de sesión
  return new Response(
    JSON.stringify({ user_id: user.user_id, email: user.email }),
  );
});
```

---

## 10. Checklist para Agregar un Nuevo Proyecto Supabase

Cuando necesites conectar un nuevo proyecto Supabase a cualquier app:

- [ ] **1. Crear variables en `.env`**: `VITE_{SERVICIO}_SUPABASE_URL` + `VITE_{SERVICIO}_SUPABASE_ANON_KEY`
- [ ] **2. Agregar a `config.ts`**: Exportar objeto con `URL` y `ANON_KEY`
- [ ] **3. Crear `lib/{servicio}-client.ts`**: Cliente con `createClient`, `storageKey` único, interfaces TypeScript
- [ ] **4. Crear `services/{servicio}-data.ts`**: Funciones CRUD con guard pattern
- [ ] **5. Actualizar `vite-env.d.ts`**: Agregar tipos para las nuevas variables de entorno
- [ ] **6. Configurar RLS** en Supabase Dashboard para las tablas que lo necesiten
- [ ] **7. Probar** que el guard pattern devuelve `[]` o `null` si no hay credenciales

---

## 11. Resumen de Archivos del Sistema

```
src/
├── config.ts                    ← Variables de entorno centralizadas
├── lib/
│   ├── supabase.ts              ← Cliente LIA (conversaciones)
│   ├── sofia-client.ts          ← Cliente SOFIA + ContentGen (auth + orgs)
│   └── iris-client.ts           ← Cliente IRIS (proyectos, issues)
├── services/
│   ├── sofia-auth.ts            ← Lógica de login con SOFIA
│   ├── iris-data.ts             ← CRUD para IRIS (projects, issues, etc.)
│   └── gemini.ts                ← Integración con Gemini AI
├── contexts/
│   └── AuthContext.tsx           ← React Context para auth (SOFIA + LIA)
└── .env                         ← Credenciales (NO subir a git)
```
