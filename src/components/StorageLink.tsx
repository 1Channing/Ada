import { useSignedUrl } from '../services/storageAccess';

/** Lien vers un fichier du storage privé : URL signée, ouverte dans un onglet. */
export function StorageLink({ path, children, className, title }: { path: string; children: React.ReactNode; className?: string; title?: string }) {
  const url = useSignedUrl(path);
  return (
    <a href={url ?? '#'} target="_blank" rel="noreferrer" className={className} title={title} onClick={(e) => { if (!url) e.preventDefault(); }}>
      {children}
    </a>
  );
}

/** Image de fond (vignette) depuis le storage privé. */
export function StorageBg({ path, className }: { path: string; className?: string }) {
  const url = useSignedUrl(path);
  return <div className={className} style={url ? { backgroundImage: `url(${url})` } : undefined} />;
}
