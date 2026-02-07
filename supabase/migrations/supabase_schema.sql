-- 1. Enable UUID extension
create extension if not exists "uuid-ossp";

-- 2. Create 'profiles' table with EXTENDED fields
create table public.profiles (
  id uuid not null references auth.users on delete cascade,
  email text,
  
  -- Campos personales detallados
  first_name text,       -- Nombre
  last_name_p text,      -- Apellido Paterno
  last_name_m text,      -- Apellido Materno
  phone text,            -- Teléfono
  nationality text,      -- Nacionalidad
  
  avatar_url text,
  plan_type text default 'free',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  primary key (id)
);

-- 3. Enable RLS
alter table public.profiles enable row level security;

-- 4. Create RLS Policies
create policy "Public profiles are viewable by everyone"
  on profiles for select
  using ( true );

create policy "Users can update own profile"
  on profiles for update
  using ( auth.uid() = id );

-- 5. Create Trigger Function to handle new user signup
-- This function will grab metadata sent from React and insert it into profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    id, 
    email, 
    first_name, 
    last_name_p, 
    last_name_m, 
    phone, 
    nationality,
    avatar_url
  )
  values (
    new.id,
    new.email,
    -- Extract data from raw_user_meta_data
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name_p',
    new.raw_user_meta_data->>'last_name_m',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'nationality',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

-- 6. Attach Trigger to Auth table
-- Drop trigger if exists to ensure clean update
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 7. Conversations Table (Ya existente, se mantiene igual o se crea si no existe)
create table if not exists public.conversations (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users not null,
  title text default 'Nueva Conversación',
  is_pinned boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.conversations enable row level security;

create policy "Users can CRUD only their own conversations"
  on conversations for all
  using ( auth.uid() = user_id );

-- 8. Messages Table
create table if not exists public.messages (
  id uuid default uuid_generate_v4() primary key,
  conversation_id uuid references public.conversations on delete cascade not null,
  user_id uuid references auth.users not null,
  role text check (role in ('user', 'model')),
  content text,
  metadata jsonb, -- Para guardar sources, places, etc.
  created_at timestamp with time zone default now()
);

alter table public.messages enable row level security;

create policy "Users can CRUD only their own messages"
  on messages for all
  using ( auth.uid() = user_id );

-- 9. Trigger for updating 'updated_at' on conversation
create or replace function update_conversation_timestamp()
returns trigger as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;

create trigger on_message_created
  after insert on public.messages
  for each row execute procedure update_conversation_timestamp();
