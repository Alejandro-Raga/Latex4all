/**
 * Where a project's folder is inside a cloud app's folder, the same on
 * every computer that syncs it ("seafile:Doctorado/Thesis/Paper", whether
 * it's at ~/Seafile/… on a Mac or D:\Seafile\… on Windows), or null if it
 * isn't in one.
 */

/** Cloud apps' folder names, and the name each place is given under. */
const CLOUDS: Array<[RegExp, string]> = [
  [/^seafile$/i, "seafile"],
  [/^dropbox( \(.+\))?$/i, "dropbox"],
  [/^onedrive( - .+)?$/i, "onedrive"],
  [/^nextcloud$/i, "nextcloud"],
  [/^owncloud$/i, "owncloud"],
  [/^pcloud drive$/i, "pcloud"],
  [/^box( sync)?$/i, "box"],
  [/^(icloud drive|mobile documents)$/i, "icloud"],
];

export function cloudPlace(root: string): string | null {
  const parts = root
    .normalize("NFC")
    .split(/[\\/]+/)
    .filter(Boolean);
  // The innermost cloud folder: a Seafile folder kept inside Dropbox is
  // Seafile's.
  for (let i = parts.length - 2; i >= 0; i--) {
    const cloud = CLOUDS.find(([name]) => name.test(parts[i]))?.[1];
    if (cloud) return `${cloud}:${parts.slice(i + 1).join("/")}`;
  }
  return null;
}
