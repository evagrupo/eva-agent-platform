import { cn } from "@bb/shared-ui/lib/utils";

export function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src="/eva/logo-primary.svg"
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}
