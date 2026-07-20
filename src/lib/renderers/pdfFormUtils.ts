/**
 * Aplatissement fiable des formulaires AcroForm.
 *
 * Nos templates PDF (produits par un éditeur tiers) portent des widgets dont
 * la référence de page (/P) pointe vers un objet qui n'existe plus, et qui
 * manquent parfois dans le /Annots de la page. Conséquence : form.flatten()
 * de pdf-lib échoue ("Could not find page for PDFRef ...") et le document
 * part avec des champs VIVANTS — chaque lecteur PDF les redessine alors à sa
 * façon (aligné sur une machine, décalé sur une autre — signalement Antoine,
 * 20/07). Ici on répare la géographie des widgets puis on aplatit : le texte
 * est gravé dans le contenu de la page, identique partout.
 */

import { PDFDict, PDFDocument, PDFFont, PDFForm, PDFName, PDFRef, PDFTextField } from 'pdf-lib';

/**
 * Les champs de nos templates sont marqués "multiline" alors que leurs boîtes
 * ne font qu'une ligne de haut : pdf-lib ancre alors le texte en HAUT de la
 * boîte et réduit la taille de police, d'où des valeurs plus basses et plus
 * petites que leur libellé. En une-ligne avec taille fixe, le texte est
 * centré verticalement — aligné avec le libellé, sur toutes les machines.
 */
export function normalizeTextFields(form: PDFForm, fontSize = 11): void {
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    try { field.disableMultiline(); } catch { /* champ figé — tant pis */ }
    try { field.setFontSize(fontSize); } catch { /* idem */ }
  }
}

/** Réancre chaque widget sur une vraie page du document (répare /P + /Annots). */
export function repairWidgetPageRefs(pdfDoc: PDFDocument, form: PDFForm): void {
  const pages = pdfDoc.getPages();
  if (pages.length === 0) return;

  // ref → page réelle, pour valider les /P existants.
  const pageByRef = new Map(pages.map((p) => [p.ref.toString(), p] as const));

  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      // Retrouver la référence indirecte du dict du widget.
      let widgetRef: PDFRef | undefined;
      for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
        if (obj === widget.dict) { widgetRef = ref; break; }
      }
      if (!widgetRef) continue;

      // Page d'accueil : /P s'il est valide, sinon la page dont le /Annots
      // contient déjà ce widget, sinon la première page.
      const pRef = widget.P();
      let page = pRef ? pageByRef.get(pRef.toString()) : undefined;
      if (!page) {
        page = pages.find((pg) => {
          const annots = pg.node.Annots();
          if (!annots) return false;
          for (let i = 0; i < annots.size(); i++) {
            if (annots.get(i) === widgetRef) return true;
          }
          return false;
        });
      }
      if (!page) page = pages[0];

      widget.setP(page.ref);

      const annots = page.node.Annots();
      let present = false;
      if (annots) {
        for (let i = 0; i < annots.size(); i++) {
          if (annots.get(i) === widgetRef) { present = true; break; }
        }
      }
      if (!present) page.node.addAnnot(widgetRef);
    }
  }
}

/**
 * Après un flatten réussi, le texte est gravé dans le contenu de la page mais
 * des annotations Widget orphelines peuvent subsister dans /Annots (nos
 * templates ont des /Annots dupliqués) : les viewers les repeignent avec leur
 * surlignage de champ (les boîtes lavande). On ne les purge QUE si le
 * formulaire est réellement aplati — sinon on effacerait les valeurs.
 */
function purgeWidgetAnnotations(pdfDoc: PDFDocument): void {
  const widget = PDFName.of('Widget');
  const subtypeKey = PDFName.of('Subtype');
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const dict = page.node.context.lookupMaybe(annots.get(i), PDFDict);
      if (dict && dict.get(subtypeKey) === widget) annots.remove(i);
    }
  }
}

/**
 * Régénère les apparences avec la police fournie, répare les widgets puis
 * aplatit. Retourne true si le formulaire est réellement aplati (plus aucun
 * champ vivant) — false signifie que le document restera dépendant du lecteur.
 */
export function finalizeAcroForm(pdfDoc: PDFDocument, form: PDFForm, font: PDFFont): boolean {
  try { normalizeTextFields(form); } catch { /* on garde les réglages template */ }
  try { form.updateFieldAppearances(font); } catch { /* apparence template conservée */ }
  try { repairWidgetPageRefs(pdfDoc, form); } catch { /* on tente le flatten quand même */ }
  try {
    form.flatten();
  } catch {
    return false;
  }
  const fullyFlat = form.getFields().length === 0;
  if (fullyFlat) {
    try { purgeWidgetAnnotations(pdfDoc); } catch { /* cosmétique seulement */ }
  }
  return fullyFlat;
}
