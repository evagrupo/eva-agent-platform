import type { PermissionMode, ReasoningLevel } from "@bb/domain";
import type { CorePolicy } from "../access-policy.js";

export const EVA_DEFAULT_PROVIDER_ID = "acp-cursor" as const;
export const EVA_DEFAULT_MODEL = "grok-4.7" as const;
export const EVA_DEFAULT_REASONING_LEVEL = "high" as const;
export const EVA_DEFAULT_PERMISSION_MODE = "accept-edits" as const;

const EVA_CODEX_DEFAULT_MODEL = "gpt-5.6-luna" as const;
const EVA_CODEX_DEFAULT_REASONING_LEVEL = "max" as const;

export const EVA_REGISTERED_PROVIDER_IDS = [
  "codex",
  "claude-code",
  "pi",
  "acp-cursor",
] as const;

export interface EvaAgentCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  sortOrder: number;
  status: "draft" | "shadow" | "live";
  sourceProviderId: string | null;
  providerIds: readonly string[];
  defaultProviderId: string | null;
  defaultModel: string;
  defaultReasoningLevel: ReasoningLevel;
  defaultPermissionMode: PermissionMode;
  fixedExecution: boolean;
  reasoningLevels: readonly ReasoningLevel[];
  permissionModes: readonly PermissionMode[];
  instructions: string;
}

const EVA_REASONING_LEVELS: readonly ReasoningLevel[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
];

const EVA_PERMISSION_MODES: readonly PermissionMode[] = [
  "accept-edits",
  "auto",
  "full",
];

function sourceAgent(args: {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  sortOrder: number;
  sourceProviderId?: string;
  instructions: string;
}): EvaAgentCatalogEntry {
  const sourceProviderId = args.sourceProviderId ?? null;
  const defaultProviderId = sourceProviderId ?? EVA_DEFAULT_PROVIDER_ID;
  const pinnedToCodex = defaultProviderId === "codex";
  return {
    ...args,
    status: "draft",
    sourceProviderId,
    providerIds: sourceProviderId
      ? [sourceProviderId]
      : [...EVA_REGISTERED_PROVIDER_IDS],
    defaultProviderId,
    defaultModel: pinnedToCodex ? EVA_CODEX_DEFAULT_MODEL : EVA_DEFAULT_MODEL,
    defaultReasoningLevel: pinnedToCodex
      ? EVA_CODEX_DEFAULT_REASONING_LEVEL
      : EVA_DEFAULT_REASONING_LEVEL,
    defaultPermissionMode: EVA_DEFAULT_PERMISSION_MODE,
    fixedExecution: false,
    reasoningLevels: EVA_REASONING_LEVELS,
    permissionModes: EVA_PERMISSION_MODES,
  };
}

export const EVA_AGENT_CATALOG: readonly EvaAgentCatalogEntry[] = [
  sourceAgent({
    id: "orchestrator",
    displayName: "Orquestador Maestro",
    description: "Decide qué agente actúa y controla los límites",
    icon: "Network",
    sortOrder: 1,
    instructions:
      "Coordina las peticiones entre agentes, aclara objetivos y asigna el trabajo al especialista correcto. Si el usuario menciona un agente EVA permitido con @ y describe una tarea concreta, crea un hilo hijo BB para ese agente con eva_delegate_to_agent, indicando un alcance acotado y el resultado esperado; después lee el resultado del hijo antes de resumirlo. Una mención sin tarea no inicia trabajo: pide una aclaración. Límite estricto: no ejecutes campañas, envíos, cambios de datos ni aprobaciones; resume opciones, dependencias y riesgos para decisión humana.",
  }),
  sourceAgent({
    id: "compliance",
    displayName: "Cumplimiento",
    description: "Revisa y aprueba todo lo que sale al público",
    icon: "ShieldCheck",
    sortOrder: 2,
    instructions:
      "Revisa materiales públicos, anuncios y mensajes frente a políticas y riesgos de cumplimiento. Límite estricto: nunca apruebes un diagnóstico ni una afirmación de cura; señala reclamaciones que requieran revisión legal o humana y no publiques nada.",
  }),
  sourceAgent({
    id: "creative",
    displayName: "Creatividad",
    description: "Crea anuncios, imágenes, vídeos y páginas",
    icon: "Sparkles",
    sortOrder: 3,
    sourceProviderId: "codex",
    instructions:
      "Crea conceptos para anuncios, imágenes, vídeos y páginas alineados con la marca. Para cada concepto creativo usa tu propia herramienta de generación de imágenes y entrega salida visual por defecto, no una descripción escrita de una imagen; produce varias variaciones por concepto. Límite estricto: no publiques activos ni hagas afirmaciones médicas, de resultados garantizados o no aprobadas.",
  }),
  sourceAgent({
    id: "meta",
    displayName: "Meta",
    description: "Campañas de Facebook e Instagram",
    icon: "Meta",
    sortOrder: 4,
    instructions:
      "Analiza y propone estructura, audiencias, creatividades y experimentos para campañas de Facebook e Instagram. Límite estricto: no lances, pauses ni cambies presupuestos o segmentaciones; entrega propuestas medibles y solicita aprobación antes de cualquier activación.",
  }),
  sourceAgent({
    id: "tiktok",
    displayName: "TikTok",
    description: "Campañas y creatividades de TikTok",
    icon: "TikTok",
    sortOrder: 5,
    instructions:
      "Diseña campañas, guiones y variaciones creativas para TikTok con hipótesis claras de crecimiento. Límite estricto: no publiques, compres medios ni declares resultados garantizados; conserva una revisión humana para cualquier pieza pública.",
  }),
  sourceAgent({
    id: "google",
    displayName: "Google",
    description: "Búsquedas, palabras clave y campañas de Google",
    icon: "Google",
    sortOrder: 6,
    instructions:
      "Investiga intención de búsqueda, palabras clave y propuestas de campañas de Google. Límite estricto: no modifiques pujas, presupuestos, conversiones ni anuncios activos; separa hechos de hipótesis y evita promesas engañosas.",
  }),
  sourceAgent({
    id: "crm",
    displayName: "CRM y Call Center",
    description: "Cola de leads, operadores y primera llamada",
    icon: "PhoneCall",
    sortOrder: 7,
    instructions:
      "Ayuda a priorizar leads, preparar guiones de primera llamada y ordenar la cola de operadores. Límite estricto: no contactes, llames ni suplantes a una persona; minimiza datos personales y deja la decisión y la acción a un operador autorizado.",
  }),
  sourceAgent({
    id: "email",
    displayName: "Correo",
    description: "Clasifica el correo y crea tareas",
    icon: "Mail",
    sortOrder: 8,
    instructions:
      "Clasifica el correo entrante, identifica urgencias y prepara tareas o borradores de respuesta. Límite estricto: no envíes mensajes, no reveles información sensible y no descartes correo sin revisión humana.",
  }),
  sourceAgent({
    id: "voice",
    displayName: "Voz IA",
    description: "Llamadas y voz en la app y la web",
    icon: "Mic",
    sortOrder: 9,
    instructions:
      "Diseña flujos, guiones y experiencia de voz para llamadas, la app y la web. Límite estricto: no imites a una persona real sin consentimiento, no realices llamadas y no presentes la voz IA como un humano.",
  }),
  sourceAgent({
    id: "recobro",
    displayName: "Recobro",
    description: "Impagos y devoluciones hasta el cobro",
    icon: "CreditCard",
    sortOrder: 10,
    instructions:
      "Propón secuencias respetuosas para impagos, devoluciones y seguimiento de cobro. Límite estricto: nunca amenaces, acoses, cobres sin autorización ni emitas asesoramiento legal; escala excepciones y decisiones sensibles a una persona.",
  }),
  sourceAgent({
    id: "people",
    displayName: "RR. HH.",
    description: "Productividad del equipo y capacidad",
    icon: "Users",
    sortOrder: 11,
    instructions:
      "Observa productividad, carga y capacidad del equipo para detectar riesgos y proponer análisis. Límite estricto: opera solo en shadow, nunca propongas disciplina, despidos, compensación ni decisiones individuales sobre personas.",
  }),
];

const EVA_AGENT_IDS = new Set(EVA_AGENT_CATALOG.map((entry) => entry.id));
const EVA_PROVIDER_IDS = new Set<string>(EVA_REGISTERED_PROVIDER_IDS);

function ruleAllows(rules: readonly string[], value: string): boolean {
  return rules.includes("*") || rules.includes(value);
}

export function isKnownEvaAgentId(agentId: string): boolean {
  return EVA_AGENT_IDS.has(agentId);
}

export function isKnownEvaProviderId(providerId: string): boolean {
  return EVA_PROVIDER_IDS.has(providerId);
}

export function findEvaAgent(agentId: string): EvaAgentCatalogEntry | null {
  return EVA_AGENT_CATALOG.find((entry) => entry.id === agentId) ?? null;
}

export function listAllowedEvaAgents(
  policy: CorePolicy,
): EvaAgentCatalogEntry[] {
  return EVA_AGENT_CATALOG.filter((entry) =>
    ruleAllows(policy.allowedAgentIds, entry.id),
  );
}

export function requireEvaAgent(agentId: string): EvaAgentCatalogEntry {
  const entry = findEvaAgent(agentId);
  if (entry === null) throw new Error(`Unknown EVA agent "${agentId}"`);
  return entry;
}

export function evaAgentAllowsProvider(
  agentId: string,
  providerId: string,
): boolean {
  return findEvaAgent(agentId)?.providerIds.includes(providerId) ?? false;
}
