export async function run() {
  const [{ a }, { d }] = await Promise.all([import('./a.js'), import('./d.js')]);
  return `${a()} ${d()}`;
}
