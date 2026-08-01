-- Études quotidiennes : critère boîte de vitesses + lancement forcé (01/08/2026)
--
-- gearbox : 'AUTOMATIQUE' | 'MANUELLE' | '' (toutes) — même convention que le
-- carburant (label critère en majuscules). Appliqué à la génération d'URL
-- (AutoScout gear=A/M natif, Leboncoin via code enum appris 2/1) ET en
-- post-filtre dur côté worker (un listing dont la boîte lue contredit le
-- critère est écarté ; boîte illisible = conservé, fail-open).
--
-- force_requested_at : posé par le bouton « Lancer maintenant » du menu ⋯ ;
-- le worker le sonde toutes les 30 s, efface le drapeau et lance l'étude
-- immédiatement, même en pause et hors heure programmée (c'est un test).
alter table daily_searches add column if not exists gearbox text not null default '';
alter table daily_searches add column if not exists force_requested_at timestamptz;
