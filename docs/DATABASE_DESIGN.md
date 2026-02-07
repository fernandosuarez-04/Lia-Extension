# Planteamiento de Base de Datos Cloud (Supabase) para Lia

Al optar por Supabase, centralizamos el historial en la nube, permitiendo sincronización entre dispositivos y persistencia segura.

## 1. Arquitectura & Stack

- **Backend/DB**: Supabase (PostgreSQL).
- **Auth**: Supabase Auth (Email/Google).
- **Cliente**: `@supabase/supabase-js` en la extensión.

## 2. Esquema de Base de Datos (SQL)

Necesitaremos ejecutar este Script SQL en el editor de Supabase para crear las tablas:

```sql
-- Tabla: conversations
create table conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  title text,
  mode text default 'chat',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Tabla: messages
create table messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null, -- Redundancia útil para RLS
  role text check (role in ('user', 'model')),
  content text,
  metadata jsonb, -- Para guardar sources, places, images
  created_at timestamp with time zone default now()
);

-- Índices básicos
create index idx_messages_conversation on messages(conversation_id);
create index idx_conversations_user on conversations(user_id);

-- Row Level Security (RLS) - CRUCIAL
-- Permitir que solo el dueño vea sus datos

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "Users can all their own conversations" on conversations
  for all using (auth.uid() = user_id);

create policy "Users can all their own messages" on messages
  for all using (auth.uid() = user_id);
```

## 3. Flujo de Usuario (UX)

El flujo de la extensión cambia ligeramente:

1.  **Estado "Invitado"**: Si no hay sesión, los chats son efímeros (en memoria) y no se guardan. Aparecerá un botón "Inicia sesión para guardar historial".
2.  **Login**: Panel simple de Email/Pass o "Continuar con Google".
3.  **Estado "Autenticado"**:
    - Al abrir Lia, se carga la lista de últimos chats desde Supabase.
    - Cada mensaje enviado se inserta en `messages` en tiempo real.

## 4. Pasos de Implementación

1.  **Instalación**: `npm install @supabase/supabase-js`
2.  **Configuración**: Crear `src/lib/supabase.ts` con `SUPABASE_URL` y `SUPABASE_ANON_KEY` (en un archivo `.env` o config).
3.  **Auth Context**: Crear un `AuthProvider` en React para manejar la sesión globalmente.
4.  **Service Layer**: Funciones como `saveMessage(text, conversationId)` y `getHistory()`.

---

**¿Tienes ya las credenciales (URL y Anon Key) de tu proyecto Supabase o quieres que creemos uno nuevo?**
