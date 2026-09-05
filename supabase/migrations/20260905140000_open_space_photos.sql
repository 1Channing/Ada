-- ═══════════════════════════════════════════════════════════════════════════
-- OPEN SPACE : travailler les PHOTOS d'une annonce partagée (05/09/2026,
-- demande Channing) — comme dans ses propres négociations (ordre, rognage,
-- ajout, suppression, PDF). Une négociation reste modifiable par son seul
-- propriétaire (RLS negotiations_own) ; cette fonction n'ouvre à l'équipe
-- QUE la colonne photos, et seulement tant que l'annonce est dans l'Open
-- space. Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.open_space_set_photos(p_negotiation_id uuid, p_photos jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if auth.uid() is null then return false; end if;
  if jsonb_typeof(p_photos) <> 'array' then return false; end if;
  update public.negotiations n
     set photos = p_photos, updated_at = now()
   where n.id = p_negotiation_id
     and exists (select 1 from public.open_space_items o where o.negotiation_id = n.id);
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.open_space_set_photos(uuid, jsonb) from public, anon;
grant execute on function public.open_space_set_photos(uuid, jsonb) to authenticated;

select 'ok' as tout_est_bon;
