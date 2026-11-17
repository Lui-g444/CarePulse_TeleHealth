-- Create an admin account directly in Supabase.
--
-- Admins are intentionally NOT creatable from the public signup form, so this
-- script (or the Supabase Dashboard -> Authentication -> Users -> "Add user")
-- is the only way to provision one.
--
-- Option A (recommended, simplest): create the user in the Supabase Dashboard
--   Authentication -> Users -> Add user, then run only the profile upsert below
--   with that user's id/email.
--
-- Option B: run this whole file in the SQL editor. It creates the auth user
--   (password hashed with pgcrypto) and the matching profile row.
--
-- Adjust the values in the `admin` CTE before running. Re-running is safe.

create extension if not exists pgcrypto;

do $$
declare
  admin_email text := 'admin@carepulse.local';
  admin_password text := 'ChangeMe123!';
  admin_name text := 'CarePulse Admin';
  admin_id uuid;
begin
  -- Reuse an existing auth user with this email if present.
  select id into admin_id
  from auth.users
  where email = admin_email
  limit 1;

  if admin_id is null then
    admin_id := gen_random_uuid();

    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      admin_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      admin_email,
      crypt(admin_password, gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', admin_name, 'role', 'admin'),
      now(),
      now()
    );
  end if;

  -- Ensure the profile row exists with the admin role.
  insert into public.profiles (id, email, full_name, role)
  values (admin_id, admin_email, admin_name, 'admin')
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        role = 'admin';

  raise notice 'Admin ready: % (id=%)', admin_email, admin_id;
end
$$;

-- Repair any NULL token columns left by older manual inserts; GoTrue requires
-- empty strings, not NULL, or login fails with "Database error querying schema".
update auth.users
set confirmation_token = coalesce(confirmation_token, ''),
    email_change = coalesce(email_change, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    recovery_token = coalesce(recovery_token, '')
where confirmation_token is null
   or email_change is null
   or email_change_token_new is null
   or recovery_token is null;

-- Make sure PostgREST picks up any schema changes made alongside this.
notify pgrst, 'reload schema';
