import {
  Anchor,
  Beaker,
  Bell,
  Bolt,
  Book,
  Box,
  Boxes,
  Bug,
  Cloud,
  Code,
  Compass,
  Cpu,
  Database,
  Feather,
  Flag,
  Folder,
  Gem,
  Globe,
  Hammer,
  Hexagon,
  Key,
  Layers,
  Leaf,
  LifeBuoy,
  Lock,
  Map,
  Package,
  Puzzle,
  Rocket,
  Shield,
  Sparkles,
  Target,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';

/**
 * The glyph vocabulary a project can be given.
 *
 * Curated rather than exhaustive — every icon named here is bundled, so the
 * full several-hundred set the picker eventually searches is not something to
 * import wholesale for a rail that draws one icon per row. Names are stable
 * strings because they are persisted; renaming one orphans a stored choice.
 */
export const PROJECT_GLYPHS: Readonly<Record<string, LucideIcon>> = {
  hexagon: Hexagon,
  lock: Lock,
  shield: Shield,
  database: Database,
  book: Book,
  wrench: Wrench,
  rocket: Rocket,
  package: Package,
  box: Box,
  boxes: Boxes,
  layers: Layers,
  folder: Folder,
  globe: Globe,
  compass: Compass,
  map: Map,
  flag: Flag,
  terminal: Terminal,
  code: Code,
  cpu: Cpu,
  bolt: Bolt,
  zap: Zap,
  key: Key,
  anchor: Anchor,
  beaker: Beaker,
  bug: Bug,
  cloud: Cloud,
  feather: Feather,
  gem: Gem,
  hammer: Hammer,
  leaf: Leaf,
  lifebuoy: LifeBuoy,
  puzzle: Puzzle,
  sparkles: Sparkles,
  target: Target,
  bell: Bell,
};

const NAMES: readonly string[] = Object.keys(PROJECT_GLYPHS);

/**
 * A stable glyph for a project that has not chosen one.
 *
 * Same idea as the deterministic colour: every project reads as distinct
 * before anyone configures anything, and it never changes underneath you.
 */
export function defaultGlyph(projectId: string): string {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  return NAMES[h % NAMES.length] ?? 'hexagon';
}

export function ProjectGlyph({
  projectId,
  glyph,
  color,
  size = 15,
}: {
  projectId: string;
  glyph: string | null;
  color: string;
  size?: number;
}): ReactElement {
  const name = glyph !== null && glyph in PROJECT_GLYPHS ? glyph : defaultGlyph(projectId);
  /* eslint-disable-next-line @typescript-eslint/naming-convention --
     JSX only treats a capitalised identifier as a component, so the local
     holding one has to be PascalCase. The rule cannot express that. */
  const Icon = PROJECT_GLYPHS[name] ?? Hexagon;
  return <Icon size={size} strokeWidth={1.9} color={color} aria-hidden />;
}
