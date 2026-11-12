/**
 * NOS PROPRES FICHES (12/11, Channing : deux Captur dont la fiche sortait vide — Ada avait pris notre propre fiche
 * PDF pour un rapport fournisseur et l'avait « lue »). Une adresse du bucket public fyc-fiches est une fiche MC Export :
 * jamais une source d'inspection. Module pur.
 */
export const isOwnFiche = (url: string | null | undefined): boolean => !!url && /\/storage\/v1\/object\/public\/fyc-fiches\//i.test(url);
export const isExternalReport = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url.trim()) && !isOwnFiche(url);
export const OWN_FICHE_ERROR = 'ce lien est une fiche MC Export, pas un rapport fournisseur : renseigne le lien du rapport d\'origine (crayon → Lien du rapport)';
