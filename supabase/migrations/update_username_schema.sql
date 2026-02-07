-- 1. Agregar columna username a profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS username text UNIQUE;

-- 2. Actualizar función Trigger para generar Username Automático
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  base_username text;
  final_username text;
BEGIN
  -- Lógica de generación: Nombre + InicialPaterno + InicialMaterno
  -- Ejemplo: Fernando + S + G -> FernandoSG
  base_username := concat(
      new.raw_user_meta_data->>'first_name',
      substring(new.raw_user_meta_data->>'last_name_p' from 1 for 1),
      substring(new.raw_user_meta_data->>'last_name_m' from 1 for 1)
  );

  -- Limpiar espacios por si acaso
  final_username := replace(base_username, ' ', '');
  
  -- Fallback si está vacío (usar parte del email)
  IF final_username IS NULL OR final_username = '' THEN
     final_username := split_part(new.email, '@', 1);
  END IF;

  INSERT INTO public.profiles (
    id, 
    email, 
    first_name, 
    last_name_p, 
    last_name_m, 
    phone, 
    nationality,
    avatar_url,
    username
  )
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name_p',
    new.raw_user_meta_data->>'last_name_m',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'nationality',
    new.raw_user_meta_data->>'avatar_url',
    final_username
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name_p = EXCLUDED.last_name_p,
    last_name_m = EXCLUDED.last_name_m,
    phone = EXCLUDED.phone,
    nationality = EXCLUDED.nationality,
    avatar_url = EXCLUDED.avatar_url,
    username = EXCLUDED.username;
    
  RETURN new;
END;
$$;
