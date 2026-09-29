import type { ComponentType } from "react";
import { BBLivePreview, COMPOSITION_ID, DEFAULT_BB_LIVE_PREVIEW_PROPS } from "./Composition";
import { QuoteCard, SocialLaunch } from "./Templates";
import type { PreviewTemplateProps } from "./preview-types";

export type CompositionDefinition = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly component: ComponentType<PreviewTemplateProps>;
  readonly durationInFrames: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly inputProps: PreviewTemplateProps;
};

export const COMPOSITION_CATALOG = [
  {
    id: COMPOSITION_ID,
    title: "Motion System",
    description: "A wide title card with a moving light field and orbit mark.",
    component: BBLivePreview,
    durationInFrames: 240,
    fps: 30,
    width: 1280,
    height: 720,
    inputProps: DEFAULT_BB_LIVE_PREVIEW_PROPS,
  },
  {
    id: "SocialLaunch",
    title: "Social Launch",
    description: "A vertical launch card sized for short-form social video.",
    component: SocialLaunch,
    durationInFrames: 180,
    fps: 30,
    width: 1080,
    height: 1920,
    inputProps: {
      headline: "Ship the story.",
      subhead: "A clean vertical template for a launch moment.",
      accent: "#ef8354",
    },
  },
  {
    id: "QuoteCard",
    title: "Quote Card",
    description: "A square editorial card for a single strong idea.",
    component: QuoteCard,
    durationInFrames: 150,
    fps: 30,
    width: 1080,
    height: 1080,
    inputProps: {
      headline: "Ideas need room to move.",
      subhead: "A quiet square canvas for a thought worth sharing.",
      accent: "#b85c38",
    },
  },
] as const satisfies readonly CompositionDefinition[];

export type CompositionId = (typeof COMPOSITION_CATALOG)[number]["id"];

export const DEFAULT_COMPOSITION_ID = COMPOSITION_CATALOG[0].id;

export function getCompositionDefinition(
  compositionId: string,
): CompositionDefinition | undefined {
  return COMPOSITION_CATALOG.find(({ id }) => id === compositionId);
}
