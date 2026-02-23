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

  fastify.post(
    '/chat/stream',
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

        const response = await fetch(`${upstreamUrl}/v1/streaming_query`, {
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
            `Navigator upstream streaming error: ${response.status} ${response.statusText} - ${errorBody}`,
          );
          return reply.status(response.status).send({
            error: 'Navigator streaming query failed',
            detail: errorBody,
          });
        }

        if (!response.body) {
          fastify.log.error('Navigator upstream returned no response body for streaming query');
          return reply.status(502).send({
            error: 'Navigator streaming response has no body',
          });
        }

        reply.hijack();

        const responseHeaders: Record<string, string> = {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        };

        reply.raw.writeHead(200, responseHeaders);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        try {
          let done = false;
          while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) {
              sseBuffer += decoder.decode(result.value, { stream: !done });

              // Process complete SSE lines
              const lines = sseBuffer.split('\n');
              // Keep the last potentially incomplete line in the buffer
              sseBuffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) {
                  continue;
                }
                try {
                  const parsed = JSON.parse(line.slice(6));
                  if (parsed.event === 'start' && parsed.data?.conversation_id) {
                    // Send conversation ID as an SSE event
                    if (!reply.raw.writableEnded) {
                      reply.raw.write(
                        `data: ${JSON.stringify({
                          event: 'start',
                          conversation_id: parsed.data.conversation_id,
                        })}\n\n`,
                      );
                    }
                  } else if (parsed.event === 'token' && parsed.data?.token != null) {
                    if (!reply.raw.writableEnded) {
                      reply.raw.write(
                        `data: ${JSON.stringify({ event: 'token', token: parsed.data.token })}\n\n`,
                      );
                    }
                  } else if (parsed.event === 'error') {
                    if (!reply.raw.writableEnded) {
                      reply.raw.write(
                        `data: ${JSON.stringify({
                          event: 'error',
                          error: parsed.data?.response || 'Unknown error',
                        })}\n\n`,
                      );
                    }
                  } else if (parsed.event === 'end') {
                    if (!reply.raw.writableEnded) {
                      reply.raw.write(`data: ${JSON.stringify({ event: 'end' })}\n\n`);
                    }
                  }
                } catch {
                  // Skip unparseable lines
                }
              }

              if (reply.raw.writableEnded) {
                break;
              }
            }
          }
        } catch (streamError: unknown) {
          const streamDetail =
            streamError instanceof Error ? streamError.message : String(streamError);
          fastify.log.error(`Navigator stream read error: ${streamDetail}`);
        } finally {
          if (!reply.raw.writableEnded) {
            reply.raw.end();
          }
        }
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        fastify.log.error(`Navigator streaming connection error: ${detail}`);
        return reply.status(503).send({
          error: 'Navigator is unavailable',
          detail,
        });
      }
    },
  );
};
