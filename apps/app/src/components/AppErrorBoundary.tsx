import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[EVA] the app crashed", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
          <h1 className="text-base font-medium">
            EVA hit an error and stopped
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A reload is safe. Your threads live on the server and an unsent
            draft is kept locally. If this repeats, contact your administrator.
          </p>
          <button
            type="button"
            className="mt-4 w-full cursor-pointer rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Reload EVA
          </button>
        </div>
      </div>
    );
  }
}
