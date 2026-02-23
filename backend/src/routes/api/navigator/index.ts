import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { KubeFastifyInstance } from '../../../types';
import { DEV_MODE } from '../../../utils/constants';

const LIGHTSPEED_NAMESPACE = process.env.LIGHTSPEED_NAMESPACE || 'lightspeed-poc';
const LIGHTSPEED_SERVICE = process.env.LIGHTSPEED_SERVICE || 'lightspeed-stack-service';
const LIGHTSPEED_PORT = process.env.LIGHTSPEED_PORT || '8080';

type ChatRequestBody = {
  message: string;
  page_context?: string;
  conversation_id?: string;
};

const getUpstreamUrl = (): string => {
  if (DEV_MODE) {
    return `http://localhost:${LIGHTSPEED_PORT}`;
  }
  return `http://${LIGHTSPEED_SERVICE}.${LIGHTSPEED_NAMESPACE}.svc.cluster.local:${LIGHTSPEED_PORT}`;
};

export default async (fastify: KubeFastifyInstance): Promise<void> => {
  fastify.post(
    '/chat',
    async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
      const { message, page_context, conversation_id: incomingConversationId } = request.body;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return reply
          .status(400)
          .send({ error: 'message is required and must be a non-empty string' });
      }

      let query = message;
      if (page_context) {
        query = `[User is currently on page: ${page_context}] ${message}`;
      }

      const upstreamUrl = getUpstreamUrl();

      try {
        const token = fastify.kube.currentUser.token;
        const body: Record<string, unknown> = { query, no_tools: false };
        if (incomingConversationId) {
          body.conversation_id = incomingConversationId;
        }

        const response = await fetch(`${upstreamUrl}/v1/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          fastify.log.error(
            `Navigator upstream error: ${response.status} ${response.statusText} - ${errorBody}`,
          );
          return reply.status(response.status).send({
            error: 'Navigator query failed',
            detail: errorBody,
          });
        }

        const data = await response.json();
        const conversationId = data.conversation_id || incomingConversationId;

        reply.header('x-conversation-id', conversationId);
        return reply.send({
          response: data.response,
          conversation_id: conversationId,
          referenced_documents: data.referenced_documents,
        });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        fastify.log.error(`Navigator connection error: ${detail}`);
        return reply.status(503).send({
          error: 'Navigator is unavailable',
          detail,
        });
      }
    },
  );
};
