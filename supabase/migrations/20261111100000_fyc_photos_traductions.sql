/*
  # FYC — photos et traductions (11/11)

  Channing : « sur les PDF, on peut ajouter les photos ? (docx, URL, PDF) » et « sur les PDF il y a beaucoup de
  français, pas de possibilité de traduire ? ».
  - photos : chemins des photos du rapport dans le storage (fyc/<id>/photo_N.jpg), extraites par le navigateur
    (PDF, .docx) ou téléchargées par le worker (page DEKRA).
  - defect_photos : photos des dommages (DEKRA) avec légende et dommage illustré.
  - translations : valeurs du rapport traduites, par langue ({ "nl": {...}, "de": {...} }), faites par le worker.
  - translate_to : langue demandée au worker (null quand rien n'est en attente).
  Additif, idempotent.
*/
alter table public.fyc_inspections add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.fyc_inspections add column if not exists defect_photos jsonb not null default '[]'::jsonb;
alter table public.fyc_inspections add column if not exists translations jsonb not null default '{}'::jsonb;
alter table public.fyc_inspections add column if not exists translate_to text;
create index if not exists fyc_inspections_translate_idx on public.fyc_inspections (translate_to) where translate_to is not null;

select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fyc_inspections' and column_name = 'photos')
   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fyc_inspections' and column_name = 'defect_photos')
   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fyc_inspections' and column_name = 'translations')
   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fyc_inspections' and column_name = 'translate_to') as tout_est_bon;
