import {
  defineRpcContract,
  type BbPluginApi,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { agentWorkspaceBehaviorInstructions } from "./src/agent-instructions";

const AGENTS_CHANGED = "agents-changed";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const EVA_DEFAULT_MODEL = "gpt-5.6-luna";
const EVA_DEFAULT_REASONING_LEVEL = "max" as const;
const AGENT_INSTRUCTIONS_FILE = "AGENTS.md";
const BB_AGENT_INSTRUCTIONS_FILE = ".bb/AGENTS.md";
const CLAUDE_INSTRUCTIONS_FILE = "CLAUDE.md";
const agentStatusSchema = z.enum(["draft", "shadow", "live"]);
const agentSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    "Use a lowercase id with letters, numbers, and hyphens.",
  );
const agentSkillSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[a-z0-9](?:[a-z0-9-]{0,63})$/,
        "Use a lowercase skill id with hyphens.",
      ),
    name: z.string().trim().min(1).max(80),
    instructions: z.string().trim().min(1).max(2_000),
  })
  .strict();
const agentSkillsInputSchema = z
  .array(agentSkillSchema)
  .max(16)
  .refine(
    (skills) => new Set(skills.map((skill) => skill.id)).size === skills.length,
    "Skill ids must be unique.",
  );
const sidebarIndicatorSchema = z.enum([
  "background-agent",
  "background-command",
  "draft",
  "goal",
  "none",
  "plan-mode",
  "runtime",
  "unread-error",
  "unread-success",
  "waiting-for-input",
  "workflow",
  "working-draft",
]);

const agentSchema = z.object({
  slug: z.string(),
  projectId: z.string().nullable(),
  name: z.string(),
  tagline: z.string(),
  icon: z.string(),
  status: agentStatusSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  instructions: z.string(),
  skills: z.array(agentSkillSchema),
  sortOrder: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const agentListItemSchema = agentSchema.extend({
  threadCount: z.number().int().nonnegative(),
  lastActivityAt: z.number().nullable(),
  threadIds: z.array(z.string()),
});

const recentThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  indicator: sidebarIndicatorSchema,
});

export type EvaAgent = z.infer<typeof agentListItemSchema>;
export type EvaRecentThread = z.infer<typeof recentThreadSchema>;

export const rpcContract = defineRpcContract({
  agents_list: {
    input: z.null(),
    output: z.object({
      agents: z.array(agentListItemSchema),
      rootProjectId: z.string().nullable(),
      summary: z.object({
        conversationsThisWeek: z.number().int().nonnegative(),
      }),
    }),
  },
  agents_get: {
    input: z.object({ slug: agentSlugSchema }).strict(),
    output: z.object({
      agent: agentListItemSchema,
      threads: z.array(recentThreadSchema),
      projectId: z.string().nullable(),
      hostId: z.string().nullable(),
      workspacePath: z.string().nullable(),
    }),
  },
  agents_create: {
    input: z
      .object({
        slug: agentSlugSchema,
        name: z.string().trim().min(1).max(80),
        tagline: z.string().trim().min(1).max(180),
        instructions: z.string().trim().min(1).max(16_000),
      })
      .strict(),
    output: z.object({ agent: agentListItemSchema, workspacePath: z.string() }),
  },
  agents_update: {
    input: z
      .object({
        slug: agentSlugSchema,
        status: agentStatusSchema.optional(),
        instructions: z.string().max(16_000).optional(),
        skills: agentSkillsInputSchema.optional(),
        provider: z.string().trim().min(1).max(200).nullable().optional(),
        model: z.string().trim().min(1).max(200).nullable().optional(),
      })
      .strict(),
    output: z.object({ agent: agentListItemSchema }),
  },
});

type AgentStatus = z.infer<typeof agentStatusSchema>;
type SidebarIndicator = z.infer<typeof sidebarIndicatorSchema>;

type AgentRow = {
  slug: string;
  // Kept for backwards-compatible reads of pre-shared-project installations;
  // new EVA threads always use settings.project instead.
  project_id: string | null;
  name: string;
  tagline: string;
  icon: string;
  status: AgentStatus;
  provider: string | null;
  model: string | null;
  instructions: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

type AgentThreadRow = {
  thread_id: string;
  agent_slug: string;
  created_at: number;
};

type AgentSkill = z.infer<typeof agentSkillSchema>;

type AgentSkillRow = {
  agent_slug: string;
  id: string;
  name: string;
  instructions: string;
  sort_order: number;
};

type CachedThreadActivity = {
  title: string;
  updatedAt: number;
  indicator: SidebarIndicator;
};

type SeedAgent = Omit<
  AgentRow,
  "created_at" | "updated_at" | "status" | "provider" | "model" | "project_id"
> & {
  status?: AgentStatus;
  provider?: string | null;
  model?: string | null;
};

export const SEEDED_AGENTS: readonly SeedAgent[] = [
  {
    slug: "orchestrator",
    name: "Orquestador Maestro",
    tagline: "Decide qué agente actúa y controla los límites",
    icon: "Network",
    sort_order: 1,
    instructions:
      "Coordina las peticiones entre agentes, aclara objetivos y asigna el trabajo al especialista correcto. Límite estricto: no ejecutes campañas, envíos, cambios de datos ni aprobaciones; resume opciones, dependencias y riesgos para decisión humana.",
  },
  {
    slug: "compliance",
    name: "Cumplimiento",
    tagline: "Revisa y aprueba todo lo que sale al público",
    icon: "ShieldCheck",
    sort_order: 2,
    instructions:
      "Revisa materiales públicos, anuncios y mensajes frente a políticas y riesgos de cumplimiento. Límite estricto: nunca apruebes un diagnóstico ni una afirmación de cura; señala reclamaciones que requieran revisión legal o humana y no publiques nada.",
  },
  {
    slug: "creative",
    name: "Creatividad",
    tagline: "Crea anuncios, imágenes, vídeos y páginas",
    icon: "Sparkles",
    provider: "codex",
    sort_order: 3,
    instructions:
      "Crea conceptos para anuncios, imágenes, vídeos y páginas alineados con la marca. Para cada concepto creativo usa tu propia herramienta de generación de imágenes y entrega salida visual por defecto, no una descripción escrita de una imagen; produce varias variaciones por concepto. Límite estricto: no publiques activos ni hagas afirmaciones médicas, de resultados garantizados o no aprobadas.",
  },
  {
    slug: "meta",
    name: "Meta",
    tagline: "Campañas de Facebook e Instagram",
    icon: "Meta",
    sort_order: 4,
    instructions:
      "Analiza y propone estructura, audiencias, creatividades y experimentos para campañas de Facebook e Instagram. Límite estricto: no lances, pauses ni cambies presupuestos o segmentaciones; entrega propuestas medibles y solicita aprobación antes de cualquier activación.",
  },
  {
    slug: "tiktok",
    name: "TikTok",
    tagline: "Campañas y creatividades de TikTok",
    icon: "TikTok",
    sort_order: 5,
    instructions:
      "Diseña campañas, guiones y variaciones creativas para TikTok con hipótesis claras de crecimiento. Límite estricto: no publiques, compres medios ni declares resultados garantizados; conserva una revisión humana para cualquier pieza pública.",
  },
  {
    slug: "google",
    name: "Google",
    tagline: "Búsquedas, palabras clave y campañas de Google",
    icon: "Google",
    sort_order: 6,
    instructions:
      "Investiga intención de búsqueda, palabras clave y propuestas de campañas de Google. Límite estricto: no modifiques pujas, presupuestos, conversiones ni anuncios activos; separa hechos de hipótesis y evita promesas engañosas.",
  },
  {
    slug: "crm",
    name: "CRM y Call Center",
    tagline: "Cola de leads, operadores y primera llamada",
    icon: "PhoneCall",
    sort_order: 7,
    instructions:
      "Ayuda a priorizar leads, preparar guiones de primera llamada y ordenar la cola de operadores. Límite estricto: no contactes, llames ni suplantes a una persona; minimiza datos personales y deja la decisión y la acción a un operador autorizado.",
  },
  {
    slug: "email",
    name: "Correo",
    tagline: "Clasifica el correo y crea tareas",
    icon: "Mail",
    sort_order: 8,
    instructions:
      "Clasifica el correo entrante, identifica urgencias y prepara tareas o borradores de respuesta. Límite estricto: no envíes mensajes, no reveles información sensible y no descartes correo sin revisión humana.",
  },
  {
    slug: "voice",
    name: "Voz IA",
    tagline: "Llamadas y voz en la app y la web",
    icon: "Mic",
    sort_order: 9,
    instructions:
      "Diseña flujos, guiones y experiencia de voz para llamadas, la app y la web. Límite estricto: no imites a una persona real sin consentimiento, no realices llamadas y no presentes la voz IA como un humano.",
  },
  {
    slug: "recobro",
    name: "Recobro",
    tagline: "Impagos y devoluciones hasta el cobro",
    icon: "CreditCard",
    sort_order: 10,
    instructions:
      "Propón secuencias respetuosas para impagos, devoluciones y seguimiento de cobro. Límite estricto: nunca amenaces, acoses, cobres sin autorización ni emitas asesoramiento legal; escala excepciones y decisiones sensibles a una persona.",
  },
  {
    slug: "people",
    name: "RR. HH.",
    tagline: "Productividad del equipo y capacidad",
    icon: "Users",
    sort_order: 11,
    instructions:
      "Observa productividad, carga y capacidad del equipo para detectar riesgos y proponer análisis. Límite estricto: opera solo en shadow, nunca propongas disciplina, despidos, compensación ni decisiones individuales sobre personas.",
  },
  {
    slug: "admin",
    name: "Administrador",
    tagline: "Implementa y mantiene la plataforma EVA",
    icon: "Wrench",
    provider: "codex",
    model: "gpt-5.6-luna",
    sort_order: 12,
    instructions:
      "Implements and maintains the EVA Agent Platform. Respond in the same language as the user; use English when the user writes in English. Before changing code, read AGENTS.md and any more-specific guidance; inspect Git status and preserve existing changes. Ground diagnosis in evidence, follow repository architecture and conventions, make the smallest complete change, add tests for affected behavior, and run relevant checks. Repository map: apps/app is the web UI; apps/server contains the API, authentication, and product policy; apps/host-daemon handles local provider execution and sessions; apps/cli contains the CLI; packages/db handles persistence; packages/domain contains shared types and rules; packages/server-contract contains API contracts; packages/agent-runtime handles agent configuration and execution; packages/plugin-sdk contains the plugin API; plugins/* contains plugins; eva-agents-seed/* contains initial agent instructions; docs contains architecture and operations guides. For production restarts, read docs/eva-systemd.md. The built frontend is served by bb-app, which supervises the HTTP/API server and host daemon together. After an explicitly requested build, run pnpm run build using the deployment's documented owner account, then restart only the active service: sudo systemctl restart eva-agent-platform.service for a system unit, or systemctl --user restart eva-agent-platform.service for a user unit. Check the service scope first, confirm the unit is active, and verify /health and /readyz on the configured web port (38886 is the documented dedicated-server default); never print the full environment file. In development, pnpm dev runs the frontend with hot reload plus the backend; stop it with Ctrl-C in its owning terminal and rerun pnpm dev to restart the whole stack. pnpm run dev:restart rebuilds and restarts only the server and host daemon, leaving the frontend dev server running. Do not deploy, restart services, change production data, publish, commit, or push unless the user explicitly requests it. Never expose secrets or personal data.",
  },
];

export const ENGLISH_AGENT_NAMES: Readonly<Record<string, string>> = {
  orchestrator: "Master Orchestrator",
  compliance: "Compliance",
  creative: "Creativity",
  meta: "Meta",
  tiktok: "TikTok",
  google: "Google",
  crm: "CRM & Call Center",
  email: "Email",
  voice: "AI Voice",
  recobro: "Payments",
  people: "HR",
  admin: "Admin",
};

export const ENGLISH_AGENT_TAGLINES: Readonly<Record<string, string>> = {
  orchestrator: "Chooses which agent acts and keeps work within bounds",
  compliance: "Reviews and approves everything that goes public",
  creative: "Creates ads, images, videos, and pages",
  meta: "Facebook and Instagram campaigns",
  tiktok: "TikTok campaigns and creative",
  google: "Google search, keywords, and campaigns",
  crm: "Lead queue, operators, and first calls",
  email: "Classifies email and creates tasks",
  voice: "Calls and voice experiences for the app and web",
  recobro: "Failed payments and returns through collection",
  people: "Team productivity and capacity",
  admin: "Implements and maintains the EVA platform",
};

function englishAgentName(agent: Pick<AgentRow, "slug" | "name">): string {
  return ENGLISH_AGENT_NAMES[agent.slug] ?? agent.name;
}

function modeLine(status: AgentStatus): string {
  if (status === "shadow") {
    return "You are in SHADOW mode: propose work, never execute it.";
  }
  if (status === "live") {
    return "You are in LIVE mode: execute only within your explicit mandate and limits.";
  }
  return "You are in DRAFT mode: prepare proposals and wait for confirmation before executing.";
}

function indicatorForThread(thread: { status: string }): SidebarIndicator {
  if (thread.status === "active" || thread.status === "starting") {
    return "runtime";
  }
  if (thread.status === "error") {
    return "unread-error";
  }
  return "none";
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length <= 64) return compact || "New conversation";
  return compact.slice(0, 61).trimEnd() + "…";
}

function nativeComposerRequest(value: unknown): NewThreadRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("The conversation request is invalid.");
  }
  const request = value as Partial<NewThreadRequest>;
  if (
    typeof request.projectId !== "string" ||
    typeof request.providerId !== "string" ||
    typeof request.model !== "string" ||
    !Array.isArray(request.input)
  ) {
    throw new Error("The conversation request is invalid.");
  }
  return request as NewThreadRequest;
}

function promptFromNativeInput(input: NewThreadRequest["input"]): string {
  return input
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join(" ")
    .trim();
}

function isAgentStatus(value: string | undefined): value is AgentStatus {
  return value === "draft" || value === "shadow" || value === "live";
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    project: {
      type: "project",
      label: "EVA shared BB project",
    },
    workspacePath: {
      type: "string",
      label: "Agents workspace folder",
      description:
        "Absolute path to the agents repository. The Orchestrator uses this root; each specialist uses its own subfolder.",
      default: "",
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE IF NOT EXISTS agents (slug TEXT PRIMARY KEY, name TEXT NOT NULL, tagline TEXT NOT NULL, icon TEXT NOT NULL, status TEXT CHECK(status IN ('draft','shadow','live')) DEFAULT 'draft', provider TEXT, model TEXT, instructions TEXT DEFAULT '', sort_order INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS agent_threads (thread_id TEXT PRIMARY KEY, agent_slug TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS agent_threads_agent_slug_created_at ON agent_threads(agent_slug, created_at DESC)",
    "UPDATE agents SET name = 'Meta', icon = 'Meta', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE slug = 'meta'",
    "UPDATE agents SET name = 'TikTok', icon = 'TikTok', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE slug = 'tiktok'",
    "UPDATE agents SET name = 'Google', icon = 'Google', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE slug = 'google'",
    "CREATE TABLE IF NOT EXISTS agent_skills (agent_slug TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, instructions TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (agent_slug, id))",
    "CREATE INDEX IF NOT EXISTS agent_skills_agent_slug_sort_order ON agent_skills(agent_slug, sort_order ASC)",
    "ALTER TABLE agents ADD COLUMN project_id TEXT",
  ]);
  // The migration was appended after earlier releases had already occupied
  // the intervening migration indexes. Keep this defensive schema check so
  // installations that recorded that index before the column was introduced
  // are upgraded in place as well.
  const agentColumns = db.pragma("table_info(agents)") as Array<{
    name: string;
  }>;
  if (!agentColumns.some((column) => column.name === "project_id")) {
    db.exec("ALTER TABLE agents ADD COLUMN project_id TEXT");
  }

  const now = Date.now();
  const seed = db.prepare(
    "INSERT OR IGNORE INTO agents (slug, name, tagline, icon, status, provider, model, instructions, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const seedAll = db.transaction(() => {
    for (const agent of SEEDED_AGENTS) {
      seed.run(
        agent.slug,
        agent.name,
        agent.tagline,
        agent.icon,
        agent.status ?? "draft",
        agent.provider ?? null,
        agent.model ?? null,
        agent.instructions,
        agent.sort_order,
        now,
        now,
      );
    }
  });
  seedAll();

  const agentRows = new Map<string, AgentRow>();
  const threadAgentById = new Map<string, string>();
  const threadActivityById = new Map<string, CachedThreadActivity>();
  let disposed = false;
  let agentsWorkspaceRoot: string | null = null;

  function validateWorkspaceRoot(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const root = resolve(trimmed);
    if (root === "/" || basename(root).toLocaleLowerCase() !== "agents") {
      throw new Error(
        'The EVA workspace folder must be an absolute folder named "agents".',
      );
    }
    return root;
  }

  function agentWorkspacePath(slug: string): string | null {
    if (!agentsWorkspaceRoot) return null;
    return slug === "orchestrator"
      ? agentsWorkspaceRoot
      : join(agentsWorkspaceRoot, slug);
  }

  function legacyAgentInstructionsFile(agent: AgentRow): string {
    return [
      "# " + agent.name,
      "",
      agent.instructions.trim(),
      "",
      modeLine(agent.status),
      "",
      "Agent-local skills live in `.bb/skills/` and executable helpers live in `bin/`.",
      "Invoke local helpers explicitly as `./bin/<command>`.",
      "",
    ].join("\n");
  }

  function initialAgentInstructionsFile(
    agent: Pick<AgentRow, "slug" | "name" | "tagline" | "instructions">,
    instructions = agent.instructions,
  ): string {
    return [
      "# " + agent.name,
      "",
      instructions.trim() || agent.tagline.trim(),
      "",
      "## Local capabilities",
      "",
      "- Agent-specific skills live in `.bb/skills/`. Read and follow the matching `SKILL.md` whenever a task fits one.",
      "- Agent-specific CLI helpers live in `bin/`. Invoke them explicitly as `./bin/<command>`.",
      ...agentWorkspaceBehaviorInstructions(agent.slug, agentsWorkspaceRoot),
      "",
    ].join("\n");
  }

  function bbAgentInstructionsBridge(): string {
    return [
      "# EVA instruction bridge",
      "",
      "Read and follow `AGENTS.md` at the workspace root before doing any work.",
      "`AGENTS.md` is the complete, authoritative instruction file for this EVA agent.",
      "",
    ].join("\n");
  }

  function claudeInstructionsBridge(): string {
    return "See @AGENTS.md\n";
  }

  function agentReadmeFile(agent: AgentRow, legacy = false): string {
    const instructionEntries = legacy
      ? "- Instructions: `.bb/AGENTS.md`\n"
      : "- Instructions: `AGENTS.md`\n- Claude bridge: `CLAUDE.md`\n- BB bridge: `.bb/AGENTS.md`\n";
    return `# ${agent.name}\n\n${agent.tagline}\n\n${instructionEntries}- Skills: \`.bb/skills/<skill>/SKILL.md\`\n- Local CLI helpers: \`bin/\`\n`;
  }

  function agentInstructionsPath(slug: string): string | null {
    const folder = agentWorkspacePath(slug);
    return folder ? join(folder, AGENT_INSTRUCTIONS_FILE) : null;
  }

  function bbAgentInstructionsPath(slug: string): string | null {
    const folder = agentWorkspacePath(slug);
    return folder ? join(folder, BB_AGENT_INSTRUCTIONS_FILE) : null;
  }

  function readAgentInstructions(agent: AgentRow): string {
    const path = agentInstructionsPath(agent.slug);
    if (path && existsSync(path)) {
      const contents = readFileSync(path, "utf8").trim();
      if (contents) return contents;
    }
    const legacyPath = bbAgentInstructionsPath(agent.slug);
    if (legacyPath && existsSync(legacyPath)) {
      const contents = readFileSync(legacyPath, "utf8").trim();
      if (contents && contents !== bbAgentInstructionsBridge().trim())
        return contents;
    }
    return agent.instructions.trim();
  }

  function writeAgentInstructions(agent: AgentRow, instructions: string): void {
    const path = agentInstructionsPath(agent.slug);
    if (!path) {
      throw new Error(
        "EVA needs the agents workspace path before instructions can be saved.",
      );
    }
    mkdirSync(agentWorkspacePath(agent.slug)!, { recursive: true });
    writeFileSync(path, instructions.trimEnd() + "\n", "utf8");
  }

  function skillFile(skill: AgentSkill, agent: AgentRow): string {
    const description =
      skill.name +
      ". Use this for " +
      agent.name +
      " whenever the task matches this capability.";
    return [
      "---",
      "name: " + skill.id,
      "description: " + JSON.stringify(description),
      "---",
      "",
      "# " + skill.name,
      "",
      skill.instructions.trim(),
      "",
    ].join("\n");
  }

  function ensureAgentWorkspace(
    agent: AgentRow,
    overwriteManaged: boolean,
  ): void {
    const folder = agentWorkspacePath(agent.slug);
    if (!folder) return;
    const bbFolder = join(folder, ".bb");
    const skillsFolder = join(bbFolder, "skills");
    const binFolder = join(folder, "bin");
    mkdirSync(skillsFolder, { recursive: true });
    mkdirSync(binFolder, { recursive: true });
    const skillsKeep = join(skillsFolder, ".gitkeep");
    if (!existsSync(skillsKeep)) writeFileSync(skillsKeep, "", "utf8");

    const instructionsPath = join(folder, AGENT_INSTRUCTIONS_FILE);
    const bbInstructionsPath = join(folder, BB_AGENT_INSTRUCTIONS_FILE);
    if (!existsSync(instructionsPath)) {
      const previousInstructions = existsSync(bbInstructionsPath)
        ? readFileSync(bbInstructionsPath, "utf8")
        : "";
      // The old EVA layout stored the full source of truth in .bb/AGENTS.md.
      // Copy manually edited content to the native root file before turning
      // the old location into BB's provider-agnostic bridge.
      const previousIsManagedBridge =
        previousInstructions === bbAgentInstructionsBridge();
      const migratedInstructions =
        previousInstructions.trim() && !previousIsManagedBridge
          ? previousInstructions === legacyAgentInstructionsFile(agent)
            ? initialAgentInstructionsFile(agent)
            : previousInstructions
          : initialAgentInstructionsFile(agent);
      writeFileSync(
        instructionsPath,
        migratedInstructions.trimEnd() + "\n",
        "utf8",
      );
    }
    const bbBridge = bbAgentInstructionsBridge();
    if (
      !existsSync(bbInstructionsPath) ||
      readFileSync(bbInstructionsPath, "utf8") !== bbBridge
    ) {
      writeFileSync(bbInstructionsPath, bbBridge, "utf8");
    }

    const claudePath = join(folder, CLAUDE_INSTRUCTIONS_FILE);
    if (!existsSync(claudePath)) {
      writeFileSync(claudePath, claudeInstructionsBridge(), "utf8");
    } else {
      const existingClaudeInstructions = readFileSync(claudePath, "utf8");
      if (!existingClaudeInstructions.includes("@AGENTS.md")) {
        writeFileSync(
          claudePath,
          existingClaudeInstructions.trimEnd() +
            "\n\n" +
            claudeInstructionsBridge(),
          "utf8",
        );
      }
    }
    const agentReadme = join(folder, "README.md");
    if (
      !existsSync(agentReadme) ||
      readFileSync(agentReadme, "utf8") === agentReadmeFile(agent, true)
    ) {
      writeFileSync(agentReadme, agentReadmeFile(agent), "utf8");
    }
    const binReadme = join(binFolder, "README.md");
    if (!existsSync(binReadme)) {
      writeFileSync(
        binReadme,
        "# Agent-local CLI helpers\n\nPlace executable scripts here and invoke them as `./bin/<command>`.\n",
        "utf8",
      );
    }

    const currentSkills = skillsForAgent(agent.slug);
    const currentIds = new Set(currentSkills.map((skill) => skill.id));
    if (overwriteManaged && existsSync(skillsFolder)) {
      for (const entry of readdirSync(skillsFolder, { withFileTypes: true })) {
        if (!entry.isDirectory() || currentIds.has(entry.name)) continue;
        const candidate = join(skillsFolder, entry.name);
        if (existsSync(join(candidate, ".eva-managed"))) {
          rmSync(candidate, { recursive: true, force: true });
        }
      }
    }
    for (const skill of currentSkills) {
      const skillFolder = join(skillsFolder, skill.id);
      const skillPath = join(skillFolder, "SKILL.md");
      mkdirSync(skillFolder, { recursive: true });
      if (overwriteManaged || !existsSync(skillPath)) {
        writeFileSync(skillPath, skillFile(skill, agent), "utf8");
        writeFileSync(
          join(skillFolder, ".eva-managed"),
          "managed by bb-plugin-eva\n",
          "utf8",
        );
      }
    }
  }

  function ensureAllAgentWorkspaces(overwriteManaged: boolean): void {
    if (!agentsWorkspaceRoot) return;
    mkdirSync(agentsWorkspaceRoot, { recursive: true });
    for (const agent of agentRows.values()) {
      ensureAgentWorkspace(agent, overwriteManaged);
    }
  }

  function refreshCaches(): void {
    agentRows.clear();
    const rows = db
      .prepare("SELECT * FROM agents ORDER BY sort_order ASC")
      .all() as AgentRow[];
    for (const row of rows) agentRows.set(row.slug, row);

    threadAgentById.clear();
    const bindings = db
      .prepare("SELECT thread_id, agent_slug, created_at FROM agent_threads")
      .all() as AgentThreadRow[];
    for (const binding of bindings) {
      threadAgentById.set(binding.thread_id, binding.agent_slug);
    }
  }

  function bindingsByAgent(): Map<string, AgentThreadRow[]> {
    const groups = new Map<string, AgentThreadRow[]>();
    const bindings = db
      .prepare(
        "SELECT thread_id, agent_slug, created_at FROM agent_threads ORDER BY created_at DESC",
      )
      .all() as AgentThreadRow[];
    for (const binding of bindings) {
      const group = groups.get(binding.agent_slug) ?? [];
      group.push(binding);
      groups.set(binding.agent_slug, group);
    }
    return groups;
  }

  function toAgent(row: AgentRow, bindings: AgentThreadRow[]): EvaAgent {
    let lastActivityAt: number | null = null;
    for (const binding of bindings) {
      const activity = threadActivityById.get(binding.thread_id);
      const timestamp = activity?.updatedAt ?? binding.created_at;
      lastActivityAt =
        lastActivityAt === null
          ? timestamp
          : Math.max(lastActivityAt, timestamp);
    }
    return {
      slug: row.slug,
      // Preserve the legacy API field without using it for routing or sidebar
      // discovery. The configured project is returned by agents_get separately.
      projectId: row.project_id,
      name: row.name,
      tagline: row.tagline,
      icon: row.icon,
      status: row.status,
      provider: row.provider,
      model: row.model,
      instructions: readAgentInstructions(row),
      skills: skillsForAgent(row.slug),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      threadCount: bindings.length,
      lastActivityAt,
      threadIds: bindings.map((binding) => binding.thread_id),
    };
  }

  function skillsForAgent(slug: string): AgentSkill[] {
    const rows = db
      .prepare(
        "SELECT agent_slug, id, name, instructions, sort_order FROM agent_skills WHERE agent_slug = ? ORDER BY sort_order ASC",
      )
      .all(slug) as AgentSkillRow[];
    return rows.map(({ id, name, instructions }) => ({
      id,
      name,
      instructions,
    }));
  }

  function replaceAgentSkills(
    slug: string,
    skills: readonly AgentSkill[],
  ): void {
    const remove = db.prepare("DELETE FROM agent_skills WHERE agent_slug = ?");
    const insert = db.prepare(
      "INSERT INTO agent_skills (agent_slug, id, name, instructions, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const replace = db.transaction(() => {
      remove.run(slug);
      const now = Date.now();
      skills.forEach((skill, index) => {
        insert.run(
          slug,
          skill.id,
          skill.name.trim(),
          skill.instructions.trim(),
          index,
          now,
          now,
        );
      });
    });
    replace();
  }

  function compiledAgentInstructions(agent: AgentRow): string {
    const mode = modeLine(agent.status);
    const body = readAgentInstructions(agent);
    const suffix = "\n\n" + mode;
    const available = Math.max(0, 4_096 - suffix.length);
    return body.slice(0, available).trimEnd() + suffix;
  }

  function listAgents(): {
    agents: EvaAgent[];
    summary: { conversationsThisWeek: number };
  } {
    const bindings = bindingsByAgent();
    const agents = Array.from(agentRows.values(), (row) =>
      toAgent(row, bindings.get(row.slug) ?? []),
    );
    const weekStart = Date.now() - WEEK_MS;
    const weeklyRow = db
      .prepare(
        "SELECT COUNT(*) AS count FROM agent_threads WHERE created_at >= ?",
      )
      .get(weekStart) as { count: number };
    return {
      agents,
      summary: { conversationsThisWeek: weeklyRow.count },
    };
  }

  function getAgent(slug: string): EvaAgent {
    const row = agentRows.get(slug);
    if (row === undefined) throw new Error("Unknown EVA agent: " + slug);
    return toAgent(row, bindingsByAgent().get(slug) ?? []);
  }

  function recentThreads(slug: string): EvaRecentThread[] {
    const bindings = (bindingsByAgent().get(slug) ?? []).slice(0, 20);
    return bindings.map((binding) => {
      const activity = threadActivityById.get(binding.thread_id);
      return {
        id: binding.thread_id,
        title: activity?.title ?? "Conversation",
        updatedAt: activity?.updatedAt ?? binding.created_at,
        indicator: activity?.indicator ?? "none",
      };
    });
  }

  function publish(reason: string): void {
    bb.realtime.publish(AGENTS_CHANGED, { reason, at: Date.now() });
  }

  function rememberThread(thread: {
    id: string;
    title: string | null;
    titleFallback: string | null;
    updatedAt: number;
    status: string;
  }): void {
    if (!threadAgentById.has(thread.id)) return;
    threadActivityById.set(thread.id, {
      title: thread.title ?? thread.titleFallback ?? "Conversation",
      updatedAt: thread.updatedAt,
      indicator: indicatorForThread(thread),
    });
  }

  async function hydrateThreadActivity(): Promise<void> {
    const configured = await settings.get();
    if (disposed || !configured.project) return;
    try {
      const snapshots = await Promise.all([
        bb.sdk.threads.list({
          projectId: configured.project,
          includeHidden: true,
          limit: 500,
        }),
        bb.sdk.threads.list({
          projectId: configured.project,
          includeHidden: true,
          archived: true,
          limit: 500,
        }),
      ]);
      if (disposed) return;
      for (const snapshot of snapshots) {
        for (const thread of snapshot) {
          rememberThread(thread);
        }
      }
      publish("thread-snapshot");
    } catch (error) {
      if (disposed) return;
      bb.log.warn(
        "Could not hydrate EVA thread activity: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  async function updateAgent(
    slug: string,
    changes: {
      status?: AgentStatus;
      instructions?: string;
      provider?: string | null;
      model?: string | null;
      skills?: AgentSkill[];
    },
  ): Promise<EvaAgent> {
    const previous = agentRows.get(slug);
    if (previous === undefined) throw new Error("Unknown EVA agent: " + slug);

    const currentInstructions = readAgentInstructions(previous);
    if (changes.instructions !== undefined && !agentsWorkspaceRoot) {
      throw new Error(
        "EVA needs the agents workspace path before instructions can be saved.",
      );
    }

    const next = {
      status: changes.status ?? previous.status,
      instructions: changes.instructions ?? currentInstructions,
      provider:
        changes.provider === undefined ? previous.provider : changes.provider,
      model: changes.model === undefined ? previous.model : changes.model,
    };
    db.prepare(
      "UPDATE agents SET status = ?, instructions = ?, provider = ?, model = ?, updated_at = ? WHERE slug = ?",
    ).run(
      next.status,
      next.instructions,
      next.provider,
      next.model,
      Date.now(),
      slug,
    );
    if (changes.skills !== undefined) replaceAgentSkills(slug, changes.skills);
    refreshCaches();
    if (changes.instructions !== undefined) {
      writeAgentInstructions(agentRows.get(slug)!, changes.instructions);
    }
    ensureAgentWorkspace(agentRows.get(slug)!, true);
    publish("agent-updated");
    return getAgent(slug);
  }

  async function createAgent(input: {
    slug: string;
    name: string;
    tagline: string;
    instructions: string;
  }): Promise<{ agent: EvaAgent; workspacePath: string }> {
    const configured = await settings.get();
    const workspaceRoot = validateWorkspaceRoot(configured.workspacePath);
    if (!workspaceRoot) {
      throw new Error(
        "EVA needs the agents workspace path before an agent can be created.",
      );
    }
    agentsWorkspaceRoot = workspaceRoot;

    if (input.slug === "new") {
      throw new Error('The agent id "new" is reserved by EVA.');
    }
    if (agentRows.has(input.slug)) {
      throw new Error(`An EVA agent with id "${input.slug}" already exists.`);
    }
    const targetFolder = join(workspaceRoot, input.slug);
    if (existsSync(targetFolder)) {
      throw new Error(
        `The workspace folder already exists: ${targetFolder}. Choose another agent id.`,
      );
    }
    const duplicateName = db
      .prepare("SELECT slug FROM agents WHERE lower(name) = lower(?) LIMIT 1")
      .get(input.name.trim()) as { slug: string } | undefined;
    if (duplicateName) {
      throw new Error(
        `An EVA agent named "${input.name.trim()}" already exists.`,
      );
    }

    const timestamp = Date.now();
    const orderRow = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM agents",
      )
      .get() as { next_order: number };
    db.prepare(
      "INSERT INTO agents (slug, name, tagline, icon, status, provider, model, instructions, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      input.slug,
      input.name.trim(),
      input.tagline.trim(),
      "Bot",
      "draft",
      null,
      null,
      input.instructions.trim(),
      orderRow.next_order,
      timestamp,
      timestamp,
    );

    try {
      refreshCaches();
      const created = agentRows.get(input.slug)!;
      ensureAgentWorkspace(created, false);
      writeAgentInstructions(
        created,
        initialAgentInstructionsFile(created, input.instructions),
      );
      publish("agent-created");
      return {
        agent: getAgent(input.slug),
        workspacePath: targetFolder,
      };
    } catch (error) {
      db.prepare("DELETE FROM agents WHERE slug = ?").run(input.slug);
      refreshCaches();
      throw error;
    }
  }

  type StartThreadOptions = {
    parentThreadId?: string;
    visibility?: "visible" | "hidden";
  };

  async function projectHostId(projectId: string): Promise<string | null> {
    const project = await bb.sdk.projects.get({ projectId });
    const source =
      project.sources.find((candidate) => candidate.isDefault) ??
      project.sources[0];
    return source?.hostId ?? null;
  }

  async function resolveHostId(projectId: string): Promise<string | null> {
    const fromProject = await projectHostId(projectId);
    if (fromProject) return fromProject;
    const hosts = await bb.sdk.hosts.list();
    const active = hosts.filter((host) => host.lifecycle.phase === "active");
    const connected = active.filter((host) => host.status === "connected");
    const pool = connected.length > 0 ? connected : active;
    return (
      pool.find((host) => host.type === "persistent")?.id ?? pool[0]?.id ?? null
    );
  }

  async function hostIdForProject(projectId: string): Promise<string> {
    const hostId = await resolveHostId(projectId);
    if (!hostId) {
      throw new Error("The configured EVA project has no workspace host.");
    }
    return hostId;
  }

  async function startThread(
    slug: string,
    rawPrompt?: string,
    rawRequest?: unknown,
    options: StartThreadOptions = {},
  ): Promise<string> {
    const agent = agentRows.get(slug);
    if (agent === undefined) throw new Error("Unknown EVA agent: " + slug);
    const configured = await settings.get();
    if (!configured.project) {
      throw new Error(
        "EVA needs a shared BB project. Set the project in Extensions → EVA Agents.",
      );
    }
    const workspaceRoot = validateWorkspaceRoot(configured.workspacePath);
    if (!workspaceRoot) {
      throw new Error(
        "EVA needs the agents workspace path. Set it in Extensions → EVA Agents.",
      );
    }
    agentsWorkspaceRoot = workspaceRoot;
    const hostId = await hostIdForProject(configured.project);
    ensureAgentWorkspace(agent, false);
    const workspace = agentWorkspacePath(agent.slug);
    if (!workspace) {
      throw new Error(
        "EVA needs the agents workspace path before starting the conversation.",
      );
    }

    const nativeRequest =
      rawRequest === undefined ? null : nativeComposerRequest(rawRequest);
    if (
      nativeRequest?.projectId &&
      nativeRequest.projectId !== configured.project
    ) {
      throw new Error(
        "EVA conversations must use the configured shared BB project.",
      );
    }

    const prompt = nativeRequest
      ? promptFromNativeInput(nativeRequest.input)
      : rawPrompt?.trim();
    if (!prompt && !nativeRequest) {
      throw new Error(
        "Write a first message before starting the conversation.",
      );
    }

    const thread = nativeRequest
      ? await bb.sdk.threads.spawn({
          ...nativeRequest,
          projectId: configured.project,
          agentId: agent.slug,
          environment: {
            type: "host",
            hostId,
            workspace: { type: "unmanaged", path: workspace },
          },
          title:
            englishAgentName(agent) + " — " + titleFromPrompt(prompt ?? ""),
          ...(agent.provider ? { providerId: agent.provider } : {}),
          ...(agent.model ? { model: agent.model } : {}),
        })
      : await bb.sdk.threads.spawn({
          projectId: configured.project,
          agentId: agent.slug,
          environment: {
            type: "host",
            hostId,
            workspace: { type: "unmanaged", path: workspace },
          },
          prompt: prompt ?? "",
          title:
            englishAgentName(agent) + " — " + titleFromPrompt(prompt ?? ""),
          ...(options.parentThreadId
            ? {
                parentThreadId: options.parentThreadId,
                startedOnBehalfOf: {
                  initiator: "agent" as const,
                  senderThreadId: options.parentThreadId,
                },
              }
            : {}),
          ...(options.visibility ? { visibility: options.visibility } : {}),
          model: agent.model ?? EVA_DEFAULT_MODEL,
          reasoningLevel: EVA_DEFAULT_REASONING_LEVEL,
          ...(agent.provider ? { providerId: agent.provider } : {}),
        });

    db.prepare(
      "INSERT OR REPLACE INTO agent_threads (thread_id, agent_slug, created_at) VALUES (?, ?, ?)",
    ).run(thread.id, agent.slug, Date.now());
    refreshCaches();
    rememberThread(thread);
    publish("thread-started");
    return thread.id;
  }

  refreshCaches();

  const initialSettings = await settings.get();
  agentsWorkspaceRoot = validateWorkspaceRoot(initialSettings.workspacePath);
  ensureAllAgentWorkspaces(false);
  if (!initialSettings.project || !agentsWorkspaceRoot) {
    bb.status.needsConfiguration(
      "Select the shared BB project and agents workspace folder that will host EVA agent threads.",
    );
  } else {
    void hydrateThreadActivity().catch((error) =>
      bb.log.warn(
        "Could not hydrate EVA thread activity: " +
          (error instanceof Error ? error.message : String(error)),
      ),
    );
  }

  settings.onChange((next) => {
    try {
      agentsWorkspaceRoot = validateWorkspaceRoot(next.workspacePath);
      ensureAllAgentWorkspaces(false);
    } catch (error) {
      bb.log.warn(error instanceof Error ? error.message : String(error));
    }
    void hydrateThreadActivity().catch((error) =>
      bb.log.warn(
        "Could not hydrate EVA thread activity: " +
          (error instanceof Error ? error.message : String(error)),
      ),
    );
    publish("project-setting-changed");
  });

  bb.agents.configure((context) => {
    const relatedThreadIds = [
      context.thread.id,
      context.thread.sourceThreadId,
      context.thread.parentThreadId,
    ].filter((id): id is string => id !== null);
    const boundSlug = relatedThreadIds
      .map((id) => threadAgentById.get(id))
      .find((slug): slug is string => slug !== undefined);
    // During threads.spawn the configure hook runs before startThread can
    // persist the new thread id. The spawn title is already present, so this
    // one-time fallback makes the first session receive the agent context too.
    const titleAgent = context.thread.title
      ? Array.from(agentRows.values()).find(
          (candidate) =>
            context.thread.title?.startsWith(candidate.name + " — ") ||
            context.thread.title?.startsWith(
              englishAgentName(candidate) + " — ",
            ),
        )
      : undefined;
    const agent = boundSlug ? agentRows.get(boundSlug) : titleAgent;
    // SDK 0.4.21 requires an empty configuration instead of null to make no
    // contribution for unrelated threads. It is the native equivalent of
    // returning null and keeps the callback valid on every thread start.
    if (agent === undefined) {
      return { tools: [], skills: [] };
    }
    const expectedWorkspace = agentWorkspacePath(agent.slug);
    const hasNativeWorkspaceInstructions =
      expectedWorkspace !== null &&
      context.environment.path === expectedWorkspace;
    const workspaceInstructions =
      agent.slug === "orchestrator"
        ? [
            `You own the configured EVA agents root workspace at ${expectedWorkspace ?? "not configured"}.`,
            "Read and follow the root `AGENTS.md` there before doing any work.",
          ]
        : [
            `Your specialist workspace is ${expectedWorkspace ?? "not configured"}.`,
            "Read and follow `AGENTS.md` in that specialist workspace root before doing any work.",
          ];
    const dynamicInstructions = [
      `You are the registered EVA agent @${agent.slug} (${englishAgentName(agent)}).`,
      modeLine(agent.status),
      ...workspaceInstructions,
      "That `AGENTS.md` file is this agent's authoritative instruction file.",
      ...agentWorkspaceBehaviorInstructions(agent.slug, agentsWorkspaceRoot),
    ].join("\n");
    const instructions = hasNativeWorkspaceInstructions
      ? dynamicInstructions
      : [compiledAgentInstructions(agent), dynamicInstructions].join("\n\n");
    return {
      tools: [],
      skills: [],
      instructions,
    };
  });

  bb.events.on("thread.created", ({ thread }) => {
    if (
      thread.originPluginId === "eva" &&
      typeof thread.agentId === "string" &&
      agentRows.has(thread.agentId)
    ) {
      db.prepare(
        "INSERT OR REPLACE INTO agent_threads (thread_id, agent_slug, created_at) VALUES (?, ?, ?)",
      ).run(thread.id, thread.agentId, thread.createdAt);
      threadAgentById.set(thread.id, thread.agentId);
    }
    rememberThread(thread);
    publish("thread-created");
  });
  bb.events.on("thread.idle", ({ thread }) => {
    rememberThread(thread);
    publish("thread-idle");
  });

  bb.rpc.register(rpcContract, {
    agents_list: async () => {
      const configured = await settings.get();
      return {
        ...listAgents(),
        rootProjectId: configured.project ?? null,
      };
    },
    agents_get: async ({ slug }) => {
      const configured = await settings.get();
      const agent = agentRows.get(slug);
      if (!agent) throw new Error("Unknown EVA agent: " + slug);
      const workspace = agentWorkspacePath(slug);
      const hostId = configured.project
        ? await resolveHostId(configured.project)
        : null;
      return {
        agent: getAgent(slug),
        threads: recentThreads(slug),
        projectId: configured.project ?? null,
        hostId,
        workspacePath: workspace,
      };
    },
    agents_create: async (input) => createAgent(input),
    agents_update: async ({
      slug,
      status,
      instructions,
      skills,
      provider,
      model,
    }) => ({
      agent: await updateAgent(slug, {
        status,
        instructions,
        skills,
        provider,
        model,
      }),
    }),
  });

  const usage = [
    "Usage:",
    "  bb eva agents",
    "  bb eva show <slug>",
    "  bb eva set <slug> --status <draft|shadow|live>",
    '  bb eva start <slug> "<prompt>"',
  ].join("\n");

  function lineForAgent(agent: EvaAgent): string {
    const pinned = agent.provider
      ? " · provider: " + agent.provider
      : " · provider: BB default";
    return (
      agent.slug +
      "  " +
      (ENGLISH_AGENT_NAMES[agent.slug] ?? agent.name) +
      "  [" +
      agent.status +
      "]  " +
      agent.threadCount +
      " threads · " +
      agent.skills.length +
      " skills" +
      pinned
    );
  }

  bb.cli.register({
    name: "eva",
    summary: "Manage the EVA agent registry and its BB conversations",
    commands: [
      {
        name: "agents",
        summary: "List EVA agents, status, and thread counts",
        usage: "bb eva agents",
      },
      {
        name: "show",
        summary: "Show one agent and its custom instructions",
        usage: "bb eva show <slug>",
      },
      {
        name: "set",
        summary: "Set an agent status",
        usage: "bb eva set <slug> --status <draft|shadow|live>",
      },
      {
        name: "start",
        summary: "Start a conversation with an EVA agent",
        usage: 'bb eva start <slug> "<prompt>"',
      },
    ],
    async run(argv) {
      const [command, ...args] = argv;
      try {
        if (command === "agents") {
          const { agents } = listAgents();
          return {
            exitCode: 0,
            stdout: agents.map(lineForAgent).join("\n"),
          };
        }
        if (command === "show" && args.length === 1) {
          const agent = getAgent(args[0] ?? "");
          const output = [
            lineForAgent(agent),
            "",
            ENGLISH_AGENT_TAGLINES[agent.slug] ?? agent.tagline,
            "",
            "Workspace:",
            agentWorkspacePath(agent.slug) ?? "(not configured)",
            "",
            "Instructions:",
            agent.instructions,
            "",
            "Skills:",
            agent.skills.length === 0
              ? "(none)"
              : agent.skills
                  .map((skill) => "- " + skill.name + ": " + skill.instructions)
                  .join("\n"),
          ].join("\n");
          return { exitCode: 0, stdout: output };
        }
        if (command === "set" && args.length === 3 && args[1] === "--status") {
          const slug = args[0] ?? "";
          const status = args[2];
          if (!isAgentStatus(status)) {
            return {
              exitCode: 1,
              stderr: "Status must be draft, shadow, or live.",
            };
          }
          const agent = await updateAgent(slug, { status });
          return { exitCode: 0, stdout: lineForAgent(agent) };
        }
        if (command === "start" && args.length >= 2) {
          const slug = args[0] ?? "";
          const prompt = args.slice(1).join(" ").trim();
          if (!prompt) return { exitCode: 1, stderr: usage };
          const threadId = await startThread(slug, prompt);
          return { exitCode: 0, stdout: "Started " + threadId };
        }
        return { exitCode: 1, stderr: usage };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  bb.onDispose(() => {
    disposed = true;
    bb.log.info("EVA registry disposed");
  });
}
