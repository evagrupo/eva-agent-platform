import { Icon, type IconName } from "@bb/shared-ui/icon";
import { usePrefersReducedMotion } from "@bb/shared-ui/hooks/use-media-query";
import { useNavigate } from "react-router-dom";
import { getEvaAgentsRoutePath } from "@/lib/route-paths";

interface RootComposeEmptyWelcomeProps {
  onCompose: (prompt?: string) => void;
}

interface WelcomeActionProps {
  icon: IconName;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}

function WelcomeAction({
  icon,
  title,
  description,
  onClick,
  disabled,
}: WelcomeActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon
        name={icon}
        aria-hidden
        className="size-5 shrink-0 text-subtle-foreground group-hover:text-foreground"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function RootComposeEmptyWelcome({
  onCompose,
}: RootComposeEmptyWelcomeProps) {
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div className="flex flex-col items-center gap-12 duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
      <svg aria-hidden className="absolute h-0 w-0" focusable="false">
        <defs>
          <filter
            id="bb-gloss"
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="bump" />
            <feSpecularLighting
              in="bump"
              surfaceScale="5"
              specularConstant="0.85"
              specularExponent="18"
              lightingColor="#ffffff"
              result="spec"
            >
              <fePointLight x="40" y="10" z="80">
                {reducedMotion ? null : (
                  <animate
                    attributeName="x"
                    dur="5s"
                    repeatCount="indefinite"
                    calcMode="spline"
                    keyTimes="0;0.5;1"
                    values="-170;270;-170"
                    keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
                  />
                )}
              </fePointLight>
            </feSpecularLighting>
            <feMorphology
              in="SourceAlpha"
              operator="erode"
              radius="0.75"
              result="innerAlpha"
            />
            <feComposite
              in="spec"
              in2="innerAlpha"
              operator="in"
              result="specClip"
            />
            <feComposite
              in="SourceGraphic"
              in2="specClip"
              operator="arithmetic"
              k1="0"
              k2="1"
              k3="1"
              k4="0"
            />
          </filter>
        </defs>
      </svg>
      <div
        role="img"
        aria-label="EVA"
        className="h-24 w-28 select-none"
        style={{ filter: "url(#bb-gloss)" }}
      >
        <img
          src="/eva/logo-primary.svg"
          alt=""
          aria-hidden
          draggable={false}
          className="size-full object-contain"
        />
      </div>
      <div className="flex w-full max-w-[360px] flex-col gap-1">
        <WelcomeAction
          icon="MessageSquarePlus"
          title="New thread"
          description="Start a new conversation"
          onClick={() => onCompose()}
        />
        <WelcomeAction
          icon="Bot"
          title="Agents"
          description="Browse and open the agent workspace"
          onClick={() => {
            void navigate(getEvaAgentsRoutePath());
          }}
        />
      </div>
    </div>
  );
}
