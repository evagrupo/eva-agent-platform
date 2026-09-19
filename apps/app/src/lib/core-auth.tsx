import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate } from "react-router-dom";
import type { PermissionMode, ReasoningLevel } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";

export interface CoreAuthUser {
  id: string;
  role: "admin" | "user";
}

export interface CoreAuthAgent {
  id: string;
  displayName: string;
  description: string;
  providerIds: string[];
  reasoningLevels: ReasoningLevel[];
  permissionModes: PermissionMode[];
  defaultProviderId?: string | null;
  defaultModel?: string | null;
  defaultReasoningLevel?: ReasoningLevel | null;
  defaultPermissionMode?: PermissionMode | null;
  fixedExecution?: boolean;
}

export interface CoreAuthAgentExecutionTuple {
  agentId: string;
  providerIds: string[];
  models: string[];
  reasoningLevels: ReasoningLevel[];
  defaultProviderId: string | null;
  defaultModel: string | null;
  defaultReasoningLevel: ReasoningLevel | null;
  defaultPermissionMode: PermissionMode | null;
  fixed: boolean;
  maxPermissionMode: PermissionMode;
  terminalAccess: string;
  toolIds: string[];
  pluginIds: string[];
}

export const coreCapabilityNames = [
  "workspaceBootstrap",
  "sidebarFooter",
  "settings",
  "threadInfo",
  "secondaryPanelTabs",
  "terminalRead",
  "terminalControl",
  "terminalFull",
  "files",
  "environments",
  "hosts",
  "projects",
  "plugins",
  "pluginData",
  "threadOwnRead",
  "threadAllRead",
  "threadOwnWrite",
  "threadAllWrite",
] as const;

export type CoreCapability = (typeof coreCapabilityNames)[number];
export type CoreCapabilities = Record<CoreCapability, boolean>;

export interface CoreAuthBootstrap {
  policyRevision: number;
  capabilities: {
    core: CoreCapabilities;
    execution: {
      agents: CoreAuthAgent[];
      agentTuples?: CoreAuthAgentExecutionTuple[];
      defaultAgentId?: string | null;
    };
  };
  plugins: {
    allowedIds: string[];
  };
}

interface CoreAuthStatus {
  authenticated: boolean;
  required: boolean;
  user?: CoreAuthUser;
}

export type CoreAuthState = {
  status: "loading" | "ready" | "error";
  authenticated: boolean;
  required: boolean;
  user: CoreAuthUser | null;
  bootstrap: CoreAuthBootstrap | null;
  accessPending: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const CoreAuthContext = createContext<CoreAuthState | null>(null);

function isCoreAuthStatus(value: unknown): value is CoreAuthStatus {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.authenticated !== "boolean" ||
    typeof record.required !== "boolean"
  ) {
    return false;
  }
  if (record.user === undefined) return true;
  if (typeof record.user !== "object" || record.user === null) return false;
  const user = record.user as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    (user.role === "admin" || user.role === "user")
  );
}

function isCoreAuthBootstrap(value: unknown): value is CoreAuthBootstrap {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.policyRevision !== "number") return false;
  if (typeof record.capabilities !== "object" || record.capabilities === null) {
    return false;
  }
  const capabilities = record.capabilities as Record<string, unknown>;
  if (typeof capabilities.core !== "object" || capabilities.core === null) {
    return false;
  }
  const core = capabilities.core as Record<string, unknown>;
  if (
    coreCapabilityNames.some(
      (capability) => typeof core[capability] !== "boolean",
    )
  ) {
    return false;
  }
  if (
    typeof capabilities.execution !== "object" ||
    capabilities.execution === null
  ) {
    return false;
  }
  const execution = capabilities.execution as Record<string, unknown>;
  if (
    execution.defaultAgentId !== undefined &&
    execution.defaultAgentId !== null &&
    typeof execution.defaultAgentId !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(execution.agents)) return false;
  if (
    !execution.agents.every((agent) => {
      if (typeof agent !== "object" || agent === null) return false;
      const entry = agent as Record<string, unknown>;
      return (
        typeof entry.id === "string" &&
        typeof entry.displayName === "string" &&
        typeof entry.description === "string" &&
        Array.isArray(entry.providerIds) &&
        entry.providerIds.every((id) => typeof id === "string") &&
        Array.isArray(entry.reasoningLevels) &&
        entry.reasoningLevels.every((level) => typeof level === "string") &&
        Array.isArray(entry.permissionModes) &&
        entry.permissionModes.every((mode) => typeof mode === "string")
      );
    })
  ) {
    return false;
  }
  if (
    !execution.agents.every((agent) => {
      const entry = agent as Record<string, unknown>;
      return (
        (entry.defaultProviderId === undefined ||
          entry.defaultProviderId === null ||
          typeof entry.defaultProviderId === "string") &&
        (entry.defaultModel === undefined ||
          entry.defaultModel === null ||
          typeof entry.defaultModel === "string") &&
        (entry.defaultReasoningLevel === undefined ||
          entry.defaultReasoningLevel === null ||
          typeof entry.defaultReasoningLevel === "string") &&
        (entry.defaultPermissionMode === undefined ||
          entry.defaultPermissionMode === null ||
          typeof entry.defaultPermissionMode === "string") &&
        (entry.fixedExecution === undefined ||
          typeof entry.fixedExecution === "boolean")
      );
    })
  ) {
    return false;
  }
  if (execution.agentTuples !== undefined) {
    if (
      !Array.isArray(execution.agentTuples) ||
      !execution.agentTuples.every((tuple) => {
        if (typeof tuple !== "object" || tuple === null) return false;
        const entry = tuple as Record<string, unknown>;
        return (
          typeof entry.agentId === "string" &&
          Array.isArray(entry.providerIds) &&
          entry.providerIds.every((id) => typeof id === "string") &&
          Array.isArray(entry.models) &&
          entry.models.every((model) => typeof model === "string") &&
          Array.isArray(entry.reasoningLevels) &&
          entry.reasoningLevels.every((level) => typeof level === "string") &&
          (entry.defaultProviderId === null ||
            typeof entry.defaultProviderId === "string") &&
          (entry.defaultModel === null ||
            typeof entry.defaultModel === "string") &&
          (entry.defaultReasoningLevel === null ||
            typeof entry.defaultReasoningLevel === "string") &&
          (entry.defaultPermissionMode === null ||
            typeof entry.defaultPermissionMode === "string") &&
          typeof entry.fixed === "boolean" &&
          typeof entry.maxPermissionMode === "string" &&
          typeof entry.terminalAccess === "string" &&
          Array.isArray(entry.toolIds) &&
          entry.toolIds.every((toolId) => typeof toolId === "string") &&
          Array.isArray(entry.pluginIds) &&
          entry.pluginIds.every((pluginId) => typeof pluginId === "string")
        );
      })
    ) {
      return false;
    }
  }
  if (typeof record.plugins !== "object" || record.plugins === null) {
    return false;
  }
  const plugins = record.plugins as Record<string, unknown>;
  return (
    Array.isArray(plugins.allowedIds) &&
    plugins.allowedIds.every((pluginId) => typeof pluginId === "string")
  );
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function CoreAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    authenticated: boolean;
    required: boolean;
    user: CoreAuthUser | null;
    bootstrap: CoreAuthBootstrap | null;
    accessPending: boolean;
    error: string | null;
  }>({
    status: "loading",
    authenticated: false,
    required: true,
    user: null,
    bootstrap: null,
    accessPending: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const response = await fetch("/api/v1/access/status", {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const body = await readResponseBody(response);
      if (!response.ok || !isCoreAuthStatus(body)) {
        throw new Error("Authentication status is unavailable");
      }
      let bootstrap: CoreAuthBootstrap | null = null;
      if (body.authenticated) {
        const bootstrapResponse = await fetch("/api/v1/access/me", {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        const bootstrapBody = await readResponseBody(bootstrapResponse);
        if (bootstrapResponse.status === 403) {
          setState({
            status: "ready",
            authenticated: true,
            required: body.required,
            user: body.user ?? null,
            bootstrap: null,
            accessPending: true,
            error:
              "Your EVA workspace is ready, but access is pending. Ask an administrator to enable your workspace policy.",
          });
          return;
        }
        if (!bootstrapResponse.ok || !isCoreAuthBootstrap(bootstrapBody)) {
          throw new Error("Authentication policy is unavailable");
        }
        bootstrap = bootstrapBody;
      }
      setState({
        status: "ready",
        authenticated: body.authenticated,
        required: body.required,
        user: body.user ?? null,
        bootstrap,
        accessPending: false,
        error: null,
      });
    } catch {
      setState((current) => ({
        ...current,
        status: "error",
        authenticated: false,
        user: null,
        bootstrap: null,
        accessPending: false,
        error: "The EVA security service is unavailable. Try again.",
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const response = await fetch("/api/auth/sign-in/email", {
          method: "POST",
          credentials: "include",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) {
          return "Sign-in failed. Check your credentials or ask an administrator.";
        }
        await refresh();
        return null;
      } catch {
        return "The EVA security service is unavailable. Try again.";
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
      });
    } finally {
      await refresh();
    }
  }, [refresh]);

  const value = useMemo<CoreAuthState>(
    () => ({ ...state, refresh, signIn, signOut }),
    [refresh, signIn, signOut, state],
  );

  return (
    <CoreAuthContext.Provider value={value}>
      {children}
    </CoreAuthContext.Provider>
  );
}

export function useCoreAuth(): CoreAuthState | null {
  return useContext(CoreAuthContext);
}

function EvaMark() {
  return (
    <img
      src="/eva/logo-primary.svg"
      alt="EVA"
      width={61}
      height={38}
      className="h-9 w-auto"
    />
  );
}

function AuthLoadingView() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-4"
      aria-busy="true"
      aria-label="Loading secure EVA workspace"
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <EvaMark />
        <span>Securing your workspace…</span>
      </div>
    </main>
  );
}

function AuthUnavailableView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <EvaMark />
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              EVA Internal Platform
            </p>
            <h1 className="mt-1 text-lg font-semibold">
              Secure workspace unavailable
            </h1>
          </div>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">{message}</p>
        <Button className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      </section>
    </main>
  );
}

function AccessPendingView({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <EvaMark />
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              EVA Internal Platform
            </p>
            <h1 className="mt-1 text-lg font-semibold">
              Workspace access pending
            </h1>
          </div>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={onRetry}>Check again</Button>
          <Button variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}

function LoginView() {
  const auth = useCoreAuth();
  const [locale, setLocale] = useState<"en" | "es">("en");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const copy =
    locale === "es"
      ? {
          eyebrow: "Plataforma interna EVA",
          title: "Accede a tu espacio seguro",
          description: "Usa las credenciales asignadas por un administrador.",
          email: "Correo electrónico",
          password: "Contraseña",
          submit: "Entrar",
          submitting: "Verificando…",
          language: "Idioma",
          help: "El registro público está desactivado.",
        }
      : {
          eyebrow: "EVA Internal Platform",
          title: "Enter your secure workspace",
          description: "Use the credentials provided by an administrator.",
          email: "Email",
          password: "Password",
          submit: "Sign in",
          submitting: "Verifying…",
          language: "Language",
          help: "Public self-registration is disabled.",
        };

  if (auth === null) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await auth.signIn(email.trim(), password);
    if (result !== null) setError(result);
    setSubmitting(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-[0.9fr_1.1fr]">
        <section className="flex flex-col justify-between border-b border-border bg-surface-recessed p-7 md:border-b-0 md:border-r md:p-10">
          <div>
            <EvaMark />
            <p className="mt-8 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {copy.eyebrow}
            </p>
            <h1 className="mt-3 max-w-xs text-3xl font-semibold tracking-tight">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
              {copy.description}
            </p>
          </div>
          <p className="mt-12 text-xs text-muted-foreground">{copy.help}</p>
        </section>
        <section className="p-7 md:p-10">
          <div className="flex justify-end">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{copy.language}</span>
              <select
                aria-label={copy.language}
                value={locale}
                onChange={(event) =>
                  setLocale(event.target.value as "en" | "es")
                }
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </label>
          </div>
          <form className="mt-12 space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="eva-login-email">
                {copy.email}
              </label>
              <Input
                id="eva-login-email"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="eva-login-password"
              >
                {copy.password}
              </label>
              <Input
                id="eva-login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? (
              <p
                className="rounded-md border border-destructive/40 bg-surface-destructive px-3 py-2 text-sm text-destructive-text"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting ? copy.submitting : copy.submit}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}

export function CoreAuthGate({ children }: { children: ReactNode }) {
  const auth = useCoreAuth();
  if (auth === null) return <>{children}</>;
  if (auth.status === "loading") return <AuthLoadingView />;
  if (auth.accessPending) {
    return (
      <AccessPendingView
        message={
          auth.error ??
          "Your EVA workspace is ready, but access is pending. Ask an administrator to enable your workspace policy."
        }
        onRetry={() => void auth.refresh()}
        onSignOut={() => void auth.signOut()}
      />
    );
  }
  if (auth.status === "error") {
    return (
      <AuthUnavailableView
        message={auth.error ?? "The EVA security service is unavailable."}
        onRetry={() => void auth.refresh()}
      />
    );
  }
  if (auth.required && !auth.authenticated) return <LoginView />;
  return <>{children}</>;
}

export function hasCoreCapability(
  bootstrap: CoreAuthBootstrap | null,
  capability: CoreCapability,
): boolean {
  return bootstrap?.capabilities.core[capability] === true;
}

export function canUseCoreCapability(
  auth: CoreAuthState | null,
  capability: CoreCapability,
): boolean {
  if (auth?.status === "ready" && !auth.required && !auth.authenticated) {
    return true;
  }
  return hasCoreCapability(auth?.bootstrap ?? null, capability);
}

export function canUseCorePlugin(
  auth: CoreAuthState | null,
  pluginId: string,
): boolean {
  if (
    auth === null ||
    (auth.status === "ready" && !auth.required && !auth.authenticated)
  ) {
    return true;
  }
  if (
    !canUseCoreCapability(auth, "plugins") ||
    !canUseCoreCapability(auth, "pluginData")
  ) {
    return false;
  }
  const allowedIds = auth.bootstrap?.plugins.allowedIds;
  return (
    allowedIds?.includes("*") === true ||
    allowedIds?.includes(pluginId) === true
  );
}

export function CoreCapabilityGate({
  capability,
  children,
}: {
  capability: CoreCapability;
  children: ReactNode;
}) {
  const auth = useCoreAuth();
  if (auth === null || auth.status !== "ready") {
    return null;
  }
  if (!canUseCoreCapability(auth, capability)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
