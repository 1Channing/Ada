/*
  # Retirer de l'Open space : tout membre de l'organisation (12/10 soir,
  #   Channing : « donne la possibilité à tous les utilisateurs d'une
  #   organisation de supprimer une annonce présente dans l'Open space, peu
  #   importe qui l'y a mise »)

  Jusqu'ici (05/09) : seul celui qui avait poussé l'annonce, ou un admin.
  Désormais : tout compte de la MÊME organisation que celui qui l'a poussée,
  ou un admin. L'annonce revient dans la liste de son propriétaire. Toujours
  rien d'une autre organisation. Idempotent.
*/
drop policy if exists "open_space_items_delete" on public.open_space_items;
create policy "open_space_items_delete" on public.open_space_items for delete to authenticated
  using (public.organisation_of(pushed_by) = public.my_organisation()
         or exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin));

select exists (select 1 from pg_policies where tablename = 'open_space_items' and policyname = 'open_space_items_delete'
                 and qual like '%my_organisation%') as tout_est_bon;
