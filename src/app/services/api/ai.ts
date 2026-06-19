import { request } from './client';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TournamentSuggestions {
  name?: string;
  club?: string;
  sport?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  teamsCount?: number;
  format?: 'groups' | 'knockout' | 'groups+knockout' | 'league';
  status?: 'upcoming' | 'ongoing' | 'completed';
  courts?: string[];
  categories?: string[];
  city?: string;
  matchBreakMinutes?: number;
  playersPerTeam?: number;
  bracketMode?: 'manual' | 'divisions';
  goldClassifiersPerGroup?: number;
  silverClassifiersPerGroup?: number;
  maxMatchesPerDay?: number;
  regulationText?: string;
  matchDurationMinutes?: number;
  enrollmentDeadline?: string;
}

export interface AIChatResponse {
  message: string;
  suggestions?: TournamentSuggestions;
  nextQuestion?: string;
  pendingFields?: string[];
  isComplete?: boolean;
}

export async function sendAIChat(
  messages: ChatMessage[],
  formState?: Record<string, unknown>,
): Promise<AIChatResponse> {
  return request<AIChatResponse>('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, formState }),
  });
}

export interface AdminAIResponse {
  message: string;
}

export async function sendAdminAIChat(
  messages: ChatMessage[],
  currentPage?: string,
): Promise<AdminAIResponse> {
  return request<AdminAIResponse>('/ai/admin-chat', {
    method: 'POST',
    body: JSON.stringify({ messages, currentPage }),
  });
}

// ── Agentic endpoint ──────────────────────────────────────────────────────────

export interface ActionLog {
  tool: string;
  label: string;
  success: boolean;
  detail?: string;
}

export interface AgentResponse {
  message: string;
  actionsExecuted: ActionLog[];
}

export async function sendAgentChat(
  messages: ChatMessage[],
  currentPage?: string,
): Promise<AgentResponse> {
  return request<AgentResponse>('/ai/agent', {
    method: 'POST',
    body: JSON.stringify({ messages, currentPage }),
  });
}
