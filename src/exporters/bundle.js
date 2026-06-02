// Bundle multiple export files into a single ZIP (JSZip loaded as a global).

export async function makeZipBlob(files) {
  if (!window.JSZip) throw new Error('JSZip not loaded');
  const zip = new window.JSZip();
  for (const f of files) zip.file(f.name, f.content);
  return zip.generateAsync({ type: 'blob' });
}
