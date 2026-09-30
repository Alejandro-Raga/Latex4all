/**
 * Links to a note that is being renamed, pointed at its new name: [[Old]],
 * [[Old|label]], [[Old#Heading]], ![[Old]], in the text and its properties.
 */
export function renameLinks(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Obsidian matches names regardless of case; keep what follows the name.
  const link = new RegExp(`(!?\\[\\[)${escaped}(\\.md)?(?=\\]\\]|\\||#)`, "gi");
  return text.replace(link, (_, open: string) => `${open}${to}`);
}
