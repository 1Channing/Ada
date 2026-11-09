/*
  # Signal « vitrine non lisible » sur la fiche contact (09/11 soir)

  Channing : « mettre un petit signal sur la fiche du contact lorsqu'on ne peut pas apprendre une vitrine ».
  network_contacts.showcase_unreadable : la raison, en clair (null = lisible ou pas encore jugée). Posé depuis la
  fenêtre Vitrine (onglet Relevés) ou retiré ; le relevé automatique passe « arrêté » en même temps. Les vitrines
  déjà jugées illisibles au 09/11 sont marquées ici, seulement si rien n'est encore noté. Additif, idempotent.
*/

alter table public.network_contacts add column if not exists showcase_unreadable text;

update public.network_contacts set showcase_unreadable = r.reason, stock_frequency = 'off'
  from (values
    ('benniewilmink.nl',  'liste servie par une API tierce à clé (esp.dtcmediainternet.nl) — pas de page lisible'),
    ('hessautomobile.com','liste servie par Algolia avec une clé propre au site'),
    ('sellens.fr',        'pare-feu (WAF) qui bloque la lecture automatique'),
    ('carizy.com',        'abandonnée (demande du 04/11)'),
    ('scala-auto.com',    'liste chargée en AJAX avec un jeton de session'),
    ('ocasionplus.com',   'liste chargée par une API non publique'),
    ('toyota-keller.de',  'liste chargée par une API non publique'),
    ('dbautohaus.de',     'liste chargée par une API non publique (Nuxt)'),
    ('groupechopard.com', 'liste chargée par une API non publique'),
    ('jwhg.tech',         'liste chargée par une API non publique'),
    ('lebonplanauto.com', 'liste chargée par une API non publique'),
    ('autosphere.fr',     'réseau national (15 000 voitures), pas une concession'),
    ('gw-deutschland.de', 'connexion requise (espace professionnel)'),
    ('home.mobile.de',    'page mobile.de, lecture automatique bloquée'),
    ('auto-brass.com',    'site injoignable lors des relevés'),
    ('kleynvans.nl',      'site injoignable lors des relevés'),
    ('bestelbus.nl',      'protection Cloudflare, lecture automatique bloquée'),
    ('vanmossel.nl',      'liste chargée par une API non publique')
  ) as r(host, reason)
 where public.network_contacts.showcase_unreadable is null
   and lower(coalesce(public.network_contacts.website, '')) like '%' || r.host || '%';

select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'network_contacts' and column_name = 'showcase_unreadable') as tout_est_bon;
