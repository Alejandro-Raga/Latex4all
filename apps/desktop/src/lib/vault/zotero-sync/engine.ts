/**
 * The Zotero → Obsidian sync, ported from the Python sync's sync() step for
 * step: brings the library's changes in, makes idea notes from highlights
 * tagged "idea", files papers and highlights under their topics and ideas
 * (and the types of your own with a Zotero tag word, and notes paired with a
 * tag), gives every paper that needs one a note, and rewrites only what
 * changed. Its memory (which note is whose, what's been deleted) is `state`,
 * shaped as the Python sync's, so either can pick up from the other.
 */
import {
  BEGIN,
  type Cache,
  cmp,
  digest,
  exactTagMembers,
  gather,
  groupPattern,
  hasTag,
  IDEA_RE,
  IDEA_TAG,
  ideaNote,
  ideaTitle,
  isPaper,
  type Item,
  LINK_RE,
  linkFixer,
  mergeNote,
  mergeTopic,
  norm,
  noteName,
  ownedFrontmatter,
  PaperFinder,
  renderBody,
  safeFilename,
  settled,
  TOPIC_RE,
  topicBody,
  topicMembers,
  topicsOf,
  topLevelKey,
  citekey,
} from "./model";

/** The vault, as the sync reads and writes it (paths relative to its root). */
export interface SyncStore {
  read(path: string): Promise<string | null>;
  /** File names in a folder. */
  list(dir: string): Promise<string[]>;
  /** Every file's path. */
  listAll(): Promise<string[]>;
  write(path: string, text: string): Promise<void>;
}

/** Zotero's library, as the sync asks for it. */
export interface SyncZotero {
  itemsSince(version: number): Promise<{ items: Item[]; version: number }>;
  deletedSince(version: number): Promise<string[]>;
}

interface GroupState {
  paths: Record<string, string | null>;
  listed: Record<string, string[]>;
}

export interface SyncState {
  version: number;
  paths: Record<string, string>;
  ideas?: Record<string, string | null>;
  idea_digests?: Record<string, string>;
  topics?: Record<string, string | null>;
  topic_papers?: Record<string, string[]>;
  idea_notes?: Record<string, string | null>;
  idea_papers?: Record<string, string[]>;
  /** Types of your own and paired tags: Latex4All's additions. */
  groups?: Record<string, GroupState>;
  /** The computer syncing the vault now, and until when (see run.ts). */
  holder?: { id: string; label: string; until: number };
}

/** A note type of your own with a Zotero tag word. */
export interface CustomGroup {
  kind: string;
  word: string;
  label: string;
  dir: string;
  /** Tag the new note gets in its frontmatter (its Obsidian tag, or the word). */
  kindTag: string;
}

/** A note paired with one exact Zotero tag (the tag manager's). */
export interface PairedTag {
  tag: string;
  path: string;
  label: string;
}

export interface SyncConfig {
  papersDir: string;
  ideasDir: string;
  topicsDir: string;
  /** The vault tag: papers with it get a note. */
  forceTag: string;
  custom?: CustomGroup[];
  paired?: PairedTag[];
  /** "YYYY-MM-DD", for a new note's `created`. */
  today: string;
  now: Date;
  rebuild?: boolean;
  log?: (message: string) => void;
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

interface Group {
  id: string;
  kind: string;
  label: string;
  heading: string;
  kindTag: string;
  dir: string;
  members: Map<string, Map<string, Item[]>>;
  state: GroupState;
  /** A paired note: its path never changes, its tag is exact. */
  fixedPath?: string;
}

export async function runSync(
  store: SyncStore,
  zot: SyncZotero,
  state: SyncState,
  cache: Cache,
  cfg: SyncConfig,
): Promise<number> {
  const log = cfg.log ?? (() => {});
  const forceTag = cfg.forceTag.trim().toLowerCase();
  const { items: changed, version } = await zot.itemsSince(state.version);
  const deleted = state.version ? await zot.deletedSince(state.version) : [];
  log(
    `library v${state.version} -> v${version}: ${changed.length} changed, ${deleted.length} deleted`,
  );

  // Papers affected before and after the changes, so a move re-renders both.
  const affected = new Set<string>();
  for (const i of changed) {
    const old = cache.get(i.key);
    if (old) affected.add(topLevelKey(old, cache));
  }
  for (const k of deleted) {
    const old = cache.get(k);
    if (old) affected.add(topLevelKey(old, cache));
  }
  for (const i of changed) cache.set(i.key, { key: i.key, data: i.data });
  for (const k of deleted) cache.delete(k);
  // A fixed order, whatever order the items came in: every computer and
  // every run agrees on which PDF comes first and how topics are listed.
  const ordered = [...cache.values()].sort(
    (a, b) =>
      cmp(a.data.dateAdded || "", b.data.dateAdded || "") || cmp(a.key, b.key),
  );
  cache.clear();
  for (const i of ordered) cache.set(i.key, i);
  for (const i of changed) affected.add(topLevelKey(i, cache));
  if (cfg.rebuild) for (const k of cache.keys()) affected.add(k);

  const paths = state.paths;
  state.ideas ??= {};
  state.idea_digests ??= {};
  state.topics ??= {};
  state.topic_papers ??= {};
  state.idea_notes ??= {};
  state.idea_papers ??= {};
  state.groups ??= {};
  const ideas = state.ideas;
  const ideaDigests = state.idea_digests;

  const wantsNote = (key: string, groups: Group[]): boolean => {
    const item = cache.get(key) as Item;
    if (hasTag(item, forceTag) || groups.some((g) => groupHas(g, item)))
      return true;
    const { annotations } = gather(key, cache);
    return annotations.some(([, anns]) =>
      anns.some(
        (a) => hasTag(a, IDEA_TAG) || groups.some((g) => groupHas(g, a)),
      ),
    );
  };

  // The groups: topics and named ideas as the Python sync has them, then
  // types of your own, then paired tags.
  const builtIn = (kind: "topic" | "idea"): Group => ({
    id: kind,
    kind,
    label: kind === "topic" ? "Topics" : "Ideas",
    heading: kind === "topic" ? "## Definition" : "## The idea",
    kindTag: kind,
    dir: kind === "topic" ? cfg.topicsDir : cfg.ideasDir,
    members: new Map(),
    state: {
      paths: (kind === "topic" ? state.topics : state.idea_notes) as Record<
        string,
        string | null
      >,
      listed: (kind === "topic"
        ? state.topic_papers
        : state.idea_papers) as Record<string, string[]>,
    },
  });
  const groups: Group[] = [builtIn("topic"), builtIn("idea")];
  const patterns = new Map<Group, RegExp>([
    [groups[0], TOPIC_RE],
    [groups[1], IDEA_RE],
  ]);
  for (const c of cfg.custom ?? []) {
    const g: Group = {
      id: `type:${c.kind}`,
      kind: c.word,
      label: c.label,
      heading: `## About this ${c.label.toLowerCase()}`,
      kindTag: c.kindTag,
      dir: c.dir,
      members: new Map(),
      state: (state.groups[`type:${c.kind}`] ??= { paths: {}, listed: {} }),
    };
    groups.push(g);
    patterns.set(g, groupPattern(c.word));
  }
  const pairedTags = new Set((cfg.paired ?? []).map((p) => p.tag));
  for (const p of cfg.paired ?? []) {
    groups.push({
      id: `tag:${p.tag}`,
      kind: "tag",
      label: p.label,
      heading: "",
      kindTag: "",
      dir: "",
      members: new Map(),
      state: (state.groups[`tag:${p.tag}`] ??= { paths: {}, listed: {} }),
      fixedPath: p.path,
    });
  }
  function groupHas(g: Group, item: Item): boolean {
    if (g.fixedPath) {
      const tag = g.id.slice(4);
      return (item.data.tags ?? []).some(
        (t: { tag: string; type?: number }) => t.type !== 1 && t.tag === tag,
      );
    }
    return topicsOf(item, patterns.get(g) as RegExp).length > 0;
  }

  const paperLinks = new Map<Group, Map<string, string[]>>(
    groups.map((g) => [g, new Map()]),
  );
  const linked = new Set<string>();
  let written = 0;

  // Notes another tool wrote for a paper (Add to vault), adopted by zotero_key.
  let adoptable: Map<string, string> | null = null;
  const existingNote = async (key: string) => {
    if (!adoptable) {
      adoptable = new Map();
      const owned = new Set(Object.values(paths).map((p) => p.toLowerCase()));
      for (const name of await store.list(cfg.papersDir)) {
        const path = join(cfg.papersDir, name);
        if (!name.endsWith(".md") || owned.has(path.toLowerCase())) continue;
        const m = /^zotero_key: *['"]?([A-Z0-9]{8})/m.exec(
          (await store.read(path)) ?? "",
        );
        if (m) adoptable.set(m[1], path);
      }
    }
    const found = adoptable.get(key) ?? null;
    adoptable.delete(key);
    return found;
  };

  const newPath = async (key: string) => {
    const found = await existingNote(key);
    if (found) {
      log(`adopting ${found}`);
      return found;
    }
    const base = safeFilename(citekey((cache.get(key) as Item).data)) || key;
    const taken = new Set(Object.values(paths).map((p) => p.toLowerCase()));
    for (const suffix of ["", ..."abcdefghijklmnopqrstuvwxyz"]) {
      const path = join(cfg.papersDir, `${base}${suffix}.md`);
      if (!taken.has(path.toLowerCase())) return path;
    }
    return join(cfg.papersDir, `${base}-${key}.md`);
  };

  // Notes moved in the vault, found by the Zotero item they name.
  let moved: Map<string, string> | null = null;
  const findMoved = async (key: string) => {
    if (!moved) {
      moved = new Map();
      const tracked = new Set(Object.values(paths).map((p) => p.toLowerCase()));
      for (const path of await store.listAll()) {
        if (
          !path.endsWith(".md") ||
          tracked.has(path.toLowerCase()) ||
          path.includes(".obsidian/")
        )
          continue;
        const m = /^zotero_key: *['"]?([A-Z0-9]{8})/m.exec(
          (await store.read(path)) ?? "",
        );
        if (m && !moved.has(m[1])) moved.set(m[1], path);
      }
    }
    return moved.get(key) ?? null;
  };

  const reserved = new Set<string>();
  const render = async (key: string): Promise<boolean> => {
    const item = cache.get(key);
    if (!item || !isPaper(item)) return false;
    let path: string | undefined = paths[key];
    const tracked = path !== undefined;
    if (path === undefined) {
      if (!wantsNote(key, groups)) return false;
      path = paths[key] = await newPath(key);
    }
    let existing = await store.read(path);
    if (existing === null && tracked) {
      const found = await findMoved(key);
      if (found) {
        log(`${path} moved to ${found}`);
        path = paths[key] = found;
        existing = await store.read(path);
      }
    }
    if (existing === null && !(wantsNote(key, groups) || linked.has(key))) {
      delete paths[key];
      return false;
    }
    const files = new Map<string, string>();
    const fix = linkFixer(paths, cache, reserved);
    const extra: [string, string[]][] = groups
      .slice(2)
      .map((g) => [
        g.label,
        (paperLinks.get(g) as Map<string, string[]>).get(key) ?? [],
      ]);
    const body = renderBody(
      key,
      cache,
      paths,
      files,
      ideas,
      fix,
      cfg.forceTag,
      (paperLinks.get(groups[0]) as Map<string, string[]>).get(key) ?? [],
      (paperLinks.get(groups[1]) as Map<string, string[]>).get(key) ?? [],
      extra,
    );
    const next = mergeNote(existing, body, ownedFrontmatter(key, cache));
    if (next === null) {
      log(`skip ${path}: zotero markers were removed`);
      return false;
    }
    for (const [name, svg] of files) {
      const inkPath = join(cfg.papersDir, `Ink/${name}`);
      if ((await store.read(inkPath)) !== svg) await store.write(inkPath, svg);
    }
    if (next !== existing) {
      await store.write(path, next);
      written++;
      log(`${existing ? "update" : "create"} ${path}`);
    }
    return existing === null;
  };

  // Highlights tagged "idea" become notes once, then belong to Obsidian.
  for (const ann of [...cache.values()]) {
    const d = ann.data;
    if (
      d.itemType !== "annotation" ||
      d.deleted ||
      ann.key in ideas ||
      !hasTag(ann, IDEA_TAG) ||
      !settled(ann, cfg.now)
    ) {
      continue;
    }
    const text = (d.annotationComment || d.annotationText || "").trim();
    const title = ideaTitle(text);
    const paper = topLevelKey(ann, cache);
    const p = cache.get(paper);
    if (!title || !p || !isPaper(p)) continue;
    if (!(paper in paths)) paths[paper] = await newPath(paper);
    let path = join(cfg.ideasDir, `${title}.md`);
    let n = 2;
    while ((await store.read(path)) !== null) {
      path = join(cfg.ideasDir, `${title} (${n}).md`);
      n++;
    }
    const note = ideaNote(
      text,
      ann,
      noteName(paths[paper]),
      linkFixer(paths, cache, reserved),
      cfg.today,
    );
    await store.write(path, note);
    ideas[ann.key] = path;
    ideaDigests[ann.key] = await digest(note);
    affected.add(paper);
    written++;
    log(`create ${path}`);
  }

  // Idea notes renamed in Obsidian are followed; a deleted one is remembered.
  for (const [annKey, path] of Object.entries(ideas)) {
    const ann = cache.get(annKey);
    if (
      path === null ||
      !ann ||
      !affected.has(topLevelKey(ann, cache)) ||
      (await store.read(path)) !== null
    ) {
      continue;
    }
    ideas[annKey] = null;
    for (const name of await store.list(cfg.ideasDir)) {
      const p = join(cfg.ideasDir, name);
      if (
        name.endsWith(".md") &&
        ((await store.read(p)) ?? "").includes(`zotero_annotation: ${annKey}`)
      ) {
        ideas[annKey] = p;
        log(`idea ${annKey} was renamed to ${name}`);
        break;
      }
    }
  }

  // A highlight's rewrites flow into its idea note until it's edited in Obsidian.
  for (const i of changed) {
    const k = i.key;
    const path = ideas[k];
    const item = cache.get(k);
    if (!path || !(k in ideaDigests) || !item || item.data.deleted) continue;
    const existing = await store.read(path);
    if (existing === null || (await digest(existing)) !== ideaDigests[k]) {
      delete ideaDigests[k];
      continue;
    }
    const body = (
      item.data.annotationComment ||
      item.data.annotationText ||
      ""
    ).trim();
    const paper = topLevelKey(item, cache);
    if (!body || !(paper in paths)) continue;
    const created = /^created: '?([\d-]+)/m.exec(existing)?.[1] ?? cfg.today;
    const text = ideaNote(
      body,
      item,
      noteName(paths[paper]),
      linkFixer(paths, cache, reserved),
      created,
    );
    if (text !== existing) {
      await store.write(path, text);
      ideaDigests[k] = await digest(text);
      written++;
      log(`update ${path}`);
    }
  }

  // Topics, ideas and the rest: every paper in one gets a note, each its own.
  for (const g of groups) {
    g.members = g.fixedPath
      ? exactTagMembers(cache, new Set([g.id.slice(4)]))
      : topicMembers(cache, patterns.get(g) as RegExp);
    const gPaths = g.state.paths;
    for (const [name, papers] of g.members) {
      const tid = g.fixedPath ? g.id : norm(name);
      if (gPaths[tid] === null) continue; // deleted in Obsidian
      let path = gPaths[tid];
      if (path && g.fixedPath && (await store.read(path)) === null) {
        gPaths[tid] = null; // a paired note deleted in Obsidian stays deleted
        continue;
      }
      if (path && !g.fixedPath && (await store.read(path)) === null) {
        gPaths[tid] = null;
        for (const f of await store.list(g.dir)) {
          const p = join(g.dir, f);
          if (
            f.endsWith(".md") &&
            ((await store.read(p)) ?? "").includes(`zotero_${g.kind}: ${tid}`)
          ) {
            gPaths[tid] = p;
            log(`${g.kind} ${name} was renamed to ${f}`);
            break;
          }
        }
        if (gPaths[tid] === null) continue;
      }
      if (gPaths[tid] === undefined && !g.fixedPath) {
        // Not met before (a vault synced by something else until now): its
        // note may have been renamed, and still says whose it is.
        const own = join(g.dir, `${name}.md`);
        if ((await store.read(own)) === null) {
          for (const f of await store.list(g.dir)) {
            const p = join(g.dir, f);
            if (
              f.endsWith(".md") &&
              ((await store.read(p)) ?? "").includes(
                `zotero_${g.kind}: ${tid}\n`,
              )
            ) {
              gPaths[tid] = p;
              break;
            }
          }
        }
      }
      if (gPaths[tid] === undefined)
        gPaths[tid] = g.fixedPath ?? join(g.dir, `${name}.md`);
      path = gPaths[tid] as string;
      for (const k of papers.keys()) {
        if (!(k in paths)) {
          paths[k] = await newPath(k);
          affected.add(k);
        }
        const links = paperLinks.get(g) as Map<string, string[]>;
        links.set(k, [...(links.get(k) ?? []), noteName(path)]);
      }
    }
    for (const [tid, keys] of Object.entries(g.state.listed)) {
      const now = [...g.members].find(
        ([n]) => (g.fixedPath ? g.id : norm(n)) === tid,
      )?.[1];
      for (const k of keys) if (!now?.has(k)) affected.add(k);
    }
  }
  void pairedTags;

  // Links typed in Zotero bring the paper they point to into the vault.
  reserved.clear();
  for (const g of groups)
    for (const p of Object.values(g.state.paths))
      if (p) reserved.add(norm(noteName(p)));
  for (const p of Object.values(ideas)) if (p) reserved.add(norm(noteName(p)));
  const finder = new PaperFinder(cache, paths, reserved);
  for (const item of [...cache.values()]) {
    const d = item.data;
    if (d.deleted || !["annotation", "note"].includes(d.itemType)) continue;
    if (!(topLevelKey(item, cache) in paths)) continue;
    const text = `${d.annotationComment || ""} ${d.note || ""}`;
    for (const m of text.matchAll(new RegExp(LINK_RE.source, "g"))) {
      const k = finder.find(m[1]);
      if (k && !(k in paths)) {
        paths[k] = await newPath(k);
        linked.add(k);
        affected.add(k);
        log(
          `include ${((cache.get(k) as Item).data.title ?? k).slice(0, 60)} (linked as [[${m[1]}]])`,
        );
      }
      if (k) linked.add(k);
    }
  }

  const created: string[] = [];
  for (const k of [...affected].sort(cmp)) if (await render(k)) created.push(k);
  // A new note can be the target of links and "Related papers" anywhere.
  if (created.length) {
    for (const k of Object.keys(paths))
      if (!created.includes(k)) await render(k);
  }

  const fix = linkFixer(paths, cache, reserved);
  for (const g of groups) {
    const listed = g.state.listed;
    for (const [name, papers] of g.members) {
      const tid = g.fixedPath ? g.id : norm(name);
      const path = g.state.paths[tid];
      if (!path) continue;
      const keys = [...papers.keys()].sort(cmp);
      const anns = [...papers.values()]
        .flatMap((found) =>
          found.map((a) => a.key + (a.data.dateModified ?? "")),
        )
        .sort(cmp);
      const stamp = [...keys, ...anns];
      const before = listed[tid];
      const same =
        before &&
        before.length === stamp.length &&
        before.every((x, i) => x === stamp[i]);
      if (
        !(
          cfg.rebuild ||
          created.length ||
          !same ||
          keys.some((k) => affected.has(k))
        )
      )
        continue;
      const files = new Map<string, string>();
      const existing = await store.read(path);
      const next = mergeTopic(
        existing,
        tid,
        topicBody(papers, cache, paths, fix, files),
        g.fixedPath ? "tag" : g.kind,
        cfg.today,
        g.heading,
        g.kindTag,
      );
      for (const [n, svg] of files) {
        const inkPath = join(cfg.papersDir, `Ink/${n}`);
        if ((await store.read(inkPath)) !== svg)
          await store.write(inkPath, svg);
      }
      if (next === null) log(`skip ${path}: zotero markers were removed`);
      else if (next !== existing) {
        await store.write(path, next);
        written++;
        log(`${existing ? "update" : "create"} ${path}`);
      }
      listed[tid] = stamp;
    }
    for (const tid of Object.keys(listed)) {
      if (
        ![...g.members.keys()].some(
          (n) => (g.fixedPath ? g.id : norm(n)) === tid,
        )
      )
        delete listed[tid];
    }
  }

  state.version = version;
  log(`done, ${written} note(s) written`);
  return written;
}

export { BEGIN };
