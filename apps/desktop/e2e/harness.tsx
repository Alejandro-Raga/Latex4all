/**
 * Pages for the WebKit end-to-end tests: one piece of the app at a time,
 * picked by ?scenario=, with Tauri stubbed out (no native side here).
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import { latex } from "codemirror-lang-latex";
import { ThemeProvider } from "next-themes";
import "../src/styles/globals.css";
import { ThemeBridge } from "@/components/theme-bridge";
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/workspace/command-palette";
import {
  RightDock,
  WideDockPanel,
} from "@/components/workspace/dock/right-dock";
import { PdfViewer } from "@/components/workspace/preview/pdf-viewer";
import { VaultGraph } from "@/components/workspace/vault-graph";
import { themedEditor } from "@/components/workspace/editor/editor-theme";
import { THEME_IDS } from "@/lib/app-themes";
import { useCitationCheck } from "@/components/workspace/citation-check";
import { parseNote } from "@/lib/vault/parse";
import { buildVaultIndex } from "@/lib/vault/vault-index";
import { useDockStore } from "@/stores/dock-store";
import { useVaultStore } from "@/stores/vault-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { useZoteroLibrary } from "@/lib/zotero-library";
import { useDocumentStore } from "@/stores/document-store";
import { ChatComposer } from "@/components/claude-chat/chat-composer";
import { LibraryView } from "@/components/library-view";
import { useAiUsage } from "@/lib/ai-usage";
import { useClaudeSetupStore } from "@/stores/claude-setup-store";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario");
const root = createRoot(document.getElementById("root") as HTMLElement);
const chrome = {
  "--titlebar-height": "30px",
  "--workspace-topbar-height": "40px",
} as React.CSSProperties;

if (scenario === "dock") {
  (window as any).dock = useDockStore;
  useDockStore.setState({
    collapsed: { reference: false, vault: false, notes: false },
  });
  useDockStore.getState().setOpen("reference", true);
  function Dock() {
    const wide = useDockStore((s) => s.wide);
    return (
      <div className="flex h-full" style={chrome}>
        <div className="min-w-0 flex-1" data-testid="pane">
          {wide ? <WideDockPanel /> : "pane"}
        </div>
        <div style={{ width: 380 }}>
          <RightDock />
        </div>
      </div>
    );
  }
  root.render(<Dock />);
}

if (scenario === "pdf") {
  fetch(
    params.get("src") ??
      `/examples/${params.get("pdf") ?? "report-scientific"}/main.pdf`,
  )
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      function Viewer() {
        const [scale, setScale] = useState(1);
        return (
          <div className="flex h-full flex-col">
            <PdfViewer
              data={new Uint8Array(buf)}
              scale={scale}
              onScaleChange={setScale}
              theme={(params.get("ptheme") ?? "light") as never}
              onThemeChange={() => {}}
              onTextSelect={(s) => {
                (window as any).lastSelection = s?.text ?? null;
                (window as any).lastRects = s?.rects ?? null;
                (window as any).lastPageHeight = s?.pageHeight ?? null;
              }}
            />
          </div>
        );
      }
      root.render(<Viewer />);
    });
}

if (scenario === "graph") {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    id: `n${i}`,
    label: i === 0 ? "Centre" : `Note ${i}`,
    color: ["#3b82f6", "#f59e0b", "#10b981"][i % 3],
    centre: i === 0,
  }));
  const links: { source: string; target: string }[] = [];
  for (let i = 1; i < 60; i++) {
    links.push({ source: `n${i}`, target: `n${Math.floor(rnd() * i)}` });
  }
  // ?layout=radial: the centre's neighbourhood two steps out, by ring.
  const radial = params.get("layout") === "radial";
  let shown = nodes as ((typeof nodes)[number] & { ring?: number })[];
  if (radial) {
    const ring = new Map([["n0", 0]]);
    for (let step = 1; step <= 2; step++) {
      for (const l of links) {
        for (const [a, b] of [
          [l.source, l.target],
          [l.target, l.source],
        ]) {
          if (ring.get(a) === step - 1 && !ring.has(b)) ring.set(b, step);
        }
      }
    }
    shown = nodes
      .filter((n) => ring.has(n.id))
      .map((n) => ({ ...n, ring: ring.get(n.id) }));
  }
  const ids = new Set(shown.map((n) => n.id));
  root.render(
    <div style={{ width: 800, padding: 16 }}>
      <VaultGraph
        nodes={shown}
        links={links.filter((l) => ids.has(l.source) && ids.has(l.target))}
        layout={radial ? "radial" : "force"}
        height={500}
        onOpen={(id) => {
          (window as any).opened = id;
        }}
      />
    </div>,
  );
}

const SAMPLE = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
% A comment about the draft
Firms \emph{underinvest} in research \cite{nelson1959}, see
\ref{eq:1} and $x^2 + \alpha_1 = 42$.
\begin{equation}\label{eq:1}
  f(x) = \frac{1}{2} \sum_{i=0}^{n} x_i
\end{equation}
\verb|code| and 3.5 cm.
\end{document}
`;

function mountEditor(el: HTMLDivElement | null) {
  if (!el || el.childElementCount) return;
  new EditorView({
    parent: el,
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        latex({ enableLinting: false, enableAutocomplete: false }),
        themedEditor(document.documentElement.classList.contains("theme-dark")),
      ],
    }),
  });
}

if (scenario === "theme") {
  const theme = params.get("theme") ?? "light";
  root.render(
    <ThemeProvider attribute="class" themes={THEME_IDS} forcedTheme={theme}>
      <ThemeBridge />
      <div className="flex h-full bg-background text-foreground">
        <div className="w-40 border-r bg-sidebar p-3 text-sm">
          <div className="rounded-md bg-sidebar-accent px-2 py-1">themed</div>
          <div className="px-2 py-1 text-muted-foreground">main.tex</div>
          <button
            type="button"
            className="mt-2 rounded-md bg-primary px-2 py-1 text-primary-foreground"
          >
            Compile
          </button>
        </div>
        <div className="min-w-0 flex-1" ref={mountEditor} />
      </div>
    </ThemeProvider>,
  );
}

if (scenario === "palette") {
  (window as any).dock = useDockStore;
  useDockStore.setState({ open: { reference: false, vault: false } });
  useDocumentStore.setState({
    projectRoot: "/p/demo",
    files: [
      {
        id: "main.tex",
        relativePath: "main.tex",
        name: "main.tex",
        type: "tex",
        content: "",
      },
      {
        id: "refs.bib",
        relativePath: "refs.bib",
        name: "refs.bib",
        type: "bib",
        content: "",
      },
    ],
  } as never);
  useCommandPalette.getState().setOpen(true);
  root.render(
    <ThemeProvider attribute="class" themes={THEME_IDS}>
      <CommandPalette />
    </ThemeProvider>,
  );
}

if (scenario === "workspace") {
  const theme = params.get("theme") ?? "light";
  const tex = (name: string, content: string) => ({
    id: name,
    relativePath: name,
    name: name.split("/").pop(),
    type: name.endsWith(".bib")
      ? "bib"
      : name.endsWith(".png")
        ? "image"
        : "tex",
    content,
  });
  useDocumentStore.setState({
    projectRoot: "/p/Science Policy Paper",
    initialized: true,
    activeFileId: "main.tex",
    files: [
      tex("main.tex", SAMPLE),
      tex("chapters/intro.tex", "\\section{Intro}"),
      tex("chapters/methods.tex", "\\section{Methods}"),
      tex("refs.bib", "@article{a, title={A}}"),
      tex("figures/plot.png", ""),
    ],
  } as never);
  useDockStore.setState({
    collapsed: { reference: false, vault: false, notes: false },
  });
  useDockStore.getState().setOpen("notes", true);
  if (params.get("dialog") === "cite") {
    // A project citing papers: some in the bibliography, some in the vault.
    const many = Number(params.get("many") ?? 0);
    const cites = [
      ...Array.from(
        { length: many },
        (_, i) => `author${i}_a_rather_long_title_word_${2000 + (i % 25)}`,
      ),
      "nelson_simple_1959",
      "arrow1962",
      "cohen_absorptive_1990",
      "zahra_absorptive_2002",
      "todorova_absorptive_2007",
      "lane_reflexive_2006",
      "volberda_perspective_2010",
      "unknown2020",
      "missing_key_2021",
    ];
    const tex = `\\section{Intro}\n${cites.map((c) => `\\cite{${c}}`).join(" ")}`;
    const bib = cites
      .slice(0, 7)
      .concat(["never_cited_2019", "also_unused_2018"])
      .map((k) => `@article{${k},\n  title = {A paper called ${k}},\n}`)
      .join("\n\n");
    const { files } = useDocumentStore.getState();
    useDocumentStore.setState({
      files: files.map((f) =>
        f.id === "main.tex"
          ? { ...f, content: tex }
          : f.id === "refs.bib"
            ? { ...f, content: bib }
            : f,
      ),
    } as never);
    const notes = [
      parseNote(
        "Papers/Nelson1959.md",
        "---\ncitekey: nelson_simple_1959\n---\n",
      ),
      parseNote("Papers/Arrow1962.md", "---\ncitekey: arrow1962\n---\n"),
    ];
    const source = {
      kind: "local",
      label: "Commonplace",
      load: async () => ({
        notes,
        attachments: new Map(),
        versions: new Map(),
        templates: [],
        newNoteFolder: null,
      }),
    };
    useVaultStore.setState({ source, index: buildVaultIndex(notes) } as never);
    useZoteroStore.setState({
      isAuthenticated: true,
      apiKey: "k",
      userID: "1",
    });
    setTimeout(() => useCitationCheck.getState().show(), 500);
  }
  if (params.get("dialog") === "zotero-target") {
    useZoteroLibrary.setState({
      mirror: {
        format: 1,
        userID: "1",
        version: 1,
        items: {},
        attachments: {},
        collections: [
          { key: "POL", name: "Policy", parentKey: false, itemCount: 0 },
          { key: "EU", name: "EU programmes", parentKey: "POL", itemCount: 0 },
        ],
      },
    });
    import("@/components/workspace/zotero-target-dialog").then((m) => {
      (window as any).chooseZoteroTarget = m.chooseZoteroTarget;
    });
  }
  import("@/components/workspace/workspace-layout").then(
    ({ WorkspaceLayout }) =>
      root.render(
        <ThemeProvider attribute="class" themes={THEME_IDS} forcedTheme={theme}>
          <ThemeBridge />
          <div className="h-full" style={chrome}>
            <WorkspaceLayout />
          </div>
        </ThemeProvider>,
      ),
  );
}

if (scenario === "grammar") {
  const theme = params.get("theme") ?? "light";
  import("@/components/workspace/editor/grammar-issue-popover").then(
    ({ GrammarIssuePopover }) =>
      root.render(
        <ThemeProvider attribute="class" themes={THEME_IDS} forcedTheme={theme}>
          <ThemeBridge />
          <div className="h-full bg-background p-4 text-foreground">
            <GrammarIssuePopover
              issue={{
                from: 0,
                to: 5,
                message: "Possible spelling mistake found.",
                shortMessage: "Spelling mistake",
                replacements: ["research", "researcher", "researched"],
                category: "Possible Typo",
                isSpelling: true,
              }}
              flaggedText="reserch"
              anchor={{ x: 20, y: 20 }}
              onReplace={() => {}}
              onIgnore={() => {}}
              onDismiss={() => {}}
            />
          </div>
        </ThemeProvider>,
      ),
  );
}

if (scenario === "vault") {
  // A vault held in memory, so notes can be written and then checked.
  const files = new Map<string, string>([
    [
      "Papers/Cohen1990.md",
      "---\ntitle: 'Absorptive capacity: a new perspective on learning and innovation'\ncitekey: cohen_absorptive_1990\nauthors:\n- Wesley M. Cohen\nyear: 1990\n---\n%% begin zotero %%\n# Absorptive capacity\n%% end zotero %%\n\n## My notes\n\n",
    ],
    [
      "Lecturas/A human capability approach.md",
      "---\nTitle: A human capability approach to transformative innovation policy\nYear: 2025\nAuthors: Alejandra Boni\n---\n",
    ],
    ["Ideas/My idea.md", "Something to link."],
  ]);
  (window as any).vaultFiles = files;
  const source = {
    kind: "local",
    label: "Vault",
    load: async () => ({
      notes: [...files].map(([p, t]) => parseNote(p, t)),
      attachments: new Map(),
      versions: new Map(),
      templates: [],
      newNoteFolder: null,
    }),
    readAttachment: async () => new Uint8Array(),
    readNote: async (p: string) => ({
      text: files.get(p) ?? "",
      version: null,
    }),
    writeNote: async (p: string, t: string) => {
      files.set(p, t);
      return null;
    },
    createNote: async (p: string, t: string) => {
      if (files.has(p)) throw new Error(`exists: ${p}`);
      files.set(p, t);
    },
  };
  useVaultStore.setState({ source, index: null } as never);
  Promise.all([
    import("@/components/workspace/vault-panel"),
    import("@/components/workspace/topic-menu"),
  ]).then(([{ VaultPanel }, { NewTopicDialog }]) =>
    root.render(
      <ThemeProvider attribute="class" themes={THEME_IDS}>
        <ThemeBridge />
        <div className="flex h-full" style={chrome}>
          <div style={{ width: 420 }} className="flex h-full flex-col">
            <VaultPanel onClose={() => {}} />
          </div>
        </div>
        <NewTopicDialog />
      </ThemeProvider>,
    ),
  );
}

if (scenario === "join") {
  import("@/components/collab/join-dialog").then(({ JoinDialog }) =>
    root.render(
      <ThemeProvider attribute="class" themes={THEME_IDS}>
        <ThemeBridge />
        <div className="h-full bg-background" />
        <JoinDialog open onOpenChange={() => {}} />
      </ThemeProvider>,
    ),
  );
}

if (scenario === "composer") {
  // The chat's message box at a given width, on Claude with its limits.
  const width = Number(params.get("width") ?? 600);
  const now = Date.now();
  useClaudeSetupStore.setState({ status: "ready" } as never);
  useAiUsage.setState({
    claudeLimits: {
      fiveHour: { utilization: 0.34, resetsAt: now + 130 * 60e3 },
      sevenDay: { utilization: 0.81, resetsAt: now + 3 * 864e5 },
      status: "allowed",
      limitedUntil: null,
      limitType: "five_hour",
      observedAt: now,
    },
  });
  root.render(
    <ThemeProvider attribute="class" themes={THEME_IDS}>
      <div data-testid="composer" style={{ width, padding: 8 }}>
        <ChatComposer isOpen />
      </div>
    </ThemeProvider>,
  );
}

if (scenario === "library") {
  // Zotero and the vault side by side, no project open.
  useDocumentStore.setState({ projectRoot: null } as never);
  root.render(
    <ThemeProvider attribute="class" themes={THEME_IDS}>
      <div className="h-full" style={chrome}>
        <LibraryView />
      </div>
    </ThemeProvider>,
  );
}
