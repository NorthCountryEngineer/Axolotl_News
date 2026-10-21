export type GameSpec = {
  version: 1;
  title: string;
  description: string;
  genre: 'collect' | 'dodge' | 'platformer';
  theme: 'pond' | 'space' | 'garden';
  player: { name: string; color: string; speed: number; jump: number };
  rules: { goal: number; timeLimit: number; lives: number; difficulty: number };
  objects: { collectible: string; hazard: string };
  instructions: string;
};

export type GameMessage = { id: string; role: 'user' | 'assistant'; text: string };
export type Game = {
  id: string;
  spec: GameSpec;
  revision: number;
  status: 'Draft' | 'Published';
  messages?: GameMessage[];
  testedRevision?: number;
  publishedRevision?: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  operationState?: 'pending' | 'uncertain';
  operationError?: string;
};
export type GameConfig = { version: 1; revision: number; creationEnabled: boolean; assistantModeId: string };
export type GameSettings = { config: GameConfig; canCreate: boolean; canPublish: boolean; canManage: boolean; canAdminContent: boolean };
export type GameResult = { outcome: 'won' | 'lost'; elapsed: number; score: number };
