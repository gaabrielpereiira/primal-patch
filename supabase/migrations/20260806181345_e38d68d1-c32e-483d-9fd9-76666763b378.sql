
INSERT INTO public.organizations (name, slug)
SELECT 'Minha Clínica', 'minha-clinica'
WHERE NOT EXISTS (SELECT 1 FROM public.organizations);

INSERT INTO public.profiles (id, full_name, name, email, is_approved)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)),
       COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)),
       u.email,
       true
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

UPDATE public.profiles
SET org_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
WHERE org_id IS NULL;

INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'admin'::app_role FROM public.profiles p
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _org uuid;
begin
  select id into _org from public.organizations order by created_at limit 1;
  if _org is null then
    insert into public.organizations (name, slug)
    values ('Minha Clínica', 'minha-clinica-' || substr(new.id::text, 1, 8))
    returning id into _org;
  end if;

  insert into public.profiles (id, full_name, name, email, org_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    _org
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
