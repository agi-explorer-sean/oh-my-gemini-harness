export type FallbackEntry = {
  providers: string[];
  model: string;
  variant?: string;
};

export type ModelRequirement = {
  fallbackChain: FallbackEntry[];
  variant?: string;
  requiresModel?: string;
  requiresAnyModel?: boolean;
};

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      {
        providers: ['google', 'gemini'],
        model: 'gemini-3.1-pro-preview',
        variant: 'max',
      },
      {
        providers: ['google', 'gemini'],
        model: 'gemini-2.5-pro',
        variant: 'max',
      },
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      {
        providers: ['google', 'gemini'],
        model: 'gemini-3.1-pro-preview',
        variant: 'max',
      },
    ],
    requiresModel: 'gemini-3.1-pro-preview',
  },
  oracle: {
    fallbackChain: [
      {
        providers: ['google', 'gemini'],
        model: 'gemini-3.1-pro-preview',
        variant: 'max',
      },
    ],
  },
  librarian: {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-flash-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-flash'},
    ],
  },
  explore: {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-flash-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-flash-lite'},
    ],
  },
  'multimodal-looker': {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-flash-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-flash'},
    ],
  },
  prometheus: {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-pro-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-pro'},
    ],
  },
  metis: {
    fallbackChain: [
      {
        providers: ['google', 'gemini'],
        model: 'gemini-3.1-pro-preview',
        variant: 'max',
      },
      {
        providers: ['google', 'gemini'],
        model: 'gemini-2.5-pro',
        variant: 'max',
      },
    ],
  },
  momus: {
    fallbackChain: [
      {
        providers: ['google', 'gemini'],
        model: 'gemini-3.1-pro-preview',
        variant: 'max',
      },
    ],
  },
  atlas: {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-pro-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-pro'},
    ],
  },
};

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  'visual-engineering': {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-pro-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-pro'},
    ],
  },
  ultrabrain: {
    fallbackChain: [
      {
        providers: ['google', 'gemini'],
        model: 'gemini-3.1-pro-preview',
        variant: 'max',
      },
    ],
  },
  deep: {
    fallbackChain: [
      {
        providers: ['google', 'gemini'],
        model: 'gemini-3.1-pro-preview',
        variant: 'max',
      },
    ],
    requiresModel: 'gemini-3.1-pro-preview',
  },
  artistry: {
    fallbackChain: [
      {
        providers: ['google', 'gemini'],
        model: 'gemini-3.1-pro-preview',
        variant: 'max',
      },
    ],
    requiresModel: 'gemini-3.1-pro-preview',
  },
  quick: {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-flash-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-flash-lite'},
    ],
  },
  'unspecified-low': {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-flash-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-flash'},
    ],
  },
  'unspecified-high': {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-pro-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-pro'},
    ],
  },
  writing: {
    fallbackChain: [
      {providers: ['google', 'gemini'], model: 'gemini-3.1-flash-preview'},
      {providers: ['google', 'gemini'], model: 'gemini-2.5-flash'},
    ],
  },
};
