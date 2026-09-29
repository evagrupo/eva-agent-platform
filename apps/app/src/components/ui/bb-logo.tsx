import { cn } from "@bb/shared-ui/lib/utils";

export function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src="/eva/logo-primary.svg"
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain")}
    />
  );
}

export function EvaWordmark({ className = "h-6 w-auto" }: { className?: string }) {
  return (
    <span className="inline-flex items-center" role="img" aria-label="EVA">
      <img
        src="/eva/eva-logo-black.webp"
        alt=""
        aria-hidden="true"
        className={cn(className, "object-contain dark:hidden")}
      />
      <img
        src="/eva/eva-logo-white.webp"
        alt=""
        aria-hidden="true"
        className={cn(className, "hidden object-contain dark:block")}
      />
    </span>
  );
}
