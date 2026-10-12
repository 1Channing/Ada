/**
 * CLÉ D'UN NUMÉRO DE TÉLÉPHONE (12/10, prospection : « enregistrer le numéro
 * avec l'annonce pour repérer les doublons quand quelqu'un remet une annonce
 * au bout d'un certain temps »).
 *
 * Deux écritures du même numéro doivent se reconnaître : « 06 12 34 56 78 »,
 * « 0612345678 », « +33 6 12 34 56 78 », « 0033612345678 ». La clé garde les
 * chiffres, ramène le préfixe international 00 → +, et pose l'indicatif 33
 * sur un numéro français à 10 chiffres commençant par 0. Un numéro d'un
 * autre pays donné avec son indicatif se compare tel quel. Fail-open : moins
 * de 6 chiffres → pas de clé (jamais de faux doublon sur un fragment).
 */
export function phoneKey(raw: string | null | undefined): string {
  let d = (raw ?? '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.length === 10 && d.startsWith('0')) d = `33${d.slice(1)}`;
  else if (d.length === 9 && /^[67]/.test(d)) d = `33${d}`; // « 612345678 » sans le 0
  return d.length >= 6 ? d : '';
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneKey(a);
  return ka !== '' && ka === phoneKey(b);
}

/** Affichage français « 06 12 34 56 78 » quand c'est un numéro FR, sinon tel quel. */
export function fmtPhone(raw: string | null | undefined): string {
  const k = phoneKey(raw);
  if (/^33\d{9}$/.test(k)) return `0${k.slice(2)}`.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  return (raw ?? '').trim();
}
