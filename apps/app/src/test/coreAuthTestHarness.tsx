import { Fragment, type ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { StaticCoreAuthProvider, type CoreAuthState } from "@/lib/core-auth";

const unrestrictedAuth: CoreAuthState = {
  status: "ready",
  authenticated: false,
  required: false,
  user: null,
  bootstrap: null,
  accessPending: false,
  error: null,
  refresh: async () => {},
  signIn: async () => null,
  signOut: async () => {},
};

export function UnrestrictedCoreAuth({ children }: { children: ReactNode }) {
  return (
    <StaticCoreAuthProvider value={unrestrictedAuth}>
      {children}
    </StaticCoreAuthProvider>
  );
}

export function renderWithCoreAuth(ui: ReactNode, options?: RenderOptions) {
  const Wrapper = options?.wrapper ?? Fragment;
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <UnrestrictedCoreAuth>
        <Wrapper>{children}</Wrapper>
      </UnrestrictedCoreAuth>
    ),
  });
}
