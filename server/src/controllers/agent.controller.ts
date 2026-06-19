import type { Request, Response, NextFunction } from 'express';
import { runAgentLoop, type AgentMessage } from '../services/agent.service';
import { getPool } from '../config/database';

export async function agentChat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: 'No autorizado' });
      return;
    }

    const { messages, currentPage } = req.body as {
      messages?: AgentMessage[];
      currentPage?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ message: '"messages" es requerido' });
      return;
    }

    // Get username for the system prompt
    const pool = getPool();
    const userRes = await pool.query(
      'SELECT username, display_name FROM users WHERE id = $1',
      [userId],
    );
    const username = userRes.rows[0]?.display_name ?? userRes.rows[0]?.username ?? 'Administrador';

    const result = await runAgentLoop(userId, username, messages, currentPage);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
